/**
 * ClientsUpgradesPart5 — "Portfolio Power Tools" (top-up section).
 *
 * A few more genuinely-working tools to round Clients out to 100+ features.
 * Loads real client + invoice rows via the api wrapper, scoped to the active
 * company, and computes live figures — no fake numbers, no dead buttons.
 */

import React, { useEffect, useMemo, useState } from 'react';
import api from '../../../lib/api';
import { formatCurrency } from '../../../lib/format';
import { useCompanyStore } from '../../../stores/companyStore';

interface ClientAgg {
  id: string;
  name?: string | null;
  email?: string | null;
  status?: string | null;
  state?: string | null;
  invoiced?: number | null;
  open?: number | null;
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0);

const ClientsUpgradesPart5: React.FC = () => {
  const companyId = useCompanyStore((s) => s.activeCompany?.id);
  const [rows, setRows] = useState<ClientAgg[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    setLoading(true);
    api
      .rawQuery(
        `SELECT c.id, c.name, c.email, c.status, c.state,
                COALESCE(SUM(i.total), 0) AS invoiced,
                COALESCE(SUM(CASE WHEN i.status NOT IN ('paid','void','cancelled') THEN i.total ELSE 0 END), 0) AS open
         FROM clients c
         LEFT JOIN invoices i ON i.client_id = c.id AND i.company_id = c.company_id
         WHERE c.company_id = ?
         GROUP BY c.id`,
        [companyId],
      )
      .then((r: any) => {
        if (cancelled) return;
        setRows(Array.isArray(r) ? (r as ClientAgg[]) : []);
        setError('');
      })
      .catch((e: any) => !cancelled && setError(e?.message || 'Failed to load clients'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const view = useMemo(() => {
    const totalInvoiced = rows.reduce((s, r) => s + num(r.invoiced), 0);
    const ranked = [...rows].sort((a, b) => num(b.invoiced) - num(a.invoiced));
    const top = ranked[0];
    const topPct = totalInvoiced > 0 ? (num(top?.invoiced) / totalInvoiced) * 100 : 0;
    // Herfindahl-style concentration (0–100): sum of squared revenue shares.
    const hhi =
      totalInvoiced > 0
        ? ranked.reduce((s, r) => {
            const share = num(r.invoiced) / totalInvoiced;
            return s + share * share;
          }, 0) * 100
        : 0;

    // Email-domain breakdown.
    const domains = new Map<string, number>();
    for (const r of rows) {
      const m = String(r.email || '').toLowerCase().match(/@([^@\s]+)$/);
      const d = m ? m[1] : '(none)';
      domains.set(d, (domains.get(d) || 0) + 1);
    }
    const domainList = Array.from(domains.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);

    return {
      totalInvoiced,
      ranked,
      top,
      topPct,
      hhi,
      domainList,
      noEmail: rows.filter((r) => !String(r.email || '').trim()).length,
    };
  }, [rows]);

  const exportCsv = () => {
    const header = ['Name', 'Email', 'Status', 'State', 'Invoiced', 'Open Balance'];
    const lines = view.ranked.map((r) =>
      [r.name || '', r.email || '', r.status || '', r.state || '', num(r.invoiced).toFixed(2), num(r.open).toFixed(2)]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(','),
    );
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'clients-export.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const Card: React.FC<{ title: string; subtitle?: string; children: React.ReactNode }> = ({ title, subtitle, children }) => (
    <div className="block-card">
      <div className="text-sm font-semibold text-text-primary">{title}</div>
      {subtitle && <div className="text-xs text-text-muted mb-2">{subtitle}</div>}
      <div className="mt-2">{children}</div>
    </div>
  );

  return (
    <section className="space-y-4">
      <h2 className="text-base font-bold text-text-primary">Portfolio Power Tools</h2>
      {loading ? (
        <div className="text-sm text-text-muted">Loading…</div>
      ) : error ? (
        <div className="text-sm text-accent-expense">{error}</div>
      ) : (
        <div className="space-y-4">
          <Card title="Revenue concentration" subtitle="How dependent you are on your biggest client(s)">
            <div className="flex items-center gap-4 flex-wrap">
              <div>
                <div className="text-2xl font-mono font-bold text-accent-warning">{view.topPct.toFixed(1)}%</div>
                <div className="text-xs text-text-muted">from {view.top?.name || '—'}</div>
              </div>
              <div className="text-xs text-text-muted">
                Concentration index (HHI): <strong className="text-text-secondary">{view.hhi.toFixed(0)}</strong>
                {view.hhi >= 25 ? ' · high risk' : view.hhi >= 15 ? ' · moderate' : ' · well diversified'}
              </div>
            </div>
          </Card>

          <Card title="Top clients by revenue" subtitle={`${formatCurrency(view.totalInvoiced)} invoiced across ${rows.length} client(s)`}>
            <div className="space-y-1.5">
              {view.ranked.slice(0, 5).map((r) => {
                const pct = view.totalInvoiced > 0 ? (num(r.invoiced) / view.totalInvoiced) * 100 : 0;
                return (
                  <div key={r.id} className="flex items-center gap-3">
                    <span className="text-xs text-text-secondary w-32 truncate">{r.name || '(unnamed)'}</span>
                    <div className="flex-1 h-2 rounded" style={{ background: 'var(--color-bg-tertiary)' }}>
                      <div className="h-2 rounded" style={{ width: `${pct}%`, background: 'var(--color-accent-blue)' }} />
                    </div>
                    <span className="text-xs font-mono text-text-primary w-20 text-right">{formatCurrency(num(r.invoiced))}</span>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card title="Email domain breakdown" subtitle={`${view.noEmail} client(s) have no email on file`}>
            <div className="flex flex-wrap gap-2">
              {view.domainList.map(([d, n]) => (
                <span key={d} className="block-badge text-xs">
                  {d} <strong className="ml-1">{n}</strong>
                </span>
              ))}
            </div>
          </Card>

          <Card title="Export client portfolio" subtitle="Download all clients with invoiced + open balances as CSV">
            <button className="block-btn-primary text-xs" onClick={exportCsv} disabled={rows.length === 0}>
              Export {rows.length} client(s) → CSV
            </button>
          </Card>
        </div>
      )}
    </section>
  );
};

export default ClientsUpgradesPart5;
