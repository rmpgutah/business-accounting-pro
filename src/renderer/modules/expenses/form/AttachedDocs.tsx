import React, { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import api from '../../../lib/api';

// ─── Attached Documents (for receipt linking) ─────────
const AttachedDocs: React.FC<{ expenseId: string }> = ({ expenseId }) => {
  const [docs, setDocs] = useState<any[]>([]);
  useEffect(() => {
    api.rawQuery("SELECT * FROM documents WHERE entity_type = 'expense' AND entity_id = ?", [expenseId])
      .then(r => setDocs(Array.isArray(r) ? r : []))
      .catch(() => {});
  }, [expenseId]);
  if (docs.length === 0) return null;
  return (
    <div className="mt-2 space-y-1">
      <p className="text-xs text-text-muted font-semibold uppercase tracking-wider">Attached Documents</p>
      {docs.map((d: any) => (
        <div key={d.id} className="flex items-center gap-2 text-xs text-text-secondary">
          <FileText size={12} className="text-accent-blue" />
          <span className="truncate">{d.filename}</span>
        </div>
      ))}
    </div>
  );
};

export default AttachedDocs;
