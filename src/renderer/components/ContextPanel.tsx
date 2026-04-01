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
    ]).then(([outRow, payRow, ytdRow]) => setData({
      outstanding: outRow?.outstanding ?? 0,
      lastPayment: payRow?.last_payment ?? null,
      ytd: ytdRow?.ytd ?? 0,
    }));
  }, [clientId, companyId]);

  if (!clientId || !data) return null;

  return (
    <div className="border border-indigo-100 bg-indigo-50 p-3 text-xs space-y-1.5 mt-2">
      <div className="font-black uppercase tracking-wider text-indigo-600 text-[10px] mb-2">Client Overview</div>
      <div className="flex justify-between">
        <span className="text-gray-500">Outstanding</span>
        <span className={`font-bold ${Number(data.outstanding) > 0 ? 'text-orange-600' : 'text-gray-700'}`}>${Number(data.outstanding).toFixed(2)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-gray-500">Last Payment</span>
        <span className="font-bold">{data.lastPayment ? new Date(data.lastPayment).toLocaleDateString() : '—'}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-gray-500">Invoiced YTD</span>
        <span className="font-bold">${Number(data.ytd).toFixed(2)}</span>
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
    ).then(row => setData(row));
  }, [categoryId, companyId]);

  if (!categoryId || !data) return null;
  const over = Number(data.month_spend) > Number(data.budget) && Number(data.budget) > 0;

  return (
    <div className={`border p-3 text-xs space-y-1.5 mt-2 ${over ? 'border-red-200 bg-red-50' : 'border-gray-100 bg-gray-50'}`}>
      <div className="font-black uppercase tracking-wider text-[10px] mb-2 text-gray-500">Category This Month</div>
      <div className="flex justify-between">
        <span className="text-gray-500">Spent</span>
        <span className={`font-bold ${over ? 'text-red-600' : ''}`}>${Number(data.month_spend).toFixed(2)}</span>
      </div>
      {Number(data.budget) > 0 && (
        <div className="flex justify-between">
          <span className="text-gray-500">Budget</span>
          <span className="font-bold">${Number(data.budget).toFixed(2)}</span>
        </div>
      )}
      {over && <div className="text-red-600 font-bold text-[10px] uppercase tracking-wider">Over budget</div>}
    </div>
  );
};
