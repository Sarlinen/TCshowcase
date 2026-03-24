import { useState, useEffect } from 'react';
import { getShop, createPurchase, validateCoupon, getMe, logoutSteam, SteamUser } from '../api';
import { useNavigate } from 'react-router-dom';

interface ShopSet {
  appId: number; gameName: string; completeSets: number; sellPrice: number;
}
type SortKey = 'name' | 'sets' | 'price';
type SortDir = 'asc' | 'desc';
type ViewMode = 'grid' | 'list';
type PurchaseStep = 'input' | 'sending' | 'done' | 'error';

interface PurchaseModal {
  set: ShopSet; step: PurchaseStep; tradeUrl: string; offerId: string | null; errorMsg: string;
  quantity: number; couponCode: string; appliedCoupon: any; discount: number; finalPrice: number;
  couponLoading: boolean; couponError: string;
}

// 깨지지 않는 스팀 공식 벡터 아이콘
const SteamIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
    <path d="M11.979 0C5.363 0 0 5.363 0 11.979c0 4.67 2.68 8.71 6.551 10.74l1.96-2.83c-.02-.12-.04-.25-.04-.37 0-1.89 1.53-3.42 3.42-3.42 1.34 0 2.49.77 3.07 1.88l3.66-1.54c.03-.13.04-.26.04-.4 0-2.85-2.31-5.16-5.16-5.16-2.85 0-5.16 2.31-5.16 5.16 0 .42.06.82.16 1.21l-3.32 4.79C1.94 19.5 0 15.98 0 11.98 0 5.36 5.36 0 11.98 0c6.61 0 11.98 5.36 11.98 11.98 0 6.61-5.36 11.98-11.98 11.98-1.58 0-3.09-.31-4.48-.87l2.84-2c.49.12.99.18 1.51.18 3.51 0 6.36-2.85 6.36-6.36s-2.85-6.36-6.36-6.36-6.36 2.85-6.36 6.36c0 .32.03.63.07.93l-1.92 2.76c-.03-.11-.05-.23-.05-.36 0-1.89 1.53-3.42 3.42-3.42 1.34 0 2.49.77 3.07 1.88l3.66-1.54c.03-.13.04-.26.04-.4 0-2.85-2.31-5.16-5.16-5.16-2.85 0-5.16 2.31-5.16 5.16 0 .39.05.77.13 1.13l-3.23 4.67c-.24.08-.49.12-.76.12-1.55 0-2.81-1.26-2.81-2.81 0-1.55 1.26-2.81 2.81-2.81 1.29 0 2.38.88 2.71 2.08l1.78-.75c-.53-1.63-2.09-2.81-3.92-2.81-2.28 0-4.13 1.85-4.13 4.13 0 1.28.58 2.41 1.5 3.19l-3.66 1.54c.16 3.12 2.75 5.58 5.92 5.58 3.28 0 5.95-2.67 5.95-5.95s-2.67-5.95-5.95-5.95z"/>
  </svg>
);

export default function ShopPage() {
  const [sets, setSets]         = useState<ShopSet[]>([]);
  const [me, setMe]             = useState<SteamUser | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [sortKey, setSortKey]   = useState<SortKey>('name');
  const [sortDir, setSortDir]   = useState<SortDir>('asc');
  
  const [search, setSearch]     = useState('');
  
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [modal, setModal]       = useState<PurchaseModal | null>(null);
  const navigate = useNavigate();

  useEffect(() => { loadInitialData(); }, []);

  async function loadInitialData() {
    setLoading(true);
    try {
      const [shopData, userData] = await Promise.all([getShop(), getMe()]);
      setSets(shopData.sets || []);
      setMe(userData);
    } catch {
      setError('상점 데이터를 불러올 수 없습니다.');
    } finally {
      setLoading(false);
    }
  }

  async function handleLogoutSteam() {
    await logoutSteam();
    setMe(null);
  }

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
    setModal(m => m ? { 
      ...m, quantity: validQty, couponCode: '', appliedCoupon: null, discount: 0, 
      finalPrice: m.set.sellPrice * validQty, couponError: ''
    } : m);
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
    setModal(m => m ? { ...m, step: 'sending' } : m);
    try {
      const res = await createPurchase({ 
        tradeUrl, appId: modal.set.appId, couponCode: modal.appliedCoupon?.code, quantity: modal.quantity
      });
      setModal(m => m ? { ...m, step: 'done', offerId: res.offerId } : m);
      await loadInitialData();
    } catch (e: unknown) {
      setModal(m => m ? { ...m, step: 'error', errorMsg: e instanceof Error ? e.message : '거래 전송 실패' } : m);
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
    <button
      onClick={() => handleSort(k)}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1 ${
        sortKey === k ? 'bg-blue-600 text-white' : 'bg-gray-700/50 text-gray-400 hover:bg-gray-700 hover:text-white'
      }`}
    >
      {label} <span className="text-xs opacity-70">{sortKey === k ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
    </button>
  );

  if (loading) return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-400">상점 불러오는 중...</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
      <div className="text-center"><div className="text-4xl mb-4">⚠️</div><p className="text-red-400">{error}</p></div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white">
      <header className="border-b border-gray-700 bg-gray-900/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center text-lg">🃏</div>
            <div>
              <h1 className="text-lg font-bold leading-tight">트레이딩 카드 상점</h1>
              <p className="text-xs text-gray-400">보석(Gems)으로 카드 세트를 구매하세요</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            
            <button onClick={() => navigate('/admin')} className="text-xs text-gray-400 hover:text-white transition-colors px-3 py-1.5 rounded-md hover:bg-gray-700/50 border border-transparent hover:border-gray-600">
              관리자 접속
            </button>
            <div className="w-px h-4 bg-gray-700" />

            {me ? (
              <div className="flex items-center gap-3 bg-gray-800/80 px-3 py-1.5 rounded-lg border border-gray-700">
                {me.avatar && (
                  <img src={me.avatar} alt="profile" className="w-7 h-7 rounded-md object-cover border border-gray-600" />
                )}
                <div className="flex flex-col text-right">
                  <span className="text-xs font-bold text-gray-200">{me.displayName || me.steamId}</span>
                  {me.approved ? (
                    <span className="text-[10px] font-bold text-green-400">✅ 구매 승인됨</span>
                  ) : (
                    <span className="text-[10px] font-bold text-yellow-500">⏳ 승인 대기중</span>
                  )}
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

      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
            <input
              type="text" placeholder="게임명 검색..." value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-gray-800/60 border border-gray-700 rounded-lg pl-9 pr-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <SortBtn k="name"  label="이름" />
            <SortBtn k="sets"  label="세트수" />
            <SortBtn k="price" label="가격" />
            <div className="w-px h-6 bg-gray-600 mx-1" />
            <button onClick={() => setViewMode('grid')} className={`p-2 rounded-lg transition-colors ${viewMode === 'grid' ? 'bg-blue-600 text-white' : 'bg-gray-700/50 text-gray-400 hover:bg-gray-700'}`}>🖼️</button>
            <button onClick={() => setViewMode('list')} className={`p-2 rounded-lg transition-colors ${viewMode === 'list' ? 'bg-blue-600 text-white' : 'bg-gray-700/50 text-gray-400 hover:bg-gray-700'}`}>📋</button>
          </div>
        </div>

        <div className="mb-4 text-sm text-gray-400">
          {sorted.length}개 게임 · 총 {sorted.reduce((a, s) => a + s.completeSets, 0).toLocaleString()}세트
        </div>

        {sorted.length === 0 ? (
          <div className="text-center py-24">
            <div className="text-6xl mb-4">🃏</div>
            <p className="text-gray-400 text-lg">{search ? `'${search}' 검색 결과가 없습니다.` : '판매 중인 세트가 없습니다.'}</p>
          </div>
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700 bg-gray-800/60">
                    <th className="text-left px-4 py-3 font-medium text-gray-300 w-8">#</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-300">게임</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-300">세트 수</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-300">보석 가격</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-300">구매</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((set, i) => (
                    <tr key={set.appId} className="border-b border-gray-700/40 hover:bg-gray-700/20 transition-colors">
                      <td className="px-4 py-3 text-gray-500 text-xs">{i + 1}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <img src={`https://cdn.cloudflare.steamstatic.com/steam/apps/${set.appId}/capsule_sm_120.jpg`} alt="" className="w-12 h-8 rounded object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                          <span className="font-medium text-white text-sm line-clamp-1">{set.gameName}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center text-green-400 font-semibold">{set.completeSets}</td>
                      <td className="px-4 py-3 text-center text-yellow-400 font-bold">💎 {set.sellPrice.toLocaleString()}</td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => openPurchase(set)} className="px-3 py-1.5 bg-blue-600/80 hover:bg-blue-600 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap">구매하기</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">

            {(!me || !me.approved) && modal.step === 'input' && (
              <div className="text-center py-4">
                <div className="text-5xl mb-4">🔒</div>
                <h3 className="text-xl font-bold text-white mb-2">구매 권한 없음</h3>
                {!me ? (
                  <p className="text-gray-400 text-sm mb-6">구매를 진행하려면 스팀 로그인이 필요합니다.</p>
                ) : (
                  <p className="text-yellow-400 text-sm mb-6 bg-yellow-900/20 p-3 rounded-lg border border-yellow-700/50">
                    현재 관리자의 승인을 대기 중입니다.<br/>승인이 완료된 후 구매가 가능합니다.
                  </p>
                )}
                <div className="flex gap-3 justify-center">
                  {!me && (
                    <button onClick={() => window.location.href = '/api/auth/steam'} className="px-4 py-2.5 bg-[#171a21] hover:bg-[#2a475e] text-white rounded-lg font-bold text-sm transition-colors flex items-center gap-2">
                      <SteamIcon /> 로그인
                    </button>
                  )}
                  <button onClick={() => setModal(null)} className="px-4 py-2.5 bg-gray-600 hover:bg-gray-500 rounded-lg font-semibold text-sm transition-colors">닫기</button>
                </div>
              </div>
            )}

            {me?.approved && modal.step === 'input' && (
              <>
                <h3 className="text-lg font-bold mb-3 flex items-center gap-2">🛒 구매하기</h3>
                
                <div className="mb-5 flex flex-col">
                  <span className="text-white font-medium mb-1">{modal.set.gameName}</span>
                  <div className="flex items-center gap-2">
                    {modal.appliedCoupon ? (
                      <>
                        <span className="text-gray-500 line-through text-sm">💎 {(modal.set.sellPrice * modal.quantity).toLocaleString()}</span>
                        <span className="text-green-400 font-bold text-lg">💎 {modal.finalPrice.toLocaleString()}</span>
                        <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded">{modal.appliedCoupon.discountRate}% 할인 적용!</span>
                      </>
                    ) : (
                      <span className="text-yellow-400 font-bold text-lg">💎 {(modal.set.sellPrice * modal.quantity).toLocaleString()}</span>
                    )}
                    <span className="text-gray-500 text-xs ml-auto">재고 {modal.set.completeSets}세트</span>
                  </div>
                </div>

                <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-700 flex justify-between items-center mb-4">
                  <label className="text-sm font-medium text-gray-300">구매 수량 (최대 {Math.min(5, modal.set.completeSets)}세트)</label>
                  <div className="flex items-center bg-gray-800 rounded-lg border border-gray-600 overflow-hidden">
                    <button onClick={() => handleQuantityChange(modal.quantity - 1)} disabled={modal.quantity <= 1 || modal.step === 'sending'} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 transition">-</button>
                    <span className="w-10 text-center text-sm font-bold text-white">{modal.quantity}</span>
                    <button onClick={() => handleQuantityChange(modal.quantity + 1)} disabled={modal.quantity >= Math.min(5, modal.set.completeSets) || modal.step === 'sending'} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 transition">+</button>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-700">
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">🎟️ 쿠폰 코드 (선택)</label>
                    <div className="flex gap-2">
                      <input type="text" value={modal.couponCode} onChange={e => setModal(m => m ? { ...m, couponCode: e.target.value.toUpperCase() } : m)} disabled={modal.step === 'sending' || !!modal.appliedCoupon} className="flex-1 bg-gray-800 border border-gray-600 rounded-md px-3 py-1.5 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 text-sm disabled:opacity-50" placeholder="코드를 입력하세요" />
                      {modal.appliedCoupon ? (
                        <button onClick={() => setModal(m => m ? { ...m, couponCode: '', appliedCoupon: null, discount: 0, finalPrice: modal.set.sellPrice * modal.quantity } : m)} disabled={modal.step === 'sending'} className="px-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-md text-sm font-medium transition">취소</button>
                      ) : (
                        <button onClick={handleApplyCoupon} disabled={!modal.couponCode.trim() || modal.couponLoading || modal.step === 'sending'} className="px-3 bg-gray-600 hover:bg-gray-500 disabled:opacity-50 text-white rounded-md text-sm font-medium transition">{modal.couponLoading ? '확인중..' : '적용'}</button>
                      )}
                    </div>
                    {modal.couponError && <p className="text-xs text-red-400 mt-1.5">{modal.couponError}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">스팀 트레이드 URL <span className="text-red-400">*</span></label>
                    <input type="text" value={modal.tradeUrl} onChange={e => setModal(m => m ? { ...m, tradeUrl: e.target.value } : m)} disabled={modal.step === 'sending'} className="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm disabled:opacity-60 font-mono" placeholder="https://steamcommunity.com/tradeoffer/new/?partner=...&token=..." />
                    <p className="text-[10px] text-gray-500 mt-1">로그인한 계정({me.displayName || me.steamId})의 트레이드 URL이어야 합니다.</p>
                  </div>
                </div>

                <div className="flex gap-3 mt-6">
                  <button onClick={handleConfirmPurchase} disabled={!modal.tradeUrl.trim()} className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg font-semibold text-sm transition-colors">💎 {modal.finalPrice.toLocaleString()} 구매 요청</button>
                  <button onClick={() => setModal(null)} className="px-4 py-2.5 bg-gray-600 hover:bg-gray-500 rounded-lg text-sm transition-colors">닫기</button>
                </div>
              </>
            )}

            {modal.step === 'sending' && (
              <div className="text-center py-8">
                <span className="inline-block w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
                <p className="text-gray-300 font-medium">거래 생성 중...</p>
              </div>
            )}
            
            {modal.step === 'done' && (
              <div className="text-center py-4">
                <div className="text-5xl mb-4">🎉</div>
                <h3 className="text-xl font-bold text-green-400 mb-2">거래 전송 완료!</h3>
                <p className="text-gray-400 text-sm mb-2"><span className="text-white">{modal.set.gameName}</span> {modal.quantity}세트 거래 전송</p>
                <p className="text-gray-500 text-xs mb-6">스팀 앱에서 수락하세요. (Offer ID: {modal.offerId})</p>
                <button onClick={() => setModal(null)} className="px-6 py-2.5 bg-green-600 hover:bg-green-700 rounded-lg font-semibold transition-colors">확인</button>
              </div>
            )}

            {modal.step === 'error' && (
              <div className="text-center py-4">
                <div className="text-5xl mb-4">❌</div>
                <h3 className="text-xl font-bold text-red-400 mb-2">오류 발생</h3>
                <p className="text-gray-400 text-sm mb-6 whitespace-pre-wrap">{modal.errorMsg}</p>
                <div className="flex gap-3 justify-center">
                  <button onClick={() => setModal(m => m ? { ...m, step: 'input' } : m)} className="px-4 py-2.5 bg-gray-600 hover:bg-gray-500 rounded-lg font-semibold text-sm transition-colors">다시 시도</button>
                  <button onClick={() => setModal(null)} className="px-4 py-2.5 bg-red-600/50 hover:bg-red-600 rounded-lg font-semibold text-sm transition-colors">닫기</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}