import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  getConfig, saveConfig, getData, saveData,
  refreshSteam, fetchLvlupForSet,
  getBotStatus, loginBot, restockBot,
  getCoupons, createCoupon, deleteCoupon, Coupon,
  getUsers, approveUser, deleteUser, SteamUser
} from '../api';

interface Config {
  steamLogin: string; steamPassword: string; steamId: string;
  steamApiKey: string; identitySecret: string; sharedSecret: string;
  steamLoginSecure: string; gemSackPrice: number;
  lvlupPointToGem: number; lvlupBuyMultiplier: number;
  adminPassword: string; adminSteamId: string; adminTradeToken: string;
  novelAiKey: string; energyEarnRate: number; novelAiCost: number;
  novelAiUrl: string; novelAiModelCurated: string; novelAiModelFull: string;
}

interface CardSet {
  appId: string; gameName: string; completeSets: number; cardsInSet: number;
  totalMarketPrice: number; lvlupNormalPrice: number; lvlupFoilPrice: number;
  lvlupNormalStock: number; lvlupFoilStock: number; lvlupCostPoints: number;
  suggestedGemPrice: number; sellPrice: number; listed: boolean;
}

interface BotStatus {
  isLoggedIn: boolean; botSteamId: string | null; loginError: string | null; logs: string[];
}

const DEFAULT_CONFIG: Config = {
  steamLogin: '', steamPassword: '', steamId: '', steamApiKey: '', identitySecret: '', sharedSecret: '',
  steamLoginSecure: '', gemSackPrice: 1100, lvlupPointToGem: 5, lvlupBuyMultiplier: 1.0,
  adminPassword: 'admin1234', adminSteamId: '', adminTradeToken: '',
  novelAiKey: '', energyEarnRate: 5, novelAiCost: 100,
  novelAiUrl: 'https://image.novelai.net/ai/generate-image',
  novelAiModelCurated: 'nai-diffusion-4-5-curated',
  novelAiModelFull: 'nai-diffusion-4-5-full'
};

export default function AdminPage() {
  const [tab, setTab] = useState<'bot' | 'inventory' | 'coupons' | 'users' | 'security'>('bot');
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [sets, setSets] = useState<CardSet[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [users, setUsers] = useState<SteamUser[]>([]);

  const [lastRefresh, setLastRefresh] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lvlupAllLoading, setLvlupAllLoading] = useState(false);
  const [lvlupAllProgress, setLvlupAllProgress] = useState<{ done: number; total: number } | null>(null);
  const [loadingAppIds, setLoadingAppIds] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  
  const [oldPw, setOldPw] = useState(''); 
  const [newPw, setNewPw] = useState(''); 
  const [newPwConfirm, setNewPwConfirm] = useState('');
  
  const lvlupAllAbort = useRef(false);

  const [botStatus, setBotStatus] = useState<BotStatus | null>(null);
  const [botLoggingIn, setBotLoggingIn] = useState(false);
  const [botLogOff, setBotLogOff] = useState(false);
  const [restockLoading, setRestockLoading] = useState(false);

  const [newCoupon, setNewCoupon] = useState({ 
    code: '', type: 'discount' as 'discount'|'energy', discountRate: 10, 
    minPurchase: 0, maxDiscount: 0, energyAmount: 1000, usageLimit: 1 
  });

  const navigate = useNavigate();
  const { doLogout } = useAuth();

  useEffect(() => {
    loadAll();
    loadBotStatus();
    const interval = setInterval(loadBotStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (message) {
      const duration = message.type === 'error' ? 10000 : 4000;
      const timer = setTimeout(() => setMessage(null), duration);
      return () => clearTimeout(timer);
    }
  }, [message]);

  async function loadBotStatus() { 
    try { const s = await getBotStatus(); setBotStatus(s); } catch {} 
  }

  async function handleBotLogin() {
    setBotLoggingIn(true); setMessage(null);
    try { 
      await loginBot(); 
      setMessage({ type: 'success', text: '봇 로그인 성공!' }); 
      await loadBotStatus(); 
    } catch (err: any) { 
      setMessage({ type: 'error', text: `봇 로그인 실패: ${err.message}` }); 
    } finally { 
      setBotLoggingIn(false); 
    }
  }

  async function handleBotLogoff() {
    setBotLogOff(true);
    try { 
      await fetch('/api/bot/logoff', { method: 'POST', credentials: 'include' }); 
      setMessage({ type: 'success', text: '봇 로그오프 완료.' }); 
      await loadBotStatus(); 
    } catch (err: any) { 
      setMessage({ type: 'error', text: `로그오프 실패: ${err.message}` }); 
    } finally { 
      setBotLogOff(false); 
    }
  }

  async function handleRestockAll() {
    if (!config.adminSteamId) { 
      setMessage({ type: 'error', text: '관리자 SteamID64를 입력하세요.' }); 
      setTab('bot'); return; 
    }
    if (!botStatus?.isLoggedIn) { 
      setMessage({ type: 'error', text: '봇이 오프라인입니다.' }); return; 
    }
    setRestockLoading(true); setMessage(null);
    try { 
      const result = await restockBot({}); 
      setMessage({ type: 'success', text: `✅ 재고보충 완료! ${result.cards}장` }); 
    } catch (err: any) { 
      setMessage({ type: 'error', text: `재고보충 실패: ${err.message}` }); 
    } finally { 
      setRestockLoading(false); 
    }
  }

  async function loadAll() {
    setLoading(true);
    try {
      const [cfgRes, dataRes, cpRes, uRes] = await Promise.all([getConfig(), getData(), getCoupons(), getUsers()]);
      setConfig({ ...DEFAULT_CONFIG, ...cfgRes });
      setSets(dataRes.sets || []); 
      setCoupons(cpRes.coupons || []); 
      setUsers(uRes.users || []); 
      setLastRefresh(dataRes.lastRefresh || '');
    } catch (err: any) { 
      setMessage({ type: 'error', text: `데이터 불러오기 실패: ${err.message}` }); 
    } finally { 
      setLoading(false); 
    }
  }

  async function handleApproveUser(steamId: string) {
    try { 
      await approveUser(steamId); 
      setUsers(users.map(u => u.steamId === steamId ? { ...u, approved: true } : u)); 
      setMessage({ type: 'success', text: '승인 처리되었습니다.' }); 
    } catch (err: any) { 
      setMessage({ type: 'error', text: '승인 실패' }); 
    }
  }

  async function handleDeleteUser(steamId: string) {
    if (!confirm('유저를 삭제하시겠습니까?')) return;
    try { 
      await deleteUser(steamId); 
      setUsers(users.filter(u => u.steamId !== steamId)); 
      setMessage({ type: 'success', text: '유저가 삭제되었습니다.' }); 
    } catch (err: any) { 
      setMessage({ type: 'error', text: '유저 삭제 실패' }); 
    }
  }

  async function handleSaveConfig() { 
    setSaving(true); 
    try { 
      await saveConfig(config); 
      setMessage({ type: 'success', text: '설정이 저장되었습니다.' }); 
    } catch (err: any) { 
      setMessage({ type: 'error', text: `저장 실패: ${err.message}` }); 
    } finally { 
      setSaving(false); 
    } 
  }
  
  async function handleRefresh() { 
    if (!config.steamId) { 
      setMessage({ type: 'error', text: '스팀 ID 설정 필요' }); return; 
    } 
    setRefreshing(true); 
    try { 
      const result = await refreshSteam(); 
      setSets(result.data.sets || []); 
      setLastRefresh(result.data.lastRefresh || ''); 
      setMessage({ type: 'success', text: `새로고침 완료!` }); 
    } catch (err: any) { 
      setMessage({ type: 'error', text: err.message }); 
    } finally { 
      setRefreshing(false); 
    } 
  }
  
  async function handleFetchLvlup(appId: string) { 
    setLoadingAppIds(prev => new Set(prev).add(appId)); 
    try { 
      const result = await fetchLvlupForSet(appId); 
      const updated = result.set; 
      setSets(prev => prev.map(s => String(s.appId) === String(appId) ? { ...s, ...updated } : s)); 
    } catch (err: any) { 
      setMessage({ type: 'error', text: err.message }); 
    } finally { 
      setLoadingAppIds(prev => { const n = new Set(prev); n.delete(appId); return n; }); 
    } 
  }
  
  async function handleFetchLvlupAll() { 
    if (sets.length === 0) return; 
    setLvlupAllLoading(true); lvlupAllAbort.current = false; setLvlupAllProgress({ done: 0, total: sets.length }); 
    let success = 0, failed = 0; 
    for (let i = 0; i < sets.length; i++) { 
      if (lvlupAllAbort.current) break; 
      setLvlupAllProgress({ done: i + 1, total: sets.length }); 
      try { 
        const result = await fetchLvlupForSet(sets[i].appId); 
        const updated = result.set; 
        setSets(prev => prev.map(s => String(s.appId) === String(sets[i].appId) ? { ...s, ...updated } : s)); 
        success++; 
      } catch { failed++; } 
      if (i < sets.length - 1 && !lvlupAllAbort.current) await new Promise(r => setTimeout(r, 800)); 
    } 
    setLvlupAllLoading(false); setLvlupAllProgress(null); 
    setMessage({ type: success > 0 ? 'success' : 'error', text: `lvlup 전체조회 완료` }); 
  }
  
  function applyLvlupSuggestedPrice(appId: string) { 
    setSets(prev => prev.map(s => String(s.appId) === String(appId) && s.suggestedGemPrice > 0 ? { ...s, sellPrice: s.suggestedGemPrice } : s)); 
  }
  
  function applyAllSuggestedPrice() { 
    setSets(prev => prev.map(s => s.suggestedGemPrice > 0 ? { ...s, sellPrice: s.suggestedGemPrice } : s)); 
    setMessage({ type: 'success', text: '제안가 전체적용 됨' }); 
  }
  
  async function handleSaveData() { 
    setSaving(true); 
    try { 
      await saveData({ sets, lastRefresh }); 
      setMessage({ type: 'success', text: '데이터 저장됨' }); 
    } catch (err: any) { 
      setMessage({ type: 'error', text: `저장 실패` }); 
    } finally { 
      setSaving(false); 
    } 
  }
  
  function updateSet(appId: string, field: string, value: unknown) { 
    setSets(prev => prev.map(s => String(s.appId) === String(appId) ? { ...s, [field]: value } : s)); 
  }
  
  function toggleAllListed() { 
    const allOn = sets.every(s => s.listed); 
    setSets(prev => prev.map(s => ({ ...s, listed: !allOn }))); 
  }
  
  async function handleCreateCoupon(e: React.FormEvent) { 
    e.preventDefault(); 
    if (!newCoupon.code) return; 
    try { 
      await createCoupon(newCoupon); 
      setMessage({ type: 'success', text: '쿠폰이 생성되었습니다.' }); 
      setNewCoupon({ code: '', type: 'discount', discountRate: 10, minPurchase: 0, maxDiscount: 0, energyAmount: 1000, usageLimit: 1 }); 
      const cpRes = await getCoupons(); 
      setCoupons(cpRes.coupons || []); 
    } catch (err: any) { 
      setMessage({ type: 'error', text: err.message }); 
    } 
  }
  
  async function handleDeleteCoupon(code: string) { 
    if (!confirm(`삭제하시겠습니까?`)) return; 
    try { 
      await deleteCoupon(code); 
      setCoupons(prev => prev.filter(c => c.code !== code)); 
    } catch (err: any) {} 
  }
  
  async function handleChangePassword() { 
    if (!oldPw || !newPw || newPw !== newPwConfirm) return; 
    try { 
      const currentConfig = await getConfig(); 
      if (oldPw !== (currentConfig.adminPassword || 'admin1234')) { 
        setMessage({ type: 'error', text: '비밀번호가 틀립니다.' }); return; 
      } 
      await saveConfig({ ...currentConfig, adminPassword: newPw }); 
      setMessage({ type: 'success', text: '비밀번호가 변경되었습니다.' }); 
      setOldPw(''); setNewPw(''); setNewPwConfirm(''); 
    } catch (err: any) {} 
  }
  
  function cfg(field: keyof Config, value: string | number) { 
    setConfig(prev => ({ ...prev, [field]: value })); 
  }

  const listedCount = sets.filter(s => s.listed).length;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-xl animate-pulse">⏳ 로딩 중...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4 flex justify-between items-center max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <span className="text-2xl">⚙️</span>
          <h1 className="text-xl font-bold text-white">관리자 페이지</h1>
        </div>
        <div className="flex gap-3">
          <button onClick={() => navigate('/')} className="text-sm px-3 py-1.5 bg-gray-700 rounded hover:bg-gray-600 transition">
            🏠 상점
          </button>
          <button onClick={async () => { await doLogout(); navigate('/login'); }} className="text-sm bg-red-600 hover:bg-red-700 px-3 py-1.5 rounded transition">
            🚪 로그아웃
          </button>
        </div>
      </header>

      {message && (
        <div className={`fixed top-4 right-4 z-50 p-4 rounded-lg shadow text-sm flex gap-4 ${message.type === 'success' ? 'bg-green-800' : 'bg-red-800'}`}>
          <span>{message.text}</span>
          <button onClick={() => setMessage(null)}>✕</button>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex gap-2 mb-6 border-b border-gray-700">
          {[
            { key: 'bot', label: '⚙️ 봇/시스템 설정' }, 
            { key: 'inventory', label: '📦 인벤토리' }, 
            { key: 'coupons', label: '🎫 쿠폰' }, 
            { key: 'users', label: '👥 유저 관리' }, 
            { key: 'security', label: '🔒 보안' }
          ].map(t => (
            <button 
              key={t.key} 
              onClick={() => setTab(t.key as typeof tab)} 
              className={`px-5 py-2.5 text-sm font-medium rounded-t transition ${tab === t.key ? 'bg-blue-600 text-white border-b-2 border-blue-400' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── 🤖 봇/시스템 설정 ── */}
        {tab === 'bot' && (
          <div className="space-y-6">
            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <h2 className="text-lg font-bold mb-4">🤖 봇 상태</h2>
              <div className="flex items-center gap-4">
                <span className={`font-semibold flex items-center gap-2 ${botStatus?.isLoggedIn ? 'text-green-400' : 'text-red-400'}`}>
                  <span className={`w-3 h-3 rounded-full ${botStatus?.isLoggedIn ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
                  {botStatus?.isLoggedIn ? '온라인' : '오프라인'}
                </span>
                <button onClick={handleBotLogin} disabled={botLoggingIn} className="px-4 py-1.5 bg-green-600 hover:bg-green-700 rounded text-sm disabled:opacity-50">
                  {botLoggingIn ? '⏳...' : '🔑 로그인'}
                </button>
                {botStatus?.isLoggedIn && (
                  <button onClick={handleBotLogoff} disabled={botLogOff} className="px-4 py-1.5 bg-gray-600 hover:bg-gray-700 rounded text-sm disabled:opacity-50">
                    ⏏️ 로그오프
                  </button>
                )}
              </div>
            </div>

            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <h2 className="text-lg font-bold mb-4">🔧 스팀 계정 설정</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className="block text-sm text-gray-400 mb-1">로그인 아이디</label><input value={config.steamLogin} onChange={e => cfg('steamLogin', e.target.value)} className="w-full bg-gray-700 border-gray-600 rounded px-3 py-2 text-sm text-white" /></div>
                <div><label className="block text-sm text-gray-400 mb-1">비밀번호</label><input type="password" value={config.steamPassword} onChange={e => cfg('steamPassword', e.target.value)} className="w-full bg-gray-700 border-gray-600 rounded px-3 py-2 text-sm text-white" /></div>
                <div><label className="block text-sm text-gray-400 mb-1">SteamID64</label><input value={config.steamId} onChange={e => cfg('steamId', e.target.value)} className="w-full bg-gray-700 border-gray-600 rounded px-3 py-2 text-sm text-white" /></div>
                <div><label className="block text-sm text-gray-400 mb-1">Steam API Key</label><input value={config.steamApiKey || ''} onChange={e => cfg('steamApiKey', e.target.value)} className="w-full bg-gray-700 border-gray-600 rounded px-3 py-2 text-sm text-white" placeholder="프로필 사진 추출에 사용됩니다" /></div>
                <div><label className="block text-sm text-gray-400 mb-1">Shared Secret</label><input value={config.sharedSecret} onChange={e => cfg('sharedSecret', e.target.value)} className="w-full bg-gray-700 border-gray-600 rounded px-3 py-2 text-sm text-white" /></div>
                <div><label className="block text-sm text-gray-400 mb-1">Identity Secret</label><input value={config.identitySecret} onChange={e => cfg('identitySecret', e.target.value)} className="w-full bg-gray-700 border-gray-600 rounded px-3 py-2 text-sm text-white" /></div>
              </div>
            </div>

            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <h2 className="text-lg font-bold mb-4">👤 관리자 본계정 설정 (재고보충용)</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className="block text-sm text-gray-400 mb-1">관리자 SteamID64</label><input value={config.adminSteamId} onChange={e => cfg('adminSteamId', e.target.value)} className="w-full bg-gray-700 border-gray-600 rounded px-3 py-2 text-sm text-white" /></div>
                <div><label className="block text-sm text-gray-400 mb-1">Trade Token</label><input value={config.adminTradeToken} onChange={e => cfg('adminTradeToken', e.target.value)} className="w-full bg-gray-700 border-gray-600 rounded px-3 py-2 text-sm text-white" /></div>
              </div>
            </div>

            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <h2 className="text-lg font-bold mb-4">✨ NovelAI 및 포인트 설정</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-3">
                  <label className="block text-sm text-gray-400 mb-1">NovelAI API URL (엔드포인트)</label>
                  <input type="text" value={config.novelAiUrl ?? ''} onChange={e => cfg('novelAiUrl', e.target.value)} placeholder="https://image.novelai.net/ai/generate-image" className="w-full bg-gray-700 border-gray-600 rounded px-3 py-2 text-sm text-white font-mono" />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">NovelAI API Key</label>
                  <input type="password" value={config.novelAiKey ?? ''} onChange={e => cfg('novelAiKey', e.target.value)} placeholder="pst-..." className="w-full bg-gray-700 border-gray-600 rounded px-3 py-2 text-sm text-white font-mono" />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Curated 모델명 (Enum)</label>
                  <input type="text" value={config.novelAiModelCurated ?? ''} onChange={e => cfg('novelAiModelCurated', e.target.value)} placeholder="nai-diffusion-4-5-curated" className="w-full bg-gray-700 border-gray-600 rounded px-3 py-2 text-sm text-white font-mono" />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Full 모델명 (Enum)</label>
                  <input type="text" value={config.novelAiModelFull ?? ''} onChange={e => cfg('novelAiModelFull', e.target.value)} placeholder="nai-diffusion-4-5-full" className="w-full bg-gray-700 border-gray-600 rounded px-3 py-2 text-sm text-white font-mono" />
                </div>
                
                <div className="md:col-span-3 border-t border-gray-700 my-2"></div>
                
                <div>
                  <label className="block text-sm text-gray-400 mb-1">결제 Energy 적립률 (%)</label>
                  <input type="number" value={config.energyEarnRate ?? 5} onChange={e => cfg('energyEarnRate', Number(e.target.value))} className="w-full bg-gray-700 border-gray-600 rounded px-3 py-2 text-sm text-white" />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">이미지 1장당 소모 Energy (0=무료, -1=사용금지)</label>
                  <input type="number" value={config.novelAiCost ?? 100} onChange={e => cfg('novelAiCost', Number(e.target.value))} className="w-full bg-gray-700 border-gray-600 rounded px-3 py-2 text-sm text-white" />
                </div>
              </div>
            </div>

            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <h2 className="text-lg font-bold mb-4">💎 가격 환산 설정</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div><label className="text-sm text-gray-400 mb-1 block">보석 주머니 시세 (₩/1000Gems)</label><input type="number" value={config.gemSackPrice ?? 1100} onChange={e => cfg('gemSackPrice', Number(e.target.value))} className="w-full bg-gray-700 rounded px-3 py-2 text-sm text-white" /></div>
                <div><label className="text-sm text-gray-400 mb-1 block">lvlup 1포인트 = N 보석</label><input type="number" value={config.lvlupPointToGem ?? 5} onChange={e => cfg('lvlupPointToGem', Number(e.target.value))} className="w-full bg-gray-700 rounded px-3 py-2 text-sm text-white" /></div>
                <div><label className="text-sm text-gray-400 mb-1 block">구매 배율 (마진)</label><input type="number" step="0.01" value={config.lvlupBuyMultiplier ?? 1.0} onChange={e => cfg('lvlupBuyMultiplier', Number(e.target.value))} className="w-full bg-gray-700 rounded px-3 py-2 text-sm text-white" /></div>
              </div>
            </div>

            <button onClick={handleSaveConfig} disabled={saving} className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-xl transition">
              {saving ? '⏳ 저장 중...' : '💾 전체 설정 저장'}
            </button>
          </div>
        )}

        {/* ── 📦 인벤토리 ── */}
        {tab === 'inventory' && (
          <div className="space-y-4">
            <div className="bg-gray-800 rounded-xl p-4 border border-gray-700 flex flex-wrap gap-2 items-center justify-between">
              <div className="flex flex-wrap gap-2">
                <button onClick={handleRefresh} disabled={refreshing} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded-lg font-medium transition">
                  {refreshing ? '⏳ 조회 중...' : '🔄 세트 새로고침'}
                </button>
                <button onClick={handleFetchLvlupAll} disabled={lvlupAllLoading || sets.length === 0} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm rounded-lg font-medium transition">
                  {lvlupAllLoading ? `⏳ ${lvlupAllProgress?.done}/${lvlupAllProgress?.total}` : '🔍 전체 lvlup 조회'}
                </button>
                {lvlupAllLoading && (
                  <button onClick={() => { lvlupAllAbort.current = true; }} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg transition">
                    ⏹ 중단
                  </button>
                )}
                <button onClick={applyAllSuggestedPrice} disabled={sets.length === 0} className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 text-white text-sm rounded-lg transition">
                  ✨ 제안가 전체 적용
                </button>
                <button onClick={handleRestockAll} disabled={restockLoading || !botStatus?.isLoggedIn} className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-40 text-white text-sm rounded-lg font-medium flex items-center gap-1 transition">
                  {restockLoading ? '전송 중...' : '📦 전체 재고보충'}
                </button>
              </div>
              <button onClick={handleSaveData} disabled={saving || sets.length === 0} className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm rounded-lg font-medium transition">
                {saving ? '⏳ 저장 중...' : '💾 저장'}
              </button>
            </div>

            {sets.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: '전체 게임',  value: sets.length, color: 'blue' },
                  { label: '판매 등록',  value: listedCount, color: 'green' },
                  { label: '총 세트 수', value: sets.reduce((a, s) => a + (s.completeSets || 0), 0).toLocaleString(), color: 'purple' },
                  { label: '봇 상태',    value: botStatus?.isLoggedIn ? '🟢 온라인' : '🔴 오프라인', color: botStatus?.isLoggedIn ? 'green' : 'red' },
                ].map((stat, idx) => (
                  <div key={idx} className={`bg-gray-800 border border-${stat.color}-800/50 rounded-lg p-3 text-center`}>
                    <p className="text-xs text-gray-400">{stat.label}</p>
                    <p className={`text-xl font-bold text-${stat.color}-400`}>{stat.value}</p>
                  </div>
                ))}
              </div>
            )}

            {sets.length === 0 ? (
              <div className="bg-gray-800 rounded-xl p-12 text-center border border-gray-700 text-gray-400">데이터가 없습니다. 새로고침을 진행해주세요.</div>
            ) : (
              <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-900 text-gray-400 text-xs uppercase">
                    <tr>
                      <th className="px-4 py-3">게임명</th>
                      <th className="px-4 py-3 text-center">세트수</th>
                      <th className="px-4 py-3 text-center">카드수</th>
                      <th className="px-4 py-3 text-center">lvlup 가격</th>
                      <th className="px-4 py-3 text-center">제안💎</th>
                      <th className="px-4 py-3 text-center w-28">판매가💎</th>
                      <th className="px-4 py-3 text-center">
                        <button onClick={toggleAllListed} className="text-blue-400 hover:text-blue-300 underline">판매등록 (전체)</button>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700">
                    {sets.map(set => (
                      <tr key={set.appId} className={`hover:bg-gray-750 transition ${set.listed ? 'bg-gray-800' : 'bg-gray-800/50'}`}>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-3">
                            <img src={`https://cdn.cloudflare.steamstatic.com/steam/apps/${set.appId}/capsule_sm_120.jpg`} alt="" className="w-12 h-6 object-cover rounded" onError={e => (e.currentTarget.style.display='none')} />
                            <div className="font-medium text-white text-xs max-w-[160px] truncate">{set.gameName}</div>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-center text-green-400 font-bold">{set.completeSets || 0}</td>
                        <td className="px-4 py-2 text-center text-gray-400 text-xs">{set.cardsInSet || 0}종</td>
                        
                        <td className="px-4 py-2 text-center">
                          {loadingAppIds.has(String(set.appId)) ? (
                            <span className="text-xs text-gray-400">조회 중...</span>
                          ) : set.lvlupNormalPrice > 0 ? (
                            <div className="text-xs">
                              <div className="text-purple-300">{set.lvlupNormalPrice}pt</div>
                              <button onClick={() => handleFetchLvlup(String(set.appId))} className="text-purple-400 hover:text-purple-300 underline mt-0.5">갱신</button>
                            </div>
                          ) : (
                            <button onClick={() => handleFetchLvlup(String(set.appId))} className="bg-purple-700 hover:bg-purple-600 px-3 py-1 rounded text-xs text-white transition">조회</button>
                          )}
                        </td>

                        <td className="px-4 py-2 text-center">
                          {set.suggestedGemPrice > 0 ? (
                            <div className="text-xs">
                              <div className="text-yellow-300">{set.suggestedGemPrice}💎</div>
                              <button onClick={() => applyLvlupSuggestedPrice(String(set.appId))} className="text-yellow-400 hover:text-yellow-300 underline mt-0.5">← 적용</button>
                            </div>
                          ) : <span className="text-gray-600">-</span>}
                        </td>
                        
                        <td className="px-4 py-2">
                          <input type="number" value={set.sellPrice || 0} onChange={e => updateSet(String(set.appId), 'sellPrice', Number(e.target.value))} className="w-20 bg-gray-700 rounded px-2 py-1 text-xs text-center text-white focus:outline-none" />
                        </td>
                        
                        <td className="px-4 py-2 text-center">
                          <input type="checkbox" checked={set.listed || false} onChange={e => updateSet(String(set.appId), 'listed', e.target.checked)} className="cursor-pointer w-4 h-4" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── 🎫 쿠폰 ── */}
        {tab === 'coupons' && (
          <div className="space-y-6">
            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <h2 className="text-lg font-bold mb-4">🎫 새 쿠폰 생성</h2>
              
              <div className="flex gap-6 mb-4">
                <label className="flex items-center gap-2 cursor-pointer text-gray-300">
                  <input type="radio" value="discount" checked={newCoupon.type === 'discount'} onChange={() => setNewCoupon({...newCoupon, type: 'discount'})} className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600" />
                  🛒 결제 할인 쿠폰
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-gray-300">
                  <input type="radio" value="energy" checked={newCoupon.type === 'energy'} onChange={() => setNewCoupon({...newCoupon, type: 'energy'})} className="w-4 h-4 text-purple-600 bg-gray-700 border-gray-600" />
                  ⚡ Energy 충전 쿠폰
                </label>
              </div>

              <form onSubmit={handleCreateCoupon} className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end bg-gray-900/50 p-4 rounded-lg border border-gray-700">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">쿠폰 코드</label>
                  <input required value={newCoupon.code} onChange={e => setNewCoupon({ ...newCoupon, code: e.target.value.toUpperCase() })} className="w-full bg-gray-700 border-gray-600 rounded px-3 py-2 text-sm text-white" />
                </div>
                
                {newCoupon.type === 'discount' ? (
                  <>
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">할인율 (%)</label>
                      <input type="number" required min="1" max="100" value={newCoupon.discountRate} onChange={e => setNewCoupon({ ...newCoupon, discountRate: Number(e.target.value) })} className="w-full bg-gray-700 border-gray-600 rounded px-3 py-2 text-sm text-white" />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">최소결제금액 (💎)</label>
                      <input type="number" required min="0" value={newCoupon.minPurchase} onChange={e => setNewCoupon({ ...newCoupon, minPurchase: Number(e.target.value) })} className="w-full bg-gray-700 border-gray-600 rounded px-3 py-2 text-sm text-white" />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">최대할인금액 (💎)</label>
                      <input type="number" required min="0" value={newCoupon.maxDiscount} onChange={e => setNewCoupon({ ...newCoupon, maxDiscount: Number(e.target.value) })} className="w-full bg-gray-700 border-gray-600 rounded px-3 py-2 text-sm text-white" placeholder="0 = 무제한" />
                    </div>
                  </>
                ) : (
                  <div className="md:col-span-3">
                    <label className="block text-sm text-gray-400 mb-1">충전될 Energy 량 (⚡)</label>
                    <input type="number" required min="1" value={newCoupon.energyAmount} onChange={e => setNewCoupon({ ...newCoupon, energyAmount: Number(e.target.value) })} className="w-full bg-gray-700 border-gray-600 rounded px-3 py-2 text-sm text-white" />
                  </div>
                )}
                
                <div>
                  <label className="block text-sm text-gray-400 mb-1">총 사용 횟수</label>
                  <div className="flex gap-2">
                    <input type="number" required min="1" value={newCoupon.usageLimit} onChange={e => setNewCoupon({ ...newCoupon, usageLimit: Number(e.target.value) })} className="w-full bg-gray-700 border-gray-600 rounded px-3 py-2 text-sm text-white" />
                    <button type="submit" className={`px-4 ${newCoupon.type === 'energy' ? 'bg-purple-600 hover:bg-purple-700' : 'bg-blue-600 hover:bg-blue-700'} text-white rounded text-sm font-bold transition whitespace-nowrap`}>발급</button>
                  </div>
                </div>
              </form>
            </div>
            
            <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
              <table className="w-full text-sm text-center">
                <thead className="bg-gray-900 text-gray-400 text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left">쿠폰 유형</th>
                    <th className="px-4 py-3">쿠폰 코드</th>
                    <th className="px-4 py-3">조건 및 혜택</th>
                    <th className="px-4 py-3">사용현황</th>
                    <th className="px-4 py-3">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {coupons.map(c => (
                    <tr key={c.code} className="hover:bg-gray-750 transition">
                      <td className="px-4 py-3 text-left">
                        {c.type === 'energy' 
                          ? <span className="bg-purple-500/20 text-purple-400 px-2 py-1 rounded text-xs font-bold">⚡ 에너지</span>
                          : <span className="bg-blue-500/20 text-blue-400 px-2 py-1 rounded text-xs font-bold">🛒 결제 할인</span>
                        }
                      </td>
                      <td className="px-4 py-3 font-bold text-gray-100">{c.code}</td>
                      
                      <td className="px-4 py-3 text-sm">
                        {c.type === 'energy' ? (
                          <span className="text-purple-300 font-bold">+{c.energyAmount?.toLocaleString()} Energy 충전</span>
                        ) : (
                          <div className="flex flex-col items-center">
                            <span className="text-yellow-400 font-bold">{c.discountRate}% 할인</span>
                            <span className="text-gray-400 text-xs">최소 {c.minPurchase}💎 결제 (최대 {c.maxDiscount > 0 ? c.maxDiscount : '무제한'}💎)</span>
                          </div>
                        )}
                      </td>
                      
                      <td className="px-4 py-3">
                        <span className={c.usedCount >= c.usageLimit ? 'text-red-400 font-bold' : 'text-green-400 font-bold'}>
                          {c.usedCount}
                        </span> 
                        <span className="text-gray-500"> / {c.usageLimit}</span>
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => handleDeleteCoupon(c.code)} className="px-3 py-1 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white rounded text-xs transition">
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))}
                  {coupons.length === 0 && (
                    <tr><td colSpan={5} className="py-6 text-gray-500">등록된 쿠폰이 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── 👥 유저 관리 ── */}
        {tab === 'users' && (
          <div className="space-y-6">
            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <h2 className="text-lg font-bold mb-1">👥 상점 회원 목록</h2>
              <p className="text-xs text-gray-400 mb-4">가입한 유저 중 <b>승인</b> 처리된 계정만 구매 기능을 이용할 수 있습니다. <br/>삭제를 누르면 권한이 박탈되며 리스트에서 지워집니다.</p>
              
              <div className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-800 text-gray-400 text-xs uppercase">
                    <tr>
                      <th className="px-4 py-3">유저 정보 (이름 / SteamID)</th>
                      <th className="px-4 py-3 text-center">Energy (포인트)</th>
                      <th className="px-4 py-3 text-center">가입 일자</th>
                      <th className="px-4 py-3 text-center">상태</th>
                      <th className="px-4 py-3 text-center">관리 (권한)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700">
                    {users.length === 0 ? (
                      <tr><td colSpan={5} className="p-8 text-center text-gray-500">가입한 유저가 없습니다.</td></tr>
                    ) : users.map(u => (
                      <tr key={u.steamId} className="hover:bg-gray-750 transition">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            {u.avatar ? (
                              <img src={u.avatar} alt="avatar" className="w-8 h-8 rounded object-cover border border-gray-600" />
                            ) : (
                              <div className="w-8 h-8 rounded bg-gray-700 border border-gray-600 flex items-center justify-center text-gray-400 text-xs">?</div>
                            )}
                            <div className="flex flex-col">
                              <span className="font-bold text-gray-200">{u.displayName || u.steamId}</span>
                              <span className="text-[10px] text-gray-500 font-mono">{u.steamId}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center font-bold text-purple-400">⚡ {u.energy?.toLocaleString() || 0}</td>
                        <td className="px-4 py-3 text-center text-gray-500 text-xs">{new Date(u.joinedAt).toLocaleString('ko-KR')}</td>
                        <td className="px-4 py-3 text-center">
                          {u.approved ? (
                            <span className="bg-green-500/20 text-green-400 px-2 py-1 rounded text-xs font-bold">✅ 승인됨</span>
                          ) : (
                            <span className="bg-yellow-500/20 text-yellow-400 px-2 py-1 rounded text-xs font-bold">⏳ 대기중</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex justify-center gap-2">
                            {!u.approved && (
                              <button onClick={() => handleApproveUser(u.steamId)} className="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded text-xs font-medium transition">
                                승인 허용
                              </button>
                            )}
                            <button onClick={() => handleDeleteUser(u.steamId)} className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white rounded text-xs font-medium transition">
                              삭제 (차단)
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── 🔒 보안 ── */}
        {tab === 'security' && (
          <div className="max-w-md bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h2 className="text-lg font-bold mb-4">🔒 비밀번호 변경</h2>
            <div className="space-y-3">
              <input type="password" value={oldPw} onChange={e => setOldPw(e.target.value)} placeholder="현재 비밀번호" className="w-full bg-gray-700 border-gray-600 rounded px-3 py-2 text-sm text-white" />
              <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="새 비밀번호" className="w-full bg-gray-700 border-gray-600 rounded px-3 py-2 text-sm text-white" />
              <input type="password" value={newPwConfirm} onChange={e => setNewPwConfirm(e.target.value)} placeholder="새 비밀번호 확인" className="w-full bg-gray-700 border-gray-600 rounded px-3 py-2 text-sm text-white" />
              <button onClick={handleChangePassword} className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition">변경</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}