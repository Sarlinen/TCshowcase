'use strict';

const express = require('express');
const session = require('express-session');
const fs      = require('fs');
const path    = require('path');
const axios   = require('axios');
const AdmZip  = require('adm-zip'); 
const bot     = require('./bot');

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '50mb' }));

app.use(session({
  secret: 'steam-card-shop-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 7 },
}));

const CONFIG_PATH = path.join(__dirname, 'config.json');
const DATA_PATH   = path.join(__dirname, 'data.json');

const DEFAULT_CONFIG = {
  steamLogin: '', steamPassword: '', steamId: '',
  steamApiKey: '', identitySecret: '', sharedSecret: '',
  steamLoginSecure: '', gemSackPrice: 1100,
  lvlupPointToGem: 5, lvlupBuyMultiplier: 1.0,
  adminPassword: 'admin1234', adminSteamId: '', adminTradeToken: '',
  novelAiKey: '', energyEarnRate: 5, novelAiCost: 100,
  novelAiUrl: 'https://image.novelai.net/ai/generate-image',
  novelAiModelCurated: 'nai-diffusion-4-5-curated',
  novelAiModelFull: 'nai-diffusion-4-5-full'
};

const DEFAULT_DATA = { sets: [], coupons: [], users: [] };

function readJSON(fp, def) {
  try { if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch (e) {}
  return { ...def };
}
function writeJSON(fp, d) { fs.writeFileSync(fp, JSON.stringify(d, null, 2), 'utf-8'); }
const delay = ms => new Promise(r => setTimeout(r, ms));

function authMiddleware(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: '로그인이 필요합니다.' });
}

// ── 인증 API ──
app.get('/api/session', (req, res) => res.json({ isAdmin: !!(req.session && req.session.isAdmin) }));
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const config = readJSON(CONFIG_PATH, DEFAULT_CONFIG);
  if (username === '788qa' && password === (config.adminPassword || 'admin1234')) {
    req.session.isAdmin = true;
    return res.json({ success: true });
  }
  return res.status(401).json({ error: '인증 실패' });
});
app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });

// ── 스팀 OpenID 인증 ──
app.get('/api/auth/steam', (req, res) => {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const realm = `${protocol}://${req.headers.host}`;
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': `${realm}/api/auth/steam/return`,
    'openid.realm': realm,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select'
  });
  res.redirect(`https://steamcommunity.com/openid/login?${params.toString()}`);
});

app.get('/api/auth/steam/return', async (req, res) => {
  try {
    const rawQuery = req.originalUrl.split('?')[1];
    if (!rawQuery) return res.status(400).send('잘못된 요청입니다.');

    const verifyStr = rawQuery.replace('openid.mode=id_res', 'openid.mode=check_authentication');

    const verifyRes = await axios.post('https://steamcommunity.com/openid/login', verifyStr, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    if (verifyRes.data.includes('is_valid:true')) {
      const claimedId = req.query['openid.claimed_id'];
      if (!claimedId) return res.status(400).send('Steam ID가 누락되었습니다.');

      const steamId = claimedId.split('/').pop();
      let displayName = steamId, avatar = '';
      
      try {
        const config = readJSON(CONFIG_PATH, DEFAULT_CONFIG);
        if (config.steamApiKey) {
          const sumRes = await axios.get(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${config.steamApiKey}&steamids=${steamId}`);
          const p = sumRes.data.response.players[0];
          if (p) { displayName = p.personaname; avatar = p.avatar; }
        } else {
          const xmlRes = await axios.get(`https://steamcommunity.com/profiles/${steamId}?xml=1`, { timeout: 5000 });
          const match = xmlRes.data.match(/<steamID><!\[CDATA\[(.*?)\]\]><\/steamID>/);
          if (match) displayName = match[1];
          const avMatch = xmlRes.data.match(/<avatarIcon><!\[CDATA\[(.*?)\]\]><\/avatarIcon>/);
          if (avMatch) avatar = avMatch[1];
        }
      } catch (e) { console.error('[Steam Profile Fetch Error]', e.message); }

      const data = readJSON(DATA_PATH, DEFAULT_DATA);
      if (!data.users) data.users = [];
      
      let user = data.users.find(u => u.steamId === steamId);
      if (!user) {
        user = { steamId, displayName, avatar, approved: false, energy: 0, joinedAt: new Date().toISOString() };
        data.users.push(user);
      } else {
        user.displayName = displayName; 
        user.avatar = avatar;
        if (user.energy === undefined) user.energy = 0;
      }
      
      writeJSON(DATA_PATH, data);
      req.session.steamUser = user;
      
      req.session.save(() => res.redirect('/'));
    } else { 
      console.error('[Steam OpenID Invalid]', verifyRes.data);
      res.status(401).send('스팀 인증이 거부되었습니다. (is_valid:false)'); 
    }
  } catch (err) { 
    console.error('[Steam Auth 통신 오류]', err.message);
    res.status(500).send('스팀 서버 통신 오류'); 
  }
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.steamUser) return res.json(null);
  const data = readJSON(DATA_PATH, DEFAULT_DATA);
  if (!data.users) data.users = [];
  res.json(data.users.find(u => u.steamId === req.session.steamUser.steamId) || null);
});
app.post('/api/auth/steam/logout', (req, res) => { req.session.steamUser = null; res.json({ success: true }); });

// ── 에너지 쿠폰 ──
app.post('/api/users/energy-coupon', async (req, res) => {
  try {
    if (!req.session.steamUser) return res.status(401).json({ error: '로그인 필요' });
    const { code } = req.body;
    const data = readJSON(DATA_PATH, DEFAULT_DATA);
    if (!data.coupons) data.coupons = [];
    if (!data.users) data.users = [];
    
    const cIdx = data.coupons.findIndex(c => c.code === code.toUpperCase() && c.type === 'energy');
    if (cIdx < 0) return res.status(404).json({ error: '유효하지 않은 쿠폰' });
    const user = data.users.find(u => u.steamId === req.session.steamUser.steamId);
    if (!user) return res.status(404).json({ error: '유저 데이터 없음' });

    user.energy = (user.energy || 0) + (data.coupons[cIdx].energyAmount || 0);
    data.coupons[cIdx].usedCount += 1;
    if (data.coupons[cIdx].usedCount >= data.coupons[cIdx].usageLimit) data.coupons.splice(cIdx, 1);
    
    writeJSON(DATA_PATH, data);
    res.json({ success: true, totalEnergy: user.energy });
  } catch (err) { res.status(500).json({ error: '오류' }); }
});

// ── NovelAI 작업 대기열 (Queue) ──
const aiQueue = [];
const aiJobs = {};
let isAiProcessing = false;

app.post('/api/ai/generate/submit', async (req, res) => {
  try {
    if (!req.session.steamUser) return res.status(401).json({ error: '로그인 필요' });
    const config = readJSON(CONFIG_PATH, DEFAULT_CONFIG);
    const data = readJSON(DATA_PATH, DEFAULT_DATA);
    if (!data.users) data.users = [];

    const user = data.users.find(u => u.steamId === req.session.steamUser.steamId);
    if (!user || !user.approved) return res.status(403).json({ error: '승인 필요' });
    if (config.novelAiCost > 0 && (user.energy || 0) < config.novelAiCost) return res.status(400).json({ error: 'Energy 부족' });

    const jobId = Date.now().toString() + Math.random().toString(36).substring(7);
    aiJobs[jobId] = { steamId: user.steamId, reqBody: req.body, status: 'queued' };
    aiQueue.push(jobId);
    processAiQueue();
    res.json({ success: true, jobId });
  } catch (err) { res.status(500).json({ error: '등록 실패' }); }
});

app.get('/api/ai/generate/status/:jobId', (req, res) => {
  const job = aiJobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: '작업 없음' });
  const pos = aiQueue.indexOf(req.params.jobId);
  res.json({ status: job.status, position: pos >= 0 ? pos : 0, result: job.result, error: job.error });
  if (job.status === 'done' || job.status === 'error') setTimeout(() => { delete aiJobs[req.params.jobId]; }, 60000);
});

async function processAiQueue() {
  if (isAiProcessing) return;
  isAiProcessing = true;
  while (aiQueue.length > 0) {
    const jobId = aiQueue[0];
    const job = aiJobs[jobId];
    if (!job) { aiQueue.shift(); continue; }
    job.status = 'processing';
    try {
      const config = readJSON(CONFIG_PATH, DEFAULT_CONFIG);
      const data = readJSON(DATA_PATH, DEFAULT_DATA);
      if (!data.users) data.users = [];
      const user = data.users.find(u => u.steamId === job.steamId);
      const { basePrompt, charPrompt, negativePrompt, charNegativePrompt, model } = job.reqBody;

      const finalInput = ["very aesthetic, masterpiece, no text", basePrompt, charPrompt].filter(Boolean).join(", ");
      const finalNegative = ["nsfw, lowres, artistic error, worst quality, bad quality", negativePrompt, charNegativePrompt].filter(Boolean).join(", ");
      const targetModel = model === 'curated' ? config.novelAiModelCurated : config.novelAiModelFull;

      const payload = {
        action: "generate", input: finalInput, model: targetModel,
        parameters: {
          params_version: 3, width: 832, height: 1216, scale: 5, sampler: "k_euler_ancestral", steps: 28, n_samples: 1, ucPreset: 0,
          qualityToggle: true, noise_schedule: "karras", seed: Math.floor(Math.random() * 4294967295), negative_prompt: finalNegative,
          v4_prompt: { caption: { base_caption: finalInput, char_captions: charPrompt ? [{ char_caption: charPrompt, centers: [{x:0, y:0}] }] : [] }, use_coords: true, use_order: true },
          v4_negative_prompt: { caption: { base_caption: finalNegative, char_captions: [] }, legacy_uc: false }
        }
      };

      const aiRes = await axios.post(config.novelAiUrl, payload, {
        headers: { 'Authorization': `Bearer ${config.novelAiKey.trim()}`, 'Content-Type': 'application/json' },
        responseType: 'arraybuffer'
      });

      const buffer = Buffer.from(aiRes.data);
      let base64Image = '';
      if (buffer[0] === 0x89 && buffer[1] === 0x50) base64Image = `data:image/png;base64,${buffer.toString('base64')}`;
      else {
        const zip = new AdmZip(buffer);
        const entry = zip.getEntries().find(e => e.entryName.endsWith('.png'));
        base64Image = `data:image/png;base64,${entry.getData().toString('base64')}`;
      }

      if (config.novelAiCost > 0 && user) { user.energy -= config.novelAiCost; writeJSON(DATA_PATH, data); }
      job.result = { image: base64Image, remainingEnergy: user ? user.energy : 0 };
      job.status = 'done';
    } catch (err) { job.error = err.message; job.status = 'error'; }
    aiQueue.shift();
    if (aiQueue.length > 0) await delay(5000);
  }
  isAiProcessing = false;
}

// ── 상점, 세트 동기화, 거래 추적 ──
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8' };
async function fetchViaOldJson(steamId, cookie) { const url = `https://steamcommunity.com/profiles/${steamId}/inventory/json/753/6`; const headers = { ...HEADERS, Referer: `https://steamcommunity.com/profiles/${steamId}/inventory` }; if (cookie) headers.Cookie = `steamLoginSecure=${cookie}`; const resp = await axios.get(url, { headers, timeout: 30000, params: { l: 'english', count: 5000 } }); const d = resp.data; if (!d.success) throw new Error('success=false'); const rgInv = d.rgInventory || {}; const rgDesc = d.rgDescriptions || {}; const items = []; for (const id in rgInv) { const inv = rgInv[id]; const desc = rgDesc[`${inv.classid}_${inv.instanceid}`]; if (desc) items.push({ asset: { assetid: id, classid: inv.classid, instanceid: inv.instanceid, amount: inv.amount || '1' }, desc }); } return items; }
async function fetchViaNewApi(steamId, cookie) { const allAssets = [], allDescs = {}; let lastAssetId = null, page = 0; while (true) { page++; const params = { l: 'english', count: 2000 }; if (lastAssetId) params.start_assetid = lastAssetId; const headers = { ...HEADERS, Referer: `https://steamcommunity.com/profiles/${steamId}/inventory`, 'X-Requested-With': 'XMLHttpRequest' }; if (cookie) headers.Cookie = `steamLoginSecure=${cookie}`; const resp = await axios.get(`https://steamcommunity.com/inventory/${steamId}/753/6`, { params, headers, timeout: 30000 }); const d = resp.data; if (!d || d.success !== 1) throw new Error(`success=${d && d.success}`); const assets = d.assets || [], descs = d.descriptions || []; if (assets.length === 0 && d.total_inventory_count > 0) throw new Error('assets 비어있음'); for (const desc of descs) allDescs[`${desc.classid}_${desc.instanceid}`] = desc; for (const a of assets) allAssets.push(a); if (!d.more_items || assets.length === 0) break; lastAssetId = d.last_assetid; await delay(500); } return allAssets.map(a => ({ asset: a, desc: allDescs[`${a.classid}_${a.instanceid}`] })).filter(i => i.desc); }
async function fetchViaWebApi(steamId, apiKey) { if (!apiKey) throw new Error('API Key 없음'); const allAssets = [], allDescs = {}; let startAssetId = null, page = 0; while (true) { page++; const params = { key: apiKey, steamid: steamId, appid: 753, contextid: 6, count: 2000, get_descriptions: 1 }; if (startAssetId) params.start_assetid = startAssetId; const resp = await axios.get('https://api.steampowered.com/IEconService/GetInventoryItemsWithDescriptions/v1/', { params, timeout: 30000 }); const r = resp.data.response || resp.data; const assets = r.assets || [], descs = r.descriptions || []; if (assets.length === 0 && page === 1) throw new Error('assets 비어있음'); for (const desc of descs) allDescs[`${desc.classid}_${desc.instanceid}`] = desc; for (const a of assets) allAssets.push(a); if (!r.more_items || assets.length === 0) break; startAssetId = r.last_assetid || (assets[assets.length - 1] && assets[assets.length - 1].assetid); await delay(500); } return allAssets.map(a => ({ asset: a, desc: allDescs[`${a.classid}_${a.instanceid}`] })).filter(i => i.desc); }
async function fetchInventory(steamId, apiKey, cookie) { const errors = []; for (const [name, fn] of [['방법A', () => fetchViaOldJson(steamId, cookie)], ['방법B', () => fetchViaNewApi(steamId, cookie)], ['방법C', () => fetchViaWebApi(steamId, apiKey)]]) { try { const items = await fn(); if (items.length > 0) return items; } catch (e) { errors.push(e.message); } } throw new Error('모든 방법 실패:\n' + errors.join('\n')); }
function isTradingCard(desc) { if (desc.type) { const t = desc.type.toLowerCase(); if (t.includes('trading card')) return true; } const tags = desc.tags || []; if (tags.some(t => t.internal_name === 'item_class_2')) return true; if (tags.some(t => (t.localized_tag_name || t.name || '').toLowerCase().includes('trading card'))) return true; return false; }
function isFoilCard(desc) { if (desc.type && desc.type.toLowerCase().includes('foil')) return true; return (desc.tags || []).some(t => t.internal_name === 'cardborder_1'); }
function extractAppId(asset, desc) { if (desc.market_fee_app) return parseInt(desc.market_fee_app); const tags = desc.tags || []; const gameTag = tags.find(t => t.category === 'Game' || t.category_name === 'Game'); if (gameTag && gameTag.internal_name) { const m = gameTag.internal_name.match(/app_(\d+)/); if (m) return parseInt(m[1]); const m2 = gameTag.internal_name.match(/(\d+)/); if (m2) return parseInt(m2[1]); } return 0; }
function extractGameName(desc, appId) { const tags = desc.tags || []; const gameTag = tags.find(t => t.category === 'Game' || t.category_name === 'Game'); return gameTag ? (gameTag.localized_tag_name || gameTag.name || `App ${appId}`) : `App ${appId}`; }
async function fetchSetSizeFromBadgePage(steamId, appId) { const url = `https://steamcommunity.com/profiles/${steamId}/gamecards/${appId}`; try { const resp = await axios.get(url, { headers: { ...HEADERS, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', Referer: 'https://steamcommunity.com/' }, timeout: 15000 }); const match = resp.data.match(/(\d+)\s+of\s+(\d+),\s*Series/i); if (match) return parseInt(match[2]); return 0; } catch (e) { return 0; } }
async function fetchLvlupPrice(appId) { const url = `https://steamlvlup.com/gameinfo/${appId}`; const resp = await axios.get(url, { headers: { ...HEADERS, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', Referer: 'https://steamlvlup.com/' }, timeout: 20000 }); const html = resp.data; let normalPrice = 0, foilPrice = 0, normalStock = 0, foilStock = 0; const allGemPrices = []; const gemsRe = /<i[^>]*class=["']gems_icon["'][^>]*><\/i>\s*([\d,]+)/g; let gm; while ((gm = gemsRe.exec(html)) !== null) allGemPrices.push(parseInt(gm[1].replace(/,/g, '')) || 0); const htmlLower = html.toLowerCase(); const normalIdx = htmlLower.indexOf('normal set'), foilIdx = htmlLower.indexOf('foil set'); if (normalIdx >= 0) { const end = (foilIdx > normalIdx) ? foilIdx : normalIdx + 3000; const section = html.slice(normalIdx, end); const nm = section.match(/<i[^>]*class=["']gems_icon["'][^>]*><\/i>\s*([\d,]+)/i); if (nm) normalPrice = parseInt(nm[1].replace(/,/g, '')) || 0; const nsm = section.match(/in\s+stock[^<]*<b>\s*(\d+)\s*<\/b>/i); if (nsm) normalStock = parseInt(nsm[1]) || 0; } if (foilIdx >= 0) { const section = html.slice(foilIdx, foilIdx + 3000); const fm = section.match(/<i[^>]*class=["']gems_icon["'][^>]*><\/i>\s*([\d,]+)/i); if (fm) foilPrice = parseInt(fm[1].replace(/,/g, '')) || 0; const fsm = section.match(/in\s+stock[^<]*<b>\s*(\d+)\s*<\/b>/i); if (fsm) foilStock = parseInt(fsm[1]) || 0; } if (normalPrice === 0 && allGemPrices.length >= 1) normalPrice = allGemPrices[0]; if (foilPrice === 0 && allGemPrices.length >= 2) foilPrice = allGemPrices[1]; const allStocks = []; const stockRe = /in\s+stock[^<]*<b>\s*(\d+)\s*<\/b>/gi; let sm; while ((sm = stockRe.exec(html)) !== null) allStocks.push(parseInt(sm[1]) || 0); if (normalStock === 0 && allStocks.length >= 1) normalStock = allStocks[0]; if (foilStock === 0 && allStocks.length >= 2) foilStock = allStocks[1]; return { normalPrice, foilPrice, normalStock, foilStock }; }
function calcLvlupSuggestedGem(pts, pointToGem, multiplier) { if (!pts || pts <= 0) return 0; return Math.ceil(pts * (multiplier || 1.0) * (pointToGem || 5)); }

app.post('/api/steam/refresh', authMiddleware, async (req, res) => {
  try {
    const config = readJSON(CONFIG_PATH, DEFAULT_CONFIG); const existingData = readJSON(DATA_PATH, DEFAULT_DATA);
    if (!existingData.sets) existingData.sets = [];
    const steamId = config.steamId; if (!steamId) return res.status(400).json({ error: '스팀 커뮤니티 ID 설정 필요' });
    const allItems = await fetchInventory(steamId, config.steamApiKey, config.steamLoginSecure);
    const tradingCards = [];
    for (const item of allItems) {
      if (!isTradingCard(item.desc) || isFoilCard(item.desc)) continue;
      const appId = extractAppId(item.asset, item.desc); if (!appId) continue;
      tradingCards.push({ classid: String(item.desc.classid), appId, gameName: extractGameName(item.desc, appId), name: item.desc.name || item.desc.market_name || 'Unknown', marketHashName: item.desc.market_hash_name || '', amount: parseInt(item.asset.amount) || 1 });
    }
    const gameGroups = {};
    for (const card of tradingCards) {
      if (!gameGroups[card.appId]) gameGroups[card.appId] = { appId: card.appId, gameName: card.gameName, cards: {} };
      if (!gameGroups[card.appId].cards[card.classid]) gameGroups[card.appId].cards[card.classid] = { name: card.name, marketHashName: card.marketHashName, amount: 0 };
      gameGroups[card.appId].cards[card.classid].amount += card.amount;
    }
    const appIdList = Object.keys(gameGroups); const setSize = {}; const CONCURRENCY = 5;
    for (let i = 0; i < appIdList.length; i += CONCURRENCY) {
      const batch = appIdList.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(aid => fetchSetSizeFromBadgePage(steamId, aid)));
      batch.forEach((aid, idx) => { setSize[aid] = results[idx]; });
      if (i + CONCURRENCY < appIdList.length) await delay(300);
    }
    const results = [];
    for (const appIdStr in gameGroups) {
      const group = gameGroups[appIdStr]; const appId = parseInt(appIdStr);
      const uniqueCards = Object.keys(group.cards).length; const cardAmounts = Object.values(group.cards).map(c => c.amount);
      const realSetSize = setSize[appIdStr] || uniqueCards; const completeSets = (uniqueCards >= realSetSize) ? Math.min(...cardAmounts) : 0;
      results.push({ appId, gameName: group.gameName, cardsInSet: realSetSize, uniqueCards, totalCards: cardAmounts.reduce((a, b) => a + b, 0), completeSets, totalMarketPrice: 0, lvlupNormalPrice: 0, lvlupFoilPrice: 0, lvlupNormalStock: 0, lvlupFoilStock: 0, lvlupCostPoints: 0, suggestedGemPrice: 0, sellPrice: 0, listed: false, cards: Object.values(group.cards).map(c => ({ name: c.name, marketHashName: c.marketHashName, amount: c.amount, marketPrice: 0 })) });
    }
    const existingSets = existingData.sets || [];
    const mergedSets = results.map(ns => {
      const ex = existingSets.find(s => s.appId === ns.appId); if (!ex) return ns;
      return { ...ns, totalMarketPrice: ex.totalMarketPrice || 0, lvlupNormalPrice: ex.lvlupNormalPrice || 0, lvlupFoilPrice: ex.lvlupFoilPrice || 0, lvlupNormalStock: ex.lvlupNormalStock || 0, lvlupFoilStock: ex.lvlupFoilStock || 0, lvlupCostPoints: ex.lvlupCostPoints || 0, suggestedGemPrice: ex.suggestedGemPrice || 0, sellPrice: ex.sellPrice || 0, listed: ex.listed || false, cards: ns.cards.map(nc => { const ec = (ex.cards || []).find(c => c.marketHashName === nc.marketHashName); return ec ? { ...nc, marketPrice: ec.marketPrice || 0 } : nc; }) };
    });
    const newData = { sets: mergedSets, coupons: existingData.coupons || [], users: existingData.users || [], lastRefresh: new Date().toISOString() };
    writeJSON(DATA_PATH, newData); res.json({ success: true, data: newData });
  } catch (err) { res.status(500).json({ error: err.message || '새로고침 실패' }); }
});

app.post('/api/steam/price/:appId', authMiddleware, async (req, res) => {
  try {
    const appId = parseInt(req.params.appId); const config = readJSON(CONFIG_PATH, DEFAULT_CONFIG); const data = readJSON(DATA_PATH, DEFAULT_DATA);
    if (!data.sets) data.sets = [];
    const set = data.sets.find(s => s.appId === appId); if (!set) return res.status(404).json({ error: '세트 없음' });
    let totalMarketPrice = 0;
    for (let i = 0; i < set.cards.length; i++) {
      const card = set.cards[i]; if (!card.marketHashName) continue;
      try { const resp = await axios.get('https://steamcommunity.com/market/priceoverview/', { params: { appid: 753, currency: 16, market_hash_name: card.marketHashName }, headers: { ...HEADERS, Referer: 'https://steamcommunity.com/market/' }, timeout: 15000 }); const raw = (resp.data && (resp.data.lowest_price || resp.data.median_price)) || ''; const price = parseFloat(raw.replace(/[^\d.]/g, '')) || 0; card.marketPrice = price; totalMarketPrice += price; } catch (e) {}
      if (i < set.cards.length - 1) await delay(1200);
    }
    set.totalMarketPrice = Math.round(totalMarketPrice * 100) / 100; const gemSackPrice = config.gemSackPrice || 1100;
    set.suggestedGemPrice = totalMarketPrice > 0 ? Math.ceil(totalMarketPrice * 1.3 / (gemSackPrice / 1000)) : (set.suggestedGemPrice || 0);
    writeJSON(DATA_PATH, data); res.json({ success: true, set: { appId: set.appId, totalMarketPrice: set.totalMarketPrice, suggestedGemPrice: set.suggestedGemPrice, cards: set.cards } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/steam/lvlup/:appId', authMiddleware, async (req, res) => {
  try {
    const appId = parseInt(req.params.appId); const config = readJSON(CONFIG_PATH, DEFAULT_CONFIG); const data = readJSON(DATA_PATH, DEFAULT_DATA);
    if (!data.sets) data.sets = [];
    const set = data.sets.find(s => s.appId === appId); if (!set) return res.status(404).json({ error: '세트 없음' });
    const result = await fetchLvlupPrice(appId);
    set.lvlupNormalPrice = result.normalPrice; set.lvlupFoilPrice = result.foilPrice; set.lvlupNormalStock = result.normalStock; set.lvlupFoilStock = result.foilStock; set.suggestedGemPrice = calcLvlupSuggestedGem(result.normalPrice, config.lvlupPointToGem || 5, config.lvlupBuyMultiplier || 1.0); set.lvlupCostPoints = result.normalPrice;
    writeJSON(DATA_PATH, data); res.json({ success: true, set: { appId, lvlupNormalPrice: result.normalPrice, lvlupFoilPrice: result.foilPrice, lvlupNormalStock: result.normalStock, lvlupFoilStock: result.foilStock, suggestedGemPrice: set.suggestedGemPrice, lvlupCostPoints: result.normalPrice } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/steam/lvlup-all', authMiddleware, async (req, res) => {
  try {
    const config = readJSON(CONFIG_PATH, DEFAULT_CONFIG); const data = readJSON(DATA_PATH, DEFAULT_DATA); 
    if (!data.sets) data.sets = [];
    const sets = data.sets;
    if (sets.length === 0) return res.status(400).json({ error: '새로고침 필요' });
    let success = 0, failed = 0;
    for (let i = 0; i < sets.length; i++) {
      const set = sets[i];
      try { const result = await fetchLvlupPrice(set.appId); set.lvlupNormalPrice = result.normalPrice; set.lvlupFoilPrice = result.foilPrice; set.lvlupNormalStock = result.normalStock; set.lvlupFoilStock = result.foilStock; set.suggestedGemPrice = calcLvlupSuggestedGem(result.normalPrice, config.lvlupPointToGem || 5, config.lvlupBuyMultiplier || 1.0); set.lvlupCostPoints = result.normalPrice; success++; } catch (e) { failed++; }
      if (i < sets.length - 1) await delay(800);
    }
    writeJSON(DATA_PATH, data); res.json({ success: true, data, summary: { total: sets.length, success, failed } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/shop/offer-status/:offerId', async (req, res) => {
  try {
    const status = await bot.getOfferStatus(req.params.offerId);
    res.json(status);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/shop/purchase', async (req, res) => {
  try {
    if (!req.session.steamUser) return res.status(401).json({ error: '로그인 필요' });
    const data = readJSON(DATA_PATH, DEFAULT_DATA);
    if (!data.sets) data.sets = [];
    if (!data.coupons) data.coupons = [];
    if (!data.users) data.users = [];

    const user = data.users.find(u => u.steamId === req.session.steamUser.steamId);
    if (!user) return res.status(404).json({ error: '유저 데이터 없음' });
    if (!user.approved) return res.status(403).json({ error: '관리자 승인이 필요합니다.' });

    const { tradeUrl, appId, couponCode, quantity } = req.body;
    const set = data.sets.find(s => String(s.appId) === String(appId));
    if (!set || !set.listed) return res.status(404).json({ error: '상품 없음' });

    let finalPrice = set.sellPrice * (quantity || 1);
    if (couponCode) {
      const idx = data.coupons.findIndex(c => c.code === couponCode.toUpperCase() && c.type !== 'energy');
      if (idx >= 0) {
        const cp = data.coupons[idx];
        let disc = Math.floor(finalPrice * (cp.discountRate / 100));
        if (cp.maxDiscount > 0) disc = Math.min(disc, cp.maxDiscount);
        finalPrice -= disc;
        cp.usedCount += 1;
        if (cp.usedCount >= cp.usageLimit) data.coupons.splice(idx, 1);
      }
    }
    const token = new URL(tradeUrl).searchParams.get('token');
    const resOffer = await bot.sendPurchaseOffer(req.session.steamUser.steamId, token, appId, finalPrice, quantity || 1);
    writeJSON(DATA_PATH, data);
    res.json({ success: true, ...resOffer });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 관리자 API ──
app.get('/api/config', authMiddleware, (req, res) => res.json(readJSON(CONFIG_PATH, DEFAULT_CONFIG)));
app.post('/api/config', authMiddleware, (req, res) => { writeJSON(CONFIG_PATH, req.body); res.json({ success: true }); });
app.get('/api/data', authMiddleware, (req, res) => res.json(readJSON(DATA_PATH, DEFAULT_DATA)));
app.post('/api/data', authMiddleware, (req, res) => { writeJSON(DATA_PATH, req.body); res.json({ success: true }); });
app.get('/api/shop', (req, res) => {
  const d = readJSON(DATA_PATH, DEFAULT_DATA), c = readJSON(CONFIG_PATH, DEFAULT_CONFIG);
  if (!d.sets) d.sets = [];
  res.json({ sets: d.sets.filter(s => s.listed && s.completeSets > 0), novelAiCost: c.novelAiCost });
});
app.get('/api/users', authMiddleware, (req, res) => {
  const d = readJSON(DATA_PATH, DEFAULT_DATA);
  if (!d.users) d.users = [];
  res.json({ users: d.users });
});
app.post('/api/users/:sid/approve', authMiddleware, (req, res) => {
  const data = readJSON(DATA_PATH, DEFAULT_DATA);
  if (!data.users) data.users = [];
  const u = data.users.find(x => x.steamId === req.params.sid);
  if (u) { u.approved = true; writeJSON(DATA_PATH, data); }
  res.json({ success: true });
});
app.delete('/api/users/:sid', authMiddleware, (req, res) => {
  const data = readJSON(DATA_PATH, DEFAULT_DATA);
  if (!data.users) data.users = [];
  data.users = data.users.filter(x => x.steamId !== req.params.sid);
  writeJSON(DATA_PATH, data);
  res.json({ success: true });
});
app.get('/api/coupons', authMiddleware, (req, res) => {
  const d = readJSON(DATA_PATH, DEFAULT_DATA);
  if (!d.coupons) d.coupons = [];
  res.json({ coupons: d.coupons });
});
app.post('/api/coupons', authMiddleware, (req, res) => {
  const data = readJSON(DATA_PATH, DEFAULT_DATA);
  if (!data.coupons) data.coupons = [];
  const code = req.body.code.toUpperCase();
  const idx = data.coupons.findIndex(c => c.code === code);
  const newCp = { ...req.body, code, usedCount: idx >= 0 ? data.coupons[idx].usedCount : 0 };
  if (idx >= 0) data.coupons[idx] = newCp; else data.coupons.push(newCp);
  writeJSON(DATA_PATH, data); res.json({ success: true });
});
app.delete('/api/coupons/:code', authMiddleware, (req, res) => {
  const data = readJSON(DATA_PATH, DEFAULT_DATA);
  if (!data.coupons) data.coupons = [];
  data.coupons = data.coupons.filter(c => c.code !== req.params.code.toUpperCase());
  writeJSON(DATA_PATH, data);
  res.json({ success: true });
});

app.get('/api/bot/status', authMiddleware, (req, res) => res.json(bot.getStatus()));
app.post('/api/bot/login', authMiddleware, async (req, res) => { try { res.json(await bot.login()); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/bot/logoff', authMiddleware, (req, res) => { bot.logoff(); res.json({ success: true }); });
app.post('/api/bot/restock', authMiddleware, async (req, res) => { try { res.json(await bot.sendRestockOfferAll()); } catch (e) { res.status(500).json({ error: e.message }); } });

const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

app.get(/^(?!\/api).+/, (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});
app.get('/', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

const PORT = parseInt(process.env.PORT) || 3002;
app.listen(PORT, '0.0.0.0', () => {
  console.log('\n' + '='.repeat(50));
  console.log(`  🚀 서버 실행 중: http://0.0.0.0:${PORT}`);
  console.log('='.repeat(50) + '\n');
});