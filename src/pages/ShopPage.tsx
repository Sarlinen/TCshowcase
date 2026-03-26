import { useState, useEffect } from 'react';
import { getShop, createPurchase, validateCoupon, redeemEnergyCoupon, getMe, logoutSteam, SteamUser, submitAiJob, getAiJobStatus } from '../api';
import { useNavigate } from 'react-router-dom';

interface ShopSet { appId: number; gameName: string; completeSets: number; sellPrice: number; }
type SortKey = 'name' | 'sets' | 'price';
type SortDir = 'asc' | 'desc';
type ViewMode = 'grid' | 'list';

// 복잡했던 추적 단계(tracking, success, failed 등)를 모두 지우고 'sent'(전송 완료)로 통합했습니다.
type PurchaseStep = 'input' | 'sending' | 'sent' | 'error';

interface PurchaseModal {
  set: ShopSet; step: PurchaseStep; tradeUrl: string; offerId: string | null; errorMsg: string;
  quantity: number; couponCode: string; appliedCoupon: any; discount: number; finalPrice: number;
  couponLoading: boolean; couponError: string;
}

const SteamIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
    <path d="M11.979 0C5.363 0 0 5.363 0 11.979c0 4.67 2.68 8.71 6.551 10.74l1.96-2.83c-.02-.12-.04-.25-.04-.37 0-1.89 1.53-3.42 3.42-3.42 1.34 0 2.49.77 3.07 1.88l3.66-1.54c.03-.13.04-.26.04-.4 0-2.85-2.31-5.16-5.16-5.16-2.85 0-5.16 2.31-5.16 5.16 0 .42.06.82.16 1.21l-3.32 4.79C1.94 19.5 0 15.98 0 11.98 0 5.36 5.36 0 11.98 0c6.61 0 11.98 5.36 11.98 11.98 0 6.61-5.36 11.98-11.98 11.98-1.58 0-3.09-.31-4.48-.87l2.84-2c.49.12.99.18 1.51.18 3.51 0 6.36-2.85 6.36-6.36s-2.85-6.36-6.36-6.36-6.36 2.85-6.36 6.36c0 .32.03.63.07.93l-1.92 2.76c-.03-.11-.05-.23-.05-.36 0-1.89 1.53-3.42 3.42-3.42 1.34 0 2.49.77 3.07 1.88l3.66-1.54c.03-.13.04-.26.04-.4 0-2.85-2.31-5.16-5.16-5.16-2.85 0-5.16 2.31-5.16 5.16 0 .39.05.77.13 1.13l-3.23 4.67c-.24.08-.49.12-.76.12-1.55 0-2.81-1.26-2.81-2.81 0-1.55 1.26-2.81 2.81-2.81 1.29 0 2.38.88 2.71 2.08l1.78-.75c-.53-1.63-2.09-2.81-3.92-2.81-2.28 0-4.13 1.85-4.13 4.13 0 1.28.58 2.41 1.5 3.19l-3.66 1.54c.16 3.12 2.75 5.58 5.92 5.58 3.28 0 5.95-2.67 5.95-5.95s-2.67-5.95-5.95-5.95z"/>
  </svg>
);

export default function ShopPage() {
  const [activeTab, setActiveTab] = useState<'shop' | 'ai'>('shop');
  const [sets, setSets]         = useState<ShopSet[]>([]);
  const [me, setMe]             = useState<SteamUser | null>(null);
  const [novelAiCost, setNovelAiCost] = useState(100);

  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [sortKey, setSortKey]   = useState<SortKey>('name');
  const [sortDir, setSortDir]   = useState<SortDir>('asc');
  
  const [search, setSearch]     = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [modal, setModal]       = useState<PurchaseModal | null>(null);
  
  const [aiModel, setAiModel] = useState<'curated' | 'full'>('curated');
  const [basePrompt, setBasePrompt] = useState('');
  const [charPrompt, setCharPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [charNegativePrompt, setCharNegativePrompt] = useState('');
  
  const [aiLoading, setAiLoading] = useState(false);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [aiError, setAiError] = useState('');

  const [energyCoupon, setEnergyCoupon] = useState('');
  const [energyCouponLoading, setEnergyCouponLoading] = useState(false);
  const [energyCouponMessage, setEnergyCouponMessage] = useState<{type: 'success'|'error', text: string} | null>(null);

  const navigate = useNavigate();

  useEffect(() => { loadInitialData(); }, []);

  async function loadInitialData() {
    setLoading(true);
    try {
      const [shopData, userData] = await Promise.all([getShop(), getMe()]);
      setSets(shopData.sets || []);
      setNovelAiCost(shopData.novelAiCost !== undefined ? shopData.novelAiCost : 100);
      setMe(userData);
    } catch { setError('상점 데이터를 불러올 수 없습니다.'); } 
    finally { setLoading(false); }
  }

  async function handleLogoutSteam() { await logoutSteam(); setMe(null); }

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'name' ? 'asc' : 'desc'); }
  }

  function openPurchase(set: ShopSet) {
    setModal({ 
      set, step: 'input', tradeUrl: '', offerId: null, errorMsg: '',
      quantity: 1, couponCode: '', appliedCoupon: null, discount: 0, finalPrice: set.sellPrice,
      couponLoading: false, couponError: ''
    });
  }

  function handleQuantityChange(newQty: number) {
    if (!modal) return;
    const validQty = Math.max(1, Math.min(newQty, 5, modal.set.completeSets));
    setModal(m => m ? { ...m, quantity: validQty, couponCode: '', appliedCoupon: null, discount: 0, finalPrice: m.set.sellPrice * validQty, couponError: '' } : m);
  }

  async function handleApplyCoupon() {
    if (!modal || !modal.couponCode.trim()) return;
    setModal(m => m ? { ...m, couponLoading: true, couponError: '' } : m);
    try {
      const res = await validateCoupon(modal.couponCode, modal.set.sellPrice * modal.quantity);
      setModal(m => m ? { ...m, appliedCoupon: res.coupon, discount: res.discount, finalPrice: res.finalPrice, couponLoading: false } : m);
    } catch (e: any) {
      setModal(m => m ? { ...m, appliedCoupon: null, discount: 0, finalPrice: modal.set.sellPrice * modal.quantity, couponError: e.message || '유효하지 않은 쿠폰입니다.', couponLoading: false } : m);
    }
  }

  async function handleConfirmPurchase() {
    if (!modal) return;
    const tradeUrl = modal.tradeUrl.trim();
    if (!tradeUrl) return;
    
    const curAppId = modal.set.appId;
    const curQuantity = modal.quantity;
    const curCoupon = modal.appliedCoupon?.code;

    setModal(prev => prev ? { ...prev, step: 'sending' } : null);
    try {
      const res = await createPurchase({ tradeUrl, appId: curAppId, couponCode: curCoupon, quantity: curQuantity });
      if (!res.offerId) throw new Error("거래 ID를 반환받지 못했습니다.");
      
      // ✨ 복잡한 추적을 제거하고 바로 전송 완료(sent) 단계로 넘어갑니다. ✨
      setModal(prev => prev ? { ...prev, step: 'sent', offerId: res.offerId } : null);
    } catch (e: any) {
      setModal(prev => prev ? { ...prev, step: 'error', errorMsg: e.message || '거래 전송 실패' } : null);
    }
  }

  async function handleGenerateAi() {
    if (!me || !me.approved || aiLoading) return;
    setAiLoading(true); setAiError(''); setGeneratedImage(null); setQueuePosition(null);
    try {
      const res = await submitAiJob(basePrompt, charPrompt, negativePrompt, charNegativePrompt, aiModel);
      const jobId = res.jobId;

      const poll = setInterval(async () => {
        try {
          const statusRes = await getAiJobStatus(jobId);
          if (statusRes.status === 'queued') {
            setQueuePosition(statusRes.position);
          } else if (statusRes.status === 'processing') {
            setQueuePosition(null);
          } else if (statusRes.status === 'done') {
            clearInterval(poll);
            setGeneratedImage(statusRes.result.image);
            setMe(prev => prev ? { ...prev, energy: statusRes.result.remainingEnergy } : prev);
            setAiLoading(false);
          } else if (statusRes.status === 'error') {
            clearInterval(poll);
            setAiError(statusRes.error);
            setAiLoading(false);
          }
        } catch (e: any) {
          clearInterval(poll);
          setAiError('상태 확인 중 연결이 끊겼습니다.');
          setAiLoading(false);
        }
      }, 2000);
    } catch (err: any) {
      setAiError(err.message || '이미지 생성 요청에 실패했습니다.');
      setAiLoading(false);
    }
  }

  async function handleRedeemEnergyCoupon() {
    if (!energyCoupon.trim() || !me?.approved) return;
    setEnergyCouponLoading(true);
    setEnergyCouponMessage(null);
    try {
      const res = await redeemEnergyCoupon(energyCoupon);
      setMe(prev => prev ? { ...prev, energy: res.totalEnergy } : prev);
      setEnergyCouponMessage({ type: 'success', text: `Energy 충전 완료!` });
      setEnergyCoupon('');
    } catch (err: any) {
      setEnergyCouponMessage({ type: 'error', text: err.message || '쿠폰 적용 실패' });
    } finally {
      setEnergyCouponLoading(false);
    }
  }

  const filtered = sets.filter(s => s.gameName.toLowerCase().includes(search.toLowerCase()));
  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'name')  cmp = a.gameName.localeCompare(b.gameName, 'ko');
    if (sortKey === 'sets')  cmp = a.completeSets - b.completeSets;
    if (sortKey === 'price') cmp = a.sellPrice - b.sellPrice;
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const SortBtn = ({ k, label }: { k: SortKey; label: string }) => (
    <button onClick={() => handleSort(k)} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1 ${sortKey === k ? 'bg-blue-600 text-white' : 'bg-gray-700/50 text-gray-400 hover:bg-gray-700 hover:text-white'}`}>
      {label} <span className="text-xs opacity-70">{sortKey === k ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
    </button>
  );

  const isAiDisabled = novelAiCost <= -1;
  const aiButtonText = isAiDisabled 
    ? '사용금지 (비활성화됨)' 
    : (novelAiCost === 0 ? '생성하기 (무료)' : `생성하기 (-${novelAiCost} Energy)`);
  const aiButtonDisabled = aiLoading || isAiDisabled || (novelAiCost > 0 && (me?.energy || 0) < novelAiCost);

  if (loading) return <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center"><div className="text-center"><div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" /><p className="text-gray-400">불러오는 중...</p></div></div>;
  if (error) return <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center"><div className="text-center"><div className="text-4xl mb-4">⚠️</div><p className="text-red-400">{error}</p></div></div>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white">
      <header className="border-b border-gray-700 bg-gray-900/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-16">
          <div className="flex items-center gap-6 h-full">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center text-lg">🃏</div>
              <h1 className="text-lg font-bold leading-tight hidden sm:block">트레이딩 카드 상점</h1>
            </div>
            
            <div className="flex h-full border-l border-gray-700 pl-6 gap-2">
              <button onClick={() => setActiveTab('shop')} className={`h-full px-4 text-sm font-bold border-b-2 transition-colors flex items-center ${activeTab === 'shop' ? 'border-blue-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
                🛒 상점
              </button>
              <button onClick={() => setActiveTab('ai')} className={`h-full px-4 text-sm font-bold border-b-2 transition-colors flex items-center gap-1.5 ${activeTab === 'ai' ? 'border-purple-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
                ✨ AI 일러스트 생성
              </button>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/admin')} className="text-xs text-gray-400 hover:text-white transition-colors px-3 py-1.5 rounded-md hover:bg-gray-700/50 border border-transparent hover:border-gray-600">관리자</button>
            <div className="w-px h-4 bg-gray-700" />
            {me ? (
              <div className="flex items-center gap-3 bg-gray-800/80 px-3 py-1.5 rounded-lg border border-gray-700">
                {me.avatar && <img src={me.avatar} alt="profile" className="w-7 h-7 rounded-md object-cover border border-gray-600" />}
                <div className="flex flex-col text-right">
                  <span className="text-xs font-bold text-gray-200">{me.displayName || me.steamId}</span>
                  <div className="flex items-center gap-2 justify-end">
                    <span className="text-[10px] text-purple-400 font-bold">⚡ {me.energy?.toLocaleString() || 0} Energy</span>
                    {me.approved ? <span className="text-[10px] font-bold text-green-400">✅ 승인됨</span> : <span className="text-[10px] font-bold text-yellow-500">⏳ 대기중</span>}
                  </div>
                </div>
                <button onClick={handleLogoutSteam} className="text-xs bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded transition ml-1">로그아웃</button>
              </div>
            ) : (
              <button onClick={() => window.location.href = '/api/auth/steam'} className="flex items-center gap-2 bg-[#171a21] hover:bg-[#2a475e] text-white px-4 py-2 rounded-lg font-bold transition text-sm">
                <SteamIcon /> 로그인
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {activeTab === 'shop' && (
          <>
            <div className="flex flex-col sm:flex-row gap-3 mb-6">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
                <input type="text" placeholder="게임명 검색..." value={search} onChange={e => setSearch(e.target.value)} className="w-full bg-gray-800/60 border border-gray-700 rounded-lg pl-9 pr-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <SortBtn k="name" label="이름" /><SortBtn k="sets" label="세트수" /><SortBtn k="price" label="가격" />
                <div className="w-px h-6 bg-gray-600 mx-1" />
                <button onClick={() => setViewMode('grid')} className={`p-2 rounded-lg transition-colors ${viewMode === 'grid' ? 'bg-blue-600 text-white' : 'bg-gray-700/50 text-gray-400 hover:bg-gray-700'}`}>🖼️</button>
                <button onClick={() => setViewMode('list')} className={`p-2 rounded-lg transition-colors ${viewMode === 'list' ? 'bg-blue-600 text-white' : 'bg-gray-700/50 text-gray-400 hover:bg-gray-700'}`}>📋</button>
              </div>
            </div>

            {sorted.length === 0 ? (
              <div className="text-center py-24"><div className="text-6xl mb-4">🃏</div><p className="text-gray-400 text-lg">결과가 없습니다.</p></div>
            ) : viewMode === 'grid' ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {sorted.map(set => (
                  <div key={set.appId} className="bg-gray-800/40 border border-gray-700/50 rounded-xl overflow-hidden hover:border-blue-500/40 hover:bg-gray-800/60 transition-all group">
                    <a href={`https://store.steampowered.com/app/${set.appId}`} target="_blank" rel="noreferrer" className="block relative overflow-hidden">
                      <img src={`https://cdn.cloudflare.steamstatic.com/steam/apps/${set.appId}/capsule_sm_120.jpg`} alt={set.gameName} className="w-full h-[90px] object-cover group-hover:scale-105 transition-transform duration-300" onError={e => { (e.target as HTMLImageElement).src = `https://cdn.cloudflare.steamstatic.com/steam/apps/${set.appId}/header.jpg`; }} />
                    </a>
                    <div className="p-3">
                      <h3 className="text-xs font-medium text-white leading-tight mb-2 line-clamp-2 min-h-[2.5rem]">{set.gameName}</h3>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-gray-400">재고 {set.completeSets}</span>
                        <span className="text-xs font-bold text-yellow-400">💎 {set.sellPrice.toLocaleString()}</span>
                      </div>
                      <button onClick={() => openPurchase(set)} className="w-full py-1.5 bg-blue-600/80 hover:bg-blue-600 rounded-md text-xs font-semibold transition-colors">구매하기</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-gray-800/40 border border-gray-700/50 rounded-2xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-800/60"><tr><th className="text-left px-4 py-3">게임</th><th className="text-center px-4 py-3">세트 수</th><th className="text-center px-4 py-3">가격</th><th className="text-center px-4 py-3">구매</th></tr></thead>
                  <tbody>
                    {sorted.map(set => (
                      <tr key={set.appId} className="border-b border-gray-700/40 hover:bg-gray-700/20">
                        <td className="px-4 py-3 flex items-center gap-3"><img src={`https://cdn.cloudflare.steamstatic.com/steam/apps/${set.appId}/capsule_sm_120.jpg`} alt="" className="w-12 h-8 rounded object-cover" /><span className="font-medium truncate">{set.gameName}</span></td>
                        <td className="px-4 py-3 text-center text-green-400 font-semibold">{set.completeSets}</td>
                        <td className="px-4 py-3 text-center text-yellow-400 font-bold">💎 {set.sellPrice.toLocaleString()}</td>
                        <td className="px-4 py-3 text-center"><button onClick={() => openPurchase(set)} className="px-3 py-1.5 bg-blue-600/80 hover:bg-blue-600 rounded-lg text-xs font-semibold whitespace-nowrap">구매하기</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {activeTab === 'ai' && (
          <div className="max-w-5xl mx-auto mt-4">
            {!me ? (
              <div className="text-center py-20 bg-gray-800/30 rounded-3xl border border-gray-700/50">
                <div className="text-6xl mb-6">🔒</div>
                <h2 className="text-2xl font-bold mb-4">로그인이 필요합니다</h2>
                <p className="text-gray-400 mb-8">AI 일러스트 생성 기능은 스팀 로그인 및 관리자 승인 유저만 이용 가능합니다.</p>
                <button onClick={() => window.location.href = '/api/auth/steam'} className="inline-flex items-center gap-3 bg-[#171a21] hover:bg-[#2a475e] text-white px-8 py-4 rounded-xl font-bold transition text-lg shadow-lg">
                  <SteamIcon /> Steam으로 로그인
                </button>
              </div>
            ) : !me.approved ? (
              <div className="text-center py-20 bg-gray-800/30 rounded-3xl border border-gray-700/50">
                <div className="text-6xl mb-6">⏳</div>
                <h2 className="text-2xl font-bold mb-4">관리자 승인 대기 중</h2>
                <p className="text-gray-400">상점 관리자의 계정 승인 후 AI 일러스트 생성 및 카드 구매가 가능합니다.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
                
                <div className="md:col-span-2 space-y-4">
                  <div className="bg-gray-800/60 rounded-2xl p-5 border border-gray-700 shadow-xl space-y-4">
                    <h3 className="font-bold text-lg flex items-center justify-between">
                      <span className="flex items-center gap-2"><span className="text-purple-400">⚡</span> 내 Energy</span>
                      <span className="text-purple-400 text-xl">{me.energy?.toLocaleString() || 0}</span>
                    </h3>

                    <div className="bg-gray-900/60 p-3 rounded-lg border border-gray-700">
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">🎟️ Energy 충전 쿠폰</label>
                      <div className="flex gap-2">
                        <input 
                          type="text" value={energyCoupon} onChange={e => setEnergyCoupon(e.target.value.toUpperCase())} disabled={energyCouponLoading || aiLoading}
                          className="flex-1 bg-gray-800 border border-gray-600 rounded-md px-3 py-1.5 text-white text-xs placeholder-gray-500 focus:outline-none focus:border-purple-500 transition" 
                          placeholder="코드 입력..." 
                        />
                        <button 
                          onClick={handleRedeemEnergyCoupon} disabled={!energyCoupon.trim() || energyCouponLoading || aiLoading}
                          className="px-3 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-md text-xs font-bold transition"
                        >
                          충전
                        </button>
                      </div>
                      {energyCouponMessage && (
                        <p className={`text-xs mt-1.5 ${energyCouponMessage.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                          {energyCouponMessage.text}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-400 mb-2">NovelAI 모델</label>
                      <select 
                        value={aiModel} onChange={e => setAiModel(e.target.value as 'curated'|'full')} disabled={aiLoading || isAiDisabled}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none"
                      >
                        <option value="curated">NAI Diffusion V4.5 Curated</option>
                        <option value="full">NAI Diffusion V4.5 Full</option>
                      </select>
                    </div>

                    <div className="space-y-3 pt-2">
                      <div>
                        <label className="block text-xs font-bold text-gray-300 mb-1">Base Prompt</label>
                        <textarea rows={2} value={basePrompt} onChange={e => setBasePrompt(e.target.value)} disabled={aiLoading || isAiDisabled} className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-xs focus:ring-2 focus:ring-purple-500 focus:outline-none resize-none" placeholder="(선택) 1girl, solo, looking at viewer..." />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-red-400 mb-1">Negative Prompt</label>
                        <textarea rows={2} value={negativePrompt} onChange={e => setNegativePrompt(e.target.value)} disabled={aiLoading || isAiDisabled} className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-xs focus:ring-2 focus:ring-red-500 focus:outline-none resize-none" placeholder="(선택) nsfw, signature..." />
                      </div>
                      <div className="border-t border-gray-700 my-2 pt-2" />
                      <div>
                        <label className="block text-xs font-bold text-gray-300 mb-1">Character Prompt</label>
                        <textarea rows={2} value={charPrompt} onChange={e => setCharPrompt(e.target.value)} disabled={aiLoading || isAiDisabled} className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-xs focus:ring-2 focus:ring-purple-500 focus:outline-none resize-none" placeholder="(선택) silver hair, blue eyes..." />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-red-400 mb-1">Character Negative Prompt</label>
                        <textarea rows={2} value={charNegativePrompt} onChange={e => setCharNegativePrompt(e.target.value)} disabled={aiLoading || isAiDisabled} className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-xs focus:ring-2 focus:ring-red-500 focus:outline-none resize-none" placeholder="(선택) ahoge, hat, glasses..." />
                      </div>
                    </div>
                    
                    {aiError && <div className="text-red-400 text-xs bg-red-900/20 p-3 rounded-lg border border-red-800/50 break-words whitespace-pre-wrap mt-2">{aiError}</div>}
                    
                    <button 
                      onClick={handleGenerateAi} 
                      disabled={aiButtonDisabled}
                      className="w-full py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-bold text-white shadow-lg transition-all transform active:scale-95 mt-4"
                    >
                      {aiLoading ? (
                        <span className="flex items-center justify-center gap-2"><span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"/> 요청 중...</span>
                      ) : aiButtonText}
                    </button>
                  </div>
                </div>

                <div className="md:col-span-3 bg-gray-900/50 rounded-2xl border border-gray-700 shadow-xl overflow-hidden flex items-center justify-center min-h-[500px] relative">
                  {aiLoading ? (
                    <div className="flex flex-col items-center justify-center space-y-6 text-center px-4 w-full">
                      <div className={`w-16 h-16 border-4 border-t-transparent rounded-full animate-spin ${queuePosition !== null ? 'border-yellow-500' : 'border-purple-500'}`} />
                      
                      {queuePosition !== null ? (
                        <div className="space-y-4 w-full flex flex-col items-center">
                          <h3 className="text-yellow-400 font-bold text-xl animate-pulse">대기열에서 순서를 기다리는 중...</h3>
                          <div className="bg-gray-800 px-6 py-4 rounded-2xl border border-gray-700 shadow-inner inline-block">
                            <span className="text-white text-2xl font-bold">앞에 </span>
                            <span className="text-yellow-400 text-4xl font-black mx-2">{queuePosition}</span>
                            <span className="text-white text-2xl font-bold">명 대기 중</span>
                          </div>
                          <p className="text-red-400 font-bold bg-red-900/30 px-5 py-3 rounded-xl border border-red-500/50 shadow-lg mt-4 animate-bounce">
                            ⚠️ 절대 이 웹 페이지를 끄거나 새로고침하지 마세요!
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-purple-400 font-bold text-xl animate-pulse">내 차례입니다!</p>
                          <p className="text-gray-300 font-medium">서버에서 일러스트를 렌더링하고 있습니다...</p>
                        </div>
                      )}
                    </div>
                  ) : generatedImage ? (
                    <div className="w-full h-full relative group">
                      <img src={generatedImage} alt="Generated AI" className="w-full h-full object-contain" />
                      <a href={generatedImage} download={`NovelAI_${Date.now()}.png`} className="absolute bottom-4 right-4 bg-gray-900/80 hover:bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-bold backdrop-blur opacity-0 group-hover:opacity-100 transition-opacity">
                        💾 다운로드
                      </a>
                    </div>
                  ) : (
                    <div className="text-center text-gray-600">
                      <span className="text-6xl block mb-4">🖼️</span>
                      <p>프롬프트를 입력해 이미지를 생성해보세요!</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {modal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-700 rounded-2xl p-8 w-full max-w-md shadow-2xl text-center">
            
            {modal.step === 'input' && (
              <div className="text-left space-y-4">
                <h3 className="text-lg font-bold mb-3 flex items-center gap-2">🛒 구매하기</h3>
                <div className="mb-5 flex flex-col">
                  <span className="text-white font-medium mb-1">{modal.set.gameName}</span>
                  <div className="flex items-center gap-2">
                    {modal.appliedCoupon ? (
                      <>
                        <span className="text-gray-500 line-through text-sm">💎 {(modal.set.sellPrice * modal.quantity).toLocaleString()}</span>
                        <span className="text-green-400 font-bold text-lg">💎 {modal.finalPrice.toLocaleString()}</span>
                        <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded">
                          {modal.appliedCoupon.discountRate}% 할인
                        </span>
                      </>
                    ) : <span className="text-yellow-400 font-bold text-lg">💎 {(modal.set.sellPrice * modal.quantity).toLocaleString()}</span>}
                    <span className="text-gray-500 text-xs ml-auto">재고 {modal.set.completeSets}세트</span>
                  </div>
                </div>

                <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-700 flex justify-between items-center mb-4">
                  <label className="text-sm font-medium text-gray-300">구매 수량</label>
                  <div className="flex items-center bg-gray-800 rounded-lg border border-gray-600 overflow-hidden">
                    <button onClick={() => handleQuantityChange(modal.quantity - 1)} disabled={modal.quantity <= 1} className="px-3 py-1 bg-gray-700 hover:bg-gray-600">-</button>
                    <span className="w-10 text-center text-sm font-bold text-white">{modal.quantity}</span>
                    <button onClick={() => handleQuantityChange(modal.quantity + 1)} disabled={modal.quantity >= Math.min(5, modal.set.completeSets)} className="px-3 py-1 bg-gray-700 hover:bg-gray-600">+</button>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-700">
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">🎟️ 결제 할인 쿠폰</label>
                    <div className="flex gap-2">
                      <input type="text" value={modal.couponCode} onChange={e => setModal(m => m ? { ...m, couponCode: e.target.value.toUpperCase() } : m)} disabled={!!modal.appliedCoupon} className="flex-1 bg-gray-800 border border-gray-600 rounded-md px-3 py-1.5 text-white text-sm" />
                      {modal.appliedCoupon ? <button onClick={() => setModal(m => m ? { ...m, couponCode: '', appliedCoupon: null, discount: 0, finalPrice: modal.set.sellPrice * modal.quantity } : m)} className="px-3 bg-red-600 text-white rounded-md text-sm">취소</button> : <button onClick={handleApplyCoupon} disabled={!modal.couponCode.trim() || modal.couponLoading} className="px-3 bg-gray-600 text-white rounded-md text-sm">적용</button>}
                    </div>
                    {modal.couponError && <p className="text-xs text-red-400 mt-1.5">{modal.couponError}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">스팀 트레이드 URL</label>
                    <input type="text" value={modal.tradeUrl} onChange={e => setModal(m => m ? { ...m, tradeUrl: e.target.value } : m)} className="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-4 py-2.5 text-white text-sm font-mono" />
                  </div>
                </div>

                <div className="flex gap-3 mt-6">
                  <button onClick={handleConfirmPurchase} disabled={!modal.tradeUrl.trim()} className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg font-semibold text-sm">💎 {modal.finalPrice.toLocaleString()} 구매 요청</button>
                  <button onClick={() => setModal(null)} className="px-4 py-2.5 bg-gray-600 hover:bg-gray-500 rounded-lg text-sm">닫기</button>
                </div>
              </div>
            )}

            {modal.step === 'sending' && (
              <div className="py-10 space-y-4">
                <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="font-bold">거래를 보내는 중입니다...</p>
              </div>
            )}

            {/* ✨ 대기열 폴링을 없애고, 전송 완료 즉시 화면을 닫을 수 있는 가벼운 UI로 변경 ✨ */}
            {modal.step === 'sent' && (
              <div className="py-10 space-y-6">
                <div className="w-16 h-16 bg-blue-500/20 text-blue-500 rounded-full flex items-center justify-center mx-auto text-3xl">📱</div>
                <div className="space-y-2">
                  <h2 className="text-2xl font-black text-blue-400">거래 제안 전송 완료!</h2>
                  <p className="text-gray-300 text-sm">
                    스팀 앱에서 <b>거래를 수락</b>해 주세요.<br/>
                    (수락하시면 서버에서 감지하여 Energy를 적립해 드립니다.)
                  </p>
                </div>
                <button onClick={() => setModal(null)} className="w-full py-4 bg-gray-700 hover:bg-gray-600 rounded-xl font-bold">확인 및 창 닫기</button>
              </div>
            )}

            {modal.step === 'error' && (
              <div className="py-10 space-y-4">
                <h2 className="text-xl font-bold text-red-400">오류 발생</h2>
                <p className="text-sm text-gray-400">{modal.errorMsg}</p>
                <button onClick={() => setModal(null)} className="w-full py-3 bg-gray-700 rounded-xl">닫기</button>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}