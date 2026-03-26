'use strict';

const SteamUser = require('steam-user');
const SteamTotp = require('steam-totp');
const SteamCommunity = require('steamcommunity');
const TradeOfferManager = require('steam-tradeoffer-manager');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const DATA_PATH = path.join(__dirname, 'data.json');

function readJSON(fp) { try { return JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch { return {}; } }
function writeJSON(fp, d) { fs.writeFileSync(fp, JSON.stringify(d, null, 2), 'utf-8'); }

class CardBot {
  constructor() {
    this.client = new SteamUser();
    this.community = new SteamCommunity();
    this.manager = new TradeOfferManager({ steam: this.client, community: this.community, language: 'en' });
    this.isLoggedIn = false;
    this.botSteamId = null;
    this.logs = [];

    this.manager.on('sentOfferChanged', (offer, oldState) => {
      this.addLog(`Offer #${offer.id} 상태 변경: ${TradeOfferManager.ETradeOfferState[offer.state]}`);
      if (offer.state === TradeOfferManager.ETradeOfferState.Accepted) {
        this.rewardEnergy(offer);
      }
    });
  }

  rewardEnergy(offer) {
    try {
      const steamId = offer.partner.getSteamID64();
      const config = readJSON(CONFIG_PATH), data = readJSON(DATA_PATH);
      let totalGems = 0;
      offer.itemsToReceive.forEach(item => { if (item.market_hash_name === '753-Gems') totalGems += parseInt(item.amount); });
      if (totalGems > 0) {
        const earned = Math.floor(totalGems * ((config.energyEarnRate || 5) / 100));
        const u = data.users.find(x => x.steamId === steamId);
        if (u) {
          u.energy = (u.energy || 0) + earned;
          writeJSON(DATA_PATH, data);
          this.addLog(`[Energy] 유저 ${u.displayName}님에게 ${earned} Energy 적립 완료`);
        }
      }
    } catch (e) { this.addLog(`[Energy Error] 적립 실패: ${e.message}`); }
  }

  async getOfferStatus(offerId) {
    return new Promise((resolve, reject) => {
      this.manager.getOffer(offerId, (err, offer) => {
        if (err) return reject(err);
        resolve({ state: offer.state, stateName: TradeOfferManager.ETradeOfferState[offer.state] });
      });
    });
  }

  addLog(m) {
    const s = `[${new Date().toLocaleTimeString()}] ${m}`;
    this.logs.push(s); if (this.logs.length > 50) this.logs.shift();
    console.log(s);
  }

  getStatus() { return { isLoggedIn: this.isLoggedIn, botSteamId: this.botSteamId, logs: this.logs }; }

  async login() {
    const cfg = readJSON(CONFIG_PATH);
    if (!cfg.steamLogin) throw new Error('로그인 정보 부족');
    return new Promise((resolve, reject) => {
      this.client.logOn({ accountName: cfg.steamLogin, password: cfg.steamPassword, twoFactorCode: SteamTotp.generateAuthCode(cfg.sharedSecret) });
      this.client.once('webSession', (sid, cookies) => {
        this.community.setCookies(cookies);
        this.manager.setCookies(cookies, (err) => {
          if (err) return reject(err);
          this.isLoggedIn = true; this.botSteamId = this.client.steamID.getSteamID64();
          this.addLog('봇 로그인 성공'); resolve({ success: true, steamId: this.botSteamId });
        });
      });
      this.client.once('error', reject);
    });
  }

  logoff() { this.client.logOff(); this.isLoggedIn = false; this.addLog('로그오프'); }

  async getBuyerGemBalance(steamId) {
    return new Promise((resolve, reject) => {
      this.manager.getUserInventoryContents(steamId, 753, 6, true, (err, inv) => {
        if (err) return reject(err);
        const gems = inv.filter(i => i.market_hash_name === '753-Gems');
        resolve({ gemBalance: gems.reduce((a, b) => a + parseInt(b.amount), 0), gemItems: gems });
      });
    });
  }

  async sendPurchaseOffer(steamId, token, appId, price, quantity) {
    if (!this.isLoggedIn) throw new Error('봇 오프라인');
    
    const data = readJSON(DATA_PATH);
    const buyerInv = await this.getBuyerGemBalance(steamId);
    if (buyerInv.gemBalance < price) throw new Error('보석 부족');

    const set = (data.sets || []).find(s => String(s.appId) === String(appId));
    const gameName = set ? set.gameName : `App ${appId}`;

    return new Promise((resolve, reject) => {
      this.manager.getInventoryContents(753, 6, true, (err, botInv) => {
        if (err) return reject(err);
        const offer = this.manager.createOffer(steamId);
        if (token) offer.setToken(token);
        
        const setCards = botInv.filter(i => i.tags.some(t => t.internal_name === `app_${appId}`) && i.type.toLowerCase().includes('trading card'));
        const groups = {}; setCards.forEach(c => { if(!groups[c.classid]) groups[c.classid] = []; groups[c.classid].push(c); });
        
        for (let i = 0; i < quantity; i++) {
          Object.keys(groups).forEach(cid => { const card = groups[cid].pop(); if (card) offer.addMyItem(card); });
        }
        
        let rem = price;
        for (const g of buyerInv.gemItems) {
          const amt = Math.min(rem, parseInt(g.amount));
          offer.addTheirItem({ assetid: g.assetid, appid: 753, contextid: 6, amount: amt });
          rem -= amt; if (rem <= 0) break;
        }

        offer.setMessage(`[Steam Card Shop] 🛒 ${gameName} x${quantity} 세트 구매`);

        offer.send((err, status) => {
          if (err) return reject(err);
          if (status === 'pending') {
            const cfg = readJSON(CONFIG_PATH);
            this.community.acceptConfirmationForObject(cfg.identitySecret, offer.id, (e) => {});
          }
          resolve({ success: true, offerId: offer.id });
        });
      });
    });
  }

  async sendRestockOfferAll() {
    if (!this.isLoggedIn) throw new Error('봇 오프라인');
    const cfg = readJSON(CONFIG_PATH);
    return new Promise((resolve, reject) => {
      this.manager.getUserInventoryContents(cfg.adminSteamId, 753, 6, true, (err, inv) => {
        if (err) return reject(err);
        const cards = inv.filter(i => i.type.toLowerCase().includes('trading card') && !i.type.toLowerCase().includes('foil'));
        if (cards.length === 0) return resolve({ success: true, cards: 0 });
        
        const offer = this.manager.createOffer(cfg.adminSteamId);
        offer.setToken(cfg.adminTradeToken);
        cards.forEach(c => offer.addTheirItem(c));
        offer.setMessage('[Admin] 봇 카드 재고 보충');

        offer.send((err2) => { if (err2) return reject(err2); resolve({ success: true, cards: cards.length }); });
      });
    });
  }
}

module.exports = new CardBot();