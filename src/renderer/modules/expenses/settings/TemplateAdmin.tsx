import React, { useCallback, useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import api from '../../../lib/api';
import { useCompanyStore } from '../../../stores/companyStore';
import { formatCurrency, formatDate } from '../../../lib/format';

interface Tpl {
  id: string;
  template_name: string;
  default_amount: number | null;
  description: string | null;
  use_count: number;
  last_used_at: string | null;
  is_active: number;
}

// Read-only: expense_templates_v2 has no renderer-safe write path for a
// toggle — it is not in the IPC VALID_TABLES allowlist (generic db:update
// rejects it), saveExpenseTemplate is insert-only (always is_active=1, ignores
// id), and listExpenseTemplates filters to is_active=1 so a disabled row
// could never be re-enabled from here. Templates are created from the expense
// form/save flows.
const TemplateAdmin: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [tpls, setTpls] = useState<Tpl[]>([]);

  const reload = useCallback(async () => {
    if (!activeCompany) return;
    const r = await api.featExpTplList().catch(() => []);
    setTpls(Array.isArray(r) ? r : []);
  }, [activeCompany]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <div className="block-card p-0 overflow-hidden" style={{ borderRadius: 'var(--app-radius)' }}>
      <div className="px-4 py-3 border-b border-border-primary">
        <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider flex items-center gap-2">
          <FileText size={12} /> Expense Templates
        </div>
      </div>
      {tpls.length === 0 ? (
        <div className="py-5 text-center text-xs text-text-muted">No saved templates yet. Save one from the expense form.</div>
      ) : (
        <table className="block-table">
          <thead>
            <tr><th>Name</th><th>Description</th><th className="text-right">Default Amount</th><th className="text-right">Uses</th><th>Last Used</th></tr>
          </thead>
          <tbody>
            {tpls.map((t) => (
              <tr key={t.id}>
                <td className="text-text-primary text-xs">{t.template_name}</td>
                <td className="text-text-secondary text-xs truncate max-w-[220px]">{t.description || '-'}</td>
                <td className="text-right font-mono text-text-primary text-xs">{t.default_amount != null ? formatCurrency(t.default_amount) : '—'}</td>
                <td className="text-right font-mono text-text-secondary text-xs">{t.use_count}</td>
                <td className="font-mono text-text-secondary text-xs">{t.last_used_at ? formatDate(t.last_used_at) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default TemplateAdmin;
