import React, { useMemo, useState } from 'react';
import { StockBadge, priceLabel } from './components.jsx';
import { PAGE } from './i18n.js';

function extractBrand(name) {
  return (name || '').split(' ')[0] || '';
}

export default function Catalog({
  t, items, loading,
  query, setQuery, inStockOnly, setInStockOnly,
  visible, setVisible, onLogout, onOpen,
}) {
  const [brand, setBrand] = useState('');

  const brands = ['Logitech', 'Anker', 'Onten', 'Lention', 'Poly', 'Jabra', 'JBL'];

  const all = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(it => {
      if (brand && extractBrand(it.n).toLowerCase() !== brand.toLowerCase()) return false;
      if (inStockOnly && !it.k) return false;
      if (q && it.n.toLowerCase().indexOf(q) < 0 && (it.s || '').toLowerCase().indexOf(q) < 0 && (it.barcode || '').toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }, [items, query, inStockOnly, brand]);

  const vis = all.slice(0, visible);
  const hasMore = vis.length < all.length;
  const on = inStockOnly;

  const selectBrand = (b) => { setBrand(b); setVisible(PAGE); };

  return (
    <div>
      <div style={{ height:4, background:'var(--pri)' }} />
      <header style={{ position:'sticky', top:0, zIndex:20, background:'rgba(255,252,245,.92)', backdropFilter:'blur(10px)', borderBottom:'1.5px solid #E9DFC9' }}>
        <div style={{ maxWidth:1200, margin:'0 auto', padding:'14px 20px', display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
          <img src="/assets/itland-logo.png" alt="iTLand" style={{ height:30, width:'auto' }} />
          <div style={{ flex:1 }} />
          <button onClick={onLogout} style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'9px 14px', fontSize:14, fontWeight:700, fontFamily:'inherit', color:'#2B2419', background:'#fff', border:'1.5px solid #E9DFC9', borderRadius:12, cursor:'pointer' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            <span>{t.logout}</span>
          </button>
        </div>
        <div style={{ maxWidth:1200, margin:'0 auto', padding:'0 20px 14px' }}>
          <div style={{ position:'relative', maxWidth:560 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8B8071" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ position:'absolute', left:16, top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              className="inp" type="text" value={query}
              onChange={e => { setQuery(e.target.value); setVisible(PAGE); }}
              placeholder={t.searchPh}
              style={{ width:'100%', padding:'14px 16px 14px 48px', fontSize:16, fontFamily:'inherit', color:'#17130E', background:'#fff', border:'1.5px solid #E9DFC9', borderRadius:14, boxShadow:'0 1px 2px rgba(23,19,14,.05)' }}
            />
          </div>
        </div>

        {/* Brand filter bar */}
        <div style={{ borderTop:'1px solid #E9DFC9', overflowX:'auto', scrollbarWidth:'none' }}>
          <div style={{ maxWidth:1200, margin:'0 auto', padding:'10px 20px', display:'flex', gap:8, alignItems:'center' }}>
            <button
              onClick={() => selectBrand('')}
              style={{ flexShrink:0, padding:'6px 14px', fontSize:13, fontWeight:700, fontFamily:'inherit', borderRadius:999, border:'1.5px solid ' + (brand===''?'#17130E':'#E9DFC9'), background:brand===''?'#17130E':'#fff', color:brand===''?'#fff':'#2B2419', cursor:'pointer', whiteSpace:'nowrap', transition:'all .12s' }}
            >All</button>
            {brands.map(b => (
              <button
                key={b}
                onClick={() => selectBrand(b === brand ? '' : b)}
                style={{ flexShrink:0, padding:'6px 14px', fontSize:13, fontWeight:700, fontFamily:'inherit', borderRadius:999, border:'1.5px solid ' + (brand===b?'#17130E':'#E9DFC9'), background:brand===b?'#17130E':'#fff', color:brand===b?'#fff':'#2B2419', cursor:'pointer', whiteSpace:'nowrap', transition:'all .12s' }}
              >{b}</button>
            ))}
          </div>
        </div>
      </header>

      <main style={{ maxWidth:1200, margin:'0 auto', padding:'20px 20px 80px' }}>
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
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(var(--cardmin), 1fr))', gap:16 }}>
              {vis.map(it => (
                <div key={it.id} className="card" onClick={() => onOpen(it)} style={{ background:'#fff', border:'1.5px solid #E9DFC9', borderRadius:16, padding:'var(--cardpad)', cursor:'pointer', display:'flex', flexDirection:'column', gap:10, boxShadow:'0 1px 2px rgba(23,19,14,.06)' }}>
                  <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:8, minHeight:24 }}>
                    <span style={{ fontSize:11, fontFamily:"'Space Mono',ui-monospace,monospace", color:'#8B8071', letterSpacing:'.02em', paddingTop:2 }}>{it.barcode}</span>
                    <StockBadge inStock={it.k} t={t} />
                  </div>
                  <div style={{ fontSize:16, fontWeight:700, lineHeight:1.35, color:'#17130E' }}>{it.n}</div>
                  <div style={{ marginTop:'auto', paddingTop:8, borderTop:'1px dashed #E9DFC9', display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:8 }}>
                    <span style={{ fontSize:11, fontWeight:700, letterSpacing:'.1em', textTransform:'uppercase', color:'#8B8071' }}>{t.wholesalePrice}</span>
                    <span dir="ltr" style={{ fontSize:it.p==null?13:22, fontWeight:800, fontFamily:"'Space Mono',ui-monospace,monospace", color:'#17130E' }}>{priceLabel(it, t)}</span>
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
            <button className="btn-press" onClick={() => { setQuery(''); setInStockOnly(false); setVisible(PAGE); setBrand(''); }} style={{ padding:'11px 22px', fontSize:14.5, fontWeight:800, fontFamily:'inherit', color:'#fff', background:'var(--acc)', border:'2px solid #17130E', borderRadius:14, boxShadow:'3px 3px 0 #17130E', cursor:'pointer' }}>{t.clearFilters}</button>
          </div>
        )}
      </main>
    </div>
  );
}
