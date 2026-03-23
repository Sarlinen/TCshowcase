import { useState, useEffect } from 'react';
import { getShop, createPurchase } from '../api';
import { useNavigate } from 'react-router-dom';

interface ShopSet {
  appId: number;
  gameName: string;
  completeSets: number;
  sellPrice: number;
}

type SortKey = 'name' | 'sets' | 'price';
type SortDir = 'asc' | 'desc';
type ViewMode = 'grid' | 'list';
type PurchaseStep = 'input' | 'sending' | 'done' | 'error';

interface PurchaseModal {
  set: ShopSet;
  step: PurchaseStep;
  tradeUrl: string;
  offerId: string | null;
  errorMsg: string;
}

export default function ShopPage() {
  const [sets, setSets]         = useState<ShopSet[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [sortKey, setSortKey]   = useState<SortKey>('name');
  const [sortDir, setSortDir]   = useState<SortDir>('asc');
  const [search, setSearch]     = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [modal, setModal]       = useState<PurchaseModal | null>(null);
  const navigate = useNavigate();

  useEffect(() => { loadShop(); }, []);

  async function loadShop() {
    setLoading(true);
    try {
      const data = await getShop();
      setSets(data.sets || []);
    } catch {
      setError('상점 데이터를 불러올 수 없습니다.');
    } finally {
      setLoading(false);
    }
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'name' ? 'asc' : 'desc'); }
  }

  function openPurchase(set: ShopSet) {
    setModal({ set, step: 'input', tradeUrl: '', offerId: null, errorMsg: '' });
  }

  async function handleConfirmPurchase() {
    if (!modal) return;
    const tradeUrl = modal.tradeUrl.trim();
    if (!tradeUrl) return;

    setModal(m => m ? { ...m, step: 'sending' } : m);
    try {
      const res = await createPurchase({ tradeUrl, appId: modal.set.appId });
      setModal(m => m ? { ...m, step: 'done', offerId: res.offerId } : m);
      await loadShop();
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
      {label}
      <span className="text-xs opacity-70">{sortKey === k ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
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
      <div className="text-center">
        <div className="text-4xl mb-4">⚠️</div>
        <p className="text-red-400">{error}</p>
        <button onClick={loadShop} className="mt-4 px-4 py-2 bg-blue-600 rounded-lg text-sm">다시 시도</button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white">
      {/* 헤더 */}
      <header className="border-b border-gray-700 bg-gray-900/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center text-lg">🃏</div>
            <div>
              <h1 className="text-lg font-bold leading-tight">트레이딩 카드 상점</h1>
              <p className="text-xs text-gray-400">보석(Gems)으로 카드 세트를 구매하세요</p>
            </div>
          </div>
          <button onClick={() => navigate('/admin')} className="text-xs text-gray-500 hover:text-gray-300 transition-colors px-3 py-1.5 rounded-md hover:bg-gray-700/50">
            관리자
          </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* 툴바 */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
            <input
              type="text" placeholder="게임 검색..." value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-gray-800/60 border border-gray-700 rounded-lg pl-9 pr-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <SortBtn k="name"  label="이름" />
            <SortBtn k="sets"  label="세트수" />
            <SortBtn k="price" label="가격" />
            <div className="w-px h-6 bg-gray-600 mx-1" />
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded-lg transition-colors ${viewMode === 'grid' ? 'bg-blue-600 text-white' : 'bg-gray-700/50 text-gray-400 hover:bg-gray-700'}`}
              title="섬네일형"
            >🖼️</button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 rounded-lg transition-colors ${viewMode === 'list' ? 'bg-blue-600 text-white' : 'bg-gray-700/50 text-gray-400 hover:bg-gray-700'}`}
              title="리스트형"
            >📋</button>
          </div>
        </div>

        {/* 결과 요약 */}
        <div className="mb-4 text-sm text-gray-400">
          {sorted.length}개 게임 · 총 {sorted.reduce((a, s) => a + s.completeSets, 0).toLocaleString()}세트
        </div>

        {sorted.length === 0 ? (
          <div className="text-center py-24">
            <div className="text-6xl mb-4">🃏</div>
            <p className="text-gray-400 text-lg">{search ? '검색 결과가 없습니다.' : '판매 중인 세트가 없습니다.'}</p>
          </div>
        ) : viewMode === 'grid' ? (
          /* ── 섬네일형 ── */
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {sorted.map(set => (
              <div key={set.appId} className="bg-gray-800/40 border border-gray-700/50 rounded-xl overflow-hidden hover:border-blue-500/40 hover:bg-gray-800/60 transition-all group">
                <a href={`https://store.steampowered.com/app/${set.appId}`} target="_blank" rel="noreferrer" className="block relative overflow-hidden">
                  <img
                    src={`https://cdn.cloudflare.steamstatic.com/steam/apps/${set.appId}/capsule_sm_120.jpg`}
                    alt={set.gameName}
                    className="w-full h-[90px] object-cover group-hover:scale-105 transition-transform duration-300"
                    onError={e => { (e.target as HTMLImageElement).src = `https://cdn.cloudflare.steamstatic.com/steam/apps/${set.appId}/header.jpg`; }}
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                    <span className="text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 px-2 py-1 rounded">🔗 스팀 상점</span>
                  </div>
                </a>
                <div className="p-3">
                  <h3 className="text-xs font-medium text-white leading-tight mb-2 line-clamp-2 min-h-[2.5rem]">{set.gameName}</h3>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-gray-400">재고 {set.completeSets}세트</span>
                    <span className="text-xs font-bold text-yellow-400">💎 {set.sellPrice.toLocaleString()}</span>
                  </div>
                  <button
                    onClick={() => openPurchase(set)}
                    className="w-full py-1.5 bg-blue-600/80 hover:bg-blue-600 rounded-md text-xs font-semibold transition-colors"
                  >
                    구매하기
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* ── 리스트형 ── */
          <div className="bg-gray-800/40 border border-gray-700/50 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700 bg-gray-800/60">
                    <th className="text-left px-4 py-3 font-medium text-gray-300 w-8">#</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-300">게임</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-300 whitespace-nowrap">세트 수</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-300 whitespace-nowrap">보석 가격</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-300">구매</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((set, i) => (
                    <tr key={set.appId} className="border-b border-gray-700/40 hover:bg-gray-700/20 transition-colors">
                      <td className="px-4 py-3 text-gray-500 text-xs">{i + 1}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <a href={`https://store.steampowered.com/app/${set.appId}`} target="_blank" rel="noreferrer" className="flex-shrink-0">
                            <img
                              src={`https://cdn.cloudflare.steamstatic.com/steam/apps/${set.appId}/capsule_sm_120.jpg`}
                              alt="" className="w-12 h-8 rounded object-cover hover:opacity-80 transition-opacity"
                              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                          </a>
                          <a href={`https://store.steampowered.com/app/${set.appId}`} target="_blank" rel="noreferrer"
                            className="font-medium text-white hover:text-blue-400 transition-colors text-sm line-clamp-1">
                            {set.gameName}
                          </a>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-green-400 font-semibold">{set.completeSets}</span>
                        <span className="text-gray-500 text-xs ml-1">세트</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-yellow-400 font-bold">💎 {set.sellPrice.toLocaleString()}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => openPurchase(set)}
                          className="px-3 py-1.5 bg-blue-600/80 hover:bg-blue-600 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap"
                        >
                          구매하기
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-800/60 border-t border-gray-700">
                    <td colSpan={2} className="px-4 py-3 text-sm text-gray-400">총 {sorted.length}개 게임</td>
                    <td className="px-4 py-3 text-center text-sm text-green-400 font-semibold">
                      {sorted.reduce((a, s) => a + s.completeSets, 0).toLocaleString()}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── 구매 모달 ── */}
      {modal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">

            {/* 완료 */}
            {modal.step === 'done' && (
              <div className="text-center py-4">
                <div className="text-5xl mb-4">🎉</div>
                <h3 className="text-xl font-bold text-green-400 mb-2">거래 전송 완료!</h3>
                <p className="text-gray-400 text-sm mb-2">
                  <span className="text-white">{modal.set.gameName}</span> 카드 세트 거래를 전송했습니다.
                </p>
                <p className="text-gray-500 text-xs mb-6">
                  스팀 앱에서 거래 제안을 확인하고 수락하세요.<br />
                  Offer ID: {modal.offerId}
                </p>
                <button onClick={() => setModal(null)} className="px-6 py-2.5 bg-green-600 hover:bg-green-700 rounded-lg font-semibold transition-colors">
                  확인
                </button>
              </div>
            )}

            {/* 에러 */}
            {modal.step === 'error' && (
              <div className="text-center py-4">
                <div className="text-5xl mb-4">❌</div>
                <h3 className="text-xl font-bold text-red-400 mb-2">오류 발생</h3>
                <p className="text-gray-400 text-sm mb-6 whitespace-pre-wrap">{modal.errorMsg}</p>
                <div className="flex gap-3 justify-center">
                  <button onClick={() => setModal(m => m ? { ...m, step: 'input' } : m)}
                    className="px-4 py-2.5 bg-gray-600 hover:bg-gray-500 rounded-lg font-semibold text-sm transition-colors">
                    다시 시도
                  </button>
                  <button onClick={() => setModal(null)}
                    className="px-4 py-2.5 bg-red-600/50 hover:bg-red-600 rounded-lg font-semibold text-sm transition-colors">
                    닫기
                  </button>
                </div>
              </div>
            )}

            {/* 입력 / 전송 중 */}
            {(modal.step === 'input' || modal.step === 'sending') && (
              <>
                <h3 className="text-lg font-bold mb-1 flex items-center gap-2">🛒 구매하기</h3>
                <p className="text-sm text-gray-400 mb-5">
                  <span className="text-white font-medium">{modal.set.gameName}</span>
                  <span className="ml-2 text-yellow-400 font-bold">💎 {modal.set.sellPrice.toLocaleString()}</span>
                  <span className="ml-2 text-gray-500 text-xs">재고 {modal.set.completeSets}세트</span>
                </p>

                {/* 게임 이미지 */}
                <div className="mb-4 rounded-lg overflow-hidden">
                  <img
                    src={`https://cdn.cloudflare.steamstatic.com/steam/apps/${modal.set.appId}/capsule_sm_120.jpg`}
                    alt={modal.set.gameName}
                    className="w-full h-24 object-cover"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">
                      스팀 트레이드 URL <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={modal.tradeUrl}
                      onChange={e => setModal(m => m ? { ...m, tradeUrl: e.target.value } : m)}
                      disabled={modal.step === 'sending'}
                      className="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm disabled:opacity-60 font-mono"
                      placeholder="https://steamcommunity.com/tradeoffer/new/?partner=...&token=..."
                    />
                    <a
                      href="https://steamcommunity.com/my/tradeoffers/privacy#trade_offer_access_url"
                      target="_blank" rel="noreferrer"
                      className="text-xs text-blue-400 hover:text-blue-300 mt-1.5 inline-flex items-center gap-1"
                    >
                      🔗 내 트레이드 URL 확인하기
                    </a>
                  </div>

                  {/* 안내 */}
                  <div className="bg-yellow-900/20 border border-yellow-700/30 rounded-lg px-4 py-3 text-xs text-yellow-300 space-y-1">
                    <p>• 스팀 로그인 후 트레이드 URL을 복사해서 붙여넣으세요</p>
                    <p>• 봇이 자동으로 카드 세트와 보석을 교환하는 거래를 전송합니다</p>
                    <p>• 스팀 앱에서 거래를 수락하면 카드 세트가 인벤토리에 추가됩니다</p>
                  </div>
                </div>

                <div className="flex gap-3 mt-6">
                  {modal.step === 'input' && (
                    <>
                      <button
                        onClick={handleConfirmPurchase}
                        disabled={!modal.tradeUrl.trim()}
                        className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg font-semibold text-sm transition-colors"
                      >
                        💎 구매 요청
                      </button>
                      <button onClick={() => setModal(null)} className="px-4 py-2.5 bg-gray-600 hover:bg-gray-500 rounded-lg text-sm transition-colors">
                        취소
                      </button>
                    </>
                  )}
                  {modal.step === 'sending' && (
                    <div className="flex-1 py-2.5 bg-blue-600/40 rounded-lg font-semibold text-sm flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      거래 생성 중... (보석 잔액 확인 후 거래 전송)
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
