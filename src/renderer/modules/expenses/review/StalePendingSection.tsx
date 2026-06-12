import React, { useCallback, useEffect, useState } from 'react';
import { Clock, CheckCircle2, FolderOpen, Trash2 } from 'lucide-react';
import api from '../../../lib/api';
import { useCompanyStore } from '../../../stores/companyStore';
import { formatCurrency, formatDate } from '../../../lib/format';

interface Props {
  onCount: (n: number) => void;
  onViewExpense?: (id: string) => void;
}

interface StaleRow {
  id: string;
  date: string;
  amount: number;
  description: string | null;
  vendor_name: string | null;
}

const StalePendingSection: React.FC<Props> = ({ onCount, onViewExpense }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [rows, setRows] = useState<StaleRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeCompany) return;
    api.rawQuery(
      `SELECT e.id, e.date, e.amount, e.description, v.name AS vendor_name
       FROM expenses e LEFT JOIN vendors v ON v.id = e.vendor_id
       WHERE e.company_id = ? AND e.status = 'pending'
         AND e.date <= date('now', '-7 days') AND e.deleted_at IS NULL
       ORDER BY e.date ASC LIMIT 50`,
      [activeCompany.id]
    )
      .then((r: any) => setRows(Array.isArray(r) ? r : []))
      .catch(() => setRows([]));
  }, [activeCompany]);

  useEffect(() => { onCount(rows.length); }, [rows.length, onCount]);

  const approve = useCallback(async (id: string) => {
    setBusyId(id);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await api.update('expenses', id, { status: 'approved', approved_date: today });
      setRows((rs) => rs.filter((r) => r.id !== id));
    } finally {
      setBusyId(null);
    }
  }, []);

  const voidRow = useCallback(async (id: string) => {
    setBusyId(id);
    try {
      await api.exVoidExpense(id, 'Stale pending (resolved from Review inbox)');
      setRows((rs) => rs.filter((r) => r.id !== id));
    } finally {
      setBusyId(null);
    }
  }, []);

  return (
    <div className="block-card p-0 overflow-hidden" style={{ borderRadius: 'var(--app-radius)' }}>
      <div className="px-4 py-3 border-b border-border-primary flex items-center justify-between">
        <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider flex items-center gap-2">
          <Clock size={12} /> Stale Pending (&gt;7 days)
        </div>
        <span className="text-xs font-mono font-bold text-text-primary">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <div className="py-5 text-center text-xs text-text-muted">Nothing has been sitting in pending.</div>
      ) : (
        <table className="block-table">
          <thead>
            <tr>
              <th>Date</th><th>Description</th><th>Vendor</th>
              <th className="text-right">Amount</th><th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td className="font-mono text-text-secondary text-xs">{formatDate(e.date)}</td>
                <td className="text-text-primary text-xs truncate max-w-[220px]">{e.description || '(no description)'}</td>
                <td className="text-text-secondary text-xs truncate max-w-[120px]">{e.vendor_name || '-'}</td>
                <td className="text-right font-mono text-accent-expense text-xs">{formatCurrency(e.amount)}</td>
                <td className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button className="block-btn flex items-center gap-1 text-xs text-accent-income" disabled={busyId === e.id} onClick={() => approve(e.id)}>
                      <CheckCircle2 size={12} /> Approve
                    </button>
                    <button className="block-btn flex items-center gap-1 text-xs text-accent-expense" disabled={busyId === e.id} onClick={() => voidRow(e.id)}>
                      <Trash2 size={12} /> Void
                    </button>
                    {onViewExpense && (
                      <button className="block-btn flex items-center gap-1 text-xs" onClick={() => onViewExpense(e.id)}>
                        <FolderOpen size={12} /> Open
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default StalePendingSection;
