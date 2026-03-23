const BASE = '';

async function request(method: string, url: string, body?: unknown) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// 로그인
export const login = (username: string, password: string) =>
  fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password }),
  }).then(async r => {
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || '로그인 실패');
    return d;
  });

// 로그아웃
export const logout = () =>
  fetch('/api/logout', { method: 'POST', credentials: 'include' }).then(() => {});

// 세션 상태 확인
export const checkSession = () =>
  fetch('/api/session', { credentials: 'include' })
    .then(r => r.json())
    .then(d => d.isAdmin === true);

export const getConfig  = ()                => request('GET',  '/api/config');
export const saveConfig = (config: unknown) => request('POST', '/api/config', config);
export const getData    = ()                => request('GET',  '/api/data');
export const saveData   = (data: unknown)   => request('POST', '/api/data', data);

export const refreshSteam     = ()                       => request('POST', '/api/steam/refresh');
export const fetchPriceForSet = (appId: string | number) => request('POST', `/api/steam/price/${appId}`);
export const fetchLvlupForSet = (appId: string | number) => request('POST', `/api/steam/lvlup/${appId}`);
export const fetchLvlupAll    = ()                       => request('POST', '/api/steam/lvlup-all');

// 봇 API
export const getBotStatus = () => request('GET',  '/api/bot/status');
export const loginBot     = () => request('POST', '/api/bot/login');
export const restockBot   = (body?: Record<string, unknown>) => request('POST', '/api/bot/restock', body || {});

// 공개 상점 API
export const getShop = () =>
  fetch('/api/shop', { credentials: 'include' }).then(r => r.json());

// 구매 거래 생성 — tradeUrl (트레이드 URL 전체) + appId
export const createPurchase = (body: { tradeUrl: string; appId: string | number }) =>
  fetch('/api/shop/purchase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  }).then(async r => {
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || '구매 실패');
    return d;
  });
