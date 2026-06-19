// Client-facing portal. Reached via a magic-link token the desktop mints for
// a client. No nav — focused on the client viewing/paying their invoices.

import { shell, escapeHTML, fmtMoney, fmtDate } from './shell';

export interface PortalClient {
  id: string;
  name: string;
  email?: string;
  company_name: string;
}
export interface PortalInvoice {
  id: string;
  invoice_number?: string;
  date: string;
  due_date?: string;
  status: string;
  total: number;
  amount_paid: number;
  outstanding: number;
  currency?: string;
}

export function portalIndexPage(client: PortalClient, invoices: PortalInvoice[]): string {
  const totalOut = invoices.reduce((s, i) => s + i.outstanding, 0);
  const body = `
<div style="text-align:center;margin-bottom:2rem">
  <div class="muted" style="font-size:0.8rem;text-transform:uppercase;letter-spacing:0.1em">Client Portal</div>
  <h1 style="font-size:1.8rem;font-weight:800;color:var(--text-bright);margin-top:6px">${escapeHTML(client.name)}</h1>
  <div class="muted" style="font-size:0.9rem">${escapeHTML(client.company_name)}</div>
</div>

<div class="card" style="text-align:center;margin-bottom:1.5rem">
  <div class="card-title">Total Outstanding</div>
  <div style="font-size:2rem;font-weight:800;color:${totalOut > 0 ? 'var(--amber)' : 'var(--green)'};font-family:'SF Mono',Menlo,monospace">${fmtMoney(totalOut)}</div>
</div>

${invoices.length === 0
  ? `<div class="empty-state">No invoices on file.</div>`
  : `<table class="data">
    <thead><tr><th>#</th><th>Date</th><th>Due</th><th>Status</th><th class="num">Total</th><th class="num">Outstanding</th><th></th></tr></thead>
    <tbody>
      ${invoices.map(i => `<tr>
        <td>${escapeHTML(i.invoice_number || i.id.slice(0, 8))}</td>
        <td>${fmtDate(i.date)}</td>
        <td class="muted">${fmtDate(i.due_date)}</td>
        <td>${statusBadge(i.status)}</td>
        <td class="num">${fmtMoney(i.total, i.currency)}</td>
        <td class="num"><strong>${fmtMoney(i.outstanding, i.currency)}</strong></td>
        <td>
          <a class="btn btn-ghost" style="padding:6px 12px;font-size:0.75rem" href="/portal/invoice/${escapeHTML(i.id)}${queryToken()}">View</a>
          ${i.outstanding > 0 ? `<button class="btn" style="padding:6px 12px;font-size:0.75rem;margin-left:4px" data-pay="${escapeHTML(i.id)}">Pay</button>` : ''}
        </td>
      </tr>`).join('')}
    </tbody>
  </table>`}
<script>
document.querySelectorAll('[data-pay]').forEach(function(btn){
  btn.addEventListener('click', async function(){
    const id = btn.getAttribute('data-pay');
    btn.disabled = true; btn.textContent = '…';
    try {
      const r = await window.fetchJSON('/portal/invoice/' + id + '/checkout' + (location.search || ''), { method: 'POST' });
      if (r.url) location.href = r.url;
      else window.toast(r.message || 'Stripe not configured', 'err');
    } catch (e) {
      window.toast(e.message || 'Failed to start payment', 'err');
      btn.disabled = false; btn.textContent = 'Pay';
    }
  });
});
</script>`;
  return shell({ title: 'Client Portal', body, showNav: false, brand: client.company_name });
}

export function portalInvoicePage(client: PortalClient, invoice: PortalInvoice, lines: Array<{ description: string; quantity: number; unit_price: number; amount: number }>): string {
  const body = `
<div style="text-align:center;margin-bottom:1.5rem">
  <div class="muted" style="font-size:0.8rem;text-transform:uppercase;letter-spacing:0.1em">Invoice ${escapeHTML(invoice.invoice_number || invoice.id.slice(0, 8))}</div>
  <h1 style="font-size:1.5rem;font-weight:800;color:var(--text-bright);margin-top:4px">${escapeHTML(client.company_name)}</h1>
  <div class="muted" style="font-size:0.85rem">Billed to ${escapeHTML(client.name)} · ${fmtDate(invoice.date)}</div>
</div>

<div class="card" style="margin-bottom:1rem">
  <table class="data" style="border:none">
    <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Amount</th></tr></thead>
    <tbody>
      ${lines.map(l => `<tr>
        <td>${escapeHTML(l.description || '')}</td>
        <td class="num">${l.quantity}</td>
        <td class="num">${fmtMoney(l.unit_price, invoice.currency)}</td>
        <td class="num">${fmtMoney(l.amount, invoice.currency)}</td>
      </tr>`).join('')}
    </tbody>
  </table>
</div>

<div class="card" style="display:flex;flex-direction:column;gap:8px;align-items:flex-end;font-family:'SF Mono',Menlo,monospace">
  <div>Total: <strong>${fmtMoney(invoice.total, invoice.currency)}</strong></div>
  <div>Paid: ${fmtMoney(invoice.amount_paid, invoice.currency)}</div>
  <div style="font-size:1.3rem;color:${invoice.outstanding > 0 ? 'var(--amber)' : 'var(--green)'}">
    Outstanding: <strong>${fmtMoney(invoice.outstanding, invoice.currency)}</strong>
  </div>
</div>

<div style="display:flex;gap:8px;justify-content:center;margin-top:1.5rem">
  <a class="btn btn-ghost" href="/portal${queryToken()}">Back to invoices</a>
  ${invoice.outstanding > 0 ? `<button id="payBtn" class="btn">Pay ${fmtMoney(invoice.outstanding, invoice.currency)}</button>` : ''}
</div>
<script>
const payBtn = document.getElementById('payBtn');
if (payBtn) payBtn.addEventListener('click', async function(){
  payBtn.disabled = true; payBtn.textContent = 'Starting…';
  try {
    const r = await window.fetchJSON('/portal/invoice/${escapeHTML(invoice.id)}/checkout' + (location.search || ''), { method: 'POST' });
    if (r.url) location.href = r.url;
    else window.toast(r.message || 'Stripe not configured', 'err');
  } catch (e) {
    window.toast(e.message || 'Failed', 'err');
    payBtn.disabled = false; payBtn.textContent = 'Pay';
  }
});
</script>`;
  return shell({ title: `Invoice ${invoice.invoice_number || ''}`, body, showNav: false, brand: client.company_name });
}

function queryToken(): string {
  // Token is passed as ?token=… in the URL; preserve it across navigation
  // by inlining a window.location.search read at click time. For SSR we
  // emit nothing here — the inline scripts re-read location.search anyway.
  return '';
}

function statusBadge(s: string): string {
  const map: Record<string, { cls: string; label: string }> = {
    draft: { cls: 'badge', label: 'Draft' },
    sent: { cls: 'badge badge-blue', label: 'Sent' },
    paid: { cls: 'badge badge-green', label: 'Paid' },
    overdue: { cls: 'badge badge-red', label: 'Overdue' },
    partial: { cls: 'badge badge-purple', label: 'Partial' },
  };
  const m = map[s] ?? { cls: 'badge', label: s || '—' };
  return `<span class="${m.cls}">${m.label}</span>`;
}
