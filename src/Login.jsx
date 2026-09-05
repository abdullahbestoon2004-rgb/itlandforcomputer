import React, { useState } from 'react';

export default function Login({ t, user, setUser, pass, setPass, error, loading, onLogin }) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div style={{ minHeight:'100vh', display:'flex', flexDirection:'column' }}>
      <div style={{ height:4, background:'var(--pri)' }} />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:'24px 20px 64px' }}>
        <div className="login-card" style={{ width:'100%', maxWidth:430, background:'#fff', border:'2px solid #17130E', borderRadius:22, boxShadow:'6px 6px 0 #17130E', padding:'36px 32px' }}>
          <div style={{ display:'flex', justifyContent:'center', marginBottom:26 }}>
            <img src="/assets/itland-logo.png" alt="iTLand" style={{ height:52, width:'auto', maxWidth:'100%' }} />
          </div>
          <h1 style={{ margin:'0 0 26px', fontSize:23, lineHeight:1.25, fontWeight:800, textAlign:'center' }}>{t.loginTitle}</h1>

          <label style={{ display:'block', fontSize:13.5, fontWeight:700, color:'#2B2419', marginBottom:7 }}>{t.username}</label>
          <input
            className="inp" type="email" value={user} dir="ltr"
            onChange={e => setUser(e.target.value)}
            placeholder={t.usernamePh}
            style={{ width:'100%', padding:'13px 14px', fontSize:16, fontFamily:'inherit', color:'#17130E', background:'#fff', border:'1.5px solid #E9DFC9', borderRadius:12, marginBottom:16, boxSizing:'border-box' }}
          />

          <label style={{ display:'block', fontSize:13.5, fontWeight:700, color:'#2B2419', marginBottom:7 }}>{t.password}</label>
          <div style={{ position:'relative', width:'100%', marginBottom:8 }}>
            <input
              className="inp" type={showPassword ? 'text' : 'password'} value={pass}
              onChange={e => setPass(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') onLogin(); }}
              placeholder={t.passwordPh}
              style={{ width:'100%', padding:'13px 44px 13px 14px', fontSize:16, fontFamily:'inherit', color:'#17130E', background:'#fff', border:'1.5px solid #E9DFC9', borderRadius:12, boxSizing:'border-box' }}
            />
            <button
              type="button"
              onClick={() => setShowPassword(v => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              style={{
                position: 'absolute',
                right: 12,
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
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                  <line x1="1" y1="23" x2="23" y2="1"/>
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              )}
            </button>
          </div>

          {error && <div style={{ fontSize:13.5, color:'#DE3A1E', fontWeight:600, margin:'2px 0 12px' }}>{t.loginError}</div>}

          <button
            className="btn-press" onClick={onLogin}
            style={{ width:'100%', marginTop:10, padding:14, fontSize:16, fontWeight:800, fontFamily:'inherit', color:'#fff', background:'var(--pri)', border:'2px solid #17130E', borderRadius:14, boxShadow:'3px 3px 0 #17130E', cursor:'pointer' }}
          >{loading ? '…' : t.signIn}</button>

          <p style={{ margin:'22px 0 0', fontSize:13, lineHeight:1.6, color:'#8B8071', textAlign:'center' }}>{t.loginSubtitle}</p>
        </div>
      </div>
    </div>
  );
}
