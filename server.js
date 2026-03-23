'use strict';

const express = require('express');
const session = require('express-session');
const fs      = require('fs');
const path    = require('path');
const axios   = require('axios');
const cheerio = require('cheerio');
const bot     = require('./bot');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(session({
  secret: 'steam-card-shop-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 1000 * 60 * 60 * 24 },
}));

const CONFIG_PATH = path.join(__dirname, 'config.json');
const DATA_PATH   = path.join(__dirname, 'data.json');

const DEFAULT_CONFIG = {
  steamLogin: '', steamPassword: '', steamId: '',
  steamApiKey: '', identitySecret: '', sharedSecret: '',
  steamLoginSecure: '', gemSackPrice: 1100,
  lvlupPointToGem: 5, lvlupBuyMultiplier: 1.0,
  adminPassword: 'admin1234', adminSteamId: '', adminTradeToken: '',
};
const DEFAULT_DATA = { sets: [] };

function readJSON(fp, def) {
  try { if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch {}
  return { ...def };
}
function writeJSON(fp, d) { fs.writeFileSync(fp, JSON.stringify(d, null, 2), 'utf-8'); }
const delay = ms => new Promise(r => setTimeout(r, ms));

// ── 인증 ──────────────────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: '로그인이 필요합니다.' });
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const config = readJSON(CONFIG_PATH, DEFAULT_CONFIG);
  if (username === '788qa' && password === (config.adminPassword || 'admin1234')) {
    req.session.isAdmin = true;
    return res.json({ success: true });
  }
  return res.status(401).json({ error: '아이디 또는 비밀번호가 틀립니다.' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/session', (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

app.get('/api/config', authMiddleware, (req, res) => res.json(readJSON(CONFIG_PATH, DEFAULT_CONFIG)));
app.post('/api/config', authMiddleware, (req, res) => {
  writeJSON(CONFIG_PATH, req.body);
  res.json({ success: true });
});
app.get('/api/data', authMiddleware, (req, res) => res.json(readJSON(DATA_PATH, DEFAULT_DATA)));
app.post('/api/data', authMiddleware, (req, res) => {
  writeJSON(DATA_PATH, req.body);
  res.json({ success: true });
});

app.get('/api/shop', (req, res) => {
  const data = readJSON(DATA_PATH, DEFAULT_DATA);
  const sets = (data.sets || []).filter(s => s.listed && s.sellPrice > 0 && s.completeSets > 0);
  res.json({ sets });
});

// ── 공통 헤더 ──────────────────────────────────────────────────────────────────
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8',
};

// ── 인벤토리 방법 A: 구 JSON API ───────────────────────────────────────────────
async function fetchViaOldJson(steamId, cookie) {
  console.log('  [방법A] 구 JSON API 시도...');
  const url = `https://steamcommunity.com/profiles/${steamId}/inventory/json/753/6`;
  const headers = { ...HEADERS, Referer: `https://steamcommunity.com/profiles/${steamId}/inventory` };
  if (cookie) headers.Cookie = `steamLoginSecure=${cookie}`;

  const resp = await axios.get(url, { headers, timeout: 30000, params: { l: 'english', count: 5000 } });
  const d = resp.data;
  console.log('  [방법A] success:', d.success);
  if (!d.success) throw new Error('success=false');

  const rgInv  = d.rgInventory    || {};
  const rgDesc = d.rgDescriptions || {};
  const invKeys = Object.keys(rgInv);
  console.log(`  [방법A] rgInventory: ${invKeys.length}개, rgDescriptions: ${Object.keys(rgDesc).length}개`);
  if (invKeys.length === 0) throw new Error('rgInventory 비어있음');

  const items = [];
  for (const id in rgInv) {
    const inv  = rgInv[id];
    const desc = rgDesc[`${inv.classid}_${inv.instanceid}`];
    if (desc) items.push({ asset: { assetid: id, classid: inv.classid, instanceid: inv.instanceid, amount: inv.amount || '1' }, desc });
  }
  console.log(`  [방법A] ✅ 결합: ${items.length}개`);
  if (items.length > 0) console.log(`  [방법A] 첫 아이템: "${items[0].desc.name}" type:"${items[0].desc.type}"`);
  return items;
}

// ── 인벤토리 방법 B: 신 API ────────────────────────────────────────────────────
async function fetchViaNewApi(steamId, cookie) {
  console.log('  [방법B] 신 인벤토리 API 시도...');
  const allAssets = [], allDescs = {};
  let lastAssetId = null, page = 0;
  while (true) {
    page++;
    const params = { l: 'english', count: 2000 };
    if (lastAssetId) params.start_assetid = lastAssetId;
    const headers = { ...HEADERS, Referer: `https://steamcommunity.com/profiles/${steamId}/inventory`, 'X-Requested-With': 'XMLHttpRequest' };
    if (cookie) headers.Cookie = `steamLoginSecure=${cookie}`;
    console.log(`  [방법B] 페이지 ${page}...`);
    const resp = await axios.get(`https://steamcommunity.com/inventory/${steamId}/753/6`, { params, headers, timeout: 30000 });
    const d = resp.data;
    if (!d || d.success !== 1) throw new Error(`success=${d && d.success}`);
    const assets = d.assets || [], descs = d.descriptions || [];
    console.log(`  [방법B] assets=${assets.length}, descs=${descs.length}`);
    if (assets.length === 0 && d.total_inventory_count > 0) throw new Error('assets 비어있음 - IP 차단 의심');
    for (const desc of descs) allDescs[`${desc.classid}_${desc.instanceid}`] = desc;
    for (const a of assets) allAssets.push(a);
    if (!d.more_items || assets.length === 0) break;
    lastAssetId = d.last_assetid;
    await delay(500);
  }
  const items = allAssets.map(a => ({ asset: a, desc: allDescs[`${a.classid}_${a.instanceid}`] })).filter(i => i.desc);
  console.log(`  [방법B] ✅ 결합: ${items.length}개`);
  return items;
}

// ── 인벤토리 방법 C: Steam Web API ────────────────────────────────────────────
async function fetchViaWebApi(steamId, apiKey) {
  console.log('  [방법C] Steam Web API 시도...');
  if (!apiKey) throw new Error('API Key 없음');
  const allAssets = [], allDescs = {};
  let startAssetId = null, page = 0;
  while (true) {
    page++;
    const params = { key: apiKey, steamid: steamId, appid: 753, contextid: 6, count: 2000, get_descriptions: 1 };
    if (startAssetId) params.start_assetid = startAssetId;
    console.log(`  [방법C] 페이지 ${page}...`);
    const resp = await axios.get('https://api.steampowered.com/IEconService/GetInventoryItemsWithDescriptions/v1/', { params, timeout: 30000 });
    const r = resp.data.response || resp.data;
    const assets = r.assets || [], descs = r.descriptions || [];
    console.log(`  [방법C] assets=${assets.length}, descs=${descs.length}`);
    if (assets.length === 0 && page === 1) throw new Error('assets 비어있음');
    for (const desc of descs) allDescs[`${desc.classid}_${desc.instanceid}`] = desc;
    for (const a of assets) allAssets.push(a);
    if (!r.more_items || assets.length === 0) break;
    startAssetId = r.last_assetid || (assets[assets.length - 1] && assets[assets.length - 1].assetid);
    await delay(500);
  }
  const items = allAssets.map(a => ({ asset: a, desc: allDescs[`${a.classid}_${a.instanceid}`] })).filter(i => i.desc);
  console.log(`  [방법C] ✅ 결합: ${items.length}개`);
  return items;
}

async function fetchInventory(steamId, apiKey, cookie) {
  const errors = [];
  for (const [name, fn] of [['방법A', () => fetchViaOldJson(steamId, cookie)], ['방법B', () => fetchViaNewApi(steamId, cookie)], ['방법C', () => fetchViaWebApi(steamId, apiKey)]]) {
    try { const items = await fn(); if (items.length > 0) return items; }
    catch (e) { console.log(`  [${name}] ❌ ${e.message}`); errors.push(e.message); }
  }
  throw new Error('모든 방법 실패:\n' + errors.join('\n'));
}

// ── 카드 판별 ──────────────────────────────────────────────────────────────────
function isTradingCard(desc) {
  if (desc.type) {
    const t = desc.type.toLowerCase();
    if (t.includes('trading card')) return true;
  }
  const tags = desc.tags || [];
  if (tags.some(t => t.internal_name === 'item_class_2')) return true;
  if (tags.some(t => (t.localized_tag_name || t.name || '').toLowerCase().includes('trading card'))) return true;
  return false;
}
function isFoilCard(desc) {
  if (desc.type && desc.type.toLowerCase().includes('foil')) return true;
  const tags = desc.tags || [];
  return tags.some(t => t.internal_name === 'cardborder_1');
}
function extractAppId(asset, desc) {
  if (desc.market_fee_app) return parseInt(desc.market_fee_app);
  const tags = desc.tags || [];
  const gameTag = tags.find(t => t.category === 'Game' || t.category_name === 'Game');
  if (gameTag && gameTag.internal_name) {
    const m = gameTag.internal_name.match(/app_(\d+)/);
    if (m) return parseInt(m[1]);
    const m2 = gameTag.internal_name.match(/(\d+)/);
    if (m2) return parseInt(m2[1]);
  }
  return 0;
}
function extractGameName(desc, appId) {
  const tags = desc.tags || [];
  const gameTag = tags.find(t => t.category === 'Game' || t.category_name === 'Game');
  return gameTag ? (gameTag.localized_tag_name || gameTag.name || `App ${appId}`) : `App ${appId}`;
}

// ── 배지 페이지에서 세트 크기 조회 ────────────────────────────────────────────
async function fetchSetSizeFromBadgePage(steamId, appId) {
  const url = `https://steamcommunity.com/profiles/${steamId}/gamecards/${appId}`;
  try {
    const resp = await axios.get(url, {
      headers: { ...HEADERS, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', Referer: 'https://steamcommunity.com/' },
      timeout: 15000,
    });
    const match = resp.data.match(/(\d+)\s+of\s+(\d+),\s*Series/i);
    if (match) {
      const setSize = parseInt(match[2]);
      console.log(`  [배지] AppID ${appId} → 세트 크기: ${setSize}`);
      return setSize;
    }
    console.log(`  [배지] AppID ${appId} → 패턴 없음`);
    return 0;
  } catch (e) {
    console.log(`  [배지] AppID ${appId} → 오류: ${e.message}`);
    return 0;
  }
}

// ── lvlup 가격 크롤링 ──────────────────────────────────────────────────────────
async function fetchLvlupPrice(appId) {
  const url = `https://steamlvlup.com/gameinfo/${appId}`;
  console.log(`  [lvlup] ${url} 조회 중...`);
  const resp = await axios.get(url, {
    headers: { ...HEADERS, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', Referer: 'https://steamlvlup.com/' },
    timeout: 20000,
  });
  const html = resp.data;

  let normalPrice = 0, foilPrice = 0, normalStock = 0, foilStock = 0;

  // gems_icon 뒤 숫자 전체 수집
  const allGemPrices = [];
  const gemsRe = /<i[^>]*class=["']gems_icon["'][^>]*><\/i>\s*([\d,]+)/g;
  let gm;
  while ((gm = gemsRe.exec(html)) !== null) {
    allGemPrices.push(parseInt(gm[1].replace(/,/g, '')) || 0);
  }
  console.log('  [lvlup] gems_icon 가격 목록:', allGemPrices);

  const htmlLower = html.toLowerCase();
  const normalIdx = htmlLower.indexOf('normal set');
  const foilIdx   = htmlLower.indexOf('foil set');

  if (normalIdx >= 0) {
    const end = (foilIdx > normalIdx) ? foilIdx : normalIdx + 3000;
    const section = html.slice(normalIdx, end);
    const nm = section.match(/<i[^>]*class=["']gems_icon["'][^>]*><\/i>\s*([\d,]+)/i);
    if (nm) normalPrice = parseInt(nm[1].replace(/,/g, '')) || 0;
    const nsm = section.match(/in\s+stock[^<]*<b>\s*(\d+)\s*<\/b>/i);
    if (nsm) normalStock = parseInt(nsm[1]) || 0;
  }
  if (foilIdx >= 0) {
    const section = html.slice(foilIdx, foilIdx + 3000);
    const fm = section.match(/<i[^>]*class=["']gems_icon["'][^>]*><\/i>\s*([\d,]+)/i);
    if (fm) foilPrice = parseInt(fm[1].replace(/,/g, '')) || 0;
    const fsm = section.match(/in\s+stock[^<]*<b>\s*(\d+)\s*<\/b>/i);
    if (fsm) foilStock = parseInt(fsm[1]) || 0;
  }

  if (normalPrice === 0 && allGemPrices.length >= 1) normalPrice = allGemPrices[0];
  if (foilPrice   === 0 && allGemPrices.length >= 2) foilPrice   = allGemPrices[1];

  const allStocks = [];
  const stockRe = /in\s+stock[^<]*<b>\s*(\d+)\s*<\/b>/gi;
  let sm;
  while ((sm = stockRe.exec(html)) !== null) allStocks.push(parseInt(sm[1]) || 0);
  console.log('  [lvlup] In stock 목록:', allStocks);
  if (normalStock === 0 && allStocks.length >= 1) normalStock = allStocks[0];
  if (foilStock   === 0 && allStocks.length >= 2) foilStock   = allStocks[1];

  if (normalPrice === 0) {
    console.warn(`  [lvlup] ⚠️ 파싱 실패. HTML 길이: ${html.length}`);
    const gi = html.indexOf('gems_icon');
    if (gi >= 0) console.warn(html.slice(Math.max(0, gi - 200), gi + 400));
  }

  console.log(`  [lvlup] AppID ${appId} → 노말: ${normalPrice}pt (재고${normalStock}) / 포일: ${foilPrice}pt (재고${foilStock})`);
  return { normalPrice, foilPrice, normalStock, foilStock };
}

function calcLvlupSuggestedGem(pts, pointToGem, multiplier) {
  if (!pts || pts <= 0) return 0;
  return Math.ceil(pts * (multiplier || 1.0) * (pointToGem || 5));
}

// ── POST /api/steam/refresh ────────────────────────────────────────────────────
app.post('/api/steam/refresh', authMiddleware, async (req, res) => {
  try {
    const config       = readJSON(CONFIG_PATH, DEFAULT_CONFIG);
    const existingData = readJSON(DATA_PATH,   DEFAULT_DATA);
    const steamId      = config.steamId;
    if (!steamId) return res.status(400).json({ error: '스팀 커뮤니티 ID가 설정되지 않았습니다.' });

    console.log('\n' + '='.repeat(60));
    console.log(`[세트 새로고침] 스팀 ID: ${steamId}`);
    console.log(`[세트 새로고침] API Key: ${config.steamApiKey ? '있음' : '없음'}`);
    console.log('='.repeat(60));

    const allItems = await fetchInventory(steamId, config.steamApiKey, config.steamLoginSecure);
    console.log(`[새로고침] 전체 아이템: ${allItems.length}개`);
    if (allItems.length === 0) return res.status(400).json({ error: '인벤토리 아이템을 가져오지 못했습니다.' });

    // 트레이딩 카드 필터
    const tradingCards = [];
    let skippedFoil = 0, skippedOther = 0;
    for (const item of allItems) {
      const { asset, desc } = item;
      if (!isTradingCard(desc)) { skippedOther++; continue; }
      if (isFoilCard(desc))     { skippedFoil++;  continue; }
      const appId = extractAppId(asset, desc);
      if (!appId) continue;
      tradingCards.push({
        classid: String(desc.classid), appId,
        gameName: extractGameName(desc, appId),
        name: desc.name || desc.market_name || 'Unknown',
        marketHashName: desc.market_hash_name || '',
        amount: parseInt(asset.amount) || 1,
      });
    }
    console.log(`[새로고침] 트레이딩 카드: ${tradingCards.length}장 (포일제외: ${skippedFoil}장, 기타: ${skippedOther}개)`);

    if (tradingCards.length === 0) {
      console.warn('[새로고침] ⚠️ 카드 0장! 첫 5개 아이템:');
      allItems.slice(0, 5).forEach((item, i) => {
        console.warn(`  [${i}] "${item.desc.name}" / type: "${item.desc.type}"`);
        if (item.desc.tags) console.warn(`       tags: ${item.desc.tags.map(t => `${t.category}:${t.internal_name}`).join(', ')}`);
      });
      return res.json({ success: true, data: { sets: [], lastRefresh: new Date().toISOString() }, message: `${allItems.length}개 아이템 중 트레이딩 카드가 없습니다.` });
    }

    // 게임별 그룹화
    const gameGroups = {};
    for (const card of tradingCards) {
      if (!gameGroups[card.appId]) gameGroups[card.appId] = { appId: card.appId, gameName: card.gameName, cards: {} };
      const g = gameGroups[card.appId];
      if (!g.cards[card.classid]) g.cards[card.classid] = { name: card.name, marketHashName: card.marketHashName, amount: 0 };
      g.cards[card.classid].amount += card.amount;
    }

    // 배지 페이지에서 세트 크기 동시 조회 (5개씩)
    const appIdList = Object.keys(gameGroups);
    console.log(`[새로고침] 배지 페이지 조회: ${appIdList.length}개 게임 (동시 5개씩)`);
    const setSize = {};
    const CONCURRENCY = 5;
    for (let i = 0; i < appIdList.length; i += CONCURRENCY) {
      const batch = appIdList.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(aid => fetchSetSizeFromBadgePage(steamId, aid)));
      batch.forEach((aid, idx) => { setSize[aid] = results[idx]; });
      if (i + CONCURRENCY < appIdList.length) await delay(300);
    }

    const results = [];
    for (const appIdStr in gameGroups) {
      const group      = gameGroups[appIdStr];
      const appId      = parseInt(appIdStr);
      const uniqueCards = Object.keys(group.cards).length;
      const cardAmounts = Object.values(group.cards).map(c => c.amount);
      const realSetSize = setSize[appIdStr] || uniqueCards;
      const completeSets = (uniqueCards >= realSetSize) ? Math.min(...cardAmounts) : 0;
      if (uniqueCards < realSetSize) {
        console.log(`  [건너뜀] AppID ${appId}: 보유 ${uniqueCards}종 / 세트 크기 ${realSetSize}종 → 미완성`);
      }
      results.push({
        appId, gameName: group.gameName,
        cardsInSet: realSetSize, uniqueCards,
        totalCards: cardAmounts.reduce((a, b) => a + b, 0),
        completeSets,
        totalMarketPrice: 0,
        lvlupNormalPrice: 0, lvlupFoilPrice: 0,
        lvlupNormalStock: 0, lvlupFoilStock: 0, lvlupCostPoints: 0,
        suggestedGemPrice: 0, sellPrice: 0, listed: false,
        cards: Object.values(group.cards).map(c => ({ name: c.name, marketHashName: c.marketHashName, amount: c.amount, marketPrice: 0 })),
      });
    }

    // 기존 데이터 병합
    const existingSets = existingData.sets || [];
    const mergedSets = results.map(ns => {
      const ex = existingSets.find(s => s.appId === ns.appId);
      if (!ex) return ns;
      return {
        ...ns,
        totalMarketPrice:  ex.totalMarketPrice  || 0,
        lvlupNormalPrice:  ex.lvlupNormalPrice  || 0,
        lvlupFoilPrice:    ex.lvlupFoilPrice    || 0,
        lvlupNormalStock:  ex.lvlupNormalStock  || 0,
        lvlupFoilStock:    ex.lvlupFoilStock    || 0,
        lvlupCostPoints:   ex.lvlupCostPoints   || 0,
        suggestedGemPrice: ex.suggestedGemPrice || 0,
        sellPrice:         ex.sellPrice         || 0,
        listed:            ex.listed            || false,
        cards: ns.cards.map(nc => {
          const ec = (ex.cards || []).find(c => c.marketHashName === nc.marketHashName);
          return ec ? { ...nc, marketPrice: ec.marketPrice || 0 } : nc;
        }),
      };
    });

    const newData = { sets: mergedSets, lastRefresh: new Date().toISOString() };
    writeJSON(DATA_PATH, newData);
    console.log(`[새로고침] 완료! ${mergedSets.length}개 게임\n`);
    res.json({ success: true, data: newData });
  } catch (err) {
    console.error('[새로고침 오류]', err.message);
    res.status(500).json({ error: err.message || '새로고침 실패' });
  }
});

// ── POST /api/steam/price/:appId ──────────────────────────────────────────────
app.post('/api/steam/price/:appId', authMiddleware, async (req, res) => {
  try {
    const appId  = parseInt(req.params.appId);
    const config = readJSON(CONFIG_PATH, DEFAULT_CONFIG);
    const data   = readJSON(DATA_PATH,   DEFAULT_DATA);
    const set    = (data.sets || []).find(s => s.appId === appId);
    if (!set) return res.status(404).json({ error: '세트를 찾을 수 없습니다.' });

    const cards = set.cards || [];
    console.log(`\n[장터시세] ${set.gameName} (${cards.length}종)`);
    let totalMarketPrice = 0;

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      if (!card.marketHashName) continue;
      try {
        const resp = await axios.get('https://steamcommunity.com/market/priceoverview/', {
          params: { appid: 753, currency: 16, market_hash_name: card.marketHashName },
          headers: { ...HEADERS, Referer: 'https://steamcommunity.com/market/' },
          timeout: 15000,
        });
        const raw   = (resp.data && (resp.data.lowest_price || resp.data.median_price)) || '';
        const price = parseFloat(raw.replace(/[^\d.]/g, '')) || 0;
        card.marketPrice   = price;
        totalMarketPrice  += price;
        console.log(`  [${i+1}/${cards.length}] "${card.name}" → ${raw} → ${price}원`);
      } catch (e) {
        console.log(`  [${i+1}/${cards.length}] "${card.name}" 실패: ${e.message}`);
      }
      if (i < cards.length - 1) await delay(1200);
    }

    set.totalMarketPrice  = Math.round(totalMarketPrice * 100) / 100;
    const gemSackPrice    = config.gemSackPrice || 1100;
    set.suggestedGemPrice = totalMarketPrice > 0
      ? Math.ceil(totalMarketPrice * 1.3 / (gemSackPrice / 1000))
      : (set.suggestedGemPrice || 0);

    writeJSON(DATA_PATH, data);
    res.json({ success: true, set: { appId: set.appId, totalMarketPrice: set.totalMarketPrice, suggestedGemPrice: set.suggestedGemPrice, cards: set.cards } });
  } catch (err) {
    console.error('[장터시세 오류]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/steam/lvlup/:appId ──────────────────────────────────────────────
app.post('/api/steam/lvlup/:appId', authMiddleware, async (req, res) => {
  try {
    const appId  = parseInt(req.params.appId);
    const config = readJSON(CONFIG_PATH, DEFAULT_CONFIG);
    const data   = readJSON(DATA_PATH,   DEFAULT_DATA);
    const set    = (data.sets || []).find(s => s.appId === appId);
    if (!set) return res.status(404).json({ error: '세트를 찾을 수 없습니다.' });

    const result = await fetchLvlupPrice(appId);
    set.lvlupNormalPrice  = result.normalPrice;
    set.lvlupFoilPrice    = result.foilPrice;
    set.lvlupNormalStock  = result.normalStock;
    set.lvlupFoilStock    = result.foilStock;
    set.suggestedGemPrice = calcLvlupSuggestedGem(result.normalPrice, config.lvlupPointToGem || 5, config.lvlupBuyMultiplier || 1.0);
    set.lvlupCostPoints   = result.normalPrice;

    writeJSON(DATA_PATH, data);
    res.json({ success: true, set: { appId, lvlupNormalPrice: result.normalPrice, lvlupFoilPrice: result.foilPrice, lvlupNormalStock: result.normalStock, lvlupFoilStock: result.foilStock, suggestedGemPrice: set.suggestedGemPrice, lvlupCostPoints: result.normalPrice } });
  } catch (err) {
    console.error('[lvlup 오류]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/steam/lvlup-all ─────────────────────────────────────────────────
app.post('/api/steam/lvlup-all', authMiddleware, async (req, res) => {
  try {
    const config = readJSON(CONFIG_PATH, DEFAULT_CONFIG);
    const data   = readJSON(DATA_PATH,   DEFAULT_DATA);
    const sets   = data.sets || [];
    if (sets.length === 0) return res.status(400).json({ error: '먼저 세트 새로고침을 해주세요.' });

    console.log(`\n[lvlup 전체] ${sets.length}개 게임`);
    let success = 0, failed = 0;
    for (let i = 0; i < sets.length; i++) {
      const set = sets[i];
      console.log(`[${i+1}/${sets.length}] ${set.gameName}`);
      try {
        const result = await fetchLvlupPrice(set.appId);
        set.lvlupNormalPrice  = result.normalPrice;
        set.lvlupFoilPrice    = result.foilPrice;
        set.lvlupNormalStock  = result.normalStock;
        set.lvlupFoilStock    = result.foilStock;
        set.suggestedGemPrice = calcLvlupSuggestedGem(result.normalPrice, config.lvlupPointToGem || 5, config.lvlupBuyMultiplier || 1.0);
        set.lvlupCostPoints   = result.normalPrice;
        success++;
      } catch (e) { console.error(`  실패: ${e.message}`); failed++; }
      if (i < sets.length - 1) await delay(800);
    }
    writeJSON(DATA_PATH, data);
    console.log(`[lvlup 전체] 완료 — 성공: ${success}, 실패: ${failed}\n`);
    res.json({ success: true, data, summary: { total: sets.length, success, failed } });
  } catch (err) {
    console.error('[lvlup 전체 오류]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── 봇 API ────────────────────────────────────────────────────────────────────
app.get('/api/bot/status', authMiddleware, (req, res) => res.json(bot.getStatus()));

app.post('/api/bot/login', authMiddleware, async (req, res) => {
  try {
    const result = await bot.login();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[봇 로그인 오류]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bot/logoff', authMiddleware, (req, res) => {
  bot.logoff();
  res.json({ success: true });
});

// 전체 재고보충: 관리자 인벤토리의 완성 세트 카드 → 봇에게 한 거래로 전송
app.post('/api/bot/restock', authMiddleware, async (req, res) => {
  try {
    const result = await bot.sendRestockOfferAll();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[재고보충 오류]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 구매자 보석 잔액 조회 (공개)
app.get('/api/shop/gem-balance/:steamId', async (req, res) => {
  try {
    const result = await bot.getBuyerGemBalance(req.params.steamId);
    res.json({ success: true, gemBalance: result.gemBalance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 구매 거래 생성 (공개)
// body: { tradeUrl: string, appId: string | number }
app.post('/api/shop/purchase', async (req, res) => {
  try {
    const { tradeUrl, appId } = req.body;
    if (!tradeUrl || !appId) return res.status(400).json({ error: 'tradeUrl과 appId가 필요합니다.' });

    // tradeUrl에서 partner, token 파싱
    let partner = '', token = '';
    try {
      const u = new URL(tradeUrl);
      partner = u.searchParams.get('partner') || '';
      token   = u.searchParams.get('token')   || '';
    } catch {
      return res.status(400).json({ error: '올바른 트레이드 URL 형식이 아닙니다.' });
    }
    if (!partner) return res.status(400).json({ error: '트레이드 URL에서 partner를 찾을 수 없습니다.' });

    // partner(32bit) → SteamID64 변환
    const buyerSteamId = (BigInt(partner) + BigInt('76561197960265728')).toString();

    const data = readJSON(DATA_PATH, DEFAULT_DATA);
    const set  = (data.sets || []).find(s => String(s.appId) === String(appId));
    if (!set)          return res.status(404).json({ error: '세트를 찾을 수 없습니다.' });
    if (!set.listed || !set.sellPrice || set.sellPrice <= 0) return res.status(400).json({ error: '현재 판매 중이 아닙니다.' });
    if ((set.completeSets || 0) <= 0) return res.status(400).json({ error: '재고가 없습니다.' });

    // 구매자 보석 잔액 확인
    let gemBalance = 0;
    try {
      const balRes = await bot.getBuyerGemBalance(buyerSteamId);
      gemBalance = balRes.gemBalance || 0;
    } catch (e) {
      console.warn('[구매] 보석 잔액 조회 실패:', e.message);
    }
    if (gemBalance < set.sellPrice) {
      return res.status(400).json({
        error: `보석이 부족합니다. 필요: ${set.sellPrice.toLocaleString()} 💎 / 보유: ${gemBalance.toLocaleString()} 💎`,
        gemBalance,
        required: set.sellPrice,
      });
    }

    const result = await bot.sendPurchaseOffer(buyerSteamId, token, appId, set.sellPrice);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[구매 오류]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── 정적 파일 서빙 ────────────────────────────────────────────────────────────
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));
app.get('/{*splat}', (req, res) => res.sendFile(path.join(distPath, 'index.html')));

const PORT = parseInt(process.env.PORT) || 3002;
app.listen(PORT, '0.0.0.0', () => {
  console.log('\n' + '='.repeat(50));
  console.log(`  🚀 서버 실행 중: http://0.0.0.0:${PORT}`);
  console.log('='.repeat(50) + '\n');
});
