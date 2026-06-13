import React, { useState, useEffect, useCallback } from 'react';
import { Tag, Plus, CheckCircle, XCircle, RefreshCw, Trash2 } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';

// ─── Types ───────────────────────────────────────────────────
interface Coupon {
  id: string;
  code: string;
  description: string;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  min_amount: number | null;
  max_uses: number | null;
  times_used: number;
  valid_from: string | null;
  valid_until: string | null;
  active: number;
}

interface CouponSummary {
  activeCoupons: number;
  totalRedemptions: number;
  totalDiscountGiven: number;
}

interface ValidateResult {
  valid: boolean;
  reason?: string;
  coupon?: Coupon;
}

const EMPTY_FORM = {
  code: '',
  description: '',
  discount_type: 'percent' as 'percent' | 'fixed',
  discount_value: '',
  min_amount: '',
  max_uses: '',
  valid_from: '',
  valid_until: '',
};

// ─── Component ───────────────────────────────────────────────
const CouponsManager: React.FC = () => {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [summary, setSummary] = useState<CouponSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Validate/redeem tester
  const [testCode, setTestCode] = useState('');
  const [testResult, setTestResult] = useState<ValidateResult | null>(null);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    let cancelled = false;
    setLoading(true);
    try {
      const [list, sum] = await Promise.resolve().then(() =>
        Promise.all([
          (api as any).ivCoupons(false),
          (api as any).ivCouponSummary(),
        ])
      );
      if (cancelled) return;
      setCoupons(Array.isArray(list) ? list : []);
      setSummary(sum || null);
    } catch (err) {
      console.error('CouponsManager load:', err);
    } finally {
      if (!cancelled) setLoading(false);
    }
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!form.code.trim()) { setFormError('Coupon code is required.'); return; }
    const val = parseFloat(form.discount_value);
    if (isNaN(val) || val <= 0) { setFormError('Discount value must be positive.'); return; }
    if (form.discount_type === 'percent' && val > 100) { setFormError('Percent discount cannot exceed 100.'); return; }
    setSaving(true);
    try {
      await (api as any).ivCouponUpsert({
        code: form.code.trim().toUpperCase(),
        description: form.description.trim(),
        discount_type: form.discount_type,
        discount_value: val,
        min_amount: form.min_amount ? parseFloat(form.min_amount) : null,
        max_uses: form.max_uses ? parseInt(form.max_uses) : null,
        valid_from: form.valid_from || null,
        valid_until: form.valid_until || null,
        active: true,
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
    } catch (err: any) {
      setFormError(err?.message || 'Failed to save coupon.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, code: string) => {
    if (!window.confirm(`Delete coupon "${code}"? This cannot be undone.`)) return;
    try {
      await (api as any).ivCouponDelete(id);
      await load();
    } catch (err) {
      console.error('Delete coupon:', err);
    }
  };

  const handleValidate = async () => {
    if (!testCode.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const r = await (api as any).ivCouponValidate(testCode.trim().toUpperCase());
      setTestResult(r || { valid: false, reason: 'No response' });
    } catch (err: any) {
      setTestResult({ valid: false, reason: err?.message || 'Error' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tag size={18} className="text-accent-primary" />
          <h3 className="text-base font-bold text-text-primary">Coupons &amp; Promo Codes</h3>
        </div>
        <div className="flex items-center gap-2">
          <button className="block-btn flex items-center gap-1" onClick={load} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            className="block-btn-primary flex items-center gap-1"
            onClick={() => { setShowForm((v) => !v); setFormError(''); setForm(EMPTY_FORM); }}
          >
            <Plus size={14} />
            New Coupon
          </button>
        </div>
      </div>

      {/* Summary KPIs */}
      {summary && (
        <div className="grid grid-cols-3 gap-3">
          <div className="block-card p-4">
            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Active Coupons</div>
            <div className="text-xl font-bold font-mono text-text-primary">{summary.activeCoupons}</div>
          </div>
          <div className="block-card p-4">
            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Total Redemptions</div>
            <div className="text-xl font-bold font-mono text-text-primary">{summary.totalRedemptions}</div>
          </div>
          <div className="block-card p-4">
            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">Total Discount Given</div>
            <div className="text-xl font-bold font-mono text-accent-expense">{formatCurrency(summary.totalDiscountGiven)}</div>
          </div>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <div className="block-card p-5">
          <h4 className="text-sm font-semibold text-text-primary mb-4">New Coupon</h4>
          <form onSubmit={handleSave} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-text-muted mb-1 font-semibold uppercase">Code *</label>
                <input
                  className="block-input w-full"
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                  placeholder="SUMMER20"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1 font-semibold uppercase">Description</label>
                <input
                  className="block-input w-full"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Summer sale 20% off"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] text-text-muted mb-1 font-semibold uppercase">Type *</label>
                <select
                  className="block-input w-full"
                  value={form.discount_type}
                  onChange={(e) => setForm((f) => ({ ...f, discount_type: e.target.value as 'percent' | 'fixed' }))}
                >
                  <option value="percent">Percent (%)</option>
                  <option value="fixed">Fixed ($)</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1 font-semibold uppercase">
                  Value * {form.discount_type === 'percent' ? '(%)' : '($)'}
                </label>
                <input
                  className="block-input w-full"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.discount_value}
                  onChange={(e) => setForm((f) => ({ ...f, discount_value: e.target.value }))}
                  placeholder="20"
                />
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1 font-semibold uppercase">Min Amount ($)</label>
                <input
                  className="block-input w-full"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.min_amount}
                  onChange={(e) => setForm((f) => ({ ...f, min_amount: e.target.value }))}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] text-text-muted mb-1 font-semibold uppercase">Max Uses</label>
                <input
                  className="block-input w-full"
                  type="number"
                  min="1"
                  step="1"
                  value={form.max_uses}
                  onChange={(e) => setForm((f) => ({ ...f, max_uses: e.target.value }))}
                  placeholder="Unlimited"
                />
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1 font-semibold uppercase">Valid From</label>
                <input
                  className="block-input w-full"
                  type="date"
                  value={form.valid_from}
                  onChange={(e) => setForm((f) => ({ ...f, valid_from: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1 font-semibold uppercase">Valid Until</label>
                <input
                  className="block-input w-full"
                  type="date"
                  value={form.valid_until}
                  onChange={(e) => setForm((f) => ({ ...f, valid_until: e.target.value }))}
                />
              </div>
            </div>
            {formError && (
              <div className="text-xs text-accent-expense">{formError}</div>
            )}
            <div className="flex items-center gap-2 pt-1">
              <button type="submit" className="block-btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Create Coupon'}
              </button>
              <button
                type="button"
                className="block-btn"
                onClick={() => { setShowForm(false); setFormError(''); }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Validate / Redeem tester */}
      <div className="block-card p-4">
        <h4 className="text-sm font-semibold text-text-primary mb-3">Validate Code</h4>
        <div className="flex items-center gap-2">
          <input
            className="block-input flex-1"
            value={testCode}
            onChange={(e) => { setTestCode(e.target.value); setTestResult(null); }}
            placeholder="Enter coupon code to test…"
            onKeyDown={(e) => { if (e.key === 'Enter') handleValidate(); }}
          />
          <button className="block-btn" onClick={handleValidate} disabled={testing || !testCode.trim()}>
            {testing ? 'Checking…' : 'Validate'}
          </button>
        </div>
        {testResult && (
          <div className={`mt-3 flex items-start gap-2 text-sm ${testResult.valid ? 'text-accent-income' : 'text-accent-expense'}`}>
            {testResult.valid
              ? <CheckCircle size={16} className="mt-0.5 flex-shrink-0" />
              : <XCircle size={16} className="mt-0.5 flex-shrink-0" />
            }
            <div>
              {testResult.valid
                ? <>
                    <span className="font-semibold">Valid</span>
                    {testResult.coupon && (
                      <span className="text-text-secondary ml-2">
                        {testResult.coupon.discount_type === 'percent'
                          ? `${testResult.coupon.discount_value}% off`
                          : formatCurrency(testResult.coupon.discount_value) + ' off'}
                        {testResult.coupon.valid_until && ` · expires ${formatDate(testResult.coupon.valid_until)}`}
                      </span>
                    )}
                  </>
                : <><span className="font-semibold">Invalid</span> — {testResult.reason}</>
              }
            </div>
          </div>
        )}
      </div>

      {/* Coupon list */}
      <div className="block-card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border-primary flex items-center justify-between">
          <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">All Coupons</span>
          <span className="text-[11px] text-text-muted">{coupons.length} total</span>
        </div>
        {loading ? (
          <div className="p-6 text-center text-sm text-text-muted">Loading…</div>
        ) : coupons.length === 0 ? (
          <div className="p-8 text-center text-sm text-text-muted">
            No coupons yet. Create your first promo code above.
          </div>
        ) : (
          <table className="block-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Description</th>
                <th>Discount</th>
                <th className="text-right">Min Amount</th>
                <th className="text-right">Uses</th>
                <th>Expires</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {coupons.map((c) => (
                <tr key={c.id}>
                  <td className="font-mono font-semibold text-text-primary">{c.code}</td>
                  <td className="text-text-secondary">{c.description || '—'}</td>
                  <td className="font-mono text-accent-income">
                    {c.discount_type === 'percent'
                      ? `${c.discount_value}%`
                      : formatCurrency(c.discount_value)}
                  </td>
                  <td className="text-right font-mono text-text-muted">
                    {c.min_amount ? formatCurrency(c.min_amount) : '—'}
                  </td>
                  <td className="text-right font-mono text-text-secondary">
                    {c.times_used}{c.max_uses ? ` / ${c.max_uses}` : ''}
                  </td>
                  <td className="text-text-muted text-sm">
                    {c.valid_until ? formatDate(c.valid_until) : '—'}
                  </td>
                  <td>
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${c.active ? 'text-accent-income' : 'text-text-muted'}`}
                      style={{ background: c.active ? 'rgba(var(--accent-income-rgb,34,197,94),0.12)' : 'var(--color-bg-tertiary)' }}>
                      {c.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <button
                      className="block-btn text-xs text-accent-expense flex items-center gap-1"
                      style={{ borderColor: 'transparent' }}
                      onClick={() => handleDelete(c.id, c.code)}
                      title="Delete coupon"
                    >
                      <Trash2 size={12} />
                    </button>
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

export default CouponsManager;
