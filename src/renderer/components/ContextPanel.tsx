// src/renderer/components/ContextPanel.tsx
import React, { useEffect, useState } from 'react';
import api from '../lib/api';

interface ClientContextProps { clientId: string | null; companyId: string; }

export const ClientContext: React.FC<ClientContextProps> = ({ clientId, companyId }) => {
  const [data, setData] = useState<{ outstanding: number; lastPayment: string | null; ytd: number } | null>(null);

  useEffect(() => {
    if (!clientId) { setData(null); return; }
    Promise.all([
      api.rawQuery(`SELECT COALESCE(SUM(total - amount_paid), 0) as outstanding FROM invoices WHERE client_id = ? AND company_id = ? AND status NOT IN ('paid','cancelled')`, [clientId, companyId]),
      api.rawQuery(`SELECT MAX(paid_date) as last_payment FROM invoices WHERE client_id = ? AND company_id = ? AND status = 'paid'`, [clientId, companyId]),
      api.rawQuery(`SELECT COALESCE(SUM(total), 0) as ytd FROM invoices WHERE client_id = ? AND company_id = ? AND strftime('%Y', issue_date) = strftime('%Y', 'now')`, [clientId, companyId]),
    ])
      .then(([outRow, payRow, ytdRow]) => setData({
        outstanding: outRow?.outstanding ?? 0,
        lastPayment: payRow?.last_payment ?? null,
        ytd: ytdRow?.ytd ?? 0,
      }))
      .catch((err) => { console.error('[ClientContext] load failed:', err); setData(null); });
  }, [clientId, companyId]);

  if (!clientId || !data) return null;

  return (
    <div
      className="p-3 text-xs space-y-1.5 mt-2"
      style={{
        background: 'var(--color-accent-blue-bg)',
        border: '1px solid var(--color-accent-blue)',
        borderRadius: '2px',
      }}
    >
      <div className="font-black uppercase tracking-wider text-accent-blue text-[10px] mb-2">Client Overview</div>
      <div className="flex justify-between">
        <span className="text-text-muted">Outstanding</span>
        <span className={`font-bold font-mono ${Number(data.outstanding) > 0 ? 'text-accent-warning' : 'text-text-secondary'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>${Number(data.outstanding).toFixed(2)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-text-muted">Last Payment</span>
        <span className="font-bold text-text-secondary">{data.lastPayment ? new Date(data.lastPayment).toLocaleDateString() : '—'}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-text-muted">Invoiced YTD</span>
        <span className="font-bold font-mono text-text-secondary" style={{ fontVariantNumeric: 'tabular-nums' }}>${Number(data.ytd).toFixed(2)}</span>
      </div>
    </div>
  );
};

interface CategoryContextProps { categoryId: string | null; companyId: string; }

export const CategoryContext: React.FC<CategoryContextProps> = ({ categoryId, companyId }) => {
  const [data, setData] = useState<{ month_spend: number; budget: number } | null>(null);

  useEffect(() => {
    if (!categoryId) { setData(null); return; }
    api.rawQuery(
      `SELECT
        COALESCE(SUM(CASE WHEN strftime('%Y-%m', date) = strftime('%Y-%m', 'now') THEN amount ELSE 0 END), 0) as month_spend,
        COALESCE((SELECT bl.amount FROM budget_lines bl WHERE bl.category_id = ? LIMIT 1), 0) as budget
      FROM expenses WHERE company_id = ? AND category_id = ?`,
      [categoryId, companyId, categoryId]
    )
      .then(row => setData(row ?? { month_spend: 0, budget: 0 }))
      .catch((err) => { console.error('[CategoryContext] load failed:', err); setData(null); });
  }, [categoryId, companyId]);

  if (!categoryId || !data) return null;
  const over = Number(data.month_spend) > Number(data.budget) && Number(data.budget) > 0;

  return (
    <div
      className="p-3 text-xs space-y-1.5 mt-2"
      style={{
        background: over ? 'var(--color-accent-expense-bg)' : 'var(--color-bg-secondary)',
        border: `1px solid ${over ? 'var(--color-accent-expense)' : 'var(--color-border-primary)'}`,
        borderRadius: '2px',
      }}
    >
      <div className="font-black uppercase tracking-wider text-[10px] mb-2 text-text-muted">Category This Month</div>
      <div className="flex justify-between">
        <span className="text-text-muted">Spent</span>
        <span className={`font-bold font-mono ${over ? 'text-accent-expense' : 'text-text-secondary'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>${Number(data.month_spend).toFixed(2)}</span>
      </div>
      {Number(data.budget) > 0 && (
        <div className="flex justify-between">
          <span className="text-text-muted">Budget</span>
          <span className="font-bold font-mono text-text-secondary" style={{ fontVariantNumeric: 'tabular-nums' }}>${Number(data.budget).toFixed(2)}</span>
        </div>
      )}
      {over && <div className="text-accent-expense font-bold text-[10px] uppercase tracking-wider">Over budget</div>}
    </div>
  );
};
