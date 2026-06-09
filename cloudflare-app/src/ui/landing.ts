// Landing / sign-in page. Mirrors the DESKTOP AuthScreen layout EXACTLY:
// two-panel split with left branding (logo, title, accent divider, feature
// bullets) + right glass auth card. Same Inter font, same red gradient
// button, same dark mountain background, same input focus ring, same
// rounded-14px card. The form posts to /auth/login as JSON.
//
// The only deviations from the desktop screen:
//  • Feature bullets are cloud-appropriate ("sync from desktop", "access
//    from anywhere") instead of the desktop's "data never leaves your device".
//  • No "pick user" multi-account picker — cloud sessions are 1:1 with email.

import { shell, escapeHTML } from './shell';

// Same background-image + dark gradient stack as the desktop AuthScreen so
// the two views feel like the same product. Logo is inlined as a data URI
// to avoid a second round-trip (Workers have no static-asset pipeline).
const BG_IMAGE = 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1920&q=80&auto=format';
const BG_GRADIENT = 'linear-gradient(145deg, #0a0a0a 0%, #111111 20%, #0d0d0d 40%, #141414 60%, #0f0f0f 80%, #0a0a0a 100%)';
const BG_OVERLAY = 'linear-gradient(rgba(5,10,20,0.55), rgba(5,10,20,0.70))';
const BG_COMBINED = `${BG_OVERLAY}, url(${BG_IMAGE}) center/cover no-repeat, ${BG_GRADIENT}`;

// Inline SVG of a stylized shield+ledger, same red accent as the seal.
// Replace with the actual rmpg-seal.png data URI later if you want pixel parity.
const LOGO_SVG = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="180" height="180">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#dc2626"/>
      <stop offset="100%" stop-color="#7f1d1d"/>
    </linearGradient>
  </defs>
  <circle cx="100" cy="100" r="92" fill="none" stroke="url(#g)" stroke-width="4"/>
  <circle cx="100" cy="100" r="78" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>
  <path d="M100 35 L150 60 V110 Q150 145 100 165 Q50 145 50 110 V60 Z" fill="url(#g)" opacity="0.85"/>
  <text x="100" y="115" text-anchor="middle" font-family="-apple-system,sans-serif" font-weight="900" font-size="42" fill="#fff">BAP</text>
</svg>`)}`;

export function landingPage(opts: { mode: 'login' | 'register'; error?: string; email?: string }): string {
  const isLogin = opts.mode === 'login';
  const body = `
<div class="auth-root">
  <!-- ── Left branding panel ───────────────────────────── -->
  <div class="auth-brand">
    <div class="logo-wrap">
      <div class="logo-glow"></div>
      <img src="${LOGO_SVG}" alt="Business Accounting Pro" class="logo" />
    </div>
    <h1 class="brand-title">RMPG Accounting<br>Manager Pro</h1>
    <div class="brand-divider"></div>
    <p class="brand-subtitle">
      Cloud companion for your desktop accounting. Sync from anywhere, view invoices on the go, and share a secure portal with your clients.
    </p>
    <div class="brand-features">
      ${[
        ['🔗', 'Synced from your desktop install'],
        ['📱', 'Mobile-friendly expense capture'],
        ['🤝', 'Secure client portal with payments'],
      ].map(([icon, text]) => `
        <div class="brand-feature">
          <div class="brand-feature-icon">${icon}</div>
          <span>${text}</span>
        </div>`).join('')}
    </div>
    <div class="brand-footer">Rocky Mountain Protective Group, LLC</div>
  </div>

  <!-- ── Right auth card panel ─────────────────────────── -->
  <div class="auth-card-panel">
    <div class="glass-card">
      <h2 class="card-title">${isLogin ? 'Welcome back' : 'Create account'}</h2>
      <p class="card-subtitle">
        ${isLogin
          ? 'Sign in with your desktop email and password.'
          : 'Add a cloud account. Or skip this and sync from your desktop instead.'}
      </p>

      ${opts.error ? `<div class="error-box">${escapeHTML(opts.error)}</div>` : ''}

      <form id="authForm" autocomplete="on">
        ${!isLogin ? `
        <div class="field-block">
          <label for="auth-name">Full Name</label>
          <input id="auth-name" type="text" name="name" autocomplete="name" placeholder="John Smith" autofocus />
        </div>` : ''}
        <div class="field-block">
          <label for="auth-email">Email</label>
          <input id="auth-email" type="email" name="email" autocomplete="username"
            placeholder="name@company.com" value="${escapeHTML(opts.email || '')}"
            ${isLogin && !opts.email ? 'autofocus' : ''} />
        </div>
        <div class="field-block">
          <label for="auth-password">Password</label>
          <div class="password-wrap">
            <input id="auth-password" type="password" name="password"
              autocomplete="${isLogin ? 'current-password' : 'new-password'}"
              placeholder="${isLogin ? 'Enter your password' : 'Min. 6 characters'}"
              minlength="${isLogin ? 1 : 6}"
              ${isLogin && opts.email ? 'autofocus' : ''} />
            <button type="button" id="togglePw" aria-label="Show password">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
          </div>
        </div>

        <button class="btn-primary" type="submit">
          <span class="btn-label">${isLogin ? 'Sign in' : 'Create account'}</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </button>
      </form>

      <div class="card-foot">
        <span class="muted">${isLogin ? 'New here? ' : 'Already have an account? '}</span>
        <a href="${isLogin ? '/auth/register' : '/auth/login'}" class="link-btn">${isLogin ? 'Create account' : 'Sign in'}</a>
      </div>
    </div>
  </div>
</div>
<script>
(function(){
  // Password show/hide — wires after DOM ready (script is at body end so OK).
  const pwInput = document.getElementById('auth-password');
  const tog = document.getElementById('togglePw');
  if (tog && pwInput) {
    tog.addEventListener('click', function(){
      const isPw = pwInput.getAttribute('type') === 'password';
      pwInput.setAttribute('type', isPw ? 'text' : 'password');
      tog.setAttribute('aria-label', isPw ? 'Hide password' : 'Show password');
    });
  }
  const form = document.getElementById('authForm');
  form.addEventListener('submit', async function(ev){
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const payload = Object.fromEntries(fd.entries());
    const btn = ev.target.querySelector('button[type=submit]');
    const lbl = btn.querySelector('.btn-label');
    btn.disabled = true;
    const prev = lbl.textContent;
    lbl.textContent = ${isLogin ? "'Signing in…'" : "'Creating…'"};
    try {
      await window.fetchJSON('/auth/${isLogin ? 'login' : 'register'}', { method: 'POST', body: JSON.stringify(payload) });
      location.href = '/app/dashboard';
    } catch (err) {
      window.toast(err.message || 'Failed', 'err');
      btn.disabled = false;
      lbl.textContent = prev;
    }
  });
})();
</script>`;

  // Page-specific CSS appended via extraHead so the shell stays generic.
  // Tracks the desktop AuthScreen pixel-for-pixel where the layout fits;
  // glass card uses the same blur(32px) saturate(1.6) and rgba(20,23,30,0.82).
  // NOTE: extraHead is injected INSIDE the shell's <style> block, so this
  // string MUST NOT include its own <style> tags.
  const css = `
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,system-ui,sans-serif;background:${BG_COMBINED};min-height:100vh}
main.shell-main{padding:0!important;max-width:none!important}
.auth-root{display:flex;min-height:100vh;width:100%}
.auth-brand{flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:60px;min-width:360px}
.logo-wrap{position:relative;margin-bottom:36px}
.logo-glow{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:240px;height:240px;background:radial-gradient(circle,rgba(200,30,30,0.12) 0%,transparent 70%);border-radius:50%;filter:blur(30px)}
.logo{position:relative;width:180px;height:180px;object-fit:contain;filter:drop-shadow(0 4px 30px rgba(0,0,0,0.6))}
.brand-title{font-size:28px;font-weight:800;color:#fff;line-height:1.15;letter-spacing:-0.02em;margin-bottom:6px;text-align:center;text-transform:uppercase}
.brand-divider{width:60px;height:3px;background:linear-gradient(90deg,#b91c1c,#dc2626,#b91c1c);margin:16px auto 20px;border-radius:2px}
.brand-subtitle{font-size:13px;color:rgba(255,255,255,0.5);line-height:1.6;max-width:340px;text-align:center;margin-bottom:36px}
.brand-features{display:flex;flex-direction:column;gap:14px;width:100%;max-width:320px}
.brand-feature{display:flex;align-items:center;gap:12px}
.brand-feature-icon{width:32px;height:32px;border-radius:6px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:15px}
.brand-feature span{font-size:12px;color:rgba(255,255,255,0.55);letter-spacing:0.02em}
.brand-footer{margin-top:48px;font-size:10px;color:rgba(255,255,255,0.2);text-transform:uppercase;letter-spacing:2px;text-align:center}
.auth-card-panel{display:flex;align-items:center;justify-content:center;padding:40px;min-width:480px}
.glass-card{width:100%;max-width:440px;background:rgba(20,23,30,0.82);backdrop-filter:blur(32px) saturate(1.6);-webkit-backdrop-filter:blur(32px) saturate(1.6);border:1px solid rgba(255,255,255,0.10);padding:44px;border-radius:14px;box-shadow:0 32px 80px rgba(0,0,0,0.55),0 1px 0 rgba(255,255,255,0.06) inset}
.card-title{font-size:24px;font-weight:700;color:#fff;margin-bottom:4px;letter-spacing:-0.01em}
.card-subtitle{font-size:14px;color:rgba(255,255,255,0.5);margin-bottom:28px;line-height:1.5}
.error-box{padding:12px 14px;margin-bottom:20px;background:rgba(239,68,68,0.10);border:1px solid rgba(239,68,68,0.20);color:#f87171;font-size:13px;border-radius:8px}
.field-block{margin-bottom:20px}
.field-block label{color:rgba(255,255,255,0.7);font-size:13px;font-weight:600;margin-bottom:6px;display:block}
.field-block input{width:100%;padding:14px 16px;font-size:14px;background:rgba(0,0,0,0.55);border:1px solid rgba(255,255,255,0.08);border-radius:8px;color:#fff;outline:none;transition:border-color 0.2s,box-shadow 0.2s;font-family:inherit}
.field-block input:focus{border-color:rgba(96,165,250,0.5);box-shadow:0 0 0 3px rgba(96,165,250,0.10)}
.password-wrap{position:relative}
.password-wrap input{padding-right:44px}
.password-wrap button{position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:rgba(255,255,255,0.3);padding:4px;display:flex;align-items:center}
.password-wrap button:hover{color:rgba(255,255,255,0.7)}
.btn-primary{width:100%;padding:14px;font-size:15px;font-weight:600;background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;border:none;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;transition:box-shadow 0.2s;box-shadow:0 4px 12px rgba(239,68,68,0.30);font-family:inherit}
.btn-primary:hover:not(:disabled){box-shadow:0 8px 24px rgba(239,68,68,0.40)}
.btn-primary:disabled{opacity:0.5;cursor:not-allowed}
.card-foot{margin-top:20px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;font-size:13px}
.muted{color:rgba(255,255,255,0.4)}
.link-btn{color:#ef4444;font-weight:600;text-decoration:none}
.link-btn:hover{color:#f87171}

/* Mobile — single column, brand panel collapses to compact header. The
   desktop view stacks branding above the form on phones rather than
   side-by-side; matches what the Electron app does when window is narrow. */
@media (max-width:880px){
  .auth-root{flex-direction:column}
  .auth-brand{padding:32px 24px 16px;min-width:0}
  .logo{width:96px;height:96px}
  .logo-wrap{margin-bottom:18px}
  .brand-title{font-size:20px}
  .brand-subtitle,.brand-features,.brand-footer{display:none}
  .auth-card-panel{padding:16px;min-width:0}
  .glass-card{padding:28px 24px}
}
`;

  return shell({
    title: isLogin ? 'Sign in' : 'Create account',
    body,
    showNav: false,
    extraHead: css,
  });
}
