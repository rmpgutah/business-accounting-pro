// JEAuthorLeaderboard.tsx — full leaderboard with sortable columns.
import React, { useMemo, useState } from 'react';
import { formatCurrency } from '../../lib/format';

interface JE {
  id: string; entry_number: string; date: string; description: string;
  is_posted: number; created_at: string; created_by: string;
  approved_by?: string; approved_at?: string;
  total_debit: number; total_credit: number;
}

type SortKey = 'count' | 'total' | 'rejected' | 'avg';

const JEAuthorLeaderboard: React.FC<{ entries: JE[] }> = ({ entries }) => {
  const [sortKey, setSortKey] = useState<SortKey>('count');

  const rows = useMemo(() => {
    const m = new Map<string, { user: string; count: number; total: number; rejected: number; avgPostMins: number; postCount: number }>();
    entries.forEach((e) => {
      const u = e.created_by || '(unknown)';
      if (!m.has(u)) m.set(u, { user: u, count: 0, total: 0, rejected: 0, avgPostMins: 0, postCount: 0 });
      const r = m.get(u)!;
      r.count++;
      r.total += e.total_debit;
      if (!e.is_posted && e.approved_at) r.rejected++;
      if (e.is_posted && e.created_at && e.approved_at) {
        const dt = (new Date(e.approved_at).getTime() - new Date(e.created_at).getTime()) / 60000;
        if (dt > 0) { r.avgPostMins += dt; r.postCount++; }
      }
    });
    const arr = Array.from(m.values()).map((r) => ({
      ...r,
      avgPostMins: r.postCount ? r.avgPostMins / r.postCount : 0,
    }));
    arr.sort((a, b) => {
      if (sortKey === 'count') return b.count - a.count;
      if (sortKey === 'total') return b.total - a.total;
      if (sortKey === 'rejected') return b.rejected - a.rejected;
      return b.avgPostMins - a.avgPostMins;
    });
    return arr;
  }, [entries, sortKey]);

  const Th: React.FC<{ k: SortKey; children: React.ReactNode }> = ({ k, children }) => (
    <th
      onClick={() => setSortKey(k)}
      className={`cursor-pointer text-right ${sortKey === k ? 'text-accent-blue' : ''}`}
    >{children}</th>
  );

  return (
    <div className="block-card" style={{ padding: 16 }}>
      <h3 className="text-sm font-bold uppercase text-text-primary mb-2">JE Author Leaderboard</h3>
      <div className="overflow-auto max-h-96">
        <table className="block-table w-full text-xs">
          <thead>
            <tr>
              <th>User</th>
              <Th k="count"># JEs</Th>
              <Th k="total">$ Posted</Th>
              <Th k="rejected">Rejected</Th>
              <Th k="avg">Avg Time-to-Post</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.user}>
                <td>{r.user}</td>
                <td className="text-right font-mono">{r.count}</td>
                <td className="text-right font-mono">{formatCurrency(r.total)}</td>
                <td className="text-right font-mono">{r.rejected}</td>
                <td className="text-right font-mono">{r.avgPostMins ? `${r.avgPostMins.toFixed(0)} min` : '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="text-center text-text-muted py-4">No entries.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default JEAuthorLeaderboard;
