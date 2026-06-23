import React, { useState, useEffect, useRef } from 'react';

async function aapi(path, opts = {}) {
  return fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
}

function EditModal({ item, images, onClose, onSaved }) {
  const [name, setName] = useState(item.n || '');
  const [price, setPrice] = useState(item.p != null ? String(item.p) : '');
  const [img, setImg] = useState(item.img || '');
  const [showGallery, setShowGallery] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef();

  const save = async () => {
    setSaving(true);
    const payload = {
      itemId: item.id,
      n: name !== item.n ? name : undefined,
      p: price === '' ? (item.p != null ? null : undefined) : (Number(price) !== item.p ? Number(price) : undefined),
      img: (img || null) !== (item.img || null) ? (img || null) : undefined,
    };
    await aapi('/api/admin/override', { method: 'POST', body: JSON.stringify(payload) });
    onSaved({ ...item, n: name, p: price === '' ? null : Number(price), img: img || null });
    setSaving(false);
  };

  const reset = async () => {
    await aapi('/api/admin/override', { method: 'POST', body: JSON.stringify({ itemId: item.id, n: null, p: null, img: null }) });
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
      if (data.img) { setImg(data.img); setShowGallery(false); }
      setUploading(false);
    };
    reader.readAsDataURL(file);
  };

  const btnStyle = (active) => ({
    padding: '8px 14px', fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
    background: active ? '#17130E' : '#fff', color: active ? '#fff' : '#2B2419',
    border: '1.5px solid ' + (active ? '#17130E' : '#E9DFC9'), borderRadius: 10, cursor: 'pointer',
  });

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(23,19,14,.55)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
      <div style={{ background: '#fff', border: '2px solid #17130E', borderRadius: 20, boxShadow: '6px 6px 0 #17130E', width: '100%', maxWidth: 540, maxHeight: '92vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>

        <div style={{ padding: '18px 22px 14px', borderBottom: '1.5px solid #E9DFC9', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: '#8B8071', marginBottom: 3 }}>Editing</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#17130E', lineHeight: 1.3 }}>{item.n}</div>
          </div>
          <button onClick={onClose} style={{ padding: 7, background: 'transparent', border: '1.5px solid #E9DFC9', borderRadius: 9, cursor: 'pointer', display: 'flex' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2B2419" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div style={{ padding: '20px 22px 22px', display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* Image */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: '#8B8071', marginBottom: 10 }}>Image</div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ width: 96, height: 96, background: '#F9F5EE', borderRadius: 12, border: '1.5px solid #E9DFC9', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                {img
                  ? <img src={img} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                  : <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#D6CDBB" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                }
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <button style={btnStyle(showGallery)} onClick={() => setShowGallery(g => !g)}>
                  {showGallery ? 'Close Gallery' : 'Pick from Gallery'}
                </button>
                <button style={btnStyle(false)} onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? 'Uploading…' : 'Upload Image'}
                </button>
                {img && <button style={{ ...btnStyle(false), color: '#DE3A1E', borderColor: '#F9C5BB' }} onClick={() => setImg('')}>Remove Image</button>}
                <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleUpload} />
              </div>
            </div>

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

          {/* Name */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: '#8B8071', marginBottom: 8 }}>Name</label>
            <input value={name} onChange={e => setName(e.target.value)}
              style={{ width: '100%', padding: '11px 13px', fontSize: 14, fontFamily: 'inherit', color: '#17130E', background: '#fff', border: '1.5px solid #E9DFC9', borderRadius: 11, boxSizing: 'border-box' }} />
          </div>

          {/* Price */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: '#8B8071', marginBottom: 8 }}>Wholesale Price ($)</label>
            <input type="number" value={price} onChange={e => setPrice(e.target.value)} min="0" step="0.01"
              style={{ width: '100%', padding: '11px 13px', fontSize: 14, fontFamily: 'inherit', color: '#17130E', background: '#fff', border: '1.5px solid #E9DFC9', borderRadius: 11, boxSizing: 'border-box' }} />
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, paddingTop: 2 }}>
            <button onClick={reset} style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', color: '#8B8071', background: '#fff', border: '1.5px solid #E9DFC9', borderRadius: 11, cursor: 'pointer' }}>Reset to original</button>
            <div style={{ flex: 1 }} />
            <button onClick={onClose} style={{ padding: '10px 16px', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', color: '#2B2419', background: '#fff', border: '1.5px solid #E9DFC9', borderRadius: 11, cursor: 'pointer' }}>Cancel</button>
            <button onClick={save} disabled={saving} style={{ padding: '10px 20px', fontSize: 13, fontWeight: 800, fontFamily: 'inherit', color: '#fff', background: 'var(--pri)', border: '2px solid #17130E', borderRadius: 11, boxShadow: '3px 3px 0 #17130E', cursor: 'pointer' }}>
              {saving ? '…' : 'Save'}
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
          <input type="password" value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && login()} className="inp"
            style={{ width: '100%', padding: '12px 13px', fontSize: 15, fontFamily: 'inherit', color: '#17130E', background: '#fff', border: '1.5px solid #E9DFC9', borderRadius: 11, marginBottom: 8, boxSizing: 'border-box' }} />

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
                <div style={{ height: 110, background: '#F9F5EE', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {it.img
                    ? <img src={it.img} alt={it.n} style={{ maxHeight: 98, maxWidth: '100%', objectFit: 'contain' }} />
                    : <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#D6CDBB" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                  }
                </div>
                <div style={{ padding: '10px 12px 12px', flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <div style={{ fontSize: 10.5, fontFamily: "'Space Mono',monospace", color: '#8B8071' }}>{it.barcode || it.s || '—'}</div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: '#17130E', lineHeight: 1.35, flex: 1 }}>{it.n}</div>
                  <div style={{ fontSize: 12.5, color: it.p != null ? 'var(--pri)' : '#8B8071', fontWeight: 700, fontFamily: "'Space Mono',monospace" }}>
                    {it.p != null ? `$${it.p}` : 'No price'}
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
