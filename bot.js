'use strict';

const SteamUser              = require('steam-user');
const SteamTradeOfferManager = require('steam-tradeoffer-manager');
const SteamCommunity         = require('steamcommunity');
const SteamTOTP              = require('steam-totp');
const fs                     = require('fs');
const path                   = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const DATA_PATH   = path.join(__dirname, 'data.json');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; }
}
function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')); } catch { return { sets: [] }; }
}
function saveData(d) { fs.writeFileSync(DATA_PATH, JSON.stringify(d, null, 2)); }
const delay = ms => new Promise(r => setTimeout(r, ms));

// ── 보석 아이템 판별 ────────────────────────────────────────────────────────────
// Steam 보석의 실제 type: "Gem" (낱개), "Gem" (주머니도 동일)
// market_hash_name: "Gems" (낱개), "Sack of Gems" (주머니)
function isGemItem(item) {
  const name = (item.market_hash_name || item.name || '').toLowerCase();
  const type = (item.type || '').toLowerCase();
  const tags  = item.tags || [];

  // 1. market_hash_name 기준 (가장 확실)
  if (name === 'gems' || name === 'sack of gems') return true;

  // 2. type 기준
  if (type === 'gem' || type === 'steam gems' || type === 'gems') return true;

  // 3. tags의 item_class_7 (Steam Gem class)
  if (tags.some(t => t.internal_name === 'item_class_7')) return true;

  return false;
}

function isSackOfGems(item) {
  const name = (item.market_hash_name || item.name || '').toLowerCase();
  return name.includes('sack') && name.includes('gem');
}

// 보석 수량 계산 (주머니는 1000개)
function getGemCount(item) {
  if (isSackOfGems(item)) {
    return (parseInt(item.amount) || 1) * 1000;
  }
  return parseInt(item.amount) || 1;
}

// ── 관리자 인벤토리 조회 (봇 community 쿠키 사용 → 403 없음) ───────────────────
function fetchInventoryViaCommunity(community, steamId) {
  return new Promise((resolve, reject) => {
    community.getUserInventoryContents(steamId, 753, 6, true, 'english', (err, items) => {
      if (err) return reject(new Error(`인벤토리 조회 실패: ${err.message}`));
      resolve(items || []);
    });
  });
}

// 트레이딩 카드 필터 (노말만, 포일 제외)
function filterTradingCards(items) {
  return items.filter(item => {
    const type = (item.type || '').toLowerCase();
    if (!type.includes('trading card')) return false;
    if (type.includes('foil')) return false;
    return true;
  });
}

// appId 추출
function getAppIdFromItem(item) {
  if (item.market_fee_app) return String(item.market_fee_app);
  const tags = item.tags || [];
  const gameTag = tags.find(t => t.category === 'Game');
  if (gameTag) {
    const m = (gameTag.internal_name || '').match(/(\d+)/);
    if (m) return m[1];
  }
  return null;
}

class SteamBot {
  constructor() {
    this.client      = new SteamUser();
    this.community   = new SteamCommunity();
    this.manager     = null;
    this.isLoggedIn  = false;
    this.loginError  = null;
    this.logs        = [];
    this.botSteamId  = null;
  }

  log(msg) {
    const entry = `[${new Date().toLocaleString('ko-KR')}] ${msg}`;
    console.log(`[BOT] ${msg}`);
    this.logs.unshift(entry);
    if (this.logs.length > 100) this.logs.pop();
  }

  getStatus() {
    return {
      isLoggedIn: this.isLoggedIn,
      loginError: this.loginError,
      botSteamId: this.botSteamId,
      logs:       this.logs.slice(0, 30),
    };
  }

  async login() {
    const config = loadConfig();
    if (!config.steamLogin || !config.steamPassword)
      throw new Error('스팀 로그인 정보가 없습니다. 봇 설정을 먼저 저장하세요.');
    if (!config.sharedSecret)
      throw new Error('Shared Secret이 없습니다. 봇 설정을 먼저 저장하세요.');

    return new Promise((resolve, reject) => {
      if (this.isLoggedIn) {
        try { this.client.logOff(); } catch {}
      }
      this.client    = new SteamUser();
      this.community = new SteamCommunity();

      const twoFactorCode = SteamTOTP.generateAuthCode(config.sharedSecret);
      this.manager = new SteamTradeOfferManager({
        steam:        this.client,
        community:    this.community,
        language:     'en',
        pollInterval: 10000,
        cancelTime:   10 * 60 * 1000,
      });

      this.client.logOn({
        accountName:   config.steamLogin,
        password:      config.steamPassword,
        twoFactorCode,
      });

      this.client.on('loggedOn', () => {
        this.log('스팀 로그인 성공');
        this.botSteamId = this.client.steamID ? this.client.steamID.toString() : null;
        this.client.setPersona(SteamUser.EPersonaState.Online);
      });

      this.client.on('webSession', (sessionId, cookies) => {
        this.log('웹 세션 획득');
        this.manager.setCookies(cookies, (err) => {
          if (err) {
            this.log(`TradeManager 쿠키 설정 실패: ${err.message}`);
            this.isLoggedIn = false;
            this.loginError = err.message;
            reject(err);
            return;
          }
          this.community.setCookies(cookies);
          this.isLoggedIn = true;
          this.loginError = null;
          this.log(`봇 온라인! SteamID: ${this.botSteamId}`);
          this._setupTradeHandlers();
          resolve({ success: true, botSteamId: this.botSteamId });
        });
      });

      this.client.on('error', (err) => {
        this.log(`로그인 오류: ${err.message}`);
        this.isLoggedIn = false;
        this.loginError = err.message;
        reject(err);
      });

      this.client.on('disconnected', (_eresult, msg) => {
        this.log(`연결 끊김: ${msg}`);
        this.isLoggedIn = false;
      });
    });
  }

  _setupTradeHandlers() {
    const config       = loadConfig();
    const adminSteamId = String(config.adminSteamId || '');

    this.manager.on('newOffer', (offer) => {
      const partnerId = offer.partner.toString();
      this.log(`새 거래 수신 — 파트너: ${partnerId}`);

      // 관리자 거래 → 자동 수락
      if (adminSteamId && partnerId === adminSteamId) {
        this.log('관리자 거래 감지 → 자동 수락');
        offer.accept((err, status) => {
          if (err) { this.log(`관리자 거래 수락 실패: ${err.message}`); return; }
          this.log(`관리자 거래 수락 완료 (상태: ${status})`);
          if (status === 'pending') this._confirmOffer(offer.id);
          setTimeout(() => this._syncBotInventory(), 5000);
        });
      } else {
        // 그 외 모든 수신 거래 즉시 거부
        this.log(`외부 거래 거부 — 파트너: ${partnerId}`);
        offer.decline((err) => {
          if (err) this.log(`거래 거부 실패: ${err.message}`);
          else     this.log('거래 거부 완료');
        });
      }
    });

    this.manager.on('offerChanged', (offer, oldState) => {
      this.log(`거래 상태 변경: ${oldState} → ${offer.state} (ID: ${offer.id})`);
      if (offer.state === SteamTradeOfferManager.ETradeOfferState.Accepted) {
        this.log(`거래 완료! ID: ${offer.id}`);
        this._handleTradeCompleted(offer);
      }
      // 역제안 → 자동 거부
      if (offer.state === SteamTradeOfferManager.ETradeOfferState.Countered) {
        this.log('역제안 감지 → 자동 거부');
        offer.decline((err) => {
          if (err) this.log(`역제안 거부 실패: ${err.message}`);
        });
      }
    });

    this.log('거래 핸들러 등록 완료');
  }

  _confirmOffer(offerId) {
    const config = loadConfig();
    if (!config.identitySecret) { this.log('Identity Secret 없음 — 수동 확인 필요'); return; }
    setTimeout(() => {
      this.community.acceptConfirmationForObject(config.identitySecret, offerId, (err) => {
        if (err) this.log(`거래 확인 실패: ${err.message}`);
        else     this.log(`거래 확인 완료 (ID: ${offerId})`);
      });
    }, 3000);
  }

  _handleTradeCompleted(offer) {
    try {
      const data        = loadData();
      const appIdCounts = {};
      (offer.itemsToGive || []).forEach(item => {
        if (String(item.appid) !== '753') return;
        const gameTag = (item.tags || []).find(t => t.category === 'Game');
        if (!gameTag) return;
        const m = (gameTag.internal_name || '').match(/(\d+)/);
        if (!m) return;
        const appId = m[1];
        appIdCounts[appId] = (appIdCounts[appId] || 0) + 1;
      });
      for (const [appId, cardCount] of Object.entries(appIdCounts)) {
        const set     = data.sets.find(s => String(s.appId) === String(appId));
        if (!set) continue;
        const setSize  = set.cardsInSet || 1;
        const setsUsed = Math.floor(cardCount / setSize);
        if (setsUsed <= 0) continue;
        set.completeSets = Math.max(0, (set.completeSets || 0) - setsUsed);
        if (set.completeSets === 0) set.listed = false;
        this.log(`재고 차감: ${set.gameName} -${setsUsed}세트 → 잔여 ${set.completeSets}세트`);
      }
      saveData(data);
    } catch (e) { this.log(`재고 차감 오류: ${e.message}`); }
  }

  async _syncBotInventory() {
    try {
      const config  = loadConfig();
      const steamId = this.botSteamId || config.steamId;
      if (!steamId) return;
      this.log('봇 인벤토리 동기화 중...');
      const allItems = await fetchInventoryViaCommunity(this.community, steamId);
      const cards    = filterTradingCards(allItems);
      const gameMap  = {};
      cards.forEach(card => {
        const appId = getAppIdFromItem(card);
        if (!appId) return;
        if (!gameMap[appId]) gameMap[appId] = { cards: [], classes: new Set() };
        gameMap[appId].cards.push(card);
        gameMap[appId].classes.add(card.classid);
      });
      const data = loadData();
      for (const [appId, info] of Object.entries(gameMap)) {
        const setSize  = info.classes.size;
        const minCount = setSize > 0 ? Math.floor(info.cards.length / setSize) : 0;
        const set      = data.sets.find(s => String(s.appId) === String(appId));
        if (set) {
          set.completeSets = minCount;
          set.cardsInSet   = setSize;
          if (minCount === 0) set.listed = false;
        }
      }
      saveData(data);
      this.log('봇 인벤토리 동기화 완료');
    } catch (e) { this.log(`봇 인벤토리 동기화 실패: ${e.message}`); }
  }

  // ── 전체 재고보충 ─────────────────────────────────────────────────────────────
  // 관리자 인벤토리에서 완성 세트가 되는 카드만 골라 봇이 관리자에게 거래 요청
  async sendRestockOfferAll() {
    if (!this.isLoggedIn) throw new Error('봇이 로그인되어 있지 않습니다.');

    const config          = loadConfig();
    const adminSteamId    = config.adminSteamId;
    const adminTradeToken = config.adminTradeToken;
    if (!adminSteamId) throw new Error('관리자 SteamID64가 설정되지 않았습니다. 봇 설정에서 입력해주세요.');

    this.log(`전체 재고보충 시작 — 관리자: ${adminSteamId}`);

    // 1. 관리자 인벤토리 수집 (봇 community 쿠키 → 403 없음)
    let allItems;
    try {
      allItems = await fetchInventoryViaCommunity(this.community, adminSteamId);
    } catch (e) {
      throw new Error(`관리자 인벤토리 조회 실패: ${e.message}`);
    }

    const cards = filterTradingCards(allItems);
    if (cards.length === 0) throw new Error('관리자 인벤토리에 노말 트레이딩 카드가 없습니다.');
    this.log(`관리자 인벤토리: 총 ${cards.length}장 노말 트레이딩 카드 발견`);

    // 2. data.json 세트 크기 정보 로드
    const data       = loadData();
    const setInfoMap = {};
    for (const s of (data.sets || [])) {
      if (s.appId && s.cardsInSet) setInfoMap[String(s.appId)] = s.cardsInSet;
    }

    // 3. 게임별 그룹화 { appId: { classid: [item, ...] } }
    const gameMap = {};
    for (const card of cards) {
      const appId = getAppIdFromItem(card);
      if (!appId) continue;
      if (!gameMap[appId]) gameMap[appId] = {};
      if (!gameMap[appId][card.classid]) gameMap[appId][card.classid] = [];
      gameMap[appId][card.classid].push(card);
    }

    const appIds = Object.keys(gameMap);
    this.log(`게임 ${appIds.length}종 감지 — 세트 크기 검증 중`);

    // 4. 완성 세트가 되는 카드만 선별
    const cardsToSend = [];
    const summary     = [];

    for (const [appId, byClass] of Object.entries(gameMap)) {
      const uniqueTypes = Object.keys(byClass).length;
      const knownSize   = setInfoMap[appId];

      // 세트 크기 검증
      if (knownSize && knownSize > 0) {
        if (uniqueTypes < knownSize) {
          this.log(`[건너뜀] AppID ${appId}: ${uniqueTypes}종 보유 / 세트 크기 ${knownSize}종 — 카드 부족`);
          continue;
        }
      } else {
        // data.json에 없으면 최소 3종 이상이어야 인정
        if (uniqueTypes < 3) {
          this.log(`[건너뜀] AppID ${appId}: ${uniqueTypes}종 보유 — 세트 정보 없음 & 3종 미만`);
          continue;
        }
      }

      const setSize  = knownSize || uniqueTypes;
      // 각 종류별 최솟값 = 완성 세트 수
      const minCount = Math.min(...Object.values(byClass).map(arr => arr.length));
      if (minCount === 0) { this.log(`[건너뜀] AppID ${appId}: 완성 세트 0개`); continue; }

      // 종류별로 minCount장씩만 선택
      for (const itemArr of Object.values(byClass)) {
        cardsToSend.push(...itemArr.slice(0, minCount));
      }
      summary.push(`AppID ${appId}: ${minCount}세트 × ${setSize}종 = ${setSize * minCount}장`);
      this.log(`[포함] AppID ${appId}: ${minCount}세트 × ${setSize}종 = ${setSize * minCount}장`);
    }

    if (cardsToSend.length === 0) {
      throw new Error('완성 세트가 가능한 카드가 없습니다. (미완성 세트는 제외됩니다)');
    }
    this.log(`보낼 카드: 총 ${cardsToSend.length}장 (${summary.length}개 게임)`);

    // 5. 거래 생성 및 전송 (봇이 관리자에게 카드 요청)
    return new Promise((resolve, reject) => {
      const offer = this.manager.createOffer(adminSteamId);
      if (adminTradeToken) offer.setToken(adminTradeToken);
      offer.setMessage(`[카드 쇼케이스 봇] 전체 재고보충 — ${summary.length}개 게임, ${cardsToSend.length}장 (완성 세트만)`);

      // addTheirItem: 상대방(관리자)의 아이템을 요청 (관리자 → 봇)
      cardsToSend.forEach(card => {
        offer.addTheirItem({
          appid:     753,
          contextid: 6,
          assetid:   card.id || card.assetid,
          amount:    1,
        });
      });

      offer.send((err, status) => {
        if (err) { this.log(`재고보충 거래 전송 실패: ${err.message}`); reject(err); return; }
        this.log(`재고보충 거래 전송 완료 (상태: ${status}, ID: ${offer.id}, 카드: ${cardsToSend.length}장, 게임: ${summary.length}개)`);
        if (status === 'pending') this._confirmOffer(offer.id);
        resolve({ success: true, offerId: offer.id, cards: cardsToSend.length, games: summary.length, summary });
      });
    });
  }

  // ── 구매자 보석 잔액 조회 ────────────────────────────────────────────────────
  async getBuyerGemBalance(buyerSteamId) {
    if (!this.isLoggedIn) throw new Error('봇이 로그인되어 있지 않습니다.');

    return new Promise((resolve, reject) => {
      this.community.getUserInventoryContents(buyerSteamId, 753, 6, true, 'english', (err, items) => {
        if (err) { reject(new Error(`구매자 인벤토리 조회 실패: ${err.message}`)); return; }

        let totalGems = 0;
        const gemItems = [];

        for (const item of (items || [])) {
          if (!isGemItem(item)) continue;
          const count = getGemCount(item);
          totalGems  += count;
          gemItems.push({ item, count });
          this.log(`[보석] "${item.market_hash_name}" × ${item.amount} = ${count}개`);
        }

        this.log(`구매자 보석 총합: ${totalGems.toLocaleString()}개 (${gemItems.length}종 아이템)`);
        resolve({ gemBalance: totalGems, gemItems });
      });
    });
  }

  // ── 구매 거래 생성 ─────────────────────────────────────────────────────────
  async sendPurchaseOffer(buyerSteamId, buyerTradeToken, appId, gemCount) {
    if (!this.isLoggedIn) throw new Error('봇이 로그인되어 있지 않습니다.');

    const data    = loadData();
    const setInfo = data.sets.find(s => String(s.appId) === String(appId));
    if (!setInfo)        throw new Error('해당 게임 세트 정보가 없습니다.');
    if (!setInfo.listed) throw new Error('판매 중이 아닌 세트입니다.');
    if ((setInfo.completeSets || 0) <= 0) throw new Error('재고가 없습니다.');

    this.log(`구매 거래 시작: 구매자 ${buyerSteamId}, AppID ${appId}, 보석 ${gemCount}개`);

    return new Promise((resolve, reject) => {
      // 봇 인벤토리에서 해당 게임 카드 조회
      this.manager.getInventoryContents(753, 6, true, (err, botInventory) => {
        if (err) { reject(new Error(`봇 인벤토리 조회 실패: ${err.message}`)); return; }

        // 해당 appId 노말 카드 필터
        const gameCards = (botInventory || []).filter(item => {
          const type = (item.type || '').toLowerCase();
          if (!type.includes('trading card') || type.includes('foil')) return false;
          const itemAppId = getAppIdFromItem(item);
          return itemAppId === String(appId);
        });

        if (gameCards.length === 0) {
          reject(new Error('봇 인벤토리에 해당 게임 카드가 없습니다. 재고보충을 먼저 해주세요.'));
          return;
        }

        // 고유 카드 1종씩 한 세트 구성
        const cardsByClass = {};
        gameCards.forEach(card => {
          if (!cardsByClass[card.classid]) cardsByClass[card.classid] = card;
        });
        const setCards = Object.values(cardsByClass);
        this.log(`봇 카드 세트: ${setCards.length}종`);

        // 구매자 인벤토리에서 보석 조회
        this.community.getUserInventoryContents(buyerSteamId, 753, 6, true, 'english', (err2, buyerItems) => {
          if (err2) { reject(new Error(`구매자 인벤토리 조회 실패: ${err2.message}`)); return; }

          // 보석 아이템 수집 및 잔액 계산
          let totalBuyerGems = 0;
          const buyerGemItems = [];
          for (const item of (buyerItems || [])) {
            if (!isGemItem(item)) continue;
            const count = getGemCount(item);
            totalBuyerGems += count;
            buyerGemItems.push({ item, count });
          }

          this.log(`구매자 보석 잔액: ${totalBuyerGems.toLocaleString()}개`);

          if (totalBuyerGems < gemCount) {
            reject(new Error(`보석이 부족합니다. 필요: ${gemCount.toLocaleString()} 💎 / 보유: ${totalBuyerGems.toLocaleString()} 💎`));
            return;
          }

          // 필요한 보석 수만큼 아이템 선택
          // 낱개 보석 먼저, 그 다음 보석 주머니 순서로 사용
          const sortedGemItems = [...buyerGemItems].sort((a, b) => {
            const aIsSack = isSackOfGems(a.item) ? 1 : 0;
            const bIsSack = isSackOfGems(b.item) ? 1 : 0;
            return aIsSack - bIsSack; // 낱개 먼저
          });

          let remaining    = gemCount;
          const gemsToTake = [];

          for (const { item, count } of sortedGemItems) {
            if (remaining <= 0) break;
            const sack      = isSackOfGems(item);
            const unitSize  = sack ? 1000 : 1;
            const unitCount = Math.ceil(Math.min(remaining, count) / unitSize);
            const takeCount = Math.min(parseInt(item.amount) || 1, Math.ceil(remaining / unitSize));

            gemsToTake.push({
              appid:     753,
              contextid: 6,
              assetid:   item.id || item.assetid,
              amount:    takeCount,
            });
            remaining -= takeCount * unitSize;
          }

          if (remaining > 0) {
            reject(new Error(`보석 아이템 수량이 부족합니다.`));
            return;
          }

          // 거래 생성: 봇 카드 → 구매자 / 구매자 보석 → 봇
          const partner32 = (BigInt(buyerSteamId) - BigInt('76561197960265728')).toString();
          const tradeUrl  = `https://steamcommunity.com/tradeoffer/new/?partner=${partner32}${buyerTradeToken ? `&token=${buyerTradeToken}` : ''}`;
          const offer     = this.manager.createOffer(tradeUrl);
          if (buyerTradeToken) offer.setToken(buyerTradeToken);
          offer.setMessage(`[카드 쇼케이스 봇] ${setInfo.gameName} 트레이딩 카드 세트 — ${gemCount.toLocaleString()} 보석`);

          // 봇 → 구매자: 카드 세트
          setCards.forEach(card => offer.addMyItem({
            appid:     753,
            contextid: 6,
            assetid:   card.id || card.assetid,
            amount:    1,
          }));

          // 구매자 → 봇: 보석
          gemsToTake.forEach(gem => offer.addTheirItem(gem));

          this.log(`거래 생성: 카드 ${setCards.length}장, 보석 ${gemCount}개`);

          offer.send((err3, status) => {
            if (err3) { this.log(`구매 거래 전송 실패: ${err3.message}`); reject(err3); return; }
            this.log(`구매 거래 전송 완료 (상태: ${status}, ID: ${offer.id})`);
            if (status === 'pending') this._confirmOffer(offer.id);

            // 재고 즉시 차감
            const data2 = loadData();
            const set2  = data2.sets.find(s => String(s.appId) === String(appId));
            if (set2) {
              set2.completeSets = Math.max(0, (set2.completeSets || 1) - 1);
              if (set2.completeSets === 0) set2.listed = false;
              saveData(data2);
              this.log(`재고 차감: ${set2.gameName} → 잔여 ${set2.completeSets}세트`);
            }

            resolve({
              success: true,
              offerId: offer.id,
              status,
              message: `${setInfo.gameName} 카드 세트 거래가 전송되었습니다! 스팀 앱에서 확인하세요.`,
            });
          });
        });
      });
    });
  }

  logoff() {
    try { this.client.logOff(); this.isLoggedIn = false; this.log('봇 로그오프'); } catch {}
  }
}

module.exports = new SteamBot();
