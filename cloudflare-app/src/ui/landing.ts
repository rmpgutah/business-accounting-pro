// Landing / sign-in page. Emerald-accented, matches the desktop app's UI.
// The form posts to /auth/login as JSON.

import { shell } from './shell';

export function landingPage(opts: { mode: 'login' | 'register'; error?: string; email?: string }): string {
  const isLogin = opts.mode === 'login';
  const body = `
<section style="min-height:calc(100vh - 60px);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px 20px;position:relative;overflow:hidden">
  <div style="position:absolute;top:-200px;left:50%;transform:translateX(-50%);width:700px;height:700px;background:radial-gradient(circle,rgba(16,185,129,0.08) 0%,transparent 70%);pointer-events:none"></div>

  <div style="display:inline-flex;align-items:center;gap:8px;background:var(--bg-elevated);border:1px solid var(--border);padding:6px 16px;border-radius:2px;font-size:0.8rem;color:var(--text-dim);margin-bottom:1.5rem">
    <span style="width:6px;height:6px;border-radius:50%;background:var(--green)"></span>
    accounting.rmpgutah.us · ${isLogin ? 'Sign in' : 'Create account'}
  </div>

  <h1 style="font-size:clamp(2rem,5vw,3.2rem);font-weight:800;line-height:1.1;color:var(--text-bright);margin-bottom:0.75rem;letter-spacing:-0.03em">
    Business Accounting <span style="background:linear-gradient(135deg,var(--accent),var(--purple));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">Pro</span>
  </h1>
  <p style="font-size:1rem;color:var(--text-dim);max-width:480px;margin-bottom:2rem">
    ${isLogin ? 'Sign in to access expenses, invoices, and client portal from anywhere.' : 'Create your cloud companion account. Your desktop syncs here automatically.'}
  </p>

  ${opts.error ? `<div class="error-banner" style="max-width:380px;width:100%">${opts.error}</div>` : ''}

  <form id="authForm" style="display:flex;flex-direction:column;gap:1rem;max-width:380px;width:100%;text-align:left">
    ${!isLogin ? `<label class="field">Name<input name="name" autocomplete="name" required></label>` : ''}
    <label class="field">Email<input name="email" type="email" autocomplete="email" required value="${(opts.email || '').replace(/"/g, '&quot;')}"></label>
    <label class="field">Password<input name="password" type="password" autocomplete="${isLogin ? 'current-password' : 'new-password'}" required minlength="8"></label>
    <button class="btn" type="submit" style="justify-content:center;padding:14px;font-size:0.95rem">
      ${isLogin ? 'Sign in' : 'Create account'}
    </button>
  </form>

  <p style="margin-top:1.5rem;font-size:0.85rem;color:var(--text-dim)">
    ${isLogin
      ? `New here? <a href="/auth/register">Create an account</a>`
      : `Have an account? <a href="/auth/login">Sign in</a>`}
  </p>
</section>
<script>
document.getElementById('authForm').addEventListener('submit', async function(ev){
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const payload = Object.fromEntries(fd.entries());
  const btn = ev.target.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = 'Working…';
  try {
    await window.fetchJSON('/auth/${isLogin ? 'login' : 'register'}', { method: 'POST', body: JSON.stringify(payload) });
    location.href = '/app/dashboard';
  } catch (err) {
    window.toast(err.message || 'Failed', 'err');
    btn.disabled = false;
    btn.textContent = '${isLogin ? 'Sign in' : 'Create account'}';
  }
});
</script>`;

  return shell({
    title: isLogin ? 'Sign in' : 'Create account',
    body,
    showNav: false,
  });
}
