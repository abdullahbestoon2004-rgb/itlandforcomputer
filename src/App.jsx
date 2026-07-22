import React, { useState, useEffect, useCallback } from 'react';
import { T, PAGE } from './i18n.js';
import Login from './Login.jsx';
import Catalog from './Catalog.jsx';
import Detail from './Detail.jsx';
import Admin, { AdminLogin } from './Admin.jsx';

async function api(path, opts) {
  return fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
}

export default function App() {
  const [screen, setScreen] = useState('login');     // 'login' | 'catalog' | 'detail' | 'admin-login' | 'admin'
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const [items, setItems] = useState([]);
  const [query, setQuery] = useState('');
  const [inStockOnly, setInStockOnly] = useState(true);
  const [visible, setVisible] = useState(PAGE);
  const [selected, setSelected] = useState(null);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api('/api/products');
      if (!res.ok) { setLoading(false); return; }
      const data = await res.json();
      const rawProducts = data.products || [];
      const normalized = rawProducts.map((p, index) => ({
        id: p.id || p.zoho_item_id || String(index),
        n: p.name || '',
        sku: p.sku || '',
        s: p.sku || p.brand || '',
        barcode: p.barcode || p.brand || p.sku || '',
        brand: p.brand || '',
        category: p.category || '',
        p: p.wholesale_price,
        retail: p.price,
        k: Boolean(p.in_stock),
        stock: p.stock_on_hand ?? 0,
        d: p.description || '',
        img: Array.isArray(p.images) && p.images.length > 0 ? p.images[0] : null,
      }));
      setItems(normalized);
    } catch (err) {
      console.error('Failed to fetch products:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const clientStr = localStorage.getItem('wholesale_client');
    if (clientStr) {
      setScreen('catalog');
      loadItems();
    }
  }, [loadItems]);

  const onLogin = async () => {
    if (!user.trim() || !pass.trim()) { setError(true); return; }
    setLoading(true);
    try {
      const res = await api('/api/wholesale-login', {
        method: 'POST',
        body: JSON.stringify({ email: user.trim(), password: pass }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        localStorage.setItem('wholesale_client', JSON.stringify(data.client));
        setError(false);
        setScreen('catalog');
        window.scrollTo(0, 0);
        loadItems();
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const onLogout = async () => {
    localStorage.removeItem('wholesale_client');
    setScreen('login'); setQuery(''); setInStockOnly(false); setVisible(PAGE);
    setSelected(null); setUser(''); setPass(''); window.scrollTo(0, 0);
  };

  const onOpen = (it) => { setSelected(it); setScreen('detail'); window.scrollTo(0,0); };
  const onBack = () => { setScreen('catalog'); window.scrollTo(0,0); };

  if (screen === 'login') {
    return (
      <Login
        t={T}
        user={user} setUser={setUser} pass={pass} setPass={setPass}
        error={error} loading={loading} onLogin={onLogin}
      />
    );
  }
  if (screen === 'detail' && selected) {
    return <Detail t={T} item={selected} onBack={onBack} />;
  }
  if (screen === 'admin-login') {
    return (
      <AdminLogin
        onSuccess={() => { setScreen('admin'); window.scrollTo(0,0); }}
        onBack={() => { setScreen('catalog'); window.scrollTo(0,0); }}
      />
    );
  }
  if (screen === 'admin') {
    return (
      <Admin
        onBack={() => { setScreen('catalog'); window.scrollTo(0,0); loadItems(); }}
      />
    );
  }
  return (
    <Catalog
      t={T}
      items={items} loading={loading}
      query={query} setQuery={setQuery}
      inStockOnly={inStockOnly} setInStockOnly={setInStockOnly}
      visible={visible} setVisible={setVisible}
      onLogout={onLogout} onOpen={onOpen}
      onAdminClick={() => { setScreen('admin-login'); window.scrollTo(0,0); }}
    />
  );
}
