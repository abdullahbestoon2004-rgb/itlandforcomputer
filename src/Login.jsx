import React from 'react';

export default function Login({ t, user, setUser, pass, setPass, error, loading, onLogin }) {
  return (
    <div style={{ minHeight:'100vh', display:'flex', flexDirection:'column' }}>
      <div style={{ height:4, background:'var(--pri)' }} />
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:'24px 20px 64px' }}>
        <div style={{ width:'100%', maxWidth:430, background:'#fff', border:'2px solid #17130E', borderRadius:22, boxShadow:'6px 6px 0 #17130E', padding:'36px 32px' }}>
          <div style={{ display:'flex', justifyContent:'center', marginBottom:26 }}>
            <img src="/assets/itland-logo.png" alt="iTLand" style={{ height:52, width:'auto', maxWidth:'100%' }} />
          </div>
          <h1 style={{ margin:'0 0 26px', fontSize:23, lineHeight:1.25, fontWeight:800, textAlign:'center' }}>{t.loginTitle}</h1>

          <label style={{ display:'block', fontSize:13.5, fontWeight:700, color:'#2B2419', marginBottom:7 }}>{t.username}</label>
          <input
            className="inp" type="text" value={user} dir="ltr"
            onChange={e => setUser(e.target.value)}
            placeholder={t.usernamePh}
            style={{ width:'100%', padding:'13px 14px', fontSize:16, fontFamily:'inherit', color:'#17130E', background:'#fff', border:'1.5px solid #E9DFC9', borderRadius:12, marginBottom:16 }}
          />

          <label style={{ display:'block', fontSize:13.5, fontWeight:700, color:'#2B2419', marginBottom:7 }}>{t.password}</label>
          <input
            className="inp" type="password" value={pass}
            onChange={e => setPass(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onLogin(); }}
            placeholder={t.passwordPh}
            style={{ width:'100%', padding:'13px 14px', fontSize:16, fontFamily:'inherit', color:'#17130E', background:'#fff', border:'1.5px solid #E9DFC9', borderRadius:12, marginBottom:8 }}
          />

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
