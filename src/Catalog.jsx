import React, { useMemo, useRef, useState } from 'react';
import { StockBadge, priceLabel } from './components.jsx';
import { PAGE } from './i18n.js';
import { matchesBrand, brandsPresent } from '../lib/brands.js';

function matchesSearch(it, query) {
  if (!query) return true;
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;

  const itemText = `${it.n || ''} ${it.d || ''} ${it.sku || ''} ${it.s || ''} ${it.barcode || ''} ${it.brand || ''} ${it.category || ''}`.toLowerCase();

  return terms.every(term => itemText.includes(term));
}

const CATEGORIES = [
  { id: 'mouse',    label: 'Mouse',           keys: ['mouse', 'mice', 'trackball', 'touchpad'] },
  { id: 'keyboard', label: 'Keyboard',         keys: ['keyboard', 'keypad', 'combo', 'keys'] },
  { id: 'headset',  label: 'Headset',          keys: ['headset', 'headphone', 'earphone', 'earbuds', 'blackwire', 'evolve', 'voyager', 'zone', 'tune', 'quantum'] },
  { id: 'adapter',  label: 'Adapter / Hub',    keys: ['hub', 'adapter', 'dock', 'dongle', 'converter', 'multiport'] },
  { id: 'mic',      label: 'Microphone',       keys: ['microphone', 'mic', 'yeti', 'snowball', 'wave'] },
  { id: 'speakers', label: 'Speakers',         keys: ['speaker', 'soundbar', 'boombox'] },
  { id: 'stream',   label: 'Streaming',        keys: ['stream deck', 'elgato', 'litra', 'cam link', 'key light'] },
  { id: 'video',    label: 'Video Conference', keys: ['webcam', 'cam', 'conference', 'meetup', 'rally', 'brio', 'streamcam', 'speak2', 'speak 5', 'poly sync', 'tap ip', 'scribe', 'vc'] },
];

function matchesCategory(it, catId) {
  if (!catId) return true;
  const cat = CATEGORIES.find(c => c.id === catId);
  if (!cat) return true;
  if (it.category && it.category.toLowerCase().includes(catId.toLowerCase())) {
    return true;
  }
  const text = `${it.n || ''} ${it.d || ''} ${it.category || ''}`.toLowerCase();
  return cat.keys.some(k => text.includes(k));
}

export default function Catalog({
  t, items, loading,
  query, setQuery,
  brand, setBrand,
  category, setCategory,
  inStockOnly, setInStockOnly,
  visible, setVisible, onLogout, onOpen, onAdminClick,
}) {

  // Derived from the items themselves rather than a fixed list, so brands like
  // Dell, UGREEN and Rapoo get a chip instead of being invisible.
  const brands = useMemo(() => brandsPresent(items), [items]);

  const searchRef = useRef(null);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportBrands, setExportBrands] = useState(null);   // [{brand, count}]
  const [exportPicked, setExportPicked] = useState(new Set());
  const [exportBusy, setExportBusy] = useState('');          // '' | 'loading' | 'building'
  const [exportPct, setExportPct] = useState(0);
  const [exportError, setExportError] = useState(null);

  const openExport = async () => {
    setExportOpen(true);
    setExportError(null);
    if (exportBrands) return;
    setExportBusy('loading');
    try {
      const res = await fetch('/api/export-brands');
      if (!res.ok) {
        setExportError({ message: `Could not load brands — the server returned ${res.status}.` });
        return;
      }
      const data = await res.json();
      setExportBrands(data.brands || []);
      setExportPicked(new Set((data.brands || []).map(b => b.brand)));
    } catch (err) {
      setExportError({ message: `Could not reach the server — ${err.message}.` });
    } finally {
      setExportBusy('');
    }
  };

  const toggleBrand = (name) => setExportPicked(prev => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  const allPicked = exportBrands != null && exportPicked.size === exportBrands.length;
  const pickedCount = (exportBrands || [])
    .filter(b => exportPicked.has(b.brand))
    .reduce((n, b) => n + b.count, 0);

  const runExport = async () => {
    if (!exportPicked.size) return;
    setExportBusy('building');
    setExportPct(0);
    setExportError(null);
    try {
      // Everything selected means "no filter", which keeps the URL short and
      // lets the server skip the brand comparison entirely.
      const qs = allPicked ? '' : `?brands=${encodeURIComponent([...exportPicked].join(','))}`;
      const res = await fetch(`/api/export.xlsx${qs}`);
      if (!res.ok) {
        setExportError({ message: `Export failed — the server returned ${res.status}.` });
        return;
      }
      // Read the body in chunks so the progress bar reflects real transfer
      // rather than a spinner that means nothing.
      const total = Number(res.headers.get('Content-Length')) || 0;
      const reader = res.body?.getReader?.();
      let blob;
      if (reader) {
        const parts = [];
        let seen = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parts.push(value);
          seen += value.length;
          if (total) setExportPct(Math.min(99, Math.round((seen / total) * 100)));
        }
        blob = new Blob(parts, { type: res.headers.get('Content-Type') || 'application/octet-stream' });
      } else {
        blob = await res.blob();
      }
      setExportPct(100);

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `itland-catalogue-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Give the browser a moment to start the save before revoking.
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setExportOpen(false);
    } catch (err) {
      setExportError({ message: `Could not reach the server — ${err.message}.` });
    } finally {
      setExportBusy('');
    }
  };

  // Pre-filtered (brand + stock + search) — used for category counts
  const preFiltered = useMemo(() => {
    return items.filter(it => {
      if (!matchesBrand(it, brand)) return false;
      if (inStockOnly && !it.k) return false;
      if (!matchesSearch(it, query)) return false;
      return true;
    });
  }, [items, query, inStockOnly, brand]);

  // Category counts from pre-filtered list
  const categoryCounts = useMemo(() => {
    const counts = {};
    for (const cat of CATEGORIES) {
      counts[cat.id] = preFiltered.filter(it => matchesCategory(it, cat.id)).length;
    }
    return counts;
  }, [preFiltered]);

  // Final filtered list
  const all = useMemo(() => {
    if (!category) return preFiltered;
    return preFiltered.filter(it => matchesCategory(it, category));
  }, [preFiltered, category]);

  const vis = all.slice(0, visible);
  const hasMore = vis.length < all.length;
  const on = inStockOnly;

  const selectBrand = (b) => { setBrand(b); setVisible(PAGE); };
  const selectCategory = (c) => { setCategory(c); setVisible(PAGE); };

  const catBtn = (id, label, count) => {
    const active = category === id;
    return (
      <button
        key={id}
        onClick={() => selectCategory(active ? '' : id)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 11px', marginBottom: 3, fontSize: 13.5, fontWeight: active ? 800 : 500,
          fontFamily: 'inherit', color: active ? '#fff' : '#2B2419',
          background: active ? '#17130E' : 'transparent',
          border: '1.5px solid ' + (active ? '#17130E' : 'transparent'),
          borderRadius: 10, cursor: 'pointer', textAlign: 'left', transition: 'all .1s',
        }}
      >
        <span>{label}</span>
        <span style={{ fontSize: 11, fontFamily: "'Space Mono',monospace", opacity: .65 }}>{count}</span>
      </button>
    );
  };

  return (
    <div>
      {exportOpen && (
        <div role="dialog" aria-modal="true" aria-label="Export to Excel"
          onClick={e => { if (e.target === e.currentTarget && !exportBusy) setExportOpen(false); }}
          style={{ position:'fixed', inset:0, zIndex:100, background:'rgba(23,19,14,.45)', display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div style={{ width:'100%', maxWidth:520, maxHeight:'86vh', display:'flex', flexDirection:'column', background:'#FFFCF5', border:'2px solid #17130E', borderRadius:18, boxShadow:'6px 6px 0 #17130E', overflow:'hidden' }}>
            <div style={{ padding:'18px 20px 12px', borderBottom:'1.5px solid #E9DFC9' }}>
              <div style={{ fontSize:18, fontWeight:800, color:'#17130E' }}>Export to Excel</div>
              <div style={{ fontSize:13, color:'#776E62', marginTop:3 }}>Choose which brands to include. In-stock items only.</div>
            </div>

            {exportError && (
              <div style={{ margin:'12px 20px 0', display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', fontSize:13, fontWeight:600, color:'#8A2B18', background:'#FDEDE9', border:'1.5px solid #F9C5BB', borderRadius:10, padding:'9px 12px' }}>
                <span>{exportError.message}</span>
              </div>
            )}

            {exportBusy === 'loading' && <div style={{ padding:'26px 20px', fontSize:13.5, color:'#776E62' }}>Loading brands…</div>}

            {exportBrands && (
              <>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, padding:'12px 20px 8px' }}>
                  <button onClick={() => setExportPicked(allPicked ? new Set() : new Set(exportBrands.map(b => b.brand)))}
                    style={{ padding:'7px 13px', fontSize:13, fontWeight:700, fontFamily:'inherit', color:'#2B2419', background:'#fff', border:'1.5px solid #E9DFC9', borderRadius:9, cursor:'pointer' }}>
                    {allPicked ? 'Clear all' : 'Select all'}
                  </button>
                  <div style={{ fontSize:13, color:'#776E62' }}>
                    <b style={{ color:'#17130E' }}>{exportPicked.size}</b> of {exportBrands.length} brands · <b style={{ color:'#17130E' }}>{pickedCount}</b> items
                  </div>
                </div>

                <div style={{ overflowY:'auto', padding:'0 20px 8px', display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(200px, 1fr))', gap:6 }}>
                  {exportBrands.map(b => (
                    <label key={b.brand} style={{ display:'flex', alignItems:'center', gap:9, padding:'8px 10px', fontSize:13.5, background:exportPicked.has(b.brand) ? '#F4EFE3' : '#fff', border:'1.5px solid #E9DFC9', borderRadius:10, cursor:'pointer' }}>
                      <input type="checkbox" checked={exportPicked.has(b.brand)} onChange={() => toggleBrand(b.brand)}
                        style={{ width:16, height:16, accentColor:'var(--pri)', cursor:'pointer', flexShrink:0 }} />
                      <span style={{ fontWeight:600, color:'#2B2419', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{b.brand}</span>
                      <span style={{ marginLeft:'auto', fontSize:12.5, fontWeight:700, color:'#8B8071' }}>{b.count}</span>
                    </label>
                  ))}
                </div>
              </>
            )}

            {exportBusy === 'building' && (
              <div style={{ padding:'12px 20px 0' }}>
                <div style={{ fontSize:13, fontWeight:600, color:'#2B2419', marginBottom:6 }}>
                  Building your spreadsheet… {exportPct > 0 ? `${exportPct}%` : ''}
                </div>
                <div style={{ height:8, background:'#EFE7D8', borderRadius:99, overflow:'hidden' }}>
                  <div style={{ height:'100%', width:`${exportPct || 8}%`, background:'var(--pri)', borderRadius:99, transition:'width .2s ease' }} />
                </div>
              </div>
            )}

            <div style={{ marginTop:'auto', display:'flex', gap:10, justifyContent:'flex-end', padding:'14px 20px', borderTop:'1.5px solid #E9DFC9' }}>
              <button onClick={() => setExportOpen(false)} disabled={!!exportBusy}
                style={{ padding:'10px 16px', fontSize:14, fontWeight:700, fontFamily:'inherit', color:'#2B2419', background:'#fff', border:'1.5px solid #E9DFC9', borderRadius:11, cursor:exportBusy?'default':'pointer', opacity: exportBusy ? 0.6 : 1 }}>Cancel</button>
              <button onClick={runExport} disabled={!!exportBusy || !exportPicked.size}
                style={{ padding:'10px 18px', fontSize:14, fontWeight:800, fontFamily:'inherit', color:'#fff', background:(exportBusy || !exportPicked.size) ? '#B9AE9B' : 'var(--pri)', border:'none', borderRadius:11, cursor:(exportBusy || !exportPicked.size)?'default':'pointer' }}>
                {exportBusy === 'building' ? 'Preparing…' : `Export ${pickedCount || ''} item${pickedCount === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ height:4, background:'var(--pri)' }} />
      <header style={{ position:'sticky', top:0, zIndex:20, background:'rgba(255,252,245,.92)', backdropFilter:'blur(10px)', borderBottom:'1.5px solid #E9DFC9' }}>
        <div style={{ maxWidth:1500, margin:'0 auto', padding:'14px 20px', display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
          <img src="/assets/itland-logo.png" alt="iTLand" style={{ height:30, width:'auto' }} />
          <div style={{ flex:1 }} />
          <button onClick={openExport} title="Export the in-stock catalogue to Excel"
            style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'9px 14px', fontSize:14, fontWeight:700, fontFamily:'inherit', color:'#2B2419', background:'#fff', border:'1.5px solid #E9DFC9', borderRadius:12, cursor:'pointer' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span className="hide-xs">Export to Excel</span>
          </button>
          <button onClick={onAdminClick} title="Admin Panel" style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:38, height:38, padding:0, color:'#2B2419', background:'#fff', border:'1.5px solid #E9DFC9', borderRadius:12, cursor:'pointer' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
          <button onClick={onLogout} style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'9px 14px', fontSize:14, fontWeight:700, fontFamily:'inherit', color:'#2B2419', background:'#fff', border:'1.5px solid #E9DFC9', borderRadius:12, cursor:'pointer' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            <span className="hide-xs">{t.logout}</span>
          </button>
        </div>
        <div style={{ maxWidth:1500, margin:'0 auto', padding:'0 20px 14px' }}>
          <div style={{ position:'relative', maxWidth:560 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8B8071" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ position:'absolute', left:16, top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              ref={searchRef}
              className="inp" type="text" value={query}
              onChange={e => { setQuery(e.target.value); setVisible(PAGE); }}
              placeholder={t.searchPh}
              style={{ width:'100%', padding:'14px 44px 14px 48px', fontSize:16, fontFamily:'inherit', color:'#17130E', background:'#fff', border:'1.5px solid #E9DFC9', borderRadius:14, boxShadow:'0 1px 2px rgba(23,19,14,.05)' }}
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                // Keep the caret in the field: the button unmounts as soon as the
                // query is empty, so without this the focus would be lost to the
                // body and you would have to click back into the input to type.
                onMouseDown={e => e.preventDefault()}
                onClick={() => { setQuery(''); setVisible(PAGE); searchRef.current?.focus(); }}
                style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', display:'flex', alignItems:'center', justifyContent:'center', width:24, height:24, padding:0, background:'#D6CDBB', border:'none', borderRadius:'50%', cursor:'pointer', color:'#2B2419' }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            )}
          </div>
        </div>

        {/* Mobile category strip */}
        <div className="mobile-cats" style={{ borderTop:'1px solid #E9DFC9', overflowX:'auto', scrollbarWidth:'none' }}>
          <div style={{ padding:'8px 16px', display:'flex', gap:6 }}>
            <button onClick={() => selectCategory('')} style={{ flexShrink:0, padding:'5px 12px', fontSize:12.5, fontWeight:700, fontFamily:'inherit', borderRadius:999, border:'1.5px solid ' + (category===''?'#17130E':'#E9DFC9'), background:category===''?'#17130E':'#fff', color:category===''?'#fff':'#2B2419', cursor:'pointer', whiteSpace:'nowrap' }}>All</button>
            {CATEGORIES.map(cat => (
              <button key={cat.id} onClick={() => selectCategory(cat.id === category ? '' : cat.id)} style={{ flexShrink:0, padding:'5px 12px', fontSize:12.5, fontWeight:700, fontFamily:'inherit', borderRadius:999, border:'1.5px solid ' + (category===cat.id?'#17130E':'#E9DFC9'), background:category===cat.id?'#17130E':'#fff', color:category===cat.id?'#fff':'#2B2419', cursor:'pointer', whiteSpace:'nowrap' }}>{cat.label}</button>
            ))}
          </div>
        </div>

        {/* Brand filter bar */}
        <div style={{ borderTop:'1px solid #E9DFC9', overflowX:'auto', scrollbarWidth:'none' }}>
          <div style={{ maxWidth:1500, margin:'0 auto', padding:'10px 20px', display:'flex', gap:8, alignItems:'center' }}>
            <button onClick={() => selectBrand('')} style={{ flexShrink:0, padding:'6px 14px', fontSize:13, fontWeight:700, fontFamily:'inherit', borderRadius:999, border:'1.5px solid ' + (brand===''?'#17130E':'#E9DFC9'), background:brand===''?'#17130E':'#fff', color:brand===''?'#fff':'#2B2419', cursor:'pointer', whiteSpace:'nowrap', transition:'all .12s' }}>All</button>
            {brands.map(b => (
              <button key={b} onClick={() => selectBrand(b === brand ? '' : b)} style={{ flexShrink:0, padding:'6px 14px', fontSize:13, fontWeight:700, fontFamily:'inherit', borderRadius:999, border:'1.5px solid ' + (brand===b?'#17130E':'#E9DFC9'), background:brand===b?'#17130E':'#fff', color:brand===b?'#fff':'#2B2419', cursor:'pointer', whiteSpace:'nowrap', transition:'all .12s' }}>{b}</button>
            ))}
          </div>
        </div>
      </header>

      {/* Body: sidebar + content */}
      <div style={{ maxWidth:1500, margin:'0 auto', display:'flex', alignItems:'flex-start' }}>

        {/* Category sidebar */}
        <aside className="cat-sidebar" style={{ width:185, flexShrink:0, borderRight:'1.5px solid #E9DFC9', padding:'22px 0 80px', position:'sticky', top:177, maxHeight:'calc(100vh - 177px)', overflowY:'auto', scrollbarWidth:'none' }}>
          <div style={{ padding:'0 14px' }}>
            <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:'.12em', textTransform:'uppercase', color:'#8B8071', marginBottom:10, paddingLeft:4 }}>Categories</div>
            {catBtn('', 'All', preFiltered.length)}
            <div style={{ height:1, background:'#E9DFC9', margin:'8px 0' }} />
            {CATEGORIES.map(cat => catBtn(cat.id, cat.label, categoryCounts[cat.id] || 0))}
          </div>
        </aside>

        {/* Main content */}
        <div style={{ flex:1, padding:'20px 20px 80px', minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:16, flexWrap:'wrap', marginBottom:18 }}>
            <button onClick={() => { setInStockOnly(!on); setVisible(PAGE); }} style={{ display:'inline-flex', alignItems:'center', gap:10, padding:'7px 12px 7px 8px', background:'transparent', border:'none', cursor:'pointer', fontFamily:'inherit' }}>
              <span style={{ display:'inline-flex', alignItems:'center', width:42, height:25, padding:2, borderRadius:999, background:on?'var(--pri)':'#D6CDBB', justifyContent:on?'flex-end':'flex-start', transition:'background .15s ease', border:'1.5px solid ' + (on?'#17130E':'#C7BDAA') }}>
                <span style={{ width:19, height:19, borderRadius:'50%', background:'#fff', boxShadow:'0 1px 2px rgba(0,0,0,.25)' }} />
              </span>
              <span style={{ fontSize:14.5, fontWeight:700, color:'#2B2419' }}>{t.inStockOnly}</span>
            </button>
            <div style={{ fontSize:13, fontFamily:"'Space Mono',ui-monospace,monospace", color:'#8B8071' }}>
              {loading ? '…' : all.length.toLocaleString() + ' ' + t.items}
            </div>
          </div>

          {all.length > 0 ? (
            <>
              <div className="catalog-grid">
                {vis.map(it => (
                  <div key={it.id} className="card" onClick={() => onOpen(it)} style={{ background:'#fff', border:'1.5px solid #E9DFC9', borderRadius:16, padding:0, cursor:'pointer', display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'0 1px 2px rgba(23,19,14,.06)' }}>
                    {it.img ? (
                      <div className="card-img" style={{ height:130, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', background:'#fff', borderRadius:10, margin:'var(--cardpad)', marginBottom:0, overflow:'hidden' }}>
                        <img src={it.img} alt={it.n} loading="lazy" decoding="async" width="200" height="130" style={{ maxHeight:'100%', maxWidth:'100%', objectFit:'contain' }} />
                      </div>
                    ) : (
                      <div className="card-img card-img-empty" style={{ height:90, flexShrink:0, alignItems:'center', justifyContent:'center', background:'#fff', display:'none' }}>
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#D6CDBB" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                      </div>
                    )}
                    <div className="card-content" style={{ padding:'var(--cardpad)', display:'flex', flexDirection:'column', gap:8, flex:1 }}>
                      <div className="card-top" style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:8, minHeight:24 }}>
                        <span className="card-barcode" style={{ fontSize:11, fontFamily:"'Space Mono',ui-monospace,monospace", color:'#8B8071', letterSpacing:'.02em', paddingTop:2 }}>
                          {it.barcode ? `${t.code}: ${it.barcode}` : ''}
                        </span>
                        <StockBadge inStock={it.k} t={t} />
                      </div>
                      <div className="card-name" style={{ fontSize:16, fontWeight:800, lineHeight:1.35, color:'#17130E' }}>
                        {it.n}
                      </div>
                      <div className="card-price-row" style={{ marginTop:'auto', paddingTop:8, borderTop:'1px dashed #E9DFC9', display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:8 }}>
                        <span className="card-price-label" style={{ fontSize:11, fontWeight:700, letterSpacing:'.1em', textTransform:'uppercase', color:'#8B8071' }}>{t.wholesalePrice}</span>
                        <span className="card-price-val" dir="ltr" style={{ fontSize:it.p==null?13:20, fontWeight:800, fontFamily:"'Space Mono',ui-monospace,monospace", color:it.p==null?'#DE3A1E':'var(--pri)' }}>{priceLabel(it, t)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {hasMore && (
                <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:10, marginTop:30 }}>
                  <button className="btn-press" onClick={() => setVisible(visible + PAGE)} style={{ padding:'12px 26px', fontSize:15, fontWeight:800, fontFamily:'inherit', color:'#17130E', background:'#fff', border:'2px solid #17130E', borderRadius:14, boxShadow:'3px 3px 0 #17130E', cursor:'pointer' }}>{t.loadMore}</button>
                  <div style={{ fontSize:12.5, fontFamily:"'Space Mono',ui-monospace,monospace", color:'#8B8071' }}>{t.showing.replace('{b}', vis.length).replace('{n}', all.length.toLocaleString())}</div>
                </div>
              )}
            </>
          ) : (
            <div style={{ textAlign:'center', padding:'70px 20px' }}>
              <div style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', width:64, height:64, borderRadius:18, background:'#F3ECDB', border:'1.5px solid #E9DFC9', marginBottom:18 }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#8B8071" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              </div>
              <h2 style={{ margin:'0 0 8px', fontSize:20, fontWeight:800 }}>{t.noItemsTitle}</h2>
              <p style={{ margin:'0 0 20px', fontSize:14.5, color:'#8B8071', maxWidth:340, marginInline:'auto', lineHeight:1.55 }}>{t.noItemsBody}</p>
              <button className="btn-press" onClick={() => { setQuery(''); setInStockOnly(false); setVisible(PAGE); setBrand(''); setCategory(''); }} style={{ padding:'11px 22px', fontSize:14.5, fontWeight:800, fontFamily:'inherit', color:'#fff', background:'var(--acc)', border:'2px solid #17130E', borderRadius:14, boxShadow:'3px 3px 0 #17130E', cursor:'pointer' }}>{t.clearFilters}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
