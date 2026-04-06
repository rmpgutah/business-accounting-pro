// src/renderer/modules/rules/RuleLog.tsx
import React from 'react';
import { formatDate } from '../../lib/format';

interface LogEntry { id: string; ran_at: string; status: string; detail: string; }
interface Props { entries: LogEntry[]; }

const STATUS_CLS: Record<string, string> = {
  PASS: 'bg-green-100 text-green-800 border border-green-300',
  FAIL: 'bg-red-100 text-red-800 border border-red-300',
  SKIP: 'bg-bg-tertiary text-text-muted border border-border-primary',
};

export const RuleLog: React.FC<Props> = ({ entries }) => {
  if (entries.length === 0) return <p className="text-xs text-text-muted italic p-4">No run history yet.</p>;
  return (
    <table className="w-full text-xs border-collapse">
      <thead>
        <tr className="border-b border-border-primary text-left text-text-muted uppercase tracking-widest">
          <th className="pb-2 pr-4">When</th>
          <th className="pb-2 pr-4">Status</th>
          <th className="pb-2">Detail</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(e => (
          <tr key={e.id} className="border-b border-border-primary">
            <td className="py-2 pr-4 text-text-muted">{formatDate(e.ran_at)}</td>
            <td className="py-2 pr-4">
              <span className={`px-2 py-0.5 font-bold uppercase text-xs ${STATUS_CLS[e.status] ?? STATUS_CLS.SKIP}`}>{e.status}</span>
            </td>
            <td className="py-2 text-text-secondary">{e.detail}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
