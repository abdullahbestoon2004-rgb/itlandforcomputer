import React, { useState, useEffect, useCallback } from 'react';
import { T, PAGE } from './i18n.js';
import Login from './Login.jsx';
import Catalog from './Catalog.jsx';
import Detail from './Detail.jsx';

async function api(path, opts) {
  return fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
}

export default function App() {
  const [screen, setScreen] = useState('login');     // 'login' | 'catalog' | 'detail'
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
    const res = await api('/api/items');
    if (res.status === 401) { setScreen('login'); setLoading(false); return; }
    const data = await res.json();
    setItems(data.items || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await api('/api/me');
        const data = await res.json();
        if (data.loggedIn) { setScreen('catalog'); loadItems(); }
      } catch {}
    })();
  }, [loadItems]);

  const onLogin = async () => {
    if (!user.trim() || !pass.trim()) { setError(true); return; }
    setLoading(true);
    const res = await api('/api/login', { method:'POST', body: JSON.stringify({ username:user, password:pass }) });
    setLoading(false);
    if (res.ok) { setError(false); setScreen('catalog'); window.scrollTo(0,0); loadItems(); }
    else setError(true);
  };

  const onLogout = async () => {
    await api('/api/logout', { method:'POST' });
    setScreen('login'); setQuery(''); setInStockOnly(false); setVisible(PAGE);
    setSelected(null); setUser(''); setPass(''); window.scrollTo(0,0);
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
  return (
    <Catalog
      t={T}
      items={items} loading={loading}
      query={query} setQuery={setQuery}
      inStockOnly={inStockOnly} setInStockOnly={setInStockOnly}
      visible={visible} setVisible={setVisible}
      onLogout={onLogout} onOpen={onOpen}
    />
  );
}
