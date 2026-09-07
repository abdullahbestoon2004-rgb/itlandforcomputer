import React, { useState, useEffect, useRef } from 'react';

async function aapi(path, opts = {}) {
  return fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
}

const CATEGORY_OPTIONS = [
  'Mouse',
  'Keyboard',
  'Headset',
  'Adapter / Hub',
  'Microphone',
  'Speakers',
  'Streaming',
  'Video Conference',
  'Accessories',
];

const BRAND_OPTIONS = [
  'Logitech',
  'Anker',
  'Onten',
  'Lention',
  'Poly',
  'Jabra',
  'JBL',
  'Elgato',
  'Samsung',
];

function EditModal({ item, images, onClose, onSaved }) {
  const [name, setName] = useState(item.n || item.name || '');
  const [wholesalePrice, setWholesalePrice] = useState(item.p != null ? String(item.p) : (item.wholesale_price != null ? String(item.wholesale_price) : ''));
  const [retailPrice, setRetailPrice] = useState(item.retail != null ? String(item.retail) : (item.price != null ? String(item.price) : ''));
  const [stock, setStock] = useState(item.stock != null ? String(item.stock) : (item.stock_on_hand != null ? String(item.stock_on_hand) : '0'));
  const [inStock, setInStock] = useState(item.k !== undefined ? Boolean(item.k) : (item.in_stock !== undefined ? Boolean(item.in_stock) : Number(item.stock) > 0));
  const [brand, setBrand] = useState(item.brand || '');
  const [category, setCategory] = useState(item.category || '');
  const [sku, setSku] = useState(item.sku || item.s || '');
  const [barcode, setBarcode] = useState(item.barcode || '');
  const [description, setDescription] = useState(item.d || item.description || '');
  const [img, setImg] = useState(item.img || '');

  const [showGallery, setShowGallery] = useState(false);
  const [showOnlineSearch, setShowOnlineSearch] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [onlineResults, setOnlineResults] = useState([]);
  const [searchingOnline, setSearchingOnline] = useState(false);
  const [attachingOnline, setAttachingOnline] = useState(false);
  const [searchQuery, setSearchQuery] = useState(item.n || item.name || '');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef();

  const handleStockChange = (val) => {
    setStock(val);
    const num = Number(val);
    if (!isNaN(num)) {
      setInStock(num > 0);
    }
  };

  const handleSearchOnline = async (overrideQuery) => {
    const q = (overrideQuery || searchQuery || name || item.n || item.sku || '').trim();
    if (!q) return;
    setSearchingOnline(true);
    setShowOnlineSearch(true);
    setShowGallery(false);
    setSearchError('');
    try {
      const res = await aapi(`/api/admin/search-images?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setOnlineResults(data.results || []);
      // Distinguish "searched fine, found nothing" from "could not search".
      // Previously every failure — blocked network, bad API key, expired admin
      // session — showed the same "No images found" message.
      if (!data.results?.length) setSearchError(data.error || '');
    } catch (err) {
      setSearchError(`Could not reach the server: ${err.message}`);
      setOnlineResults([]);
    } finally {
      setSearchingOnline(false);
    }
  };

  const handleAttachOnline = async (cand) => {
    setAttachingOnline(true);
    try {
      const brandClean = (brand || item.brand || name.split(' ')[0] || 'product').toLowerCase();
      const cleanName = (name || item.n || 'item').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
      const filename = `${brandClean}_${cleanName}_${Date.now().toString().slice(-4)}.jpg`;

      const res = await aapi('/api/admin/attach-online-image', {
        method: 'POST',
        body: JSON.stringify({
          itemId: item.id,
          imageUrl: cand.image,
          filename: filename,
        }),
      });
      const data = await res.json();
      if (data.ok && data.img) {
        setImg(data.img);
        setShowOnlineSearch(false);
      }
    } catch (err) {
      alert('Failed to attach image: ' + err.message);
    } finally {
      setAttachingOnline(false);
    }
  };

  const save = async () => {
    setSaving(true);
    const parsedP = wholesalePrice.trim() === '' ? null : parseFloat(wholesalePrice);
    const parsedRetail = retailPrice.trim() === '' ? null : parseFloat(retailPrice);
    const parsedStock = stock.trim() === '' ? 0 : parseInt(stock, 10);
    const payload = {
      itemId: item.id,
      n: name.trim(),
      p: isNaN(parsedP) ? null : parsedP,
      retail: isNaN(parsedRetail) ? null : parsedRetail,
      stock: isNaN(parsedStock) ? 0 : parsedStock,
      k: Boolean(inStock),
      brand: brand.trim(),
      category: category.trim(),
      sku: sku.trim(),
      barcode: barcode.trim(),
      d: description.trim(),
      img: img || null,
    };
    await aapi('/api/admin/override', { method: 'POST', body: JSON.stringify(payload) });
    onSaved({
      ...item,
      ...payload,
      s: payload.sku,
      price: payload.retail,
      wholesale_price: payload.p,
      stock_on_hand: payload.stock,
      in_stock: payload.k,
    });
    setSaving(false);
  };

  const reset = async () => {
    await aapi('/api/admin/override', { method: 'POST', body: JSON.stringify({ itemId: item.id, reset: true }) });
    onSaved(null);
  };

  const handleUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const res = await aapi('/api/admin/upload', {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, imageData: ev.target.result }),
      });
      const data = await res.json();
      if (data.img) { setImg(data.img); setShowGallery(false); setShowOnlineSearch(false); }
      setUploading(false);
    };
    reader.readAsDataURL(file);
  };

  const btnStyle = (active, primary) => ({
    padding: '8px 14px', fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
    background: primary ? 'var(--pri)' : (active ? '#17130E' : '#fff'),
    color: primary || active ? '#fff' : '#2B2419',
    border: '1.5px solid ' + (primary ? 'var(--pri)' : (active ? '#17130E' : '#E9DFC9')),
    borderRadius: 10, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
  });

  const labelStyle = {
    display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: '#8B8071', marginBottom: 6
  };

  const inputStyle = {
    width: '100%', padding: '10px 12px', fontSize: 14, fontFamily: 'inherit', color: '#17130E', background: '#fff', border: '1.5px solid #E9DFC9', borderRadius: 10, boxSizing: 'border-box'
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(23,19,14,.55)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
      <div style={{ background: '#fff', border: '2px solid #17130E', borderRadius: 20, boxShadow: '6px 6px 0 #17130E', width: '100%', maxWidth: 620, maxHeight: '92vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>

        <div style={{ padding: '18px 22px 14px', borderBottom: '1.5px solid #E9DFC9', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: '#8B8071', marginBottom: 3 }}>Editing Product</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#17130E', lineHeight: 1.3 }}>{item.n || item.name}</div>
          </div>
          <button onClick={onClose} style={{ padding: 7, background: 'transparent', border: '1.5px solid #E9DFC9', borderRadius: 9, cursor: 'pointer', display: 'flex' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2B2419" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div style={{ padding: '20px 22px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Pricing & Stock section */}
          <div style={{ background: '#FAF7F0', padding: 14, borderRadius: 14, border: '1.5px solid #E9DFC9' }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--pri)', marginBottom: 12 }}>
              Pricing & Inventory
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={labelStyle}>Wholesale Price ($)</label>
                <input type="number" value={wholesalePrice} onChange={e => setWholesalePrice(e.target.value)} min="0" step="0.01" placeholder="e.g. 79.99" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Retail Price ($)</label>
                <input type="number" value={retailPrice} onChange={e => setRetailPrice(e.target.value)} min="0" step="0.01" placeholder="e.g. 99.99" style={inputStyle} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'center' }}>
              <div>
                <label style={labelStyle}>Stock Quantity (Units)</label>
                <input type="number" value={stock} onChange={e => handleStockChange(e.target.value)} min="0" step="1" style={inputStyle} />
              </div>
              <div style={{ paddingTop: 18 }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
                  <input
                    type="checkbox"
                    checked={inStock}
                    onChange={e => setInStock(e.target.checked)}
                    style={{ width: 18, height: 18, accentColor: 'var(--pri)', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: inStock ? '#1F9D57' : '#DE3A1E' }}>
                    {inStock ? '✓ Mark In Stock' : '✗ Mark Out of Stock'}
                  </span>
                </label>
              </div>
            </div>
          </div>

          {/* Product details */}
          <div>
            <label style={labelStyle}>Product Name</label>
            <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Brand</label>
              <input list="brand-list" value={brand} onChange={e => setBrand(e.target.value)} placeholder="e.g. Logitech" style={inputStyle} />
              <datalist id="brand-list">
                {BRAND_OPTIONS.map(b => <option key={b} value={b} />)}
              </datalist>
            </div>
            <div>
              <label style={labelStyle}>Category</label>
              <input list="cat-list" value={category} onChange={e => setCategory(e.target.value)} placeholder="e.g. Mouse" style={inputStyle} />
              <datalist id="cat-list">
                {CATEGORY_OPTIONS.map(c => <option key={c} value={c} />)}
              </datalist>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>SKU</label>
              <input value={sku} onChange={e => setSku(e.target.value)} placeholder="e.g. 910-006557" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Barcode / Item Code</label>
              <input value={barcode} onChange={e => setBarcode(e.target.value)} placeholder="e.g. 097855174574" style={inputStyle} />
            </div>
          </div>

          <div>
            <label style={labelStyle}>Description / Specs</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              style={{ ...inputStyle, resize: 'vertical' }}
              placeholder="Product description..."
            />
          </div>

          {/* Image */}
          <div>
            <label style={labelStyle}>Product Image</label>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ width: 88, height: 88, background: '#fff', borderRadius: 12, border: '1.5px solid #E9DFC9', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                {img
                  ? <img src={img} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                  : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#D6CDBB" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                }
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, flex: 1, minWidth: 200 }}>
                <button style={btnStyle(showOnlineSearch, true)} onClick={() => { if (!showOnlineSearch) handleSearchOnline(); setShowOnlineSearch(s => !s); }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  {showOnlineSearch ? 'Hide Online Finder' : '🔍 Auto-Find Online'}
                </button>
                <button style={btnStyle(showGallery, false)} onClick={() => { setShowGallery(g => !g); setShowOnlineSearch(false); }}>
                  {showGallery ? 'Close Gallery' : 'Pick from Gallery'}
                </button>
                <button style={btnStyle(false, false)} onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? 'Uploading…' : 'Upload Image'}
                </button>
                {img && <button style={{ ...btnStyle(false, false), color: '#DE3A1E', borderColor: '#F9C5BB' }} onClick={() => setImg('')}>Remove Image</button>}
                <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleUpload} />
              </div>
            </div>

            {/* Online Image Search Box */}
            {showOnlineSearch && (
              <div style={{ marginTop: 12, padding: 12, background: '#F9F5EE', borderRadius: 14, border: '1.5px solid #E9DFC9' }}>
                <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                  <input
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search product image online…"
                    onKeyDown={e => e.key === 'Enter' && handleSearchOnline()}
                    style={{ flex: 1, padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', border: '1.5px solid #E9DFC9', borderRadius: 8 }}
                  />
                  <button onClick={() => handleSearchOnline()} disabled={searchingOnline}
                    style={{ padding: '8px 12px', fontSize: 12.5, fontWeight: 700, background: '#17130E', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
                    {searchingOnline ? '…' : 'Search'}
                  </button>
                </div>

                {searchingOnline ? (
                  <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 13, color: '#8B8071' }}>Searching online for photos…</div>
                ) : attachingOnline ? (
                  <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 13, color: 'var(--pri)', fontWeight: 700 }}>Downloading & saving image…</div>
                ) : onlineResults.length > 0 ? (
                  <div style={{ maxHeight: 220, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))', gap: 8 }}>
                    {onlineResults.map((cand, idx) => (
                      <div key={idx} onClick={() => handleAttachOnline(cand)} title={cand.title}
                        style={{ height: 88, background: '#fff', borderRadius: 8, border: '1.5px solid #E9DFC9', cursor: 'pointer', overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 4, transition: 'border-color .15s' }}>
                        <img src={cand.thumbnail || cand.image} alt={cand.title} style={{ maxHeight: '78%', maxWidth: '100%', objectFit: 'contain' }} />
                        <div style={{ fontSize: 9, color: '#8B8071', marginTop: 2 }}>{cand.width}x{cand.height}</div>
                      </div>
                    ))}
                  </div>
                ) : searchError ? (
                  <div style={{ padding: '14px 12px', fontSize: 12.5, lineHeight: 1.5, color: '#8A2B18', background: '#FDEDE9', border: '1.5px solid #F9C5BB', borderRadius: 10 }}>
                    <strong style={{ display: 'block', marginBottom: 3 }}>Image search unavailable</strong>
                    {searchError}
                  </div>
                ) : (
                  <div style={{ padding: '16px 0', textAlign: 'center', fontSize: 13, color: '#8B8071' }}>No images found. Try editing the search box above.</div>
                )}
              </div>
            )}

            {showGallery && (
              <div style={{ marginTop: 12, maxHeight: 210, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(68px, 1fr))', gap: 7, padding: 10, background: '#F9F5EE', borderRadius: 12, border: '1.5px solid #E9DFC9' }}>
                {images.map(src => (
                  <div key={src} onClick={() => { setImg(src); setShowGallery(false); }}
                    style={{ height: 68, background: img === src ? '#E9DFC9' : '#fff', borderRadius: 8, border: '2px solid ' + (img === src ? '#17130E' : '#E9DFC9'), cursor: 'pointer', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 3 }}>
                    <img src={src} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, paddingTop: 6, borderTop: '1.5px solid #E9DFC9' }}>
            <button onClick={reset} style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', color: '#8B8071', background: '#fff', border: '1.5px solid #E9DFC9', borderRadius: 11, cursor: 'pointer' }}>Reset to original</button>
            <div style={{ flex: 1 }} />
            <button onClick={onClose} style={{ padding: '10px 16px', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', color: '#2B2419', background: '#fff', border: '1.5px solid #E9DFC9', borderRadius: 11, cursor: 'pointer' }}>Cancel</button>
            <button onClick={save} disabled={saving} style={{ padding: '10px 22px', fontSize: 13, fontWeight: 800, fontFamily: 'inherit', color: '#fff', background: 'var(--pri)', border: '2px solid #17130E', borderRadius: 11, boxShadow: '3px 3px 0 #17130E', cursor: 'pointer' }}>
              {saving ? '…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AdminLogin({ onSuccess, onBack }) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const login = async () => {
    if (!user.trim() || !pass.trim()) { setError(true); return; }
    setLoading(true);
    const res = await aapi('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: user, password: pass }) });
    setLoading(false);
    if (res.ok) { setError(false); onSuccess(); }
    else setError(true);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 4, background: 'var(--pri)' }} />
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 20px 64px' }}>
        <div style={{ width: '100%', maxWidth: 400, background: '#fff', border: '2px solid #17130E', borderRadius: 22, boxShadow: '6px 6px 0 #17130E', padding: '32px 28px' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 22 }}>
            <div style={{ width: 52, height: 52, background: '#F9F5EE', border: '2px solid #17130E', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#17130E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/><circle cx="18" cy="18" r="3"/><line x1="21" y1="21" x2="19.5" y2="19.5"/></svg>
            </div>
          </div>
          <h1 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 800, textAlign: 'center' }}>Admin Access</h1>
          <p style={{ margin: '0 0 24px', fontSize: 13, color: '#8B8071', textAlign: 'center' }}>Sign in with your admin credentials</p>

          <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#2B2419', marginBottom: 6 }}>Username</label>
          <input type="text" value={user} onChange={e => setUser(e.target.value)} className="inp" dir="ltr"
            style={{ width: '100%', padding: '12px 13px', fontSize: 15, fontFamily: 'inherit', color: '#17130E', background: '#fff', border: '1.5px solid #E9DFC9', borderRadius: 11, marginBottom: 14, boxSizing: 'border-box' }} />

          <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#2B2419', marginBottom: 6 }}>Password</label>
          <div style={{ position: 'relative', width: '100%', marginBottom: 8 }}>
            <input type={showPassword ? 'text' : 'password'} value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && login()} className="inp"
              style={{ width: '100%', padding: '12px 42px 12px 13px', fontSize: 15, fontFamily: 'inherit', color: '#17130E', background: '#fff', border: '1.5px solid #E9DFC9', borderRadius: 11, boxSizing: 'border-box' }} />
            <button
              type="button"
              onClick={() => setShowPassword(v => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              style={{
                position: 'absolute',
                right: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#776E62',
                borderRadius: 6,
                transition: 'color 0.15s ease'
              }}
              onMouseEnter={e => e.currentTarget.style.color = '#17130E'}
              onMouseLeave={e => e.currentTarget.style.color = '#776E62'}
            >
              {showPassword ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                  <line x1="1" y1="23" x2="23" y2="1"/>
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              )}
            </button>
          </div>

          {error && <div style={{ fontSize: 13, color: '#DE3A1E', fontWeight: 600, margin: '2px 0 10px' }}>Invalid admin credentials.</div>}

          <button onClick={login} className="btn-press"
            style={{ width: '100%', marginTop: 10, padding: 13, fontSize: 15, fontWeight: 800, fontFamily: 'inherit', color: '#fff', background: 'var(--pri)', border: '2px solid #17130E', borderRadius: 13, boxShadow: '3px 3px 0 #17130E', cursor: 'pointer' }}>
            {loading ? '…' : 'Sign in as Admin'}
          </button>

          <button onClick={onBack}
            style={{ width: '100%', marginTop: 10, padding: 12, fontSize: 14, fontWeight: 700, fontFamily: 'inherit', color: '#2B2419', background: '#fff', border: '1.5px solid #E9DFC9', borderRadius: 13, cursor: 'pointer' }}>
            Back to Catalog
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Admin({ onBack }) {
  const [items, setItems] = useState([]);
  const [images, setImages] = useState([]);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [ir, imgr] = await Promise.all([aapi('/api/admin/items'), aapi('/api/admin/images')]);
    const id = await ir.json();
    const imgd = await imgr.json();
    setItems(id.items || []);
    setImages(imgd.images || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = items.filter(it => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (it.n || '').toLowerCase().includes(q) || (it.barcode || '').includes(q) || (it.s || '').includes(q);
  });

  const onSaved = (updated) => {
    if (updated === null) { load(); }
    else { setItems(prev => prev.map(it => it.id === updated.id ? { ...it, ...updated } : it)); }
    setEditing(null);
  };

  const logout = async () => {
    await aapi('/api/admin/logout', { method: 'POST' });
    onBack();
  };

  const hdrBtn = (onClick, children, danger) => (
    <button onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 14px', fontSize: 13.5, fontWeight: 700, fontFamily: 'inherit', color: danger ? '#DE3A1E' : '#2B2419', background: '#fff', border: '1.5px solid ' + (danger ? '#F9C5BB' : '#E9DFC9'), borderRadius: 12, cursor: 'pointer' }}>
      {children}
    </button>
  );

  return (
    <div>
      <div style={{ height: 4, background: 'var(--pri)' }} />
      <header style={{ position: 'sticky', top: 0, zIndex: 20, background: 'rgba(255,252,245,.92)', backdropFilter: 'blur(10px)', borderBottom: '1.5px solid #E9DFC9' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <img src="/assets/itland-logo.png" alt="iTLand" style={{ height: 30, width: 'auto' }} />
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--acc)' }}>Admin Panel</span>
          <div style={{ flex: 1 }} />
          {hdrBtn(onBack, <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>Back to Catalog</>)}
          {hdrBtn(logout, <>Sign out</>, true)}
        </div>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 20px 14px' }}>
          <div style={{ position: 'relative', maxWidth: 520 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8B8071" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input className="inp" type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search products…"
              style={{ width: '100%', padding: '12px 14px 12px 42px', fontSize: 14, fontFamily: 'inherit', color: '#17130E', background: '#fff', border: '1.5px solid #E9DFC9', borderRadius: 13 }} />
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 20px 80px' }}>
        <div style={{ fontSize: 13, color: '#8B8071', marginBottom: 16 }}>
          {loading ? '…' : `${filtered.length} products`}
        </div>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#8B8071' }}>Loading…</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
            {filtered.map(it => (
              <div key={it.id} style={{ background: '#fff', border: '1.5px solid #E9DFC9', borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 1px 2px rgba(23,19,14,.05)' }}>
                <div style={{ height: 110, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {it.img
                    ? <img src={it.img} alt={it.n} style={{ maxHeight: 98, maxWidth: '100%', objectFit: 'contain' }} />
                    : <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#D6CDBB" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                  }
                </div>
                <div style={{ padding: '12px 14px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 10.5, fontFamily: "'Space Mono',monospace", color: '#8B8071', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {it.barcode || it.s || '—'}
                    </span>
                    <span style={{
                      fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
                      background: it.k ? '#E6F7ED' : '#FDEBE8',
                      color: it.k ? '#1F9D57' : '#DE3A1E',
                      border: '1px solid ' + (it.k ? '#B2E5C7' : '#F9C5BB'),
                      whiteSpace: 'nowrap', flexShrink: 0
                    }}>
                      {it.k ? `In Stock (${it.stock ?? 0})` : 'Out of Stock'}
                    </span>
                  </div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: '#17130E', lineHeight: 1.35, flex: 1 }}>{it.n}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4, paddingTop: 6, borderTop: '1px dashed #E9DFC9' }}>
                    <div>
                      <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', color: '#8B8071', display: 'block' }}>Wholesale</span>
                      <span style={{ fontSize: 13.5, color: it.p != null ? 'var(--pri)' : '#DE3A1E', fontWeight: 800, fontFamily: "'Space Mono',monospace" }}>
                        {it.p != null ? `$${it.p}` : 'No price'}
                      </span>
                    </div>
                    {it.retail != null && (
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', color: '#8B8071', display: 'block' }}>Retail</span>
                        <span style={{ fontSize: 12, color: '#17130E', fontWeight: 700, fontFamily: "'Space Mono',monospace" }}>
                          ${it.retail}
                        </span>
                      </div>
                    )}
                  </div>
                  <button onClick={() => setEditing(it)}
                    style={{ marginTop: 6, padding: '7px 12px', fontSize: 12.5, fontWeight: 800, fontFamily: 'inherit', color: '#17130E', background: '#fff', border: '1.5px solid #17130E', borderRadius: 9, cursor: 'pointer' }}>
                    Edit
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {editing && (
        <EditModal
          item={editing}
          images={images}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}
