// src/renderer/modules/payroll/HrPortal.tsx
//
// HR Portal — per-employee self-service style dashboard unifying profile,
// PTO balances, recent pay stubs, time-off requests, garnishments, pay
// advances (with one-click escalation to a debt-collection case), linked
// debt cases, and a company announcements board with acknowledgment
// tracking. Also hosts the printable Employee Record (full personnel
// sheet, 8.5×11, SSN/bank masked to last-4).

import React, { useCallback, useEffect, useState } from 'react';
import {
  Users, Printer, Megaphone, Pin, Trash2, CheckCircle, Scale,
  ChevronRight, Plus, Calendar, DollarSign, AlertTriangle,
} from 'lucide-react';
import api from '../../lib/api';
import { useToast } from '../../components/ToastProvider';
import { useAppStore } from '../../stores/appStore';
import { generateEmployeeRecordHTML, generateWageWithholdingAgreementHTML } from '../../lib/print-templates';
import { formatCurrency, formatDate, formatStatus } from '../../lib/format';

interface DirectoryRow {
  id: string; name: string; email: string; phone: string; department: string;
  job_title: string; employment_type: string; status: string; start_date: string;
}

const PRIORITY_COLORS: Record<string, string> = {
  low: '#94a3b8', normal: '#60a5fa', high: '#f59e0b', urgent: '#ef4444',
};

const HrPortal: React.FC = () => {
  const toast = useToast();
  const setModule = useAppStore((s) => s.setModule);
  const setFocusEntity = useAppStore((s) => s.setFocusEntity);

  const [directory, setDirectory] = useState<DirectoryRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [snapshot, setSnapshot] = useState<any>(null);
  const [loadingSnap, setLoadingSnap] = useState(false);
  const [debtSummary, setDebtSummary] = useState<any>(null);

  // Announcements
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [showCompose, setShowCompose] = useState(false);
  const [compose, setCompose] = useState({ title: '', body: '', category: 'general', priority: 'normal', requires_ack: false, pinned: false });

  // Wage withholdings for the selected employee
  const [withholdings, setWithholdings] = useState<any[]>([]);

  const loadWithholdings = useCallback(async (empId: string) => {
    if (!empId) { setWithholdings([]); return; }
    const r = await api.hrWithholdingList({ employee_id: empId });
    setWithholdings(Array.isArray(r) ? r : []);
  }, []);

  const loadDirectory = useCallback(async () => {
    const r = await api.hrPortalDirectory();
    if (Array.isArray(r)) {
      setDirectory(r as DirectoryRow[]);
      if (r.length > 0) setSelectedId((prev) => prev || (r[0] as any).id);
    }
  }, []);

  const loadAnnouncements = useCallback(async () => {
    const r = await api.hrAnnouncementsList();
    if (Array.isArray(r)) setAnnouncements(r);
  }, []);

  useEffect(() => {
    loadDirectory();
    loadAnnouncements();
    api.hrEmployeeDebtSummary().then((r) => { if (r && !r.error) setDebtSummary(r); }).catch(() => {});
  }, [loadDirectory, loadAnnouncements]);

  const loadSnapshot = useCallback(async (empId: string) => {
    if (!empId) return;
    setLoadingSnap(true);
    try {
      const r = await api.hrPortalSnapshot(empId);
      if (r && !r.error) setSnapshot(r);
      else setSnapshot(null);
    } finally {
      setLoadingSnap(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) { loadSnapshot(selectedId); loadWithholdings(selectedId); }
  }, [selectedId, loadSnapshot, loadWithholdings]);

  // Set up a per-paycheck withholding agreement against an employee debt case.
  const createWithholding = async (debtId: string) => {
    const raw = prompt('Per-paycheck deduction amount ($):');
    if (raw == null) return;
    const amount = parseFloat(raw) || 0;
    if (amount <= 0) { toast.error('Amount must be positive'); return; }
    const r = await api.hrWithholdingSave({
      employee_id: selectedId, debt_id: debtId, per_pay_amount: amount,
      start_date: new Date().toISOString().slice(0, 10),
    });
    if (r?.error) toast.error(r.error);
    else { toast.success('Withholding agreement created'); loadWithholdings(selectedId); }
  };

  const recordDeduction = async (w: any) => {
    if (!confirm(`Record a ${formatCurrency(w.per_pay_amount)} payroll deduction against this debt?`)) return;
    const r = await api.hrWithholdingRecordDeduction({ withholding_id: w.id });
    if (r?.error) toast.error(r.error);
    else {
      toast.success(r.completed
        ? `Final deduction of ${formatCurrency(r.applied || 0)} — debt cleared!`
        : `Deducted ${formatCurrency(r.applied || 0)} · balance ${formatCurrency(r.new_balance || 0)}`);
      await Promise.all([loadWithholdings(selectedId), loadSnapshot(selectedId)]);
      api.hrEmployeeDebtSummary().then((s) => { if (s && !s.error) setDebtSummary(s); }).catch(() => {});
    }
  };

  const printAgreement = async (w: any) => {
    const data = await api.hrWithholdingAgreementData(w.id);
    if (data?.error) { toast.error(data.error); return; }
    const html = generateWageWithholdingAgreementHTML(data);
    await api.printPreview(html, `Wage Withholding Agreement — ${data.employee?.name || ''}`);
  };

  const printRecord = async () => {
    if (!selectedId) return;
    const data = await api.hrEmployeeRecordData(selectedId);
    if (data?.error) { toast.error(data.error); return; }
    const html = generateEmployeeRecordHTML(data);
    await api.printPreview(html, `Employee Record — ${data.employee?.name || ''}`);
  };

  const escalateAdvance = async (advanceId: string) => {
    if (!confirm('Escalate this pay advance into a formal debt-collection case? The outstanding balance becomes a receivable with the employee as debtor.')) return;
    const r = await api.hrAdvanceToDebt(advanceId);
    if (r?.error) toast.error(r.error);
    else {
      toast.success(r.already_linked ? 'Advance already has a debt case' : 'Debt case created');
      await loadSnapshot(selectedId);
      api.hrEmployeeDebtSummary().then((s) => { if (s && !s.error) setDebtSummary(s); }).catch(() => {});
    }
  };

  const saveAnnouncement = async () => {
    if (!compose.title.trim()) { toast.error('Title required'); return; }
    const r = await api.hrAnnouncementSave(compose);
    if (r?.error) toast.error(r.error);
    else {
      setShowCompose(false);
      setCompose({ title: '', body: '', category: 'general', priority: 'normal', requires_ack: false, pinned: false });
      await loadAnnouncements();
    }
  };

  const ackAnnouncement = async (annId: string) => {
    if (!selectedId) { toast.error('Select an employee first'); return; }
    await api.hrAnnouncementAck(annId, selectedId);
    await loadAnnouncements();
    toast.success('Acknowledged');
  };

  const emp = snapshot?.employee;

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: '230px 1fr' }}>
      {/* ── Directory rail ── */}
      <div className="block-card p-0 overflow-hidden" style={{ alignSelf: 'start' }}>
        <div className="px-3 py-2 flex items-center gap-2" style={{ borderBottom: '1px solid var(--color-border-primary)', background: 'var(--color-bg-secondary)' }}>
          <Users size={13} className="text-accent-blue" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Directory ({directory.length})</span>
        </div>
        <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {directory.map((d) => (
            <button
              key={d.id}
              onClick={() => setSelectedId(d.id)}
              className="w-full text-left px-3 py-2"
              style={{
                borderBottom: '1px solid var(--color-border-primary)',
                background: selectedId === d.id ? 'rgba(96,165,250,0.08)' : 'transparent',
                opacity: d.status === 'active' ? 1 : 0.55,
              }}
            >
              <div className="text-xs font-semibold text-text-primary truncate">{d.name}</div>
              <div className="text-[10px] text-text-muted truncate">
                {[d.job_title, d.department].filter(Boolean).join(' · ') || d.employment_type || '—'}
              </div>
            </button>
          ))}
          {directory.length === 0 && (
            <div className="p-4 text-center text-[11px] text-text-muted">No employees yet.</div>
          )}
        </div>
        {debtSummary && debtSummary.count > 0 && (
          <div className="px-3 py-2 text-[10px]" style={{ borderTop: '1px solid var(--color-border-primary)', background: 'rgba(239,68,68,0.06)' }}>
            <span className="font-bold text-accent-expense">{formatCurrency(debtSummary.total_balance)}</span>
            <span className="text-text-muted"> owed by employees ({debtSummary.count} case{debtSummary.count !== 1 ? 's' : ''})</span>
          </div>
        )}
      </div>

      {/* ── Main column ── */}
      <div className="space-y-4 min-w-0">
        {/* Snapshot header */}
        {emp && (
          <div className="block-card p-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-lg font-bold text-text-primary">{emp.name}</h3>
                  <span className={formatStatus(emp.status).className}>{formatStatus(emp.status).label}</span>
                  {snapshot.tenure && (
                    <span className="text-[10px] text-text-muted">
                      {snapshot.tenure.years}y {snapshot.tenure.months}m tenure · anniversary {formatDate(snapshot.tenure.next_anniversary)}
                    </span>
                  )}
                </div>
                <div className="text-xs text-text-muted mt-1">
                  {[emp.job_title, emp.department, emp.email, emp.phone].filter(Boolean).join(' · ')}
                </div>
              </div>
              <button className="block-btn text-xs flex items-center gap-1.5" onClick={printRecord} title="Print the full employee record (SSN/bank masked to last-4)">
                <Printer size={13} /> Print Employee Record
              </button>
            </div>

            {/* Quick stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
              <Mini label="Pay" value={emp.pay_type === 'salary' ? `${formatCurrency(emp.pay_rate)}/yr` : `${formatCurrency(emp.pay_rate)}/hr`} />
              <Mini label="Last Net Pay" value={snapshot.recent_stubs?.[0] ? formatCurrency(snapshot.recent_stubs[0].net_pay) : '—'} sub={snapshot.recent_stubs?.[0] ? formatDate(snapshot.recent_stubs[0].pay_date) : undefined} />
              <Mini
                label="PTO Available"
                value={(() => {
                  const total = (snapshot.pto_balances || []).reduce((s: number, p: any) => s + ((Number(p.accrued_hours ?? p.accrued) || 0) - (Number(p.used_hours ?? p.used) || 0)), 0);
                  return `${total.toFixed(1)} h`;
                })()}
              />
              <Mini
                label="Owed to Company"
                value={formatCurrency((snapshot.debts || []).reduce((s: number, d: any) => s + (d.balance_due || 0), 0) + (snapshot.advances || []).filter((a: any) => !a.related_debt_id).reduce((s: number, a: any) => s + (a.balance || 0), 0))}
                color={(snapshot.debts || []).length + (snapshot.advances || []).length > 0 ? '#f59e0b' : undefined}
              />
            </div>
          </div>
        )}
        {loadingSnap && !emp && <div className="block-card p-6 text-center text-text-muted text-sm">Loading…</div>}

        {/* Advances + Debt cases */}
        {emp && ((snapshot.advances || []).length > 0 || (snapshot.debts || []).length > 0) && (
          <div className="block-card p-0 overflow-hidden">
            <div className="px-3 py-2 flex items-center gap-2" style={{ borderBottom: '1px solid var(--color-border-primary)', background: 'var(--color-bg-secondary)' }}>
              <Scale size={13} className="text-accent-warning" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Advances &amp; Debt Cases</span>
            </div>
            <div className="p-3 space-y-2">
              {(snapshot.advances || []).map((a: any) => (
                <div key={a.id} className="flex items-center justify-between gap-2 text-xs flex-wrap" style={{ padding: '4px 0' }}>
                  <div>
                    <span className="font-mono font-bold">{formatCurrency(a.balance)}</span>
                    <span className="text-text-muted"> balance on {formatCurrency(a.advance_amount)} advance ({formatDate(a.advance_date)})</span>
                    {a.related_debt_id && <span className="ml-2 text-[9px] font-bold px-1.5 py-0.5" style={{ borderRadius: 4, background: '#dc262622', color: '#f87171' }}>IN COLLECTIONS</span>}
                  </div>
                  {!a.related_debt_id && (a.balance || 0) > 0 && (
                    <button className="block-btn text-[10px] flex items-center gap-1" onClick={() => escalateAdvance(a.id)} title="Create a debt-collection case for this advance">
                      <AlertTriangle size={10} /> Escalate to Collections
                    </button>
                  )}
                </div>
              ))}
              {(snapshot.debts || []).map((d: any) => {
                const hasActiveWithholding = withholdings.some((w) => w.debt_id === d.id && w.status === 'active');
                return (
                  <div key={d.id} className="flex items-center justify-between gap-2 text-xs flex-wrap" style={{ padding: '4px 0', borderTop: '1px solid var(--color-border-primary)' }}>
                    <div>
                      <span className="font-mono font-bold text-accent-expense">{formatCurrency(d.balance_due)}</span>
                      <span className="text-text-muted"> debt case · stage {String(d.current_stage || '').replace(/_/g, ' ')} · {formatCurrency(d.payments_made)} repaid</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {!hasActiveWithholding && (d.balance_due || 0) > 0 && (
                        <button className="block-btn text-[10px]" onClick={() => createWithholding(d.id)} title="Set up a voluntary per-paycheck deduction toward this debt">
                          Set Up Withholding
                        </button>
                      )}
                      <button
                        className="block-btn text-[10px] flex items-center gap-1"
                        onClick={() => { setFocusEntity({ type: 'debt', id: d.id }); setModule('debt-collection'); }}
                      >
                        Open Case <ChevronRight size={10} />
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* Wage withholding agreements — per-paycheck deductions
                  applied to debt cases. Record Deduction posts a debt
                  payment (method 'garnishment') and auto-completes the
                  agreement when the balance clears. */}
              {withholdings.length > 0 && (
                <div style={{ borderTop: '1px solid var(--color-border-primary)', paddingTop: 8 }}>
                  <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted mb-1.5">Wage Withholding Agreements</div>
                  {withholdings.map((w) => (
                    <div key={w.id} className="flex items-center justify-between gap-2 text-xs flex-wrap" style={{ padding: '3px 0' }}>
                      <div>
                        <span className="font-mono font-bold">{formatCurrency(w.per_pay_amount)}</span>
                        <span className="text-text-muted">/paycheck · {formatCurrency(w.total_withheld)} withheld over {w.deduction_count || 0} deduction{(w.deduction_count || 0) !== 1 ? 's' : ''}</span>
                        <span className="ml-2 text-[9px] font-bold px-1.5 py-0.5 uppercase" style={{
                          borderRadius: 4,
                          background: w.status === 'active' ? '#16a34a22' : w.status === 'completed' ? '#2563eb22' : '#94a3b822',
                          color: w.status === 'active' ? '#16a34a' : w.status === 'completed' ? '#60a5fa' : '#94a3b8',
                        }}>{w.status}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {w.status === 'active' && (
                          <>
                            <button className="block-btn-primary text-[10px]" onClick={() => recordDeduction(w)} title="Record this paycheck's deduction as a debt payment">
                              Record Deduction
                            </button>
                            <button
                              className="block-btn text-[10px]"
                              onClick={async () => {
                                if (!confirm('Stop this withholding agreement? The remaining debt stays open.')) return;
                                await api.hrWithholdingStop(w.id);
                                loadWithholdings(selectedId);
                              }}
                            >
                              Stop
                            </button>
                          </>
                        )}
                        <button className="block-btn text-[10px] flex items-center gap-1" onClick={() => printAgreement(w)} title="Print the signed authorization form">
                          <Printer size={10} /> Agreement
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Pay stubs + time off side by side */}
        {emp && (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="block-card p-0 overflow-hidden">
              <div className="px-3 py-2 flex items-center gap-2" style={{ borderBottom: '1px solid var(--color-border-primary)', background: 'var(--color-bg-secondary)' }}>
                <DollarSign size={13} className="text-accent-income" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Recent Pay</span>
              </div>
              {(snapshot.recent_stubs || []).length === 0 ? (
                <div className="p-3 text-[11px] text-text-muted">No pay stubs yet.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    {(snapshot.recent_stubs || []).map((s: any) => (
                      <tr key={s.id} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                        <td style={{ padding: '5px 10px', fontSize: 10, fontFamily: 'SF Mono, Menlo, monospace' }}>{formatDate(s.pay_date)}</td>
                        <td style={{ padding: '5px 10px', fontSize: 10, textAlign: 'right' }} className="text-text-muted">gross {formatCurrency(s.gross_pay)}</td>
                        <td style={{ padding: '5px 10px', fontSize: 10, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', fontWeight: 700 }}>{formatCurrency(s.net_pay)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="block-card p-0 overflow-hidden">
              <div className="px-3 py-2 flex items-center gap-2" style={{ borderBottom: '1px solid var(--color-border-primary)', background: 'var(--color-bg-secondary)' }}>
                <Calendar size={13} className="text-accent-blue" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Time Off</span>
              </div>
              {(snapshot.time_off_requests || []).length === 0 ? (
                <div className="p-3 text-[11px] text-text-muted">No time-off requests.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    {(snapshot.time_off_requests || []).slice(0, 6).map((t: any) => (
                      <tr key={t.id} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                        <td style={{ padding: '5px 10px', fontSize: 10, fontFamily: 'SF Mono, Menlo, monospace' }}>{formatDate(t.start_date)} → {formatDate(t.end_date)}</td>
                        <td style={{ padding: '5px 10px', fontSize: 10 }} className="text-text-muted">{t.request_type || t.type || 'PTO'}</td>
                        <td style={{ padding: '5px 10px', fontSize: 10, textAlign: 'right' }}>
                          <span className={formatStatus(t.status || 'pending').className}>{formatStatus(t.status || 'pending').label}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* Announcements board */}
        <div className="block-card p-0 overflow-hidden">
          <div className="px-3 py-2 flex items-center justify-between gap-2" style={{ borderBottom: '1px solid var(--color-border-primary)', background: 'var(--color-bg-secondary)' }}>
            <div className="flex items-center gap-2">
              <Megaphone size={13} className="text-accent-blue" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Announcements</span>
            </div>
            <button className="block-btn text-xs flex items-center gap-1" onClick={() => setShowCompose((v) => !v)}>
              <Plus size={11} /> New
            </button>
          </div>

          {showCompose && (
            <div className="p-3 space-y-2" style={{ borderBottom: '1px solid var(--color-border-primary)', background: 'rgba(96,165,250,0.03)' }}>
              <input className="block-input text-sm w-full" placeholder="Announcement title" value={compose.title} onChange={(e) => setCompose((p) => ({ ...p, title: e.target.value }))} />
              <textarea className="block-input text-xs w-full" rows={3} placeholder="Details…" value={compose.body} onChange={(e) => setCompose((p) => ({ ...p, body: e.target.value }))} />
              <div className="flex items-center gap-3 flex-wrap text-xs">
                <select className="block-input text-xs" value={compose.category} onChange={(e) => setCompose((p) => ({ ...p, category: e.target.value }))}>
                  {['general', 'policy', 'benefits', 'safety', 'event', 'payroll'].map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
                </select>
                <select className="block-input text-xs" value={compose.priority} onChange={(e) => setCompose((p) => ({ ...p, priority: e.target.value }))}>
                  {['low', 'normal', 'high', 'urgent'].map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
                </select>
                <label className="flex items-center gap-1.5 cursor-pointer text-text-secondary">
                  <input type="checkbox" checked={compose.requires_ack} onChange={(e) => setCompose((p) => ({ ...p, requires_ack: e.target.checked }))} className="accent-accent-blue" />
                  Requires acknowledgment
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer text-text-secondary">
                  <input type="checkbox" checked={compose.pinned} onChange={(e) => setCompose((p) => ({ ...p, pinned: e.target.checked }))} className="accent-accent-blue" />
                  Pin to top
                </label>
                <button className="block-btn-primary text-xs ml-auto" onClick={saveAnnouncement}>Post</button>
              </div>
            </div>
          )}

          {announcements.length === 0 ? (
            <div className="p-4 text-center text-[11px] text-text-muted">No announcements. Post one for the team.</div>
          ) : (
            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
              {announcements.map((a) => (
                <div key={a.id} className="px-3 py-2.5" style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      {!!a.pinned && <Pin size={11} className="text-accent-blue shrink-0" />}
                      <span className="text-xs font-bold text-text-primary truncate">{a.title}</span>
                      <span className="text-[9px] font-bold px-1.5 py-0.5 uppercase" style={{ borderRadius: 4, background: (PRIORITY_COLORS[a.priority] || '#60a5fa') + '22', color: PRIORITY_COLORS[a.priority] || '#60a5fa' }}>{a.priority}</span>
                      <span className="text-[9px] text-text-muted uppercase">{a.category}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {!!a.requires_ack && (
                        <>
                          <span className="text-[9px] text-text-muted">{a.ack_count || 0} ack{(a.ack_count || 0) !== 1 ? 's' : ''}</span>
                          <button className="block-btn text-[10px] flex items-center gap-1" onClick={() => ackAnnouncement(a.id)} title={`Acknowledge as ${emp?.name || 'selected employee'}`}>
                            <CheckCircle size={10} /> Ack
                          </button>
                        </>
                      )}
                      <button
                        className="text-text-muted hover:text-accent-expense"
                        onClick={async () => { if (confirm('Delete this announcement?')) { await api.hrAnnouncementDelete(a.id); loadAnnouncements(); } }}
                        title="Delete"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                  {a.body && <div className="text-[11px] text-text-secondary mt-1 whitespace-pre-wrap">{a.body}</div>}
                  <div className="text-[9px] text-text-muted mt-1">{formatDate(a.created_at)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const Mini: React.FC<{ label: string; value: string; sub?: string; color?: string }> = ({ label, value, sub, color }) => (
  <div>
    <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">{label}</div>
    <div className="text-sm font-bold font-mono mt-0.5" style={{ color: color || 'var(--color-text-primary)' }}>{value}</div>
    {sub && <div className="text-[9px] text-text-muted">{sub}</div>}
  </div>
);

export default HrPortal;
