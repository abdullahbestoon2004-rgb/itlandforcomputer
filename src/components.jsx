import React from 'react';

export function StockBadge({ inStock, t }) {
  const color = inStock ? '#1F9D57' : '#DE3A1E';
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'4px 10px', fontSize:11.5, fontWeight:800, letterSpacing:'.01em', borderRadius:999, background:color, color:'#fff', whiteSpace:'nowrap' }}>
      {inStock ? t.inStock : t.outOfStock}
    </span>
  );
}

export function priceLabel(it, t) {
  if (it.p == null || it.p === '') return t.noWholesale;
  return '$' + it.p;
}

const memoryImageCache = new Map();

async function searchBrowserImage(item) {
  const cacheKey = item.id || item.n;
  if (memoryImageCache.has(cacheKey)) {
    return memoryImageCache.get(cacheKey);
  }

  const stored = localStorage.getItem('img_cache_' + cacheKey);
  if (stored) {
    memoryImageCache.set(cacheKey, stored);
    return stored;
  }

  const queryName = (item.n || '').replace(/[^a-zA-Z0-9\s\-]/g, ' ').trim();
  const brand = (item.brand || '').trim();
  const searchQ = `${brand} ${queryName}`.trim() || item.sku || item.s;

  if (!searchQ) return null;

  try {
    const res = await fetch(`/api/product-image?q=${encodeURIComponent(searchQ)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.ok && data.img) {
        localStorage.setItem('img_cache_' + cacheKey, data.img);
        memoryImageCache.set(cacheKey, data.img);
        return data.img;
      }
    }
  } catch (e) {
    // API endpoint unavailable or offline
  }

  try {
    const initRes = await fetch('https://duckduckgo.com/?q=' + encodeURIComponent(searchQ), {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const initText = await initRes.text();
    const vqdMatch = initText.match(/vqd=[\"']?([^&\"'\s]+)/) || initText.match(/vqd=\"([^\"]+)\"/);
    if (vqdMatch) {
      const vqd = vqdMatch[1];
      const imgRes = await fetch(`https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(searchQ)}&vqd=${vqd}`);
      const imgData = await imgRes.json();
      if (imgData.results && imgData.results.length > 0) {
        const imgUrl = imgData.results[0].image;
        localStorage.setItem('img_cache_' + cacheKey, imgUrl);
        memoryImageCache.set(cacheKey, imgUrl);
        return imgUrl;
      }
    }
  } catch (e) {
    // Client fetch error
  }

  return null;
}

export function SmartProductImage({ item, height = 130, style = {}, className = '' }) {
  const cacheKey = item.id || item.n;
  const initialSrc = memoryImageCache.get(cacheKey) || localStorage.getItem('img_cache_' + cacheKey) || item.img || null;
  const [src, setSrc] = useState(initialSrc);
  const [loading, setLoading] = useState(!initialSrc);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const currentCached = memoryImageCache.get(cacheKey) || localStorage.getItem('img_cache_' + cacheKey);
    if (currentCached) {
      setSrc(currentCached);
      setLoading(false);
      setFailed(false);
      return;
    }

    if (!item.img) {
      setLoading(true);
      searchBrowserImage(item).then(url => {
        if (isMounted) {
          if (url) {
            setSrc(url);
            setFailed(false);
          } else {
            setFailed(true);
          }
          setLoading(false);
        }
      });
    } else {
      setSrc(item.img);
      setLoading(false);
      setFailed(false);
    }

    return () => { isMounted = false; };
  }, [item.id, item.n, item.img]);

  const handleError = () => {
    setLoading(true);
    searchBrowserImage(item).then(url => {
      if (url && url !== src) {
        setSrc(url);
        setFailed(false);
      } else {
        setFailed(true);
      }
      setLoading(false);
    });
  };

  const handleRefresh = (e) => {
    e.stopPropagation();
    localStorage.removeItem('img_cache_' + cacheKey);
    memoryImageCache.delete(cacheKey);
    setLoading(true);
    setFailed(false);
    searchBrowserImage(item).then(url => {
      if (url) {
        setSrc(url);
        setFailed(false);
      } else {
        setFailed(true);
      }
      setLoading(false);
    });
  };

  return (
    <div
      className={className || 'card-img'}
      style={{
        height,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#F9F5EE',
        borderRadius: 10,
        overflow: 'hidden',
        margin: 'var(--cardpad)',
        marginBottom: 0,
        ...style,
      }}
    >
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: '#8B8071' }}>
          <div style={{ width: 22, height: 22, border: '2.5px solid #E9DFC9', borderTopColor: 'var(--pri)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <span style={{ fontSize: 10.5, fontWeight: 700, fontFamily: 'sans-serif' }}>Finding image...</span>
        </div>
      ) : src && !failed ? (
        <>
          <img
            src={src}
            alt={item.n}
            onError={handleError}
            style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }}
          />
          <button
            onClick={handleRefresh}
            title="Refresh image from browser"
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              width: 24,
              height: 24,
              padding: 0,
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.85)',
              border: '1px solid #E9DFC9',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: 0.6,
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = '1'}
            onMouseLeave={e => e.currentTarget.style.opacity = '0.6'}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#2B2419" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 4v6h-6" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, color: '#C5BCAE' }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
          </svg>
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#A09686' }}>{item.brand || 'iTLand'}</span>
        </div>
      )}
    </div>
  );
}
