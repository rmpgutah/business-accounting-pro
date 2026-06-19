import React, { useCallback, useEffect, useState } from 'react';
import { Copy, FolderOpen, Trash2 } from 'lucide-react';
import api from '../../../lib/api';
import { formatCurrency, formatDate } from '../../../lib/format';

interface Props {
  onCount: (n: number) => void;
  onViewExpense?: (id: string) => void;
}

interface DupPair {
  id1: string;
  id2: string;
  amount: number;
  date: string;
  description: string | null;
  vendor_name: string | null;
}

const DuplicatesSection: React.FC<Props> = ({ onCount, onViewExpense }) => {
  const [pairs, setPairs] = useState<DupPair[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    api.exFindDuplicates()
      .then((r: any) => setPairs(Array.isArray(r) ? r : []))
      .catch(() => setPairs([]));
  }, []);

  useEffect(() => { onCount(pairs.length); }, [pairs.length, onCount]);

  const voidOne = useCallback(async (pair: DupPair, voidId: string) => {
    const key = `${pair.id1}-${pair.id2}`;
    setBusyKey(key);
    try {
      await api.exVoidExpense(voidId, 'Duplicate (resolved from Review inbox)');
      setPairs((rows) => rows.filter((p) => `${p.id1}-${p.id2}` !== key));
    } finally {
      setBusyKey(null);
    }
  }, []);

  return (
    <div className="block-card p-0 overflow-hidden" style={{ borderRadius: 'var(--app-radius)' }}>
      <div className="px-4 py-3 border-b border-border-primary flex items-center justify-between">
        <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider flex items-center gap-2">
          <Copy size={12} /> Possible Duplicates
        </div>
        <span className="text-xs font-mono font-bold text-text-primary">{pairs.length}</span>
      </div>
      {pairs.length === 0 ? (
        <div className="py-5 text-center text-xs text-text-muted">No suspected duplicate pairs.</div>
      ) : (
        <table className="block-table">
          <thead>
            <tr>
              <th>Date</th><th>Description</th><th>Vendor</th>
              <th className="text-right">Amount</th><th className="text-right">Resolve</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((p) => {
              const key = `${p.id1}-${p.id2}`;
              return (
                <tr key={key}>
                  <td className="font-mono text-text-secondary text-xs">{formatDate(p.date)}</td>
                  <td className="text-text-primary text-xs truncate max-w-[200px]">{p.description || '(no description)'}</td>
                  <td className="text-text-secondary text-xs truncate max-w-[120px]">{p.vendor_name || '-'}</td>
                  <td className="text-right font-mono text-accent-expense text-xs">{formatCurrency(p.amount)} ×2</td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {onViewExpense && (
                        <>
                          <button className="block-btn flex items-center gap-1 text-xs" onClick={() => onViewExpense(p.id1)}>
                            <FolderOpen size={12} /> #1
                          </button>
                          <button className="block-btn flex items-center gap-1 text-xs" onClick={() => onViewExpense(p.id2)}>
                            <FolderOpen size={12} /> #2
                          </button>
                        </>
                      )}
                      <button
                        className="block-btn flex items-center gap-1 text-xs text-accent-expense"
                        disabled={busyKey === key}
                        title="Keep the first, void the second"
                        onClick={() => voidOne(p, p.id2)}
                      >
                        <Trash2 size={12} /> Void dup
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default DuplicatesSection;
