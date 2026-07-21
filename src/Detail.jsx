import React from 'react';
import { StockBadge, priceLabel } from './components.jsx';

export default function Detail({ t, item, onBack }) {
  const stockColor = item.k ? '#1F9D57' : '#DE3A1E';
  return (
    <div>
      <div style={{ height:4, background:'var(--pri)' }} />
      <header style={{ position:'sticky', top:0, zIndex:20, background:'rgba(255,252,245,.92)', backdropFilter:'blur(10px)', borderBottom:'1.5px solid #E9DFC9' }}>
        <div style={{ maxWidth:900, margin:'0 auto', padding:'14px 20px', display:'flex', alignItems:'center', gap:16 }}>
          <img src="/assets/itland-logo.png" alt="iTLand" style={{ height:30, width:'auto' }} />
          <div style={{ flex:1 }} />
        </div>
      </header>

      <main className="detail-wrap" style={{ maxWidth:900, margin:'0 auto', padding:'22px 20px 80px' }}>
        <button onClick={onBack} style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'9px 15px', marginBottom:20, fontSize:14, fontWeight:700, fontFamily:'inherit', color:'#2B2419', background:'#fff', border:'1.5px solid #E9DFC9', borderRadius:12, cursor:'pointer' }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          <span>{t.back}</span>
        </button>

        <div style={{ background:'#fff', border:'2px solid #17130E', borderRadius:22, boxShadow:'6px 6px 0 #17130E', overflow:'hidden' }}>
          <div style={{ height:8, background:'var(--pri)' }} />
          <div className="detail-card" style={{ padding:'30px 30px 34px' }}>
            {item.img && (
              <div className="detail-img" style={{ display:'flex', justifyContent:'center', alignItems:'center', background:'#F9F5EE', borderRadius:14, padding:'24px', marginBottom:28, minHeight:220 }}>
                <img src={item.img} alt={item.n} style={{ maxHeight:260, maxWidth:'100%', objectFit:'contain' }} />
              </div>
            )}
            <div style={{ display:'flex', flexWrap:'wrap', alignItems:'center', gap:10, marginBottom:16 }}>
              <StockBadge inStock={item.k} t={t} />
            </div>
            <h1 className="detail-title" style={{ margin:'0 0 8px', fontSize:30, lineHeight:1.2, fontWeight:800 }}>{item.n}</h1>
            <div dir="ltr" style={{ fontSize:13, fontFamily:"'Space Mono',ui-monospace,monospace", color:'#8B8071', marginBottom:24, display:'flex', gap:16, flexWrap:'wrap' }}>
              {item.barcode && <span>{t.code}: {item.barcode}</span>}
              {item.sku && <span>SKU: {item.sku}</span>}
            </div>

            <div style={{ display:'flex', flexWrap:'wrap', gap:'14px 40px', padding:'20px 0', borderTop:'1.5px dashed #E9DFC9', borderBottom:'1.5px dashed #E9DFC9' }}>
              <div>
                <div style={{ fontSize:11, fontWeight:700, letterSpacing:'.1em', textTransform:'uppercase', color:'#8B8071', marginBottom:6 }}>{t.wholesalePrice}</div>
                <div className="detail-price" dir="ltr" style={{ fontSize:38, fontWeight:800, fontFamily:"'Space Mono',ui-monospace,monospace", color:'var(--pri)', lineHeight:1 }}>{priceLabel(item, t)}</div>
              </div>
              {item.retail != null && (
                <div>
                  <div style={{ fontSize:11, fontWeight:700, letterSpacing:'.1em', textTransform:'uppercase', color:'#8B8071', marginBottom:6 }}>{t.retailPrice}</div>
                  <div dir="ltr" style={{ fontSize:24, fontWeight:700, color:'#17130E' }}>${item.retail}</div>
                </div>
              )}
              <div>
                <div style={{ fontSize:11, fontWeight:700, letterSpacing:'.1em', textTransform:'uppercase', color:'#8B8071', marginBottom:6 }}>{t.availability}</div>
                <div style={{ fontSize:18, fontWeight:700, color:stockColor }}>
                  {item.k ? t.inStock : t.outOfStock}
                  {item.k && <span style={{ color:'#8B8071', fontWeight:600, fontSize:14 }}> ({item.stock})</span>}
                </div>
              </div>
            </div>

            {item.d && (
              <div style={{ marginTop:24 }}>
                <div style={{ fontSize:11, fontWeight:700, letterSpacing:'.1em', textTransform:'uppercase', color:'#8B8071', marginBottom:8 }}>{t.description}</div>
                <p style={{ margin:0, fontSize:15, lineHeight:1.65, color:'#2B2419' }}>{item.d}</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
