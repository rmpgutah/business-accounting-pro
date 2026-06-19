// Shared HTML shell — every server-rendered page wraps its body in this.
// Tokens mirror globals.css + DEFAULT_ACCENTS from personalizationStore.ts
// so the web app reads as a pixel-faithful continuation of the desktop app.
// Keep this file in sync with src/renderer/styles/globals.css when tweaking.

export interface ShellOptions {
  title: string;
  body: string;
  /** Optional <script> tag(s) injected at the end of <body>. */
  scripts?: string;
  /** Optional <link rel="stylesheet"> for per-page styles. */
  extraHead?: string;
  /** Show the global nav (default true). Set false on focused capture forms. */
  showNav?: boolean;
  /** Active nav item id, e.g. "dashboard". */
  activeNav?: string;
  /** Display name shown in nav-brand text. */
  brand?: string;
}

export function shell(opts: ShellOptions): string {
  const { title, body, scripts = '', extraHead = '', showNav = true, activeNav, brand = 'Business Accounting Pro' } = opts;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0a0a0a">
<title>${escapeHTML(title)} — ${escapeHTML(brand)}</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2310b981'%3E%3Cpath d='M3 6h18v3H3zm0 5h18v3H3zm0 5h18v3H3z'/%3E%3C/svg%3E">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  /* Background scale — globals.css --color-bg-* */
  --bg:#0a0a0a;--bg-card:#141414;--bg-elevated:#252525;--bg-hover:#2a2a2a;
  /* Borders — neutral gray, no blue tint */
  --border:#2e2e2e;--border-focus:#525252;
  /* Text */
  --text:#f0f0f0;--text-dim:#a0a0a0;--text-muted:#6b6b6b;--text-bright:#f0f0f0;
  /* Accents — DEFAULT_ACCENTS from personalizationStore.ts */
  --accent:#10b981;--accent-hover:#34d399;
  --green:#34d399;--red:#fb7185;--amber:#f59e0b;--blue:#60a5fa;--purple:#c084fc;
}
html{scroll-behavior:smooth}
body{font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',system-ui,sans-serif;background:var(--bg);color:var(--text);line-height:1.6;min-height:100vh;-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration:none}
a:hover{color:var(--accent-hover)}
input,select,textarea,button{font:inherit;color:inherit}

/* NAV */
nav.shell-nav{position:fixed;top:0;left:0;right:0;z-index:100;background:rgba(10,10,10,0.9);backdrop-filter:blur(20px);border-bottom:1px solid var(--border);padding:0 1.5rem;height:60px;display:flex;align-items:center;justify-content:space-between}
.nav-brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:1.05rem;color:var(--text-bright)}
.nav-brand svg{width:26px;height:26px;color:var(--accent)}
.nav-links{display:flex;gap:1.5rem;align-items:center}
.nav-links a{color:var(--text-dim);font-size:0.85rem;font-weight:500;transition:color 0.2s}
.nav-links a:hover,.nav-links a.active{color:var(--text-bright)}
.nav-links a.active{position:relative}
.nav-links a.active::after{content:'';position:absolute;left:0;right:0;bottom:-22px;height:2px;background:var(--accent)}
.btn-nav{background:var(--accent);color:#fff!important;padding:7px 16px;border-radius:2px;font-weight:600;font-size:0.8rem;transition:opacity 0.15s}
.btn-nav:hover{opacity:0.9}

/* MAIN container */
.shell-main{padding:${showNav ? '90px' : '24px'} 1.5rem 60px;max-width:1100px;margin:0 auto}

/* Reusable bits */
.page-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;flex-wrap:wrap;gap:1rem}
.page-title{font-size:1.6rem;font-weight:800;color:var(--text-bright);letter-spacing:-0.01em}
.page-subtitle{font-size:0.9rem;color:var(--text-dim);margin-top:4px}

/* Card — mirrors .block-card */
.card{background:var(--bg-card);border:1px solid var(--border);border-radius:2px;padding:1.25rem}
.card-title{font-size:0.75rem;font-weight:700;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:0.75rem}

/* Buttons — mirrors .block-btn-* */
.btn{background:var(--accent);color:#fff;padding:10px 20px;border-radius:2px;font-weight:600;font-size:0.85rem;border:none;cursor:pointer;transition:opacity 0.15s;display:inline-flex;align-items:center;gap:8px}
.btn:hover{opacity:0.9}
.btn:disabled{opacity:0.5;cursor:not-allowed}
.btn-ghost{background:var(--bg-elevated);color:var(--text);border:1px solid var(--border)}
.btn-ghost:hover{border-color:var(--border-focus);background:var(--bg-hover);color:var(--text-bright)}
.btn-danger{background:var(--red)}
.btn-success{background:var(--green)}

/* Form fields — mirrors .block-input */
label.field{display:flex;flex-direction:column;gap:6px;font-size:0.75rem;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.05em}
label.field input,label.field select,label.field textarea{background:var(--bg);border:1px solid var(--border);border-radius:2px;padding:10px 12px;color:var(--text);font-size:0.9rem;text-transform:none;letter-spacing:normal;font-weight:400;transition:border-color 0.15s}
label.field input:focus,label.field select:focus,label.field textarea:focus{outline:none;border-color:var(--border-focus)}
label.field input::placeholder,label.field textarea::placeholder{color:var(--text-muted)}
label.field textarea{resize:vertical;min-height:90px;font-family:inherit}

.grid{display:grid;gap:1rem}
.grid-2{grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
.grid-3{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
.grid-4{grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}

/* Table — mirrors .block-table */
table.data{width:100%;border-collapse:collapse;background:var(--bg-card);border:1px solid var(--border);border-radius:2px;overflow:hidden}
table.data th,table.data td{padding:10px 14px;text-align:left;font-size:0.85rem;border-bottom:1px solid var(--border)}
table.data th{background:var(--bg-elevated);font-size:0.7rem;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.05em}
table.data tbody tr:last-child td{border-bottom:none}
table.data tbody tr:hover td{background:var(--bg-hover)}
.num{font-family:'JetBrains Mono','SF Mono',Menlo,monospace;font-variant-numeric:tabular-nums;text-align:right}

/* Badges — mirrors .block-badge-* using DEFAULT_ACCENTS */
.badge{display:inline-block;padding:3px 9px;border-radius:2px;font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;background:var(--bg-elevated);color:var(--text-dim)}
.badge-green{background:rgba(52,211,153,0.12);color:#34d399}
.badge-blue{background:rgba(96,165,250,0.12);color:#60a5fa}
.badge-purple{background:rgba(192,132,252,0.12);color:#c084fc}
.badge-amber{background:rgba(245,158,11,0.12);color:#f59e0b}
.badge-red{background:rgba(251,113,133,0.12);color:#fb7185}

.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--bg-elevated);border:1px solid var(--border);border-radius:2px;padding:12px 20px;font-size:0.85rem;color:var(--text-bright);box-shadow:0 10px 30px rgba(0,0,0,0.4);opacity:0;transition:opacity 0.2s;pointer-events:none;z-index:1000}
.toast.show{opacity:1}
.toast.err{border-color:var(--red);color:var(--red)}
.toast.ok{border-color:var(--green);color:var(--green)}

.muted{color:var(--text-dim)}
.bright{color:var(--text-bright)}
.error-banner{background:rgba(251,113,133,0.08);border:1px solid var(--red);color:var(--red);padding:12px 16px;border-radius:2px;margin-bottom:1rem;font-size:0.85rem}
.empty-state{padding:3rem 1.5rem;text-align:center;color:var(--text-dim);font-size:0.9rem}

/* Mobile tweaks — capture screens prioritized */
@media (max-width:640px){
  nav.shell-nav{padding:0 1rem;height:54px}
  .nav-links{gap:0.75rem}
  .nav-links a{font-size:0.78rem}
  .shell-main{padding:${showNav ? '76px' : '16px'} 1rem 40px}
  .page-title{font-size:1.3rem}
  table.data th,table.data td{padding:8px 10px;font-size:0.8rem}
}
${extraHead}
</style>
</head>
<body>
${showNav ? renderNav(brand, activeNav) : ''}
<main class="shell-main">
${body}
</main>
<div id="toast" class="toast" role="status" aria-live="polite"></div>
<script>
// Toast — call window.toast('message', 'ok'|'err')
window.toast = function(msg, kind){
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show ' + (kind === 'err' ? 'err' : kind === 'ok' ? 'ok' : '');
  clearTimeout(window.__toastTo);
  window.__toastTo = setTimeout(function(){ t.className = 'toast'; }, 3000);
};
// fetchJSON — small wrapper. Throws on non-2xx with the server's error text.
window.fetchJSON = async function(url, init){
  const res = await fetch(url, Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, init || {}));
  const ct = res.headers.get('content-type') || '';
  const isJSON = ct.includes('json');
  const data = isJSON ? await res.json() : await res.text();
  if (!res.ok) throw new Error((isJSON && data && data.error) || res.statusText);
  return data;
};
</script>
${scripts}
</body>
</html>`;
}

function renderNav(brand: string, active?: string): string {
  const item = (href: string, label: string, id: string) =>
    `<a href="${href}"${active === id ? ' class="active"' : ''}>${escapeHTML(label)}</a>`;
  return `<nav class="shell-nav">
  <div class="nav-brand">
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 6h18v3H3zm0 5h18v3H3zm0 5h18v3H3z"/></svg>
    ${escapeHTML(brand)}
  </div>
  <div class="nav-links">
    ${item('/app/dashboard', 'Dashboard', 'dashboard')}
    ${item('/app/expenses', 'Expenses', 'expenses')}
    ${item('/app/invoices', 'Invoices', 'invoices')}
    ${item('/app/bills', 'Bills', 'bills')}
    ${item('/app/quotes', 'Quotes', 'quotes')}
    ${item('/app/purchase-orders', 'POs', 'purchase-orders')}
    ${item('/app/clients', 'Clients', 'clients')}
    ${item('/app/vendors', 'Vendors', 'vendors')}
    ${item('/app/projects', 'Projects', 'projects')}
    ${item('/app/time', 'Time', 'time')}
    ${item('/app/employees', 'Employees', 'employees')}
    ${item('/app/mileage', 'Mileage', 'mileage')}
    ${item('/app/inventory', 'Inventory', 'inventory')}
    ${item('/app/fixed-assets', 'Assets', 'fixed-assets')}
    ${item('/app/loans', 'Loans', 'loans')}
    ${item('/app/budgets', 'Budgets', 'budgets')}
    ${item('/app/accounts', 'GL', 'accounts')}
    ${item('/app/reports', 'Reports', 'reports')}
    ${item('/app/report-builder', 'Builder', 'report-builder')}
    ${item('/app/kpi', 'KPI', 'kpi')}
    ${item('/app/forecasting', 'Forecast', 'forecasting')}
    ${item('/app/taxes', 'Tax', 'taxes')}
    ${item('/app/recurring', 'Recurring', 'recurring')}
    ${item('/app/debt-collection', 'Collections', 'debt-collection')}
    ${item('/app/bank', 'Bank', 'bank')}
    ${item('/app/stripe', 'Stripe', 'stripe')}
    ${item('/app/email', 'Email', 'email')}
    ${item('/app/automations', 'Rules', 'automations')}
    ${item('/app/audit', 'Audit', 'audit')}
    ${item('/app/notifications', 'Inbox', 'notifications')}
    ${item('/app/settings', 'Settings', 'settings')}
    <a href="/auth/logout" class="btn-nav">Sign out</a>
  </div>
</nav>`;
}

export function escapeHTML(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Format a number as USD/etc., null-safe. */
export function fmtMoney(n: unknown, currency = 'USD'): string {
  const num = Number(n ?? 0);
  if (!Number.isFinite(num)) return '$0.00';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(num);
  } catch {
    return `$${num.toFixed(2)}`;
  }
}

export function fmtDate(s: unknown): string {
  if (!s) return '—';
  const d = new Date(String(s));
  if (isNaN(d.getTime())) return String(s);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
