// ExpenseDetail.tsx
// Read-only detail page for a single expense.
// Mirrors InvoiceDetail's structure: header → body → RelatedPanel + EntityTimeline.

import React, { useEffect, useState, useMemo } from 'react';
import { ArrowLeft, Edit, Copy, CheckCircle, XCircle, DollarSign, Receipt as ReceiptIcon, Eye, Printer, FileDown, Flag, RefreshCw, Repeat, MapPin, Clock } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency, formatDate, humanizeLabel } from '../../lib/format';
import { todayLocal } from '../../lib/date-helpers';
import { generateExpenseReceiptHTML } from '../../lib/print-templates';
import { expenseGrandTotal } from './expense-helpers';
import RelatedPanel from '../../components/RelatedPanel';
import EntityTimeline from '../../components/EntityTimeline';
import EntityChip from '../../components/EntityChip';
import ErrorBanner from '../../components/ErrorBanner';

interface Props {
  expenseId: string;
  onBack: () => void;
  onEdit: (id: string) => void;
}

interface ActivityEntry {
  id: string;
  expense_id: string;
  activity_type: string;
  description: string;
  user_name: string;
  metadata_json: string;
  created_at: string;
}

const ExpenseDetail: React.FC<Props> = ({ expenseId, onBack, onEdit }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [expense, setExpense] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [vendorStats, setVendorStats] = useState<{ ytd: number; count: number } | null>(null);
  const [project, setProject] = useState<{ id: string; name: string; budget: number; spent: number } | null>(null);

  const reload = async () => {
    if (!activeCompany) return;
    try {
      setLoading(true);
      const rows = await api.rawQuery(
        `SELECT e.*, c.name as category_name,
                v.name as vendor_name,
                v.address as vendor_address,
                v.phone as vendor_phone,
                v.email as vendor_email,
                v.website as vendor_website,
                v.tax_id as vendor_tax_id,
                p.name as project_name
         FROM expenses e
         LEFT JOIN categories c ON c.id = e.category_id
         LEFT JOIN vendors v ON v.id = e.vendor_id
         LEFT JOIN projects p ON p.id = e.project_id
         WHERE e.id = ? AND e.company_id = ?`,
        [expenseId, activeCompany.id]
      );
      const row = Array.isArray(rows) ? rows[0] : rows;
      setExpense(row || null);

      // Activity log (Changes 36-37)
      try {
        const acts = await api.rawQuery(
          `SELECT * FROM expense_activity_log WHERE expense_id = ? ORDER BY created_at DESC LIMIT 50`,
          [expenseId]
        );
        setActivity(Array.isArray(acts) ? acts : []);
      } catch { setActivity([]); }

      // Vendor stats (Change 41)
      if (row?.vendor_id) {
        try {
          const yr = new Date().getFullYear();
          const vrows = await api.rawQuery(
            `SELECT COALESCE(SUM(amount), 0) as ytd, COUNT(*) as count
             FROM expenses WHERE vendor_id = ? AND company_id = ? AND strftime('%Y', date) = ?`,
            [row.vendor_id, activeCompany.id, String(yr)]
          );
          const v = Array.isArray(vrows) ? vrows[0] : vrows;
          setVendorStats(v ? { ytd: Number(v.ytd) || 0, count: Number(v.count) || 0 } : null);
        } catch { setVendorStats(null); }
      } else {
        setVendorStats(null);
      }

      // Project stats (Change 42)
      if (row?.project_id) {
        try {
          const prows = await api.rawQuery(
            `SELECT p.id, p.name, COALESCE(p.budget, 0) as budget,
              (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE project_id = p.id AND company_id = ?) as spent
             FROM projects p WHERE p.id = ?`,
            [activeCompany.id, row.project_id]
          );
          const p = Array.isArray(prows) ? prows[0] : prows;
          if (p) setProject({ id: p.id, name: p.name, budget: Number(p.budget) || 0, spent: Number(p.spent) || 0 });
          else setProject(null);
        } catch { setProject(null); }
      } else {
        setProject(null);
      }
    } catch (e: any) {
      setErr(e?.message || 'Failed to load expense');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [expenseId, activeCompany]);

  const logActivity = async (activityType: string, description: string) => {
    try {
      await api.create('expense_activity_log', {
        expense_id: expenseId,
        activity_type: activityType,
        description,
        user_name: 'user',
        metadata_json: '{}',
      });
    } catch {}
  };

  // Unified expense lifecycle: Submitted → Approved / Declined → Paid.
  // approval_status carries the workflow (free-text, no CHECK constraint);
  // the financial `status` column (pending/approved/paid only) is kept in
  // sync so reports and the approval queue stay consistent.
  const transition = async (stage: 'submitted' | 'approved' | 'declined' | 'paid') => {
    const patch: Record<string, any> =
      stage === 'approved' ? { approval_status: 'approved', status: 'approved' } :
      stage === 'declined' ? { approval_status: 'rejected', status: 'pending' } :
      stage === 'paid'     ? { approval_status: 'approved', status: 'paid' } :
                             { approval_status: 'submitted', status: 'pending' };
    try {
      await api.update('expenses', expenseId, patch);
      await logActivity('status_change', `Status → ${stage}`);
      reload();
    } catch (e: any) { alert(e?.message || 'Update failed'); }
  };

  const markReimbursed = async () => {
    try {
      await api.update('expenses', expenseId, { reimbursed: 1, reimbursed_date: todayLocal() });
      await logActivity('reimbursed', `Marked as reimbursed`);
      reload();
    } catch (e: any) { alert(e?.message || 'Update failed'); }
  };

  const duplicate = async () => {
    const r = await api.cloneRecord('expenses', expenseId);
    if (r?.id) {
      await logActivity('duplicated', `Expense duplicated`);
      onEdit(r.id);
    }
  };

  const flagForReview = async () => {
    const reason = window.prompt('Why are you flagging this expense?');
    if (!reason) return;
    try {
      await api.update('expenses', expenseId, { flagged_for_review: 1, flag_reason: reason });
      await logActivity('flagged', `Flagged: ${reason}`);
      reload();
    } catch (e: any) { alert(e?.message || 'Flag failed'); }
  };

  const unflag = async () => {
    try {
      await api.update('expenses', expenseId, { flagged_for_review: 0, flag_reason: '' });
      await logActivity('unflagged', `Removed flag`);
      reload();
    } catch (e: any) { alert(e?.message || 'Update failed'); }
  };

  const convertToRecurring = async () => {
    if (!confirm('Mark this expense as recurring? You can configure schedule details after.')) return;
    try {
      await api.update('expenses', expenseId, { is_recurring: 1 });
      await logActivity('recurring_enabled', 'Marked as recurring');
      reload();
    } catch (e: any) { alert(e?.message || 'Update failed'); }
  };

  const flagReceiptRescan = async () => {
    try {
      await api.update('expenses', expenseId, { flagged_for_review: 1, flag_reason: 'Receipt re-scan requested' });
      await logActivity('receipt_rescan', 'Receipt flagged for re-scan');
      reload();
    } catch (e: any) { alert(e?.message || 'Update failed'); }
  };

  const buildReceiptHTML = async (): Promise<string> => {
    const [vendor, lineItems] = await Promise.all([
      expense.vendor_id ? api.get('vendors', expense.vendor_id).catch(() => null) : Promise.resolve(null),
      api.query('expense_line_items', { expense_id: expenseId }).catch(() => []),
    ]);
    return generateExpenseReceiptHTML(
      expense,
      activeCompany,
      vendor || (expense.vendor_name ? { name: expense.vendor_name } : undefined),
      Array.isArray(lineItems) ? lineItems : [],
    );
  };

  // Print Receipt Voucher (Change 45). Accepts the loaded vendor record so
  // address/phone/email/tax_id surface on the printed voucher alongside the
  // expense fields.
  const buildVoucherHTML = (vendor?: any): string => {
    const e = expense;
    const company = activeCompany;
    const created = e.created_at ? formatDate(e.created_at) : '—';
    // FINAL-PRICE: the voucher's headline amount is the true cost INCLUDING tax
    // (amount + tax − discount), not the pre-tax subtotal.
    const vGross = (e.amount || 0) + (e.tax_amount || 0);
    const vDisc = Math.min(vGross, (e.discount_amount || 0) + vGross * ((e.discount_percent || 0) / 100));
    const vTotal = Math.max(0, vGross - vDisc);
    const lineItems: Array<[string, string]> = [
      ['Date', formatDate(e.date)],
      ['Vendor', vendor?.name || e.vendor_name || '—'],
      // Vendor contact block — only emitted when fields are populated, so a
      // vendor with no address doesn't leave dash rows on the voucher.
      ...(vendor?.address ? [['Vendor Address', String(vendor.address)] as [string, string]] : []),
      ...(vendor?.phone ? [['Vendor Phone', String(vendor.phone)] as [string, string]] : []),
      ...(vendor?.email ? [['Vendor Email', String(vendor.email)] as [string, string]] : []),
      ...(vendor?.website ? [['Vendor Website', String(vendor.website)] as [string, string]] : []),
      ...(vendor?.tax_id ? [['Vendor Tax ID', String(vendor.tax_id)] as [string, string]] : []),
      ['Category', e.category_name || '—'],
      ['Project', e.project_name || '—'],
      ['Description', e.description || '—'],
      ['Reference', e.reference || '—'],
      ['Payment Method', formatPaymentMethod(e.payment_method)],
      ['Status', humanizeLabel(e.status) || '—'],
      ['Approval Status', humanizeLabel(e.approval_status) || '—'],
      ['Currency', e.currency || 'USD'],
      ['Exchange Rate', String(e.exchange_rate || 1)],
      ['Subtotal', formatCurrency(e.amount || 0)],
      ['Tax Amount', formatCurrency(e.tax_amount || 0)],
      ['Tip Amount', formatCurrency(e.tip_amount || 0)],
      // Shipping & Handling — only surfaced when present, with speed/scope detail.
      ...((e.shipping_amount || 0) > 0 ? [
        ['Shipping & Handling', formatCurrency(e.shipping_amount || 0) +
          ((e.shipping_tax_amount || 0) > 0 ? ` (+ ${formatCurrency(e.shipping_tax_amount)} tax)` : '')] as [string, string],
        ['Shipping Speed', e.shipping_speed || '—'] as [string, string],
        ['Shipping Applies To', e.shipping_scope === 'item' ? 'Single item' : 'Whole order'] as [string, string],
      ] : []),
      ['Grand Total', formatCurrency(expenseGrandTotal(e))],
      ['Tax Deductible', e.is_tax_deductible === 0 ? 'No' : 'Yes'],
      ['Schedule C Line', e.schedule_c_line || '—'],
      ['Billable', e.is_billable ? 'Yes' : 'No'],
      ['Reimbursable', e.is_reimbursable ? (e.reimbursed ? 'Reimbursed' : 'Pending') : 'No'],
      ['Markup %', (e.markup_pct || 0) > 0 ? `${e.markup_pct}%` : '—'],
      ['Mileage', (e.miles || 0) > 0 ? `${(e.miles || 0).toFixed(1)} mi @ $${(e.mileage_rate || 0.7).toFixed(2)}` : '—'],
      ['Merchant Location', e.merchant_location || '—'],
      ['GPS / Location Name', e.geo_location_name || '—'],
      ['Submitted', created],
    ];
    const rowsHtml = lineItems
      .map(([k, v]) => `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:11px;color:#555;width:180px;">${k}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:13px;color:#111;">${v}</td></tr>`)
      .join('');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Expense Voucher</title>
<style>body{font-family:'Helvetica Neue',Arial,sans-serif;color:#111;margin:32px;}
h1{font-size:18px;letter-spacing:2px;text-transform:uppercase;border-bottom:2px solid #111;padding-bottom:6px;margin:0 0 16px 0;}
.amount{font-size:28px;font-weight:bold;color:#111;font-family:Menlo,monospace;}
.meta{display:flex;justify-content:space-between;margin-bottom:18px;}
table{width:100%;border-collapse:collapse;}
.sig{margin-top:36px;display:flex;justify-content:space-between;}
.sig .line{border-top:1px solid #999;width:240px;padding-top:6px;font-size:11px;color:#555;}
</style></head><body>
<h1>Expense Voucher</h1>
<div class="meta">
  <div>
    <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;">Company</div>
    <div style="font-size:14px;font-weight:bold;">${(company?.name || '').replace(/[<>]/g, '')}</div>
    <div style="font-size:11px;color:#666;margin-top:4px;">Voucher ID: ${e.id}</div>
  </div>
  <div style="text-align:right;">
    <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;">Total${(e.tax_amount || 0) > 0 ? ' (incl. tax)' : ''}</div>
    <div class="amount">${formatCurrency(vTotal)}</div>
    <div style="font-size:11px;color:#666;margin-top:4px;">Subtotal ${formatCurrency(e.amount || 0)} + Tax ${formatCurrency(e.tax_amount || 0)}</div>
  </div>
</div>
<table>${rowsHtml}</table>
<div class="sig">
  <div class="line">Submitted by</div>
  <div class="line">Approved by</div>
</div>
</body></html>`;
  };

  const handlePreview = async () => {
    try {
      await api.printPreview(await buildReceiptHTML(), `Expense ${expense.reference || expense.description || ''}`);
    } catch (e: any) { setErr(e?.message || 'Preview failed'); }
  };
  const handlePrint = async () => {
    try { await api.print(await buildReceiptHTML()); }
    catch (e: any) { setErr(e?.message || 'Print failed'); }
  };
  const handleSavePdf = async () => {
    try {
      const safe = String(expense.reference || expense.id || 'receipt').replace(/[^a-zA-Z0-9-_]/g, '-');
      const r = await api.saveToPDF(await buildReceiptHTML(), `Expense-${safe}`);
      if (r?.error) setErr(r.error);
    } catch (e: any) { setErr(e?.message || 'PDF save failed'); }
  };

  const handlePrintVoucher = async () => {
    try {
      // Load the vendor record so its address/phone/email/tax_id appear on the
      // voucher. Falls back gracefully if the vendor lookup fails.
      const vendor = expense.vendor_id
        ? await api.get('vendors', expense.vendor_id).catch(() => null)
        : null;
      await api.printPreview(buildVoucherHTML(vendor), `Voucher ${expense.id}`);
      await logActivity('voucher_printed', 'Voucher printed');
    } catch (e: any) { setErr(e?.message || 'Voucher preview failed'); }
  };

  // Days since submitted
  const daysSinceSubmit = useMemo(() => {
    if (!expense?.created_at && !expense?.submitted_at) return null;
    const ref = expense?.submitted_at || expense?.created_at;
    const t = new Date(String(ref).replace(' ', 'T') + 'Z').getTime();
    if (isNaN(t)) return null;
    return Math.max(0, Math.floor((Date.now() - t) / 86400000));
  }, [expense]);

  if (loading) return <div className="text-text-muted text-sm py-12 text-center">Loading expense...</div>;
  if (err) return <ErrorBanner message={err} onDismiss={() => setErr('')} />;
  if (!expense) return <div className="text-text-muted text-sm py-12 text-center">Expense not found.</div>;

  // Derive ONE lifecycle stage from both fields (Submitted → Approved/Declined → Paid).
  const stage: 'submitted' | 'approved' | 'declined' | 'paid' = (() => {
    const a = (expense.approval_status || '').toLowerCase();
    if (expense.status === 'paid') return 'paid';
    if (a === 'rejected' || a === 'declined') return 'declined';
    if (expense.status === 'approved' || a === 'approved') return 'approved';
    return 'submitted'; // draft / submitted / in_review / needs_info / pending
  })();
  const STAGE_META: Record<string, { label: string; color: string }> = {
    submitted: { label: 'Submitted', color: 'var(--color-accent-warning)' },
    approved:  { label: 'Approved',  color: 'var(--color-accent-income)' },
    declined:  { label: 'Declined',  color: 'var(--color-accent-expense)' },
    paid:      { label: 'Paid',      color: 'var(--color-accent-blue)' },
  };

  const isImageReceipt = !!(expense.receipt_path && /\.(jpe?g|png|gif|webp|bmp)$/i.test(expense.receipt_path));
  const mileageDeduction = (expense.miles || 0) * (expense.mileage_rate || 0.7);
  const convertedUSD = (expense.amount || 0) * (expense.exchange_rate || 1);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-2 text-sm text-text-muted hover:text-text-primary">
          <ArrowLeft size={16} /> Back
        </button>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => onEdit(expenseId)} className="flex items-center gap-1 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue">
            <Edit size={13} /> Edit
          </button>
          <button onClick={duplicate} className="flex items-center gap-1 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue">
            <Copy size={13} /> Duplicate
          </button>
          <button onClick={convertToRecurring} className="flex items-center gap-1 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue">
            <Repeat size={13} /> Recurring
          </button>
          {expense.flagged_for_review ? (
            <button onClick={unflag} className="flex items-center gap-1 px-3 py-2 border border-accent-expense text-xs font-bold uppercase text-accent-expense hover:border-accent-blue">
              <Flag size={13} /> Unflag
            </button>
          ) : (
            <button onClick={flagForReview} className="flex items-center gap-1 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-expense text-accent-expense">
              <Flag size={13} /> Flag for Review
            </button>
          )}
          <button onClick={handlePreview} className="flex items-center gap-1 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue">
            <Eye size={13} /> Preview
          </button>
          <button onClick={handlePrint} className="flex items-center gap-1 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue">
            <Printer size={13} /> Print
          </button>
          <button onClick={handleSavePdf} className="flex items-center gap-1 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue">
            <FileDown size={13} /> PDF
          </button>
          <button onClick={handlePrintVoucher} className="flex items-center gap-1 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue">
            <Printer size={13} /> Voucher
          </button>
          {/* Lifecycle actions: Submitted → Approved/Declined → Paid */}
          {stage === 'submitted' && (<>
            <button onClick={() => transition('approved')} className="flex items-center gap-1 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-income text-accent-income">
              <CheckCircle size={13} /> Approve
            </button>
            <button onClick={() => transition('declined')} className="flex items-center gap-1 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-expense text-accent-expense">
              <XCircle size={13} /> Decline
            </button>
          </>)}
          {stage === 'approved' && (<>
            <button onClick={() => transition('paid')} className="flex items-center gap-1 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue text-accent-blue">
              <DollarSign size={13} /> Mark Paid
            </button>
            <button onClick={() => transition('declined')} className="flex items-center gap-1 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-expense text-accent-expense">
              <XCircle size={13} /> Decline
            </button>
          </>)}
          {stage === 'declined' && (
            <button onClick={() => transition('submitted')} className="flex items-center gap-1 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue">
              <RefreshCw size={13} /> Reopen
            </button>
          )}
          {stage === 'paid' && (
            <button onClick={() => transition('approved')} className="flex items-center gap-1 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue">
              <RefreshCw size={13} /> Unmark Paid
            </button>
          )}
          {!!expense.is_reimbursable && !expense.reimbursed && (
            <button onClick={markReimbursed} className="flex items-center gap-1 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue">
              <DollarSign size={13} /> Mark Reimbursed
            </button>
          )}
        </div>
      </div>

      {/* KPI Header Cards (Changes 31-34) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="block-card p-3">
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Total (incl. Tax)</div>
          {/* FINAL-PRICE v4: amount + tax + shipping + shipping_tax − discount. */}
          <div className="text-2xl font-mono font-bold text-accent-expense mt-1">
            {formatCurrency(expenseGrandTotal(expense as any))}
          </div>
          {(
            <div className="text-[10px] text-text-muted mt-1">
              Subtotal {formatCurrency(expense.amount || 0)}
              {((expense as any).tax_amount || 0) > 0 && <> + Tax {formatCurrency((expense as any).tax_amount || 0)}</>}
              {((expense as any).shipping_amount || 0) > 0 && <> + Ship {formatCurrency(((expense as any).shipping_amount || 0) + ((expense as any).shipping_tax_amount || 0))}</>}
            </div>
          )}
          {(expense.currency && expense.currency !== 'USD') && (
            <div className="text-[10px] text-text-muted mt-1">{expense.currency}</div>
          )}
        </div>
        <div className="block-card p-3">
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Status</div>
          <div className="mt-1">
            <span
              className="block-badge"
              style={{ color: STAGE_META[stage].color, background: `color-mix(in srgb, ${STAGE_META[stage].color} 14%, transparent)` }}
            >
              {STAGE_META[stage].label}
            </span>
          </div>
          {/* Lifecycle: Submitted → Approved/Declined → Paid (current stage highlighted) */}
          <div className="mt-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
            {([
              ['submitted', 'Submitted'],
              stage === 'declined' ? ['declined', 'Declined'] : ['approved', 'Approved'],
              ['paid', 'Paid'],
            ] as Array<[string, string]>).map(([key, label], i) => (
              <span key={key} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-text-muted">→</span>}
                <span style={{ color: key === stage ? STAGE_META[key].color : 'var(--color-text-muted)' }}>{label}</span>
              </span>
            ))}
          </div>
        </div>
        <div className="block-card p-3">
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Category</div>
          <div className="text-base font-bold text-text-primary mt-1 truncate">{expense.category_name || '(uncategorized)'}</div>
          {expense.is_tax_deductible === 0 ? (
            <div className="text-[10px] text-text-muted mt-1">Non-Deductible</div>
          ) : (
            <div className="text-[10px] text-accent-income mt-1">Deductible</div>
          )}
        </div>
        <div className="block-card p-3">
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1"><Clock size={10} /> Days Since Submitted</div>
          <div className="text-2xl font-mono font-bold text-text-primary mt-1">{daysSinceSubmit ?? '—'}</div>
          <div className="text-[10px] text-text-muted mt-1">{expense.submitted_at ? formatDate(expense.submitted_at) : (expense.created_at ? formatDate(expense.created_at) : '')}</div>
        </div>
      </div>

      {/* Flag banner */}
      {expense.flagged_for_review ? (
        <div className="block-card p-3 flex items-center gap-3" style={{ borderLeft: '3px solid #ef4444' }}>
          <Flag size={16} className="text-accent-expense" />
          <div className="text-xs flex-1">
            <strong className="text-accent-expense">Flagged for Review.</strong> {expense.flag_reason ? <span className="text-text-secondary">{expense.flag_reason}</span> : null}
          </div>
        </div>
      ) : null}

      <div className="block-card p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 flex items-center justify-center bg-bg-tertiary border border-border-primary" style={{ borderRadius: 6 }}>
            <ReceiptIcon size={18} className="text-accent-blue" />
          </div>
          <div className="flex-1">
            <h2 className="module-title text-text-primary">{expense.description || '(no description)'}</h2>
            <p className="text-xs text-text-muted mt-0.5">{formatDate(expense.date)} &middot; <span className="block-badge" style={{ color: STAGE_META[stage].color, background: `color-mix(in srgb, ${STAGE_META[stage].color} 14%, transparent)` }}>{STAGE_META[stage].label}</span></p>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase font-bold text-text-muted">Total</div>
            <div className="text-2xl font-mono font-bold text-accent-expense">
              {/* FINAL-PRICE v4: amount + tax + shipping + shipping_tax − discount. */}
              {formatCurrency(expenseGrandTotal(expense as any))}
            </div>
            {(((expense as any).tax_amount || 0) > 0 || ((expense as any).shipping_amount || 0) > 0) && (
              <div className="text-[10px] text-text-muted mt-0.5">
                {((expense as any).tax_amount || 0) > 0 && <>incl. {formatCurrency((expense as any).tax_amount || 0)} tax</>}
                {((expense as any).shipping_amount || 0) > 0 && <>{((expense as any).tax_amount || 0) > 0 ? ' · ' : ''}{formatCurrency(((expense as any).shipping_amount || 0) + ((expense as any).shipping_tax_amount || 0))} shipping</>}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <Field label="Vendor">
            {expense.vendor_id
              ? <EntityChip type="vendor" id={expense.vendor_id} label={expense.vendor_name || ''} variant="inline" />
              : <span className="text-text-muted">—</span>}
          </Field>
          <Field label="Category">{expense.category_name || '—'}</Field>
          <Field label="Project">
            {expense.project_id
              ? <EntityChip type="project" id={expense.project_id} label={expense.project_name || ''} variant="inline" />
              : <span className="text-text-muted">—</span>}
          </Field>
          <Field label="Tax Amount">{formatCurrency(expense.tax_amount || 0)}</Field>
          <Field label="Payment Method">{expense.payment_method ? humanizeLabel(expense.payment_method) : "—"}</Field>
          <Field label="Reference">{expense.reference || '—'}</Field>
          <Field label="Billable">{expense.is_billable ? 'Yes' : 'No'}</Field>
          <Field label="Reimbursable">{expense.is_reimbursable ? (expense.reimbursed ? `Reimbursed ${expense.reimbursed_date || ''}` : 'Pending') : 'No'}</Field>
          <Field label="Merchant Location">
            {expense.merchant_location ? <span className="inline-flex items-center gap-1"><MapPin size={11} className="text-text-muted" />{expense.merchant_location}</span> : '—'}
          </Field>
          <Field label="Status">{expense.status ? expense.status.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) : '—'}</Field>
          <Field label="Approval Status">{expense.approval_status ? expense.approval_status.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) : '—'}</Field>
          <Field label="Tax-Deductible">{expense.is_tax_deductible === 0 ? 'No' : 'Yes'}</Field>
          <Field label="Tip Amount">{formatCurrency(expense.tip_amount || 0)}</Field>
          <Field label="Currency">{expense.currency || 'USD'}{expense.exchange_rate && expense.exchange_rate !== 1 ? ` · @ ${Number(expense.exchange_rate).toFixed(4)}` : ''}</Field>
          <Field label="Schedule C Line">{expense.schedule_c_line || '—'}</Field>
          <Field label="Recurring">{expense.is_recurring ? 'Yes' : 'No'}</Field>
          <Field label="Submitted">{expense.created_at ? formatDate(expense.created_at) : '—'}</Field>
        </div>

        {/* Vendor Details — surfaces the vendor's address/contact/tax_id on the
            expense log so the record is self-contained for audit/reimbursement
            review. Only renders when at least one field is populated. */}
        {(expense.vendor_id && (
          (expense as any).vendor_address || (expense as any).vendor_phone ||
          (expense as any).vendor_email || (expense as any).vendor_website ||
          (expense as any).vendor_tax_id
        )) ? (
          <div className="mt-4 pt-4 border-t border-border-primary">
            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">
              Vendor Details
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              {(expense as any).vendor_address && (
                <Field label="Address">
                  <span className="inline-flex items-start gap-1">
                    <MapPin size={11} className="text-text-muted mt-0.5 flex-shrink-0" />
                    <span style={{ whiteSpace: 'pre-line' }}>{(expense as any).vendor_address}</span>
                  </span>
                </Field>
              )}
              {(expense as any).vendor_phone && <Field label="Phone">{(expense as any).vendor_phone}</Field>}
              {(expense as any).vendor_email && <Field label="Email">{(expense as any).vendor_email}</Field>}
              {(expense as any).vendor_website && <Field label="Website">{(expense as any).vendor_website}</Field>}
              {(expense as any).vendor_tax_id && <Field label="Tax ID / EIN">{(expense as any).vendor_tax_id}</Field>}
            </div>
          </div>
        ) : null}
      </div>

      {/* Mileage Calculator (Change 35) */}
      {(expense.miles || 0) > 0 && (
        <div className="block-card p-4">
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">Mileage Calculation</div>
          <div className="text-base text-text-primary font-mono">
            {(expense.miles || 0).toFixed(1)} miles &times; ${(expense.mileage_rate || 0.7).toFixed(2)}/mi = <strong className="text-accent-income">{formatCurrency(mileageDeduction)}</strong>
          </div>
          <div className="text-[10px] text-text-muted mt-2">IRS standard mileage rate for 2026: $0.70/mile. Reported on Schedule C, Line 9.</div>
        </div>
      )}

      {/* Currency Conversion Display (Change 40) */}
      {expense.currency && expense.currency !== 'USD' && (
        <div className="block-card p-4">
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">Currency Conversion</div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-[10px] text-text-muted uppercase">Original</div>
              <div className="text-base font-mono text-text-primary">{(expense.amount || 0).toFixed(2)} {expense.currency}</div>
            </div>
            <div>
              <div className="text-[10px] text-text-muted uppercase">Converted (USD)</div>
              <div className="text-base font-mono text-accent-income">{formatCurrency(convertedUSD)} <span className="text-[10px] text-text-muted">@ {(expense.exchange_rate || 1).toFixed(4)} rate</span></div>
            </div>
          </div>
        </div>
      )}

      {/* Receipt Viewer (Changes 38-39) */}
      {expense.receipt_path && (
        <div className="block-card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Receipt</div>
            <div className="flex gap-2">
              <a href={`file://${expense.receipt_path}`} target="_blank" rel="noreferrer" className="text-xs px-3 py-1 border border-border-primary hover:border-accent-blue uppercase font-bold">Download</a>
              <button onClick={flagReceiptRescan} className="text-xs px-3 py-1 border border-border-primary hover:border-accent-expense uppercase font-bold text-accent-expense flex items-center gap-1">
                <RefreshCw size={11} /> Flag for Re-scan
              </button>
            </div>
          </div>
          {isImageReceipt ? (
            <img
              src={`file://${expense.receipt_path}`}
              alt="Receipt"
              style={{ maxWidth: '100%', maxHeight: 480, borderRadius: 6, border: '1px solid var(--color-border-primary)' }}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <div className="text-xs text-text-muted">{expense.receipt_path.split(/[/\\]/).pop()}</div>
          )}
        </div>
      )}

      {/* Related Cards (Changes 41-42) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {vendorStats && expense.vendor_id && (
          <div className="block-card p-4">
            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">Vendor — {expense.vendor_name}</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] text-text-muted uppercase">YTD Spend</div>
                <div className="text-lg font-mono font-bold text-text-primary">{formatCurrency(vendorStats.ytd)}</div>
              </div>
              <div>
                <div className="text-[10px] text-text-muted uppercase">Transactions</div>
                <div className="text-lg font-mono font-bold text-text-primary">{vendorStats.count}</div>
              </div>
            </div>
          </div>
        )}
        {project && (
          <div className="block-card p-4">
            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">Project — {project.name}</div>
            <div className="grid grid-cols-2 gap-3 mb-2">
              <div>
                <div className="text-[10px] text-text-muted uppercase">Budget</div>
                <div className="text-lg font-mono font-bold text-text-primary">{project.budget > 0 ? formatCurrency(project.budget) : '—'}</div>
              </div>
              <div>
                <div className="text-[10px] text-text-muted uppercase">Spent</div>
                <div className="text-lg font-mono font-bold text-text-primary">{formatCurrency(project.spent)}</div>
              </div>
            </div>
            {project.budget > 0 && (
              <div className="mt-2">
                <div className="h-2 bg-bg-tertiary" style={{ borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.min(100, (project.spent / project.budget) * 100).toFixed(1)}%`,
                    height: '100%',
                    background: project.spent > project.budget ? 'var(--color-accent-expense)' : 'var(--color-accent-income)',
                  }} />
                </div>
                <div className="text-[10px] text-text-muted mt-1">
                  {Math.round((project.spent / project.budget) * 100)}% of budget · This expense contributes {formatCurrency(expense.amount || 0)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Activity Timeline (Changes 36-37) */}
      <div className="block-card p-4">
        <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3">Activity Timeline</div>
        {activity.length === 0 ? (
          <div className="text-xs text-text-muted">No activity yet.</div>
        ) : (
          <div className="space-y-2">
            {activity.map((a) => {
              const t = (a.activity_type || '').toLowerCase();
              const color = t.includes('approve') ? 'var(--color-accent-income)' :
                            t.includes('reject') ? 'var(--color-accent-expense)' :
                            t.includes('flag') ? 'var(--color-accent-expense)' :
                            t.includes('reimburs') ? 'var(--color-accent-income)' :
                            t.includes('submit') ? 'var(--color-accent-blue)' :
                            t.includes('print') ? 'var(--color-accent-purple)' : 'var(--color-text-muted)';
              return (
                <div key={a.id} className="flex items-start gap-3">
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, marginTop: 6, flexShrink: 0 }} />
                  <div className="flex-1">
                    <div className="text-xs text-text-primary font-medium">{a.description || a.activity_type}</div>
                    <div className="text-[10px] text-text-muted">{a.user_name || 'system'} &middot; {a.created_at ? formatDate(a.created_at) : ''}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RelatedPanel entityType="expense" entityId={expenseId} />
        <EntityTimeline entityType="expense" entityId={expenseId} />
      </div>
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <div className="text-xs uppercase font-bold text-text-muted">{label}</div>
    <div className="text-text-primary mt-1">{children}</div>
  </div>
);

export default ExpenseDetail;
