// Dashboard — KPIs + recent expenses/invoices. Read-only; deep links into
// CRUD pages below. The KPI numbers come from /api/dashboard JSON so the page
// hydrates immediately after the shell paints.

import { shell, fmtMoney, fmtDate, escapeHTML } from './shell';

export interface DashboardKpi {
  expensesYtd: number;
  invoicesYtd: number;
  outstandingAR: number;
  mileageDeductionYtd: number;
}

export interface DashboardLists {
  recentExpenses: Array<{ id: string; date: string; description: string; amount: number; vendor_name?: string }>;
  recentInvoices: Array<{ id: string; date: string; invoice_number?: string; client_name?: string; total: number; status: string }>;
}

export function dashboardPage(kpi: DashboardKpi, lists: DashboardLists, companyName: string): string {
  const body = `
<div class="page-header">
  <div>
    <h1 class="page-title">Dashboard</h1>
    <div class="page-subtitle">${escapeHTML(companyName)}</div>
  </div>
  <a class="btn" href="/app/expenses/new">+ New Expense</a>
</div>

<div class="grid grid-4" style="margin-bottom:1.5rem">
  ${kpiCard('Expenses YTD', fmtMoney(kpi.expensesYtd), 'var(--red)')}
  ${kpiCard('Invoiced YTD', fmtMoney(kpi.invoicesYtd), 'var(--green)')}
  ${kpiCard('Outstanding A/R', fmtMoney(kpi.outstandingAR), 'var(--amber)')}
  ${kpiCard('Mileage Deduction', fmtMoney(kpi.mileageDeductionYtd), 'var(--blue)')}
</div>

<div class="grid grid-2">
  <div class="card">
    <div class="card-title">Recent Expenses</div>
    ${lists.recentExpenses.length === 0
      ? `<div class="empty-state">No expenses yet. <a href="/app/expenses/new">Add one</a></div>`
      : `<table class="data"><thead><tr><th>Date</th><th>Description</th><th>Vendor</th><th class="num">Amount</th></tr></thead><tbody>
        ${lists.recentExpenses.map(e => `<tr>
          <td>${fmtDate(e.date)}</td>
          <td><a href="/app/expenses/${escapeHTML(e.id)}">${escapeHTML(e.description || '(no description)')}</a></td>
          <td class="muted">${escapeHTML(e.vendor_name || '—')}</td>
          <td class="num">${fmtMoney(e.amount)}</td>
        </tr>`).join('')}
      </tbody></table>`}
  </div>
  <div class="card">
    <div class="card-title">Recent Invoices</div>
    ${lists.recentInvoices.length === 0
      ? `<div class="empty-state">No invoices yet.</div>`
      : `<table class="data"><thead><tr><th>Date</th><th>#</th><th>Client</th><th>Status</th><th class="num">Total</th></tr></thead><tbody>
        ${lists.recentInvoices.map(i => `<tr>
          <td>${fmtDate(i.date)}</td>
          <td><a href="/app/invoices/${escapeHTML(i.id)}">${escapeHTML(i.invoice_number || i.id.slice(0, 8))}</a></td>
          <td class="muted">${escapeHTML(i.client_name || '—')}</td>
          <td>${statusBadge(i.status)}</td>
          <td class="num">${fmtMoney(i.total)}</td>
        </tr>`).join('')}
      </tbody></table>`}
  </div>
</div>`;
  return shell({ title: 'Dashboard', activeNav: 'dashboard', body, brand: 'BAP Cloud' });
}

function kpiCard(label: string, value: string, color: string): string {
  return `<div class="card" style="border-top:2px solid ${color}">
    <div class="card-title">${escapeHTML(label)}</div>
    <div style="font-size:1.5rem;font-weight:800;color:var(--text-bright);font-family:'SF Mono',Menlo,monospace">${escapeHTML(value)}</div>
  </div>`;
}

function statusBadge(s: string): string {
  const map: Record<string, { cls: string; label: string }> = {
    draft: { cls: 'badge', label: 'Draft' },
    sent: { cls: 'badge badge-blue', label: 'Sent' },
    paid: { cls: 'badge badge-green', label: 'Paid' },
    overdue: { cls: 'badge badge-red', label: 'Overdue' },
    partial: { cls: 'badge badge-purple', label: 'Partial' },
    void: { cls: 'badge', label: 'Void' },
  };
  const m = map[s] ?? { cls: 'badge', label: s || '—' };
  return `<span class="${m.cls}">${m.label}</span>`;
}
