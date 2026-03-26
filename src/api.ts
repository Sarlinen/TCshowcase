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

export const logout = () => fetch('/api/logout', { method: 'POST', credentials: 'include' }).then(() => {});
export const checkSession = () => fetch('/api/session', { credentials: 'include' }).then(r => r.json()).then(d => d.isAdmin === true);

export const getConfig  = ()                => request('GET',  '/api/config');
export const saveConfig = (config: unknown) => request('POST', '/api/config', config);
export const getData    = ()                => request('GET',  '/api/data');
export const saveData   = (data: unknown)   => request('POST', '/api/data', data);
export const refreshSteam     = ()                       => request('POST', '/api/steam/refresh');
export const fetchPriceForSet = (appId: string | number) => request('POST', `/api/steam/price/${appId}`);
export const fetchLvlupForSet = (appId: string | number) => request('POST', `/api/steam/lvlup/${appId}`);
export const fetchLvlupAll    = ()                       => request('POST', '/api/steam/lvlup-all');
export const getBotStatus = () => request('GET',  '/api/bot/status');
export const loginBot     = () => request('POST', '/api/bot/login');
export const restockBot   = (body?: Record<string, unknown>) => request('POST', '/api/bot/restock', body || {});

export interface Coupon {
  code: string; 
  type?: 'discount' | 'energy';
  discountRate?: number; 
  minPurchase?: number; 
  maxDiscount?: number; 
  energyAmount?: number;
  usageLimit: number; 
  usedCount: number;
}
export const getCoupons   = () => request('GET', '/api/coupons');
export const createCoupon = (data: Partial<Coupon>) => request('POST', '/api/coupons', data);
export const deleteCoupon = (code: string) => request('DELETE', `/api/coupons/${code}`);

export interface SteamUser {
  steamId: string;
  displayName?: string;
  avatar?: string;
  approved: boolean;
  energy: number;
  joinedAt: string;
}
export const getUsers    = () => request('GET', '/api/users');
export const approveUser = (steamId: string) => request('POST', `/api/users/${steamId}/approve`);
export const deleteUser  = (steamId: string) => request('DELETE', `/api/users/${steamId}`);

export const getMe = () => fetch('/api/auth/me', { credentials: 'include' }).then(r => r.json());
export const logoutSteam = () => request('POST', '/api/auth/steam/logout');

export const getShop = () => fetch('/api/shop', { credentials: 'include' }).then(r => r.json());
export const validateCoupon = (code: string, price: number) => request('POST', '/api/shop/validate-coupon', { code, price });

export const redeemEnergyCoupon = (code: string) => request('POST', '/api/users/energy-coupon', { code });

export const createPurchase = (body: { tradeUrl: string; appId: string | number; couponCode?: string; quantity?: number }) =>
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

// ✨ 대기열 제출 및 상태 확인용 함수 교체 ✨
export const submitAiJob = (basePrompt: string, charPrompt: string, negativePrompt: string, charNegativePrompt: string, model: string) =>
  request('POST', '/api/ai/generate/submit', { basePrompt, charPrompt, negativePrompt, charNegativePrompt, model });

export const getAiJobStatus = (jobId: string) =>
  request('GET', `/api/ai/generate/status/${jobId}`);