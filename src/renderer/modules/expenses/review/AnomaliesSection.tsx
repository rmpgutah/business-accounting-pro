import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, FolderOpen, EyeOff } from 'lucide-react';
import api from '../../../lib/api';
import { formatCurrency, formatDate } from '../../../lib/format';

interface Props {
  onCount: (n: number) => void;
  onViewExpense?: (id: string) => void;
}

interface AnomalyRow {
  id: string;
  amount: number;
  date: string;
  description: string | null;
  vendor_name: string | null;
  avg_amt: number;
  z_score: number;
  tags?: string | null;
}

const DISMISS_TAG = 'anomaly_dismissed';

function parseTags(raw: string | null | undefined): string[] {
  try {
    const t = JSON.parse(raw || '[]');
    return Array.isArray(t) ? t : [];
  } catch {
    return [];
  }
}

const AnomaliesSection: React.FC<Props> = ({ onCount, onViewExpense }) => {
  const [rows, setRows] = useState<AnomalyRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    api.exVendorAnomalies(2)
      .then((r: any) => {
        const list = Array.isArray(r) ? r : [];
        setRows(list.filter((a: AnomalyRow) => !parseTags(a.tags).includes(DISMISS_TAG)));
      })
      .catch(() => setRows([]));
  }, []);

  useEffect(() => { onCount(rows.length); }, [rows.length, onCount]);

  const dismiss = useCallback(async (row: AnomalyRow) => {
    setBusyId(row.id);
    try {
      const tags = parseTags(row.tags);
      tags.push(DISMISS_TAG);
      await api.update('expenses', row.id, { tags: JSON.stringify(tags) });
      setRows((rs) => rs.filter((r) => r.id !== row.id));
    } finally {
      setBusyId(null);
    }
  }, []);

  return (
    <div className="block-card p-0 overflow-hidden" style={{ borderRadius: 'var(--app-radius)' }}>
      <div className="px-4 py-3 border-b border-border-primary flex items-center justify-between">
        <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider flex items-center gap-2">
          <AlertTriangle size={12} /> Vendor Anomalies
        </div>
        <span className="text-xs font-mono font-bold text-text-primary">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <div className="py-5 text-center text-xs text-text-muted">No unusual vendor charges detected.</div>
      ) : (
        <table className="block-table">
          <thead>
            <tr>
              <th>Date</th><th>Vendor</th><th>Description</th>
              <th className="text-right">Amount</th><th className="text-right">Vendor Avg</th>
              <th className="text-right">σ</th><th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td className="font-mono text-text-secondary text-xs">{formatDate(a.date)}</td>
                <td className="text-text-secondary text-xs truncate max-w-[120px]">{a.vendor_name || '-'}</td>
                <td className="text-text-primary text-xs truncate max-w-[180px]">{a.description || '(no description)'}</td>
                <td className="text-right font-mono text-accent-expense text-xs">{formatCurrency(a.amount)}</td>
                <td className="text-right font-mono text-text-muted text-xs">{formatCurrency(a.avg_amt)}</td>
                <td className="text-right font-mono text-accent-warning text-xs">{a.z_score.toFixed(1)}</td>
                <td className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button className="block-btn flex items-center gap-1 text-xs" disabled={busyId === a.id} onClick={() => dismiss(a)}>
                      <EyeOff size={12} /> Dismiss
                    </button>
                    {onViewExpense && (
                      <button className="block-btn flex items-center gap-1 text-xs" onClick={() => onViewExpense(a.id)}>
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

export default AnomaliesSection;
