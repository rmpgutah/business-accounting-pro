import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Plus, Power } from 'lucide-react';
import api from '../../../lib/api';
import { useCompanyStore } from '../../../stores/companyStore';
import { formatCurrency } from '../../../lib/format';

interface Policy {
  id: string;
  policy_name: string;
  scope: string;
  category_id: string | null;
  vendor_id: string | null;
  employee_id: string | null;
  max_per_expense: number | null;
  max_per_day: number | null;
  max_per_month: number | null;
  requires_receipt: number;
  requires_approval_over: number | null;
  enforcement: string;
  is_active: number;
}

const emptyDraft = {
  policy_name: '',
  category_id: '',
  max_per_expense: '',
  requires_receipt: true,
  enforcement: 'warn',
};

const PolicyAdmin: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [draft, setDraft] = useState({ ...emptyDraft });
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!activeCompany) return;
    const [pols, cats] = await Promise.all([
      // listExpensePolicies returns ALL policies unless active_only is set —
      // disabled policies stay listed so they can be re-enabled here.
      api.featExpPolicyList({}).catch(() => []),
      api.query('categories', { company_id: activeCompany.id, type: 'expense' }).catch(() => []),
    ]);
    setPolicies(Array.isArray(pols) ? pols : []);
    setCategories(Array.isArray(cats) ? cats : []);
  }, [activeCompany]);

  useEffect(() => { reload(); }, [reload]);

  const save = useCallback(async () => {
    if (!draft.policy_name.trim()) return;
    setBusy(true);
    try {
      await api.featExpPolicyUpsert({
        policy_name: draft.policy_name.trim(),
        scope: draft.category_id ? 'category' : 'global',
        category_id: draft.category_id || null,
        max_per_expense: draft.max_per_expense ? parseFloat(draft.max_per_expense) : null,
        requires_receipt: draft.requires_receipt,
        enforcement: draft.enforcement,
        is_active: true,
      });
      setDraft({ ...emptyDraft });
      setShowForm(false);
      await reload();
    } finally {
      setBusy(false);
    }
  }, [draft, reload]);

  const toggleActive = useCallback(async (p: Policy) => {
    setBusy(true);
    try {
      // expense_policies is not writable via generic db:update (not in the IPC
      // VALID_TABLES allowlist) — toggle through the dedicated upsert handler,
      // passing the full row. upsertExpensePolicy maps booleans strictly
      // (`=== false` / `!== false`), so coerce the 0/1 ints to booleans.
      await api.featExpPolicyUpsert({
        ...p,
        requires_receipt: !!p.requires_receipt,
        is_active: !p.is_active,
      });
      await reload();
    } finally {
      setBusy(false);
    }
  }, [reload]);

  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name || 'All categories';

  return (
    <div className="block-card p-0 overflow-hidden" style={{ borderRadius: 'var(--app-radius)' }}>
      <div className="px-4 py-3 border-b border-border-primary flex items-center justify-between">
        <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider flex items-center gap-2">
          <ShieldCheck size={12} /> Expense Policies
        </div>
        <button className="block-btn flex items-center gap-1 text-xs" onClick={() => setShowForm((v) => !v)}>
          <Plus size={12} /> New Policy
        </button>
      </div>

      {showForm && (
        <div className="px-4 py-3 border-b border-border-primary grid grid-cols-5 gap-3 items-end">
          <label className="text-xs text-text-secondary col-span-2">
            Name
            <input className="block-input w-full mt-1" value={draft.policy_name}
              onChange={(e) => setDraft((d) => ({ ...d, policy_name: e.target.value }))} placeholder="e.g. Meals cap" />
          </label>
          <label className="text-xs text-text-secondary">
            Category
            <select className="block-input w-full mt-1" value={draft.category_id}
              onChange={(e) => setDraft((d) => ({ ...d, category_id: e.target.value }))}>
              <option value="">All</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="text-xs text-text-secondary">
            Max / expense
            <input className="block-input w-full mt-1" type="number" min="0" step="0.01" value={draft.max_per_expense}
              onChange={(e) => setDraft((d) => ({ ...d, max_per_expense: e.target.value }))} placeholder="No cap" />
          </label>
          <div className="flex items-center gap-3">
            <label className="text-xs text-text-secondary flex items-center gap-1.5">
              <input type="checkbox" checked={draft.requires_receipt}
                onChange={(e) => setDraft((d) => ({ ...d, requires_receipt: e.target.checked }))} />
              Receipt
            </label>
            <select className="block-input text-xs" value={draft.enforcement}
              onChange={(e) => setDraft((d) => ({ ...d, enforcement: e.target.value }))}>
              <option value="warn">Warn</option>
              <option value="block">Block</option>
            </select>
            <button className="block-btn-primary text-xs" disabled={busy || !draft.policy_name.trim()} onClick={save}>Save</button>
          </div>
        </div>
      )}

      {policies.length === 0 ? (
        <div className="py-5 text-center text-xs text-text-muted">No policies defined. Policies gate expense saves (warn or block).</div>
      ) : (
        <table className="block-table">
          <thead>
            <tr><th>Name</th><th>Applies To</th><th className="text-right">Max / Expense</th><th>Receipt</th><th>Mode</th><th>Status</th><th className="text-right">Actions</th></tr>
          </thead>
          <tbody>
            {policies.map((p) => (
              <tr key={p.id}>
                <td className="text-text-primary text-xs">{p.policy_name}</td>
                <td className="text-text-secondary text-xs">{catName(p.category_id)}</td>
                <td className="text-right font-mono text-text-primary text-xs">{p.max_per_expense != null ? formatCurrency(p.max_per_expense) : '—'}</td>
                <td className="text-text-secondary text-xs">{p.requires_receipt ? 'Required' : 'Optional'}</td>
                <td className="text-text-secondary text-xs capitalize">{p.enforcement}</td>
                <td className="text-xs">
                  <span className={p.is_active ? 'text-accent-income' : 'text-text-muted'}>{p.is_active ? 'Active' : 'Inactive'}</span>
                </td>
                <td className="text-right">
                  <button className="block-btn flex items-center gap-1 text-xs ml-auto" disabled={busy} onClick={() => toggleActive(p)}>
                    <Power size={12} /> {p.is_active ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default PolicyAdmin;
