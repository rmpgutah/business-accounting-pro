// src/renderer/modules/rules/RuleLog.tsx
import React from 'react';

interface LogEntry { id: string; ran_at: string; status: string; detail: string; }
interface Props { entries: LogEntry[]; }

const STATUS_CLS: Record<string, string> = {
  PASS: 'bg-green-100 text-green-800 border border-green-300',
  FAIL: 'bg-red-100 text-red-800 border border-red-300',
  SKIP: 'bg-gray-100 text-gray-500 border border-gray-200',
};

export const RuleLog: React.FC<Props> = ({ entries }) => {
  if (entries.length === 0) return <p className="text-xs text-gray-400 italic p-4">No run history yet.</p>;
  return (
    <table className="w-full text-xs border-collapse">
      <thead>
        <tr className="border-b border-gray-200 text-left text-gray-500 uppercase tracking-widest">
          <th className="pb-2 pr-4">When</th>
          <th className="pb-2 pr-4">Status</th>
          <th className="pb-2">Detail</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(e => (
          <tr key={e.id} className="border-b border-gray-100">
            <td className="py-2 pr-4 text-gray-400">{new Date(e.ran_at).toLocaleString()}</td>
            <td className="py-2 pr-4">
              <span className={`px-2 py-0.5 font-bold uppercase text-xs ${STATUS_CLS[e.status] ?? STATUS_CLS.SKIP}`}>{e.status}</span>
            </td>
            <td className="py-2 text-gray-600">{e.detail}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
