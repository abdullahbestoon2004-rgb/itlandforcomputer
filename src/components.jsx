import React from 'react';

export function StockBadge({ inStock, t }) {
  const color = inStock ? '#1F9D57' : '#DE3A1E';
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'4px 10px', fontSize:11.5, fontWeight:800, letterSpacing:'.01em', borderRadius:999, background:color, color:'#fff', whiteSpace:'nowrap' }}>
      {inStock ? t.inStock : t.outOfStock}
    </span>
  );
}

export function hasWholesalePrice(it) {
  if (!it) return false;
  const val = it.p !== undefined && it.p !== null ? it.p : it.wholesale_price;
  if (val == null || val === '') return false;
  const num = Number(val);
  return !isNaN(num) && num > 0;
}

export function priceLabel(it, t) {
  if (!hasWholesalePrice(it)) {
    return (t && t.noWholesale) ? t.noWholesale : 'Contact for the price';
  }
  const val = it.p !== undefined && it.p !== null ? it.p : it.wholesale_price;
  return '$' + Number(val);
}
