// src/renderer/modules/vendors-ap/Vendor360.tsx
import React, { useEffect, useState } from 'react';
import { ArrowLeft, Activity, Calendar, ShieldCheck, FileText, StickyNote } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import { Section, Empty, Th, Td, StatCard, MiniBar, TOK, gradeColor } from './shared/ui';
import { VENDOR_TYPE, VENDOR_APPROVAL, ClassificationBadge } from '../../lib/classifications';
import { useNavigation } from '../../lib/navigation';

const Vendor360: React.FC<{ vendorId: string; onBack: () => void }> = ({ vendorId, onBack }) => {
  const [snap, setSnap] = useState<any>(null);
  const [byMonth, setByMonth] = useState<any[]>([]);
  const [byCategory, setByCategory] = useState<any[]>([]);
  const [payHistory, setPayHistory] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [noteDraft, setNoteDraft] = useState('');
  const nav = useNavigation();

  const reloadNotes = () => { api.vnNotes(vendorId).then((r: any) => { if (Array.isArray(r)) setNotes(r); }).catch(() => {}); };

  useEffect(() => {
    let cancelled = false;
    const arr = (s: (v: any[]) => void) => (r: any) => { if (!cancelled && Array.isArray(r)) s(r); };
    const obj = (s: (v: any) => void) => (r: any) => { if (!cancelled && r && !r.error) s(r); };
    const quiet = () => {};
    api.vnFullSnapshot(vendorId).then(obj(setSnap)).catch(quiet);
    api.vnSpendByMonth(vendorId, 12).then(arr(setByMonth)).catch(quiet);
    api.vnSpendByCategory(vendorId).then(arr(setByCategory)).catch(quiet);
    api.vnPaymentHistory(vendorId).then(arr(setPayHistory)).catch(quiet);
    api.vnNotes(vendorId).then(arr(setNotes)).catch(quiet);
    api.vnActivityLog(vendorId).then(arr(setActivity)).catch(quiet);
    return () => { cancelled = true; };
  }, [vendorId]);

  const v = snap?.vendor || snap?.profile || {};
  const score = snap?.scorecard;
  const bill = snap?.billSummary || {};
  const tax = snap?.tax1099 || snap?.['1099'] || {};
  const ins = snap?.insurance || {};
  const contract = snap?.contract || {};
  const maxMonth = Math.max(1, ...byMonth.map((m: any) => m.total || 0));
  const maxCat = Math.max(1, ...byCategory.map((c: any) => c.total || 0));

  const addNote = () => {
    const text = noteDraft.trim();
    if (!text) return;
    api.vnNoteAdd(vendorId, text).then(() => { setNoteDraft(''); reloadNotes(); }).catch(() => {});
  };

  return (
    <div className="space-y-4">
      <button className="block-btn text-xs flex items-center gap-1" onClick={onBack}><ArrowLeft size={13} /> Back to directory</button>

      {/* Header */}
      <div className="block-card p-4 flex items-start justify-between">
        <div>
          <div className="text-xl font-bold text-text-primary">{v.name || 'Vendor'}</div>
          <div className="flex items-center gap-2 mt-1">
            <ClassificationBadge def={VENDOR_TYPE} value={v.vendor_type} size="xs" />
            <ClassificationBadge def={VENDOR_APPROVAL} value={v.approval_status} size="xs" />
            {v.email && <span className="text-[11px] text-text-muted">{v.email}</span>}
          </div>
        </div>
        {score && (
          <div className="text-right">
            <div className="text-3xl font-bold font-mono" style={{ color: gradeColor(score.grade) }}>{score.grade}</div>
            <div className="text-[10px] text-text-muted">score {score.score}/100</div>
          </div>
        )}
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Spend" value={snap ? formatCurrency(snap.totalSpend ?? 0) : '—'} sub={snap ? `YTD ${formatCurrency(snap.ytdSpend ?? 0)}` : undefined} />
        <StatCard label="Outstanding AP" value={bill.outstanding != null ? formatCurrency(bill.outstanding) : '—'} sub={bill.overdueBills != null ? `${bill.overdueBills} overdue` : undefined} color={bill.outstanding > 0 ? TOK.warning : undefined} />
        <StatCard label="1099 YTD Paid" value={tax.ytdPaid != null ? formatCurrency(tax.ytdPaid) : '—'} sub={tax.requiresFiling ? 'requires 1099 filing' : '1099 not required'} color={tax.requiresFiling ? TOK.warning : undefined} />
        <StatCard label="Transactions" value={snap?.expenseCount ?? '—'} sub={snap?.lastExpenseDate ? `last ${formatDate(snap.lastExpenseDate)}` : undefined} />
      </div>

      {/* Spend analytics */}
      <div className="grid md:grid-cols-2 gap-4">
        <Section title="Spend by Month (12mo)" icon={<Activity size={13} style={{ color: TOK.blue }} />}>
          {byMonth.length === 0 ? <Empty msg="No spend history." /> : (
            <div className="p-3 space-y-1.5">
              {byMonth.map((m: any) => <MiniBar key={m.month} label={m.month} value={m.total} max={maxMonth} valueLabel={formatCurrency(m.total)} barColor={TOK.blue} />)}
            </div>
          )}
        </Section>
        <Section title="Spend by Category" icon={<Activity size={13} style={{ color: TOK.blue }} />}>
          {byCategory.length === 0 ? <Empty msg="No categorized spend." /> : (
            <div className="p-3 space-y-1.5">
              {byCategory.map((c: any, i: number) => <MiniBar key={i} label={c.category || 'Uncategorized'} value={c.total} max={maxCat} valueLabel={formatCurrency(c.total)} />)}
            </div>
          )}
        </Section>
      </div>

      {/* Compliance snapshot */}
      <Section title="Compliance" icon={<ShieldCheck size={13} style={{ color: TOK.income }} />}>
        <div className="grid md:grid-cols-3 gap-3 p-3 text-[12px]">
          <div>
            <div className="text-[9px] font-bold uppercase text-text-muted">Insurance (COI)</div>
            <div style={{ color: ins.isExpired ? TOK.expense : 'var(--color-text-primary)' }}>{ins.coiExpiry ? `expires ${formatDate(ins.coiExpiry)}${ins.isExpired ? ' · EXPIRED' : ''}` : 'No COI on file'}</div>
          </div>
          <div>
            <div className="text-[9px] font-bold uppercase text-text-muted">Contract</div>
            <div style={{ color: contract.isExpired ? TOK.expense : 'var(--color-text-primary)' }}>{contract.endDate ? `ends ${formatDate(contract.endDate)}${contract.isExpired ? ' · EXPIRED' : ''}` : 'No contract dates'}</div>
          </div>
          <div>
            <div className="text-[9px] font-bold uppercase text-text-muted">W-9</div>
            <div>{tax.taxIdLast4 ? `TIN •••${tax.taxIdLast4}` : 'No TIN on file'}</div>
          </div>
        </div>
      </Section>

      {/* Payment history + bills deep-link */}
      <Section title="Recent Payments" icon={<Calendar size={13} style={{ color: TOK.blue }} />} count={payHistory.length}
        right={<button className="block-btn text-[10px]" onClick={() => nav.goTo('bills')}>Open Bills (AP)</button>}>
        {payHistory.length === 0 ? <Empty msg="No payment history." /> : (
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: `1px solid ${TOK.border}` }}><Th>Date</Th><Th>Bill #</Th><Th>Method</Th><Th right>Amount</Th></tr></thead>
              <tbody>
                {payHistory.map((p: any, i: number) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                    <Td mono>{formatDate(p.date)}</Td><Td>{p.bill_number || '—'}</Td>
                    <Td>{(p.payment_method || '').replace(/_/g, ' ')}</Td><Td right mono>{formatCurrency(p.amount)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Notes + activity */}
      <div className="grid md:grid-cols-2 gap-4">
        <Section title="Notes" icon={<StickyNote size={13} style={{ color: TOK.warning }} />} count={notes.length}>
          <div className="p-3 space-y-2">
            <div className="flex gap-2">
              <input value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addNote(); }}
                placeholder="Add an internal note…" className="block-input flex-1 text-[12px]" />
              <button className="block-btn block-btn-primary text-xs" onClick={addNote}>Add</button>
            </div>
            {notes.length === 0 ? <Empty msg="No notes yet." /> : notes.map((n: any, i: number) => (
              <div key={i} className="text-[12px] border-l-2 pl-2" style={{ borderColor: TOK.warning }}>
                <div>{n.note || n.content}</div>
                <div className="text-[10px] text-text-muted">{formatDate(n.created_at)}{n.created_by ? ` · ${n.created_by}` : ''}</div>
              </div>
            ))}
          </div>
        </Section>
        <Section title="Activity" icon={<FileText size={13} style={{ color: TOK.blue }} />} count={activity.length}>
          {activity.length === 0 ? <Empty msg="No recorded activity." /> : (
            <div style={{ maxHeight: 240, overflowY: 'auto' }} className="p-3 space-y-1">
              {activity.map((a: any, i: number) => (
                <div key={i} className="text-[11px] text-text-secondary">
                  <span className="font-mono text-text-muted">{formatDate(a.created_at || a.timestamp)}</span> — {a.action || a.event || a.description}
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
};

export default Vendor360;
