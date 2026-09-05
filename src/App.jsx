import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  const [brand, setBrand] = useState('');
  const [category, setCategory] = useState('');
  const [inStockOnly, setInStockOnly] = useState(true);
  const [visible, setVisible] = useState(PAGE);
  const [selected, setSelected] = useState(null);
  const scrollPosRef = useRef(0);

  const loadItems = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await api('/api/products');
      if (!res.ok) { if (!silent) setLoading(false); return; }
      const data = await res.json();
      const rawProducts = data.products || [];
      const normalized = rawProducts.map((p, index) => ({
        id: p.id || p.zoho_item_id || String(index),
        n: p.n || p.name || '',
        sku: p.sku || p.s || '',
        s: p.s || p.sku || p.brand || '',
        barcode: p.barcode || p.brand || p.sku || p.s || '',
        brand: p.brand || '',
        category: p.category || '',
        p: p.p !== undefined ? p.p : (p.wholesale_price !== undefined ? p.wholesale_price : null),
        retail: p.retail !== undefined ? p.retail : (p.price !== undefined ? p.price : null),
        k: p.k !== undefined ? Boolean(p.k) : (p.in_stock !== undefined ? Boolean(p.in_stock) : (p.stock > 0)),
        stock: p.stock !== undefined ? Number(p.stock) : (p.stock_on_hand !== undefined ? Number(p.stock_on_hand) : 0),
        d: p.d || p.description || '',
        img: p.img || (Array.isArray(p.images) && p.images.length > 0 ? p.images[0] : null),
      }));
      setItems(normalized);
    } catch (err) {
      console.error('Failed to fetch products:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const clientStr = localStorage.getItem('wholesale_client');
    if (clientStr) {
      setScreen('catalog');
      loadItems(false);
    }
  }, [loadItems]);

  // Periodically refresh items from server so 5-minute syncs automatically reflect in the UI
  useEffect(() => {
    if (screen === 'login') return;

    // Check for server updates every 60 seconds
    const interval = setInterval(() => {
      loadItems(true);
    }, 60 * 1000);

    // Also refresh immediately when the user switches back to this tab
    const onFocus = () => {
      loadItems(true);
    };
    window.addEventListener('focus', onFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [screen, loadItems]);

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

  useEffect(() => {
    const handlePopState = () => {
      setScreen((prevScreen) => {
        if (prevScreen === 'detail') {
          requestAnimationFrame(() => {
            window.scrollTo(0, scrollPosRef.current || 0);
          });
          return 'catalog';
        }
        return prevScreen;
      });
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const onLogout = async () => {
    localStorage.removeItem('wholesale_client');
    setScreen('login'); setQuery(''); setBrand(''); setCategory(''); setInStockOnly(true); setVisible(PAGE);
    setSelected(null); setUser(''); setPass(''); scrollPosRef.current = 0; window.scrollTo(0, 0);
  };

  const onOpen = (it) => {
    scrollPosRef.current = window.scrollY;
    setSelected(it);
    window.history.pushState({ screen: 'detail' }, '');
    setScreen('detail');
    window.scrollTo(0, 0);
  };

  const onBack = () => {
    if (window.history.state && window.history.state.screen === 'detail') {
      window.history.back();
    } else {
      setScreen('catalog');
      requestAnimationFrame(() => {
        window.scrollTo(0, scrollPosRef.current || 0);
      });
    }
  };

  if (screen === 'login') {
    return (
      <Login
        t={T}
        user={user} setUser={setUser} pass={pass} setPass={setPass}
        error={error} loading={loading} onLogin={onLogin}
      />
    );
  }
  const selectedItem = selected ? (items.find(it => String(it.id) === String(selected.id)) || selected) : null;
  if (screen === 'detail' && selectedItem) {
    return <Detail t={T} item={selectedItem} onBack={onBack} />;
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
      brand={brand} setBrand={setBrand}
      category={category} setCategory={setCategory}
      inStockOnly={inStockOnly} setInStockOnly={setInStockOnly}
      visible={visible} setVisible={setVisible}
      onLogout={onLogout} onOpen={onOpen}
      onAdminClick={() => { setScreen('admin-login'); window.scrollTo(0,0); }}
    />
  );
}
