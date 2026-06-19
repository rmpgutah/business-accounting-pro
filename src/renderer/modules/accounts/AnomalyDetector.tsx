// AnomalyDetector.tsx
// Round-2 reports: statistical anomaly detection (3σ), posting frequency
// heatmap, same-day post/approve, round-tripping, phantom vendors,
// overweight account, year-over-year volume change, P&L vs CF reconciliation,
// net-zero accounts, stagnant balances.
//
// Pure-read component fed by the same JE/line/account dataset as GLAnalytics.

import React, { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { formatCurrency, formatDate } from '../../lib/format';

interface Account {
  id: string; code: string; name: string; type: string; subtype: string;
  is_active: number; balance: number;
}
interface JE {
  id: string; entry_number: string; date: string; description: string;
  is_posted: number; created_at: string; created_by: string;
  source_type?: string; class?: string;
  total_debit: number; total_credit: number;
  approved_by?: string; approved_at?: string;
}
interface LineRow {
  id: string; journal_entry_id: string; account_id: string;
  debit: number; credit: number; description: string;
  date: string; entry_number: string; je_description: string; is_posted: number;
}
interface VendorRow { id: string; name: string; created_at?: string; }
interface InvoiceRow { id: string; vendor_id?: string; date: string; amount: number; }

const Card: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="block-card" style={{ padding: 16 }}>
    <h3 className="text-sm font-bold uppercase text-text-primary mb-2">{title}</h3>
    {children}
  </div>
);

const ymKey = (d: string) => (d || '').slice(0, 7);

interface Props {
  accounts: Account[];
  entries: JE[];
  lines: LineRow[];
  vendors?: VendorRow[];
  bills?: InvoiceRow[];
}

const AnomalyDetector: React.FC<Props> = ({ accounts, entries, lines, vendors = [], bills = [] }) => {
  const accountById = useMemo(() => {
    const m = new Map<string, Account>();
    accounts.forEach((a) => m.set(a.id, a));
    return m;
  }, [accounts]);

  // 1: Statistical anomaly — for each account, mean+stddev monthly volume; 3σ outliers
  const anomalies = useMemo(() => {
    const byAcctMonth = new Map<string, Map<string, number>>();
    lines.forEach((l) => {
      const ym = ymKey(l.date);
      const v = Math.abs(l.debit - l.credit);
      if (!byAcctMonth.has(l.account_id)) byAcctMonth.set(l.account_id, new Map());
      const mm = byAcctMonth.get(l.account_id)!;
      mm.set(ym, (mm.get(ym) || 0) + v);
    });
    const flagged: { account: Account; ym: string; value: number; mean: number; stddev: number; z: number }[] = [];
    byAcctMonth.forEach((mm, accId) => {
      const acc = accountById.get(accId); if (!acc) return;
      const vals = Array.from(mm.values());
      if (vals.length < 3) return;
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const stddev = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
      if (stddev === 0) return;
      mm.forEach((v, ym) => {
        const z = (v - mean) / stddev;
        if (z > 3) flagged.push({ account: acc, ym, value: v, mean, stddev, z });
      });
    });
    return flagged.sort((a, b) => b.z - a.z).slice(0, 50);
  }, [lines, accountById]);

  // 2: Posting frequency heatmap weekday × hour
  const heatmap = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    let max = 0;
    entries.forEach((e) => {
      if (!e.created_at) return;
      const d = new Date(e.created_at);
      const dow = d.getDay();
      const h = d.getHours();
      grid[dow][h]++;
      if (grid[dow][h] > max) max = grid[dow][h];
    });
    return { grid, max };
  }, [entries]);

  // 3: JE author leaderboard
  const authorBoard = useMemo(() => {
    const m = new Map<string, { user: string; count: number; total: number; rejected: number; avgPostMins: number; postCount: number }>();
    entries.forEach((e) => {
      const u = e.created_by || '(unknown)';
      if (!m.has(u)) m.set(u, { user: u, count: 0, total: 0, rejected: 0, avgPostMins: 0, postCount: 0 });
      const r = m.get(u)!;
      r.count++;
      r.total += e.total_debit;
      if (!e.is_posted && e.approved_at) r.rejected++;
      if (e.is_posted && e.created_at && e.approved_at) {
        const dt = (new Date(e.approved_at).getTime() - new Date(e.created_at).getTime()) / 60000;
        if (dt > 0) { r.avgPostMins += dt; r.postCount++; }
      }
    });
    return Array.from(m.values()).map((r) => ({
      ...r,
      avgPostMins: r.postCount ? r.avgPostMins / r.postCount : 0,
    })).sort((a, b) => b.count - a.count);
  }, [entries]);

  // 4: Same-day post-and-approve (SoD violation refinement)
  const sameDaySoD = useMemo(() => {
    const N_MIN = 5;
    return entries.filter((e) => {
      if (!e.created_by || !e.approved_by) return false;
      if (e.created_by !== e.approved_by) return false;
      if (!e.created_at || !e.approved_at) return false;
      const dt = (new Date(e.approved_at).getTime() - new Date(e.created_at).getTime()) / 60000;
      return dt >= 0 && dt < N_MIN;
    });
  }, [entries]);

  // 5: Round-tripping — same-day debit/credit pairs of identical amount on accounts
  // that don't normally pair (e.g. revenue immediately reversed)
  const roundTrips = useMemo(() => {
    const byKey = new Map<string, LineRow[]>();
    lines.forEach((l) => {
      const amt = l.debit || l.credit;
      if (amt < 100) return;
      const k = `${l.date}|${amt.toFixed(2)}|${l.account_id}`;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k)!.push(l);
    });
    const flagged: { date: string; account: Account; amount: number; pair: LineRow[] }[] = [];
    byKey.forEach((arr) => {
      const dr = arr.find((x) => x.debit > 0);
      const cr = arr.find((x) => x.credit > 0);
      if (dr && cr) {
        const acc = accountById.get(dr.account_id);
        if (!acc) return;
        // Flag revenue/expense accounts that round-trip same-day same-amount
        if (acc.type === 'revenue' || acc.type === 'expense') {
          flagged.push({ date: dr.date, account: acc, amount: dr.debit, pair: [dr, cr] });
        }
      }
    });
    return flagged.slice(0, 50);
  }, [lines, accountById]);

  // 6: Phantom-vendor detection
  const phantomVendors = useMemo(() => {
    if (!vendors.length) return [];
    const billsByVendor = new Map<string, InvoiceRow[]>();
    bills.forEach((b) => {
      if (!b.vendor_id) return;
      if (!billsByVendor.has(b.vendor_id)) billsByVendor.set(b.vendor_id, []);
      billsByVendor.get(b.vendor_id)!.push(b);
    });
    return vendors.map((v) => {
      const vbills = billsByVendor.get(v.id) || [];
      const onlyOne = vbills.length === 1;
      let createdRecently = false;
      if (v.created_at && vbills.length) {
        const earliest = vbills.reduce((m, b) => (b.date < m ? b.date : m), vbills[0].date);
        const days = (new Date(earliest).getTime() - new Date(v.created_at).getTime()) / 86400000;
        createdRecently = days >= 0 && days <= 30;
      }
      return { vendor: v, billCount: vbills.length, onlyOne, createdRecently };
    }).filter((r) => r.onlyOne || r.createdRecently);
  }, [vendors, bills]);

  // 7: Overweight expense account (>30% of total expenses)
  const overweight = useMemo(() => {
    const expTotals = new Map<string, number>();
    let total = 0;
    lines.forEach((l) => {
      const acc = accountById.get(l.account_id);
      if (!acc || acc.type !== 'expense') return;
      const v = l.debit - l.credit;
      expTotals.set(l.account_id, (expTotals.get(l.account_id) || 0) + v);
      total += v;
    });
    if (total <= 0) return [];
    return Array.from(expTotals.entries())
      .map(([id, v]) => ({ account: accountById.get(id)!, value: v, pct: (v / total) * 100 }))
      .filter((r) => r.pct > 30)
      .sort((a, b) => b.pct - a.pct);
  }, [lines, accountById]);

  // 8: YoY volume change
  const yoy = useMemo(() => {
    const now = new Date();
    const cyStart = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
    const pyStart = new Date(now.getFullYear() - 1, 0, 1).toISOString().slice(0, 10);
    const pyEnd = new Date(now.getFullYear() - 1, 11, 31).toISOString().slice(0, 10);
    const cy = entries.filter((e) => e.date >= cyStart);
    const py = entries.filter((e) => e.date >= pyStart && e.date <= pyEnd);
    const cyCount = cy.length, pyCount = py.length;
    const cyDollar = cy.reduce((s, e) => s + e.total_debit, 0);
    const pyDollar = py.reduce((s, e) => s + e.total_debit, 0);
    const pct = (a: number, b: number) => (b ? ((a - b) / b) * 100 : 0);
    return {
      cyCount, pyCount, cyDollar, pyDollar,
      countPct: pct(cyCount, pyCount),
      dollarPct: pct(cyDollar, pyDollar),
    };
  }, [entries]);

  // 9: P&L vs CF reconciliation walk
  const cfWalk = useMemo(() => {
    let netIncome = 0, depreciation = 0, arDelta = 0, apDelta = 0, invDelta = 0;
    accounts.forEach((a) => {
      const accLines = lines.filter((l) => l.account_id === a.id);
      if (a.type === 'revenue') netIncome += accLines.reduce((s, l) => s + (l.credit - l.debit), 0);
      if (a.type === 'expense') netIncome -= accLines.reduce((s, l) => s + (l.debit - l.credit), 0);
      const nm = (a.name + ' ' + a.subtype).toLowerCase();
      const sumDr = accLines.reduce((s, l) => s + (l.debit - l.credit), 0);
      if (nm.includes('depreciation')) depreciation += accLines.reduce((s, l) => s + (l.debit - l.credit), 0);
      if (nm.includes('receivable')) arDelta += sumDr;
      if (nm.includes('payable')) apDelta += -sumDr;
      if (nm.includes('inventory')) invDelta += sumDr;
    });
    const cfo = netIncome + depreciation - arDelta + apDelta - invDelta;
    return { netIncome, depreciation, arDelta, apDelta, invDelta, cfo };
  }, [accounts, lines]);

  // 10: Net-zero accounts (debits == credits over period)
  const netZero = useMemo(() => {
    const m = new Map<string, { dr: number; cr: number }>();
    lines.forEach((l) => {
      if (!m.has(l.account_id)) m.set(l.account_id, { dr: 0, cr: 0 });
      const r = m.get(l.account_id)!; r.dr += l.debit; r.cr += l.credit;
    });
    const out: { account: Account; dr: number; cr: number }[] = [];
    m.forEach((r, id) => {
      if (r.dr > 0 && Math.abs(r.dr - r.cr) < 0.005) {
        const acc = accountById.get(id); if (acc) out.push({ account: acc, ...r });
      }
    });
    return out;
  }, [lines, accountById]);

  // 11: Stagnant-balance — accounts with no activity in N months
  const stagnant = useMemo(() => {
    const N = 6;
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - N);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const lastActivity = new Map<string, string>();
    lines.forEach((l) => {
      const cur = lastActivity.get(l.account_id) || '';
      if (l.date > cur) lastActivity.set(l.account_id, l.date);
    });
    return accounts.filter((a) => {
      if (!a.is_active) return false;
      if (Math.abs(a.balance) < 0.005) return false;
      const last = lastActivity.get(a.id) || '';
      return last < cutoffStr;
    }).map((a) => ({ account: a, lastActivity: lastActivity.get(a.id) || '(never)' }));
  }, [accounts, lines]);

  return (
    <div className="space-y-4">
      {/* YoY tile + ratios row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="block-card" style={{ padding: 16 }}>
          <div className="text-xs uppercase font-bold text-text-muted">YoY JE Count</div>
          <div className="text-2xl font-mono font-bold mt-1">{yoy.countPct >= 0 ? '+' : ''}{yoy.countPct.toFixed(1)}%</div>
          <div className="text-xs text-text-muted">{yoy.cyCount} vs {yoy.pyCount} prior</div>
        </div>
        <div className="block-card" style={{ padding: 16 }}>
          <div className="text-xs uppercase font-bold text-text-muted">YoY $ Volume</div>
          <div className="text-2xl font-mono font-bold mt-1">{yoy.dollarPct >= 0 ? '+' : ''}{yoy.dollarPct.toFixed(1)}%</div>
          <div className="text-xs text-text-muted">{formatCurrency(yoy.cyDollar)} vs {formatCurrency(yoy.pyDollar)}</div>
        </div>
        <div className="block-card" style={{ padding: 16 }}>
          <div className="text-xs uppercase font-bold text-text-muted">Anomalies (3σ)</div>
          <div className="text-2xl font-mono font-bold mt-1 text-accent-expense">{anomalies.length}</div>
          <div className="text-xs text-text-muted">Account-month outliers</div>
        </div>
        <div className="block-card" style={{ padding: 16 }}>
          <div className="text-xs uppercase font-bold text-text-muted">Net-Zero Accounts</div>
          <div className="text-2xl font-mono font-bold mt-1">{netZero.length}</div>
          <div className="text-xs text-text-muted">Always-balanced (suspense?)</div>
        </div>
      </div>

      {/* Statistical anomalies */}
      <Card title="Statistical Anomalies — 3σ outliers per account-month">
        <div className="overflow-auto max-h-80">
          <table className="block-table w-full text-xs">
            <thead><tr><th>Account</th><th>Month</th><th className="text-right">Value</th><th className="text-right">Mean</th><th className="text-right">σ</th><th className="text-right">z-score</th></tr></thead>
            <tbody>
              {anomalies.length === 0 && <tr><td colSpan={6} className="text-center text-text-muted py-4">No 3σ outliers detected.</td></tr>}
              {anomalies.map((a, i) => (
                <tr key={i}>
                  <td>{a.account.code} {a.account.name}</td>
                  <td>{a.ym}</td>
                  <td className="text-right font-mono">{formatCurrency(a.value)}</td>
                  <td className="text-right font-mono">{formatCurrency(a.mean)}</td>
                  <td className="text-right font-mono">{formatCurrency(a.stddev)}</td>
                  <td className="text-right font-mono text-accent-expense">{a.z.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Heatmap */}
      <Card title="Posting Frequency — Weekday × Hour">
        <div className="overflow-x-auto">
          <table className="text-[10px]" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th></th>
                {Array.from({ length: 24 }, (_, h) => <th key={h} className="px-1 text-text-muted">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => (
                <tr key={d}>
                  <td className="pr-2 font-bold text-text-muted">{d}</td>
                  {heatmap.grid[i].map((v, h) => {
                    const intensity = heatmap.max ? v / heatmap.max : 0;
                    const after = (h >= 20 || h < 6 || i === 0 || i === 6);
                    const bg = v === 0 ? 'transparent' : `rgba(${after ? '239,68,68' : '59,130,246'}, ${0.15 + intensity * 0.85})`;
                    return <td key={h} title={`${d} ${h}:00 — ${v} JEs`} style={{ background: bg, width: 18, height: 18, textAlign: 'center', border: '1px solid #1f2937' }}>{v || ''}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-[11px] text-text-muted mt-2">Red cells = after-hours / weekend posting clusters.</div>
      </Card>

      {/* Same-day SoD */}
      {sameDaySoD.length > 0 && (
        <Card title="Same-User Submit + Approve (< 5 min)">
          <div className="flex items-center gap-2 text-xs text-accent-expense mb-2"><AlertTriangle size={14} />Segregation of duties violations.</div>
          <div className="overflow-auto max-h-72">
            <table className="block-table w-full text-xs">
              <thead><tr><th>Date</th><th>Entry #</th><th>User</th><th>Description</th><th className="text-right">Total</th></tr></thead>
              <tbody>
                {sameDaySoD.map((e) => (
                  <tr key={e.id}>
                    <td>{formatDate(e.date)}</td>
                    <td className="font-mono">{e.entry_number}</td>
                    <td>{e.created_by}</td>
                    <td>{e.description}</td>
                    <td className="text-right font-mono">{formatCurrency(e.total_debit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Round-tripping */}
      {roundTrips.length > 0 && (
        <Card title="Round-Tripping Detection — same-day debit/credit pairs">
          <div className="overflow-auto max-h-72">
            <table className="block-table w-full text-xs">
              <thead><tr><th>Date</th><th>Account</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                {roundTrips.map((r, i) => (
                  <tr key={i}>
                    <td>{formatDate(r.date)}</td>
                    <td>{r.account.code} {r.account.name}</td>
                    <td className="text-right font-mono">{formatCurrency(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Phantom vendors */}
      {phantomVendors.length > 0 && (
        <Card title="Phantom-Vendor Detection">
          <div className="overflow-auto max-h-72">
            <table className="block-table w-full text-xs">
              <thead><tr><th>Vendor</th><th>Bill Count</th><th>Reason</th></tr></thead>
              <tbody>
                {phantomVendors.map((p) => (
                  <tr key={p.vendor.id}>
                    <td>{p.vendor.name}</td>
                    <td>{p.billCount}</td>
                    <td>
                      {p.onlyOne && <span className="block-badge block-badge-warning mr-1">Single bill</span>}
                      {p.createdRecently && <span className="block-badge block-badge-warning">Created &lt;30d before first bill</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Overweight account */}
      {overweight.length > 0 && (
        <Card title="Overweight Expense Accounts (&gt; 30% of total)">
          <div className="overflow-auto max-h-60">
            <table className="block-table w-full text-xs">
              <thead><tr><th>Account</th><th className="text-right">Amount</th><th className="text-right">% of Total</th></tr></thead>
              <tbody>
                {overweight.map((r) => (
                  <tr key={r.account.id}>
                    <td>{r.account.code} {r.account.name}</td>
                    <td className="text-right font-mono">{formatCurrency(r.value)}</td>
                    <td className="text-right font-mono text-accent-expense">{r.pct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* CF walk */}
      <Card title="P&amp;L → Cash Flow Reconciliation Walk">
        <div className="text-xs space-y-1 font-mono">
          <div className="flex justify-between"><span>Net Income</span><span>{formatCurrency(cfWalk.netIncome)}</span></div>
          <div className="flex justify-between"><span>+ Depreciation</span><span>{formatCurrency(cfWalk.depreciation)}</span></div>
          <div className="flex justify-between"><span>− Δ Accounts Receivable</span><span>{formatCurrency(-cfWalk.arDelta)}</span></div>
          <div className="flex justify-between"><span>+ Δ Accounts Payable</span><span>{formatCurrency(cfWalk.apDelta)}</span></div>
          <div className="flex justify-between"><span>− Δ Inventory</span><span>{formatCurrency(-cfWalk.invDelta)}</span></div>
          <div className="flex justify-between border-t border-border-primary pt-1 font-bold">
            <span>= Cash Flow from Operations</span><span>{formatCurrency(cfWalk.cfo)}</span>
          </div>
        </div>
      </Card>

      {/* Net-zero accounts */}
      {netZero.length > 0 && (
        <Card title="Net-Zero Accounts — debits == credits over period">
          <div className="overflow-auto max-h-60">
            <table className="block-table w-full text-xs">
              <thead><tr><th>Account</th><th className="text-right">Debits</th><th className="text-right">Credits</th></tr></thead>
              <tbody>
                {netZero.map((r) => (
                  <tr key={r.account.id}>
                    <td>{r.account.code} {r.account.name}</td>
                    <td className="text-right font-mono">{formatCurrency(r.dr)}</td>
                    <td className="text-right font-mono">{formatCurrency(r.cr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Stagnant balance */}
      {stagnant.length > 0 && (
        <Card title="Stagnant-Balance Accounts — no activity in 6 months">
          <div className="overflow-auto max-h-60">
            <table className="block-table w-full text-xs">
              <thead><tr><th>Account</th><th>Last Activity</th><th className="text-right">Balance</th></tr></thead>
              <tbody>
                {stagnant.map((r) => (
                  <tr key={r.account.id}>
                    <td>{r.account.code} {r.account.name}</td>
                    <td>{r.lastActivity}</td>
                    <td className="text-right font-mono">{formatCurrency(r.account.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Author leaderboard mini */}
      <Card title="JE Author Leaderboard (compact)">
        <div className="overflow-auto max-h-72">
          <table className="block-table w-full text-xs">
            <thead><tr><th>User</th><th className="text-right"># JEs</th><th className="text-right">$ Posted</th><th className="text-right">Rejected</th><th className="text-right">Avg Time-to-Post</th></tr></thead>
            <tbody>
              {authorBoard.map((r) => (
                <tr key={r.user}>
                  <td>{r.user}</td>
                  <td className="text-right font-mono">{r.count}</td>
                  <td className="text-right font-mono">{formatCurrency(r.total)}</td>
                  <td className="text-right font-mono">{r.rejected}</td>
                  <td className="text-right font-mono">{r.avgPostMins ? `${r.avgPostMins.toFixed(0)} min` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

export default AnomalyDetector;
