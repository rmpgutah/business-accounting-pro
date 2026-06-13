import React, { useState, useEffect, useCallback } from 'react';
import { FileX, Plus, RefreshCw, CheckCircle, XCircle } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';

// ─── Types ───────────────────────────────────────────────────
interface CreditMemo {
  id: string;
  company_id: string;
  invoice_id: string | null;
  client_id: string | null;
  memo_number: string;
  amount: number;
  reason: string;
  issued_date: string;
  status: 'issued' | 'applied' | 'voided';
  applied_to_invoice_id: string | null;
  invoice_number: string | null;
}

interface CreditMemoSummary {
  issuedCount: number;
  issuedTotal: number;
  appliedCount: number;
  appliedTotal: number;
}

const EMPTY_FORM = {
  invoice_id: '',
  client_id: '',
  amount: '',
  reason: '',
  issued_date: '',
};

const EMPTY_APPLY = {
  memoId: '',
  toInvoiceId: '',
};

// ─── Component ───────────────────────────────────────────────
const CreditMemosPanel: React.FC = () => {
  const [memos, setMemos] = useState<CreditMemo[]>([]);
  const [summary, setSummary] = useState<CreditMemoSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Apply form
  const [showApply, setShowApply] = useState(false);
  const [applyForm, setApplyForm] = useState(EMPTY_APPLY);
  const [applying, setApplying] = useState(false);
  const [applyMsg, setApplyMsg] = useState('');

  const load = useCallback(async () => {
    let cancelled = false;
    setLoading(true);
    try {
      const listResult = await (api as any).ivCreditMemos();
      if (cancelled) return;
      setMemos(Array.isArray(listResult) ? listResult : []);
    } catch (err) {
      console.error('CreditMemosPanel load memos:', err);
    }
    try {
      const sumResult = await (api as any).ivCreditMemoSummary();
      if (cancelled) return;
      setSummary(sumResult || null);
    } catch (err) {
      console.error('CreditMemosPanel load summary:', err);
    }
    if (!cancelled) setLoading(false);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const amount = parseFloat(form.amount);
    if (isNaN(amount) || amount <= 0) { setFormError('Amount must be positive.'); return; }
    if (!form.reason.trim()) { setFormError('Reason is required.'); return; }
    setSaving(true);
    try {
      await (api as any).ivCreditMemoCreate({
        invoice_id: form.invoice_id.trim() || null,
        client_id: form.client_id.trim() || null,
        amount,
        reason: form.reason.trim(),
        issued_date: form.issued_date || new Date().toISOString().slice(0, 10),
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
    } catch (err: any) {
      setFormError(err?.message || 'Failed to create credit memo.');
    } finally {
      setSaving(false);
    }
  };

  const handleApply = async (e: React.FormEvent) => {
    e.preventDefault();
    setApplyMsg('');
    if (!applyForm.memoId.trim() || !applyForm.toInvoiceId.trim()) {
      setApplyMsg('Both Memo ID and Invoice ID are required.');
      return;
    }
    setApplying(true);
    try {
      const r = await (api as any).ivCreditMemoApply(applyForm.memoId.trim(), applyForm.toInvoiceId.trim());
      if (r?.error) {
        setApplyMsg(r.error);
      } else {
        setApplyMsg(`Applied ${formatCurrency(r?.applied || 0)} to invoice.`);
        setApplyForm(EMPTY_APPLY);
        await load();
      }
    } catch (err: any) {
      setApplyMsg(err?.message || 'Failed to apply credit memo.');
    } finally {
      setApplying(false);
    }
  };

  const handleVoid = async (id: string, memoNumber: string) => {
    if (!window.confirm(`Void credit memo ${memoNumber}? This cannot be undone.`)) return;
    try {
      await (api as any).ivCreditMemoVoid(id);
      await load();
    } catch (err) {
      console.error('Void credit memo:', err);
    }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; color: string }> = {
      issued: { label: 'Issued', color: 'text-accent-income' },
      applied: { label: 'Applied', color: 'text-accent-blue' },
      voided: { label: 'Voided', color: 'text-text-muted' },
    };
    const s = map[status] || { label: status, color: 'text-text-muted' };
    return <span className={`text-[11px] font-semibold ${s.color}`}>{s.label}</span>;
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileX size={18} className="text-accent-primary" />
          <h3 className="text-base font-bold text-text-primary">Credit Memos</h3>
        </div>
        <div className="flex items-center gap-2">
          <button className="block-btn flex items-center gap-1" onClick={load} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            className="block-btn flex items-center gap-1"
            onClick={() => { setShowApply((v) => !v); setApplyMsg(''); setApplyForm(EMPTY_APPLY); }}
          >
            <CheckCircle size={14} />
            Apply Memo
          </button>
          <button
            className="block-btn-primary flex items-center gap-1"
            onClick={() => { setShowForm((v) => !v); setFormError(''); setForm(EMPTY_FORM); }}
          >
            <Plus size={14} />
            New Memo
          </button>
        </div>
      </div>

      {/* Summary KPIs */}
      {summary && (
        <div className="grid grid-cols-4 gap-3">
          <div className="block-card p-4">
            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Issued (Open)</div>
            <div className="text-xl font-bold font-mono text-text-primary">{summary.issuedCount}</div>
          </div>
          <div className="block-card p-4">
            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Open Balance</div>
            <div className="text-xl font-bold font-mono text-accent-warning">{formatCurrency(summary.issuedTotal)}</div>
          </div>
          <div className="block-card p-4">
            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Applied</div>
            <div className="text-xl font-bold font-mono text-text-primary">{summary.appliedCount}</div>
          </div>
          <div className="block-card p-4">
            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Total Applied</div>
            <div className="text-xl font-bold font-mono text-accent-income">{formatCurrency(summary.appliedTotal)}</div>
          </div>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <div className="block-card p-5">
          <h4 className="text-sm font-semibold text-text-primary mb-4">New Credit Memo</h4>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-text-muted mb-1 font-semibold uppercase">Invoice ID (optional)</label>
                <input
                  className="block-input w-full font-mono"
                  value={form.invoice_id}
                  onChange={(e) => setForm((f) => ({ ...f, invoice_id: e.target.value }))}
                  placeholder="Paste invoice UUID"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1 font-semibold uppercase">Client ID (optional)</label>
                <input
                  className="block-input w-full font-mono"
                  value={form.client_id}
                  onChange={(e) => setForm((f) => ({ ...f, client_id: e.target.value }))}
                  placeholder="Paste client UUID"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] text-text-muted mb-1 font-semibold uppercase">Amount ($) *</label>
                <input
                  className="block-input w-full"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  placeholder="50.00"
                />
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1 font-semibold uppercase">Issued Date</label>
                <input
                  className="block-input w-full"
                  type="date"
                  value={form.issued_date}
                  onChange={(e) => setForm((f) => ({ ...f, issued_date: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1 font-semibold uppercase">Reason *</label>
                <input
                  className="block-input w-full"
                  value={form.reason}
                  onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                  placeholder="Overcharge, return, goodwill…"
                />
              </div>
            </div>
            {formError && <div className="text-xs text-accent-expense">{formError}</div>}
            <div className="flex items-center gap-2 pt-1">
              <button type="submit" className="block-btn-primary" disabled={saving}>
                {saving ? 'Creating…' : 'Create Credit Memo'}
              </button>
              <button type="button" className="block-btn" onClick={() => { setShowForm(false); setFormError(''); }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Apply form */}
      {showApply && (
        <div className="block-card p-5">
          <h4 className="text-sm font-semibold text-text-primary mb-4">Apply Credit Memo to Invoice</h4>
          <form onSubmit={handleApply} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-text-muted mb-1 font-semibold uppercase">Credit Memo ID *</label>
                <input
                  className="block-input w-full font-mono"
                  value={applyForm.memoId}
                  onChange={(e) => setApplyForm((f) => ({ ...f, memoId: e.target.value }))}
                  placeholder="Paste memo UUID"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1 font-semibold uppercase">Target Invoice ID *</label>
                <input
                  className="block-input w-full font-mono"
                  value={applyForm.toInvoiceId}
                  onChange={(e) => setApplyForm((f) => ({ ...f, toInvoiceId: e.target.value }))}
                  placeholder="Paste invoice UUID"
                />
              </div>
            </div>
            {applyMsg && (
              <div className={`text-xs flex items-center gap-1.5 ${applyMsg.startsWith('Applied') ? 'text-accent-income' : 'text-accent-expense'}`}>
                {applyMsg.startsWith('Applied')
                  ? <CheckCircle size={13} />
                  : <XCircle size={13} />}
                {applyMsg}
              </div>
            )}
            <div className="flex items-center gap-2 pt-1">
              <button type="submit" className="block-btn-primary" disabled={applying}>
                {applying ? 'Applying…' : 'Apply Memo'}
              </button>
              <button type="button" className="block-btn" onClick={() => { setShowApply(false); setApplyMsg(''); }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Memos list */}
      <div className="block-card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border-primary flex items-center justify-between">
          <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Credit Memos</span>
          <span className="text-[11px] text-text-muted">{memos.length} total</span>
        </div>
        {loading ? (
          <div className="p-6 text-center text-sm text-text-muted">Loading…</div>
        ) : memos.length === 0 ? (
          <div className="p-8 text-center text-sm text-text-muted">
            No credit memos yet. Create one to issue credit to a client.
          </div>
        ) : (
          <table className="block-table">
            <thead>
              <tr>
                <th>Memo #</th>
                <th>Reason</th>
                <th>Invoice #</th>
                <th className="text-right">Amount</th>
                <th>Issued</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {memos.map((m) => (
                <tr key={m.id}>
                  <td className="font-mono font-semibold text-text-primary">{m.memo_number}</td>
                  <td className="text-text-secondary max-w-xs truncate">{m.reason || '—'}</td>
                  <td className="font-mono text-text-muted text-sm">{m.invoice_number || '—'}</td>
                  <td className="text-right font-mono text-accent-expense">{formatCurrency(m.amount)}</td>
                  <td className="text-text-muted text-sm">{formatDate(m.issued_date)}</td>
                  <td>{statusBadge(m.status)}</td>
                  <td>
                    {m.status === 'issued' && (
                      <button
                        className="block-btn text-xs text-accent-expense flex items-center gap-1"
                        style={{ borderColor: 'transparent' }}
                        onClick={() => handleVoid(m.id, m.memo_number)}
                        title="Void credit memo"
                      >
                        <XCircle size={12} />
                        Void
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default CreditMemosPanel;
