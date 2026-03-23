import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  getConfig, saveConfig, getData, saveData,
  refreshSteam, fetchLvlupForSet,
  getBotStatus, loginBot, restockBot,
} from '../api';

interface Config {
  steamLogin: string;
  steamPassword: string;
  steamId: string;
  steamApiKey: string;
  identitySecret: string;
  sharedSecret: string;
  steamLoginSecure: string;
  gemSackPrice: number;
  lvlupPointToGem: number;
  lvlupBuyMultiplier: number;
  adminPassword: string;
  adminSteamId: string;
  adminTradeToken: string;
}

interface CardSet {
  appId: string;
  gameName: string;
  completeSets: number;
  cardsInSet: number;
  totalMarketPrice: number;
  lvlupNormalPrice: number;
  lvlupFoilPrice: number;
  lvlupNormalStock: number;
  lvlupFoilStock: number;
  lvlupCostPoints: number;
  suggestedGemPrice: number;
  sellPrice: number;
  listed: boolean;
}

interface BotStatus {
  isLoggedIn: boolean;
  botSteamId: string | null;
  loginError: string | null;
  logs: string[];
}

const DEFAULT_CONFIG: Config = {
  steamLogin: '', steamPassword: '', steamId: '',
  steamApiKey: '', identitySecret: '', sharedSecret: '',
  steamLoginSecure: '', gemSackPrice: 1100,
  lvlupPointToGem: 5, lvlupBuyMultiplier: 1.0,
  adminPassword: 'admin1234', adminSteamId: '', adminTradeToken: '',
};

export default function AdminPage() {
  const [tab, setTab] = useState<'bot' | 'inventory' | 'security'>('bot');
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [sets, setSets] = useState<CardSet[]>([]);
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

  // 봇 상태
  const [botStatus, setBotStatus] = useState<BotStatus | null>(null);
  const [botLoggingIn, setBotLoggingIn] = useState(false);
  const [botLogOff, setBotLogOff] = useState(false);

  // 전체 재고보충
  const [restockLoading, setRestockLoading] = useState(false);

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
    try {
      const s = await getBotStatus();
      setBotStatus(s);
    } catch { /* 무시 */ }
  }

  async function handleBotLogin() {
    setBotLoggingIn(true);
    setMessage(null);
    try {
      await loginBot();
      setMessage({ type: 'success', text: '봇 로그인 성공!' });
      await loadBotStatus();
    } catch (err: unknown) {
      setMessage({ type: 'error', text: `봇 로그인 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}` });
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
    } catch (err: unknown) {
      setMessage({ type: 'error', text: `로그오프 실패: ${err instanceof Error ? err.message : '오류'}` });
    } finally {
      setBotLogOff(false);
    }
  }

  // ── 전체 재고보충 (버튼 하나로) ──────────────────────────────────────────────
  async function handleRestockAll() {
    if (!config.adminSteamId) {
      setMessage({ type: 'error', text: '봇 설정에서 관리자 SteamID64를 먼저 입력하고 저장해 주세요.' });
      setTab('bot');
      return;
    }
    if (!botStatus?.isLoggedIn) {
      setMessage({ type: 'error', text: '봇이 오프라인입니다. 봇 설정에서 로그인해주세요.' });
      return;
    }
    setRestockLoading(true);
    setMessage(null);
    try {
      const result = await restockBot({});
      setMessage({
        type: 'success',
        text: `✅ 재고보충 거래 전송 완료! ${result.cards}장 — 스팀 앱에서 수락하면 봇 재고가 갱신됩니다.`,
      });
    } catch (err: unknown) {
      setMessage({ type: 'error', text: `재고보충 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}` });
    } finally {
      setRestockLoading(false);
    }
  }

  async function loadAll() {
    setLoading(true);
    try {
      const [cfgRes, dataRes] = await Promise.all([getConfig(), getData()]);
      setConfig({ ...DEFAULT_CONFIG, ...cfgRes });
      setSets(dataRes.sets || []);
      setLastRefresh(dataRes.lastRefresh || '');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '알 수 없는 오류';
      setMessage({ type: 'error', text: `데이터 불러오기 실패: ${msg}` });
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveConfig() {
    setSaving(true);
    try {
      await saveConfig(config);
      setMessage({ type: 'success', text: '봇 설정이 저장되었습니다.' });
    } catch (err: unknown) {
      setMessage({ type: 'error', text: `설정 저장 실패: ${err instanceof Error ? err.message : '오류'}` });
    } finally {
      setSaving(false);
    }
  }

  async function handleRefresh() {
    if (!config.steamId) {
      setMessage({ type: 'error', text: '스팀 커뮤니티 ID를 먼저 설정해 주세요.' });
      return;
    }
    setRefreshing(true);
    setMessage(null);
    try {
      const result = await refreshSteam();
      setSets(result.data.sets || []);
      setLastRefresh(result.data.lastRefresh || '');
      setMessage({ type: 'success', text: `세트 새로고침 완료! (${(result.data.sets || []).length}개 게임)` });
    } catch (err: unknown) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '새로고침 실패' });
    } finally {
      setRefreshing(false);
    }
  }

  async function handleFetchLvlup(appId: string) {
    setLoadingAppIds(prev => new Set(prev).add(appId));
    try {
      const result  = await fetchLvlupForSet(appId);
      const updated = result.set;
      setSets(prev => prev.map(s =>
        String(s.appId) === String(appId) ? {
          ...s,
          lvlupNormalPrice: updated.lvlupNormalPrice,
          lvlupFoilPrice:   updated.lvlupFoilPrice,
          lvlupNormalStock: updated.lvlupNormalStock,
          lvlupFoilStock:   updated.lvlupFoilStock,
          suggestedGemPrice: updated.suggestedGemPrice,
          lvlupCostPoints:  updated.lvlupCostPoints,
        } : s
      ));
      setMessage({ type: 'success', text: `lvlup 조회 완료! 노말: ${updated.lvlupNormalPrice}pt → 제안: ${updated.suggestedGemPrice}💎` });
    } catch (err: unknown) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'lvlup 조회 실패' });
    } finally {
      setLoadingAppIds(prev => { const n = new Set(prev); n.delete(appId); return n; });
    }
  }

  async function handleFetchLvlupAll() {
    if (sets.length === 0) {
      setMessage({ type: 'error', text: '세트 데이터가 없습니다. 먼저 세트 새로고침을 해주세요.' });
      return;
    }
    setLvlupAllLoading(true);
    lvlupAllAbort.current = false;
    setLvlupAllProgress({ done: 0, total: sets.length });
    let success = 0, failed = 0;

    for (let i = 0; i < sets.length; i++) {
      if (lvlupAllAbort.current) break;
      setLvlupAllProgress({ done: i + 1, total: sets.length });
      try {
        const result  = await fetchLvlupForSet(sets[i].appId);
        const updated = result.set;
        setSets(prev => prev.map(s =>
          String(s.appId) === String(sets[i].appId) ? {
            ...s,
            lvlupNormalPrice:  updated.lvlupNormalPrice,
            lvlupFoilPrice:    updated.lvlupFoilPrice,
            lvlupNormalStock:  updated.lvlupNormalStock,
            lvlupFoilStock:    updated.lvlupFoilStock,
            suggestedGemPrice: updated.suggestedGemPrice,
            lvlupCostPoints:   updated.lvlupCostPoints,
          } : s
        ));
        success++;
      } catch { failed++; }
      if (i < sets.length - 1 && !lvlupAllAbort.current)
        await new Promise(r => setTimeout(r, 800));
    }

    setLvlupAllLoading(false);
    setLvlupAllProgress(null);
    setMessage({ type: success > 0 ? 'success' : 'error', text: `전체 lvlup 조회 완료 — 성공: ${success}개, 실패: ${failed}개` });
  }

  function applyLvlupSuggestedPrice(appId: string) {
    setSets(prev => prev.map(s =>
      String(s.appId) === String(appId) && s.suggestedGemPrice > 0
        ? { ...s, sellPrice: s.suggestedGemPrice } : s
    ));
  }

  function applyAllSuggestedPrice() {
    setSets(prev => prev.map(s => s.suggestedGemPrice > 0 ? { ...s, sellPrice: s.suggestedGemPrice } : s));
    setMessage({ type: 'success', text: '제안가를 전체 판매가에 적용했습니다.' });
  }

  async function handleSaveData() {
    setSaving(true);
    try {
      await saveData({ sets, lastRefresh });
      setMessage({ type: 'success', text: '인벤토리 데이터가 저장되었습니다.' });
    } catch (err: unknown) {
      setMessage({ type: 'error', text: `데이터 저장 실패: ${err instanceof Error ? err.message : '오류'}` });
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

  async function handleChangePassword() {
    if (!oldPw || !newPw) { setMessage({ type: 'error', text: '모든 필드를 입력해 주세요.' }); return; }
    if (newPw !== newPwConfirm) { setMessage({ type: 'error', text: '새 비밀번호가 일치하지 않습니다.' }); return; }
    if (newPw.length < 6) { setMessage({ type: 'error', text: '비밀번호는 6자 이상이어야 합니다.' }); return; }
    try {
      const currentConfig = await getConfig();
      if (oldPw !== (currentConfig.adminPassword || 'admin1234')) {
        setMessage({ type: 'error', text: '현재 비밀번호가 틀립니다.' });
        return;
      }
      await saveConfig({ ...currentConfig, adminPassword: newPw });
      setMessage({ type: 'success', text: '비밀번호가 변경되었습니다.' });
      setOldPw(''); setNewPw(''); setNewPwConfirm('');
    } catch (err: unknown) {
      setMessage({ type: 'error', text: `비밀번호 변경 실패: ${err instanceof Error ? err.message : '오류'}` });
    }
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
      {/* 헤더 */}
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚙️</span>
            <div>
              <h1 className="text-xl font-bold text-white">관리자 페이지</h1>
              <p className="text-xs text-gray-400">Steam 트레이딩 카드 쇼케이스</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/')} className="text-sm text-gray-400 hover:text-white transition px-3 py-1.5 rounded hover:bg-gray-700">
              🏠 상점 보기
            </button>
            <button onClick={async () => { await doLogout(); navigate('/login'); }}
              className="text-sm bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded transition">
              🚪 로그아웃
            </button>
          </div>
        </div>
      </header>

      {/* 알림 */}
      {message && (
        <div className={`fixed top-4 right-4 z-50 max-w-md p-4 rounded-lg shadow-lg border text-sm ${
          message.type === 'success'
            ? 'bg-green-800 border-green-600 text-green-100'
            : 'bg-red-800 border-red-600 text-red-100'
        }`}>
          <div className="flex justify-between items-start gap-2">
            <span>{message.type === 'success' ? '✅' : '❌'} {message.text}</span>
            <button onClick={() => setMessage(null)} className="text-white/70 hover:text-white ml-2 flex-shrink-0">✕</button>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* 탭 */}
        <div className="flex gap-2 mb-6 border-b border-gray-700">
          {[
            { key: 'bot',       label: '🤖 봇 설정' },
            { key: 'inventory', label: '📦 인벤토리 관리' },
            { key: 'security',  label: '🔒 보안 설정' },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key as typeof tab)}
              className={`px-5 py-2.5 text-sm font-medium rounded-t transition ${
                tab === t.key
                  ? 'bg-blue-600 text-white border-b-2 border-blue-400'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── 봇 설정 탭 ── */}
        {tab === 'bot' && (
          <div className="space-y-6">
            {/* 봇 상태 */}
            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <h2 className="text-lg font-bold mb-4">🤖 봇 상태</h2>
              {botStatus ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <span className={`w-3 h-3 rounded-full ${botStatus.isLoggedIn ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
                    <span className={`font-semibold ${botStatus.isLoggedIn ? 'text-green-400' : 'text-red-400'}`}>
                      {botStatus.isLoggedIn ? '🟢 온라인' : '🔴 오프라인'}
                    </span>
                    {botStatus.botSteamId && (
                      <span className="text-xs text-gray-400">SteamID: {botStatus.botSteamId}</span>
                    )}
                  </div>
                  {botStatus.loginError && (
                    <p className="text-xs text-red-400 bg-red-900/20 p-2 rounded">오류: {botStatus.loginError}</p>
                  )}
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={handleBotLogin} disabled={botLoggingIn}
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm rounded-lg transition font-medium">
                      {botLoggingIn ? '⏳ 로그인 중...' : '🔑 봇 로그인'}
                    </button>
                    {botStatus.isLoggedIn && (
                      <button onClick={handleBotLogoff} disabled={botLogOff}
                        className="px-4 py-2 bg-gray-600 hover:bg-gray-700 disabled:opacity-50 text-white text-sm rounded-lg transition">
                        {botLogOff ? '⏳...' : '⏏️ 로그오프'}
                      </button>
                    )}
                    <button onClick={loadBotStatus} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg transition">
                      🔄 상태 갱신
                    </button>
                  </div>
                  {botStatus.logs && botStatus.logs.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs text-gray-400 mb-1">최근 로그:</p>
                      <div className="bg-gray-900 rounded p-2 max-h-40 overflow-y-auto font-mono text-xs text-gray-300 space-y-0.5">
                        {botStatus.logs.map((log, i) => <div key={i}>{log}</div>)}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-gray-400 text-sm">봇 상태를 불러오는 중...</p>
              )}
            </div>

            {/* 봇 계정 설정 */}
            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <h2 className="text-lg font-bold mb-4">🔧 스팀 봇 계정 설정</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">스팀 로그인 아이디</label>
                  <input value={config.steamLogin} onChange={e => cfg('steamLogin', e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white" placeholder="로그인 아이디" />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">스팀 비밀번호</label>
                  <input type="password" value={config.steamPassword} onChange={e => cfg('steamPassword', e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white" placeholder="비밀번호" />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">봇 스팀 커뮤니티 ID (64비트)</label>
                  <input value={config.steamId} onChange={e => cfg('steamId', e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white" placeholder="765611..." />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Steam API Key</label>
                  <div className="flex gap-2">
                    <input value={config.steamApiKey} onChange={e => cfg('steamApiKey', e.target.value)}
                      className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white" placeholder="API Key" />
                    <a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noreferrer"
                      className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg whitespace-nowrap transition">
                      🔑 발급
                    </a>
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Shared Secret</label>
                  <input value={config.sharedSecret} onChange={e => cfg('sharedSecret', e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white font-mono" placeholder="Shared Secret" />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Identity Secret</label>
                  <input value={config.identitySecret} onChange={e => cfg('identitySecret', e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white font-mono" placeholder="Identity Secret" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm text-gray-400 mb-1">steamLoginSecure 쿠키 (선택)</label>
                  <input value={config.steamLoginSecure} onChange={e => cfg('steamLoginSecure', e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white font-mono" placeholder="steamLoginSecure 값" />
                </div>
              </div>
            </div>

            {/* 관리자 계정 설정 */}
            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <h2 className="text-lg font-bold mb-1">👤 관리자 계정 설정</h2>
              <p className="text-xs text-gray-400 mb-4">
                봇이 이 계정에서 보낸 거래를 <strong className="text-white">자동 수락</strong>하고,
                재고보충 시 이 계정에 거래 요청을 보냅니다.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">관리자 SteamID64 <span className="text-red-400">*필수</span></label>
                  <input value={config.adminSteamId} onChange={e => cfg('adminSteamId', e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white" placeholder="765611..." />
                  <p className="text-xs text-gray-500 mt-1">steamcommunity.com/profiles/<strong>여기 숫자</strong></p>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">관리자 거래 토큰 (선택)</label>
                  <input value={config.adminTradeToken} onChange={e => cfg('adminTradeToken', e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white font-mono" placeholder="거래 URL 토큰" />
                  <p className="text-xs text-gray-500 mt-1">스팀 → 인벤토리 → 거래 제안 → 거래 링크에서 확인</p>
                </div>
              </div>
            </div>

            {/* 가격 설정 */}
            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <h2 className="text-lg font-bold mb-4">💎 가격 환산 설정</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">보석 주머니 시세 (₩/1000Gems)</label>
                  <input type="number" value={config.gemSackPrice} onChange={e => cfg('gemSackPrice', Number(e.target.value))}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white" />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">lvlup 1포인트 = N 보석</label>
                  <input type="number" value={config.lvlupPointToGem} onChange={e => cfg('lvlupPointToGem', Number(e.target.value))}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white" />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">구매 배율 (마진)</label>
                  <input type="number" step="0.01" value={config.lvlupBuyMultiplier} onChange={e => cfg('lvlupBuyMultiplier', Number(e.target.value))}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white" />
                  <p className="text-xs text-gray-500 mt-1">제안가 = lvlup포인트 × 배율 × 환산율</p>
                </div>
              </div>
              <div className="mt-3 p-3 bg-gray-900 rounded-lg text-xs text-gray-400">
                <span className="text-yellow-400 font-medium">💡 제안가 공식:</span>{' '}
                lvlup 노말 세트가(pt) × {config.lvlupBuyMultiplier} × {config.lvlupPointToGem}(pt→💎) = 판매 보석 수량
              </div>
            </div>

            <button onClick={handleSaveConfig} disabled={saving}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-xl transition text-sm">
              {saving ? '⏳ 저장 중...' : '💾 설정 저장'}
            </button>
          </div>
        )}

        {/* ── 인벤토리 관리 탭 ── */}
        {tab === 'inventory' && (
          <div className="space-y-4">
            {/* 툴바 */}
            <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
              <div className="flex flex-wrap gap-2 items-center justify-between">
                <div className="flex flex-wrap gap-2">
                  <button onClick={handleRefresh} disabled={refreshing}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded-lg font-medium transition">
                    {refreshing ? '⏳ 조회 중...' : '🔄 세트 새로고침'}
                  </button>
                  <button onClick={handleFetchLvlupAll} disabled={lvlupAllLoading || sets.length === 0}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm rounded-lg font-medium transition">
                    {lvlupAllLoading
                      ? `⏳ ${lvlupAllProgress?.done}/${lvlupAllProgress?.total}`
                      : '🔍 전체 lvlup 조회'}
                  </button>
                  {lvlupAllLoading && (
                    <button onClick={() => { lvlupAllAbort.current = true; }}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg transition">
                      ⏹ 중단
                    </button>
                  )}
                  <button onClick={applyAllSuggestedPrice} disabled={sets.length === 0}
                    className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 text-white text-sm rounded-lg transition">
                    ✨ 제안가 전체 적용
                  </button>
                  {/* ── 전체 재고보충 버튼 ── */}
                  <button
                    onClick={handleRestockAll}
                    disabled={restockLoading || !botStatus?.isLoggedIn}
                    title={!botStatus?.isLoggedIn ? '봇이 오프라인입니다' : '관리자 인벤토리의 모든 카드를 봇에게 전송'}
                    className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm rounded-lg font-medium transition flex items-center gap-1"
                  >
                    {restockLoading ? (
                      <><span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> 전송 중...</>
                    ) : (
                      <>📦 전체 재고보충</>
                    )}
                  </button>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleSaveData} disabled={saving || sets.length === 0}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm rounded-lg font-medium transition">
                    {saving ? '⏳ 저장 중...' : '💾 저장'}
                  </button>
                </div>
              </div>
              {/* 재고보충 안내 */}
              {!botStatus?.isLoggedIn && (
                <p className="text-xs text-orange-400 mt-2">⚠️ 재고보충을 사용하려면 봇 설정 탭에서 봇 로그인을 먼저 하세요.</p>
              )}
              {lastRefresh && (
                <p className="text-xs text-gray-500 mt-2">마지막 갱신: {new Date(lastRefresh).toLocaleString('ko-KR')}</p>
              )}
            </div>

            {/* 요약 */}
            {sets.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: '전체 게임',  value: sets.length,                                              color: 'blue' },
                  { label: '판매 등록',  value: listedCount,                                              color: 'green' },
                  { label: '총 세트 수', value: sets.reduce((a, s) => a + (s.completeSets || 0), 0).toLocaleString(), color: 'purple' },
                  { label: '봇 상태',    value: botStatus?.isLoggedIn ? '🟢 온라인' : '🔴 오프라인',     color: botStatus?.isLoggedIn ? 'green' : 'red' },
                ].map(stat => (
                  <div key={stat.label} className={`bg-gray-800 border border-${stat.color}-800/50 rounded-lg p-3 text-center`}>
                    <p className="text-xs text-gray-400">{stat.label}</p>
                    <p className={`text-xl font-bold text-${stat.color}-400`}>{stat.value}</p>
                  </div>
                ))}
              </div>
            )}

            {/* 테이블 */}
            {sets.length === 0 ? (
              <div className="bg-gray-800 rounded-xl p-12 text-center border border-gray-700">
                <p className="text-4xl mb-3">📭</p>
                <p className="text-gray-400">세트 데이터가 없습니다.</p>
                <p className="text-sm text-gray-500 mt-1">봇 설정에서 스팀 ID를 설정하고 새로고침을 눌러주세요.</p>
              </div>
            ) : (
              <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-900 text-gray-400 text-xs uppercase">
                        <th className="px-3 py-3 text-left">게임명</th>
                        <th className="px-3 py-3 text-center">세트수</th>
                        <th className="px-3 py-3 text-center">카드수</th>
                        <th className="px-3 py-3 text-center">lvlup 가격</th>
                        <th className="px-3 py-3 text-center">제안💎</th>
                        <th className="px-3 py-3 text-center w-28">판매가💎</th>
                        <th className="px-3 py-3 text-center">
                          <button onClick={toggleAllListed} className="text-xs text-blue-400 hover:text-blue-300 underline">
                            판매등록 (전체)
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700">
                      {sets.map(set => (
                        <tr key={set.appId} className={`hover:bg-gray-750 transition ${set.listed ? 'bg-gray-800' : 'bg-gray-800/50'}`}>
                          {/* 게임명 */}
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <img
                                src={`https://cdn.cloudflare.steamstatic.com/steam/apps/${set.appId}/capsule_sm_120.jpg`}
                                alt="" className="w-10 h-6 object-cover rounded"
                                onError={e => (e.currentTarget.style.display = 'none')} />
                              <div>
                                <div className="font-medium text-white text-xs leading-tight max-w-[160px] truncate" title={set.gameName}>
                                  {set.gameName}
                                </div>
                                <div className="text-gray-500 text-xs">#{set.appId}</div>
                              </div>
                            </div>
                          </td>
                          {/* 세트수 */}
                          <td className="px-3 py-2 text-center">
                            <span className={`font-bold ${(set.completeSets || 0) > 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {set.completeSets || 0}
                            </span>
                          </td>
                          {/* 카드수 */}
                          <td className="px-3 py-2 text-center text-gray-400 text-xs">{set.cardsInSet || 0}</td>
                          {/* lvlup 가격 */}
                          <td className="px-3 py-2 text-center">
                            {loadingAppIds.has(String(set.appId)) ? (
                              <span className="text-xs text-gray-400 animate-pulse">조회 중...</span>
                            ) : set.lvlupNormalPrice > 0 ? (
                              <div className="text-xs">
                                <div className="text-purple-300 font-medium">{set.lvlupNormalPrice.toLocaleString()}pt</div>
                                <div className="text-gray-500">재고: {set.lvlupNormalStock || 0}</div>
                                <button onClick={() => handleFetchLvlup(String(set.appId))}
                                  className="mt-0.5 text-xs text-purple-400 hover:text-purple-300 underline">갱신</button>
                              </div>
                            ) : (
                              <button onClick={() => handleFetchLvlup(String(set.appId))}
                                className="px-2 py-1 bg-purple-700 hover:bg-purple-600 text-white text-xs rounded transition">
                                🔍 조회
                              </button>
                            )}
                          </td>
                          {/* 제안가 */}
                          <td className="px-3 py-2 text-center">
                            {set.suggestedGemPrice > 0 ? (
                              <div className="text-xs">
                                <div className="text-yellow-300 font-medium">{set.suggestedGemPrice.toLocaleString()}💎</div>
                                <button onClick={() => applyLvlupSuggestedPrice(String(set.appId))}
                                  className="mt-0.5 text-xs text-yellow-400 hover:text-yellow-300 underline">← 적용</button>
                              </div>
                            ) : (
                              <span className="text-gray-600 text-xs">-</span>
                            )}
                          </td>
                          {/* 판매가 입력 */}
                          <td className="px-3 py-2">
                            <input type="number" value={set.sellPrice || 0}
                              onChange={e => updateSet(String(set.appId), 'sellPrice', Number(e.target.value))}
                              className="w-24 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-center text-white focus:border-blue-500 focus:outline-none" />
                          </td>
                          {/* 판매 등록 토글 */}
                          <td className="px-3 py-2 text-center">
                            <label className="relative inline-flex items-center cursor-pointer">
                              <input type="checkbox" checked={set.listed || false}
                                onChange={e => updateSet(String(set.appId), 'listed', e.target.checked)}
                                className="sr-only peer" />
                              <div className="w-9 h-5 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-green-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all" />
                            </label>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── 보안 설정 탭 ── */}
        {tab === 'security' && (
          <div className="max-w-md">
            <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
              <h2 className="text-lg font-bold mb-4">🔒 비밀번호 변경</h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">현재 비밀번호</label>
                  <input type="password" value={oldPw} onChange={e => setOldPw(e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white" />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">새 비밀번호</label>
                  <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white" />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">새 비밀번호 확인</label>
                  <input type="password" value={newPwConfirm} onChange={e => setNewPwConfirm(e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white" />
                </div>
                <button onClick={handleChangePassword}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition text-sm">
                  🔒 비밀번호 변경
                </button>
              </div>
              <div className="mt-4 p-3 bg-gray-900 rounded-lg text-xs text-gray-500">
                <p>• 로그인 아이디: <span className="text-gray-300 font-mono">788qa</span></p>
                <p>• 기본 비밀번호: <span className="text-gray-300 font-mono">admin1234</span></p>
                <p>• 변경된 비밀번호는 config.json에 저장됩니다.</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
