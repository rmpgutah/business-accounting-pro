// GLAnalytics.tsx
// Reports / insights tab for the accounts module. 15 reports covering
// activity, anomalies, trends, budget variance, common-size, etc.
// Uses recharts (already a dep). Pure-read; no schema mutations beyond
// the accounts.monthly_cap column added by the migration runner.

import React, { useEffect, useMemo, useState } from 'react';
import {
  PieChart, Pie, Cell,
  BarChart, Bar,
  LineChart, Line,
  XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import {
  AlertTriangle, TrendingUp, TrendingDown, Activity, FileText,
  DollarSign, Calendar, Search, Save, BarChart3, Wallet, Users, Sparkles,
} from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency, formatDate } from '../../lib/format';
import { todayLocal } from '../../lib/date-helpers';
import ErrorBanner from '../../components/ErrorBanner';
import AnomalyDetector from './AnomalyDetector';
import WorkingCapitalDashboard from './WorkingCapitalDashboard';
import JEAuthorLeaderboard from './JEAuthorLeaderboard';
import PowerFeatures from './PowerFeatures';

const COLORS = ['#3b82f6', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6'];

interface Account {
  id: string; code: string; name: string; type: string; subtype: string;
  is_active: number; balance: number; monthly_cap?: number;
}
interface JE {
  id: string; entry_number: string; date: string; description: string;
  is_posted: number; created_at: string; created_by: string;
  source_type?: string; class?: string;
  total_debit: number; total_credit: number;
}
interface Line {
  id: string; journal_entry_id: string; account_id: string;
  debit: number; credit: number; description: string;
  date: string; entry_number: string; je_description: string; is_posted: number;
}

const ymKey = (d: string) => (d || '').slice(0, 7);
const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-');
  if (!y || !m) return ym;
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
};
const last12Months = () => {
  const out: { ym: string; label: string }[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ ym, label: monthLabel(ym) });
  }
  return out;
};
const todayISO = () => todayLocal();
const ymStart = (offsetMonths = 0) => {
  // DATE: build YYYY-MM-DD from local components — toISOString() shifts day in non-UTC zones.
  const d = new Date();
  d.setMonth(d.getMonth() + offsetMonths, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

const Card: React.FC<{ title?: string; children: React.ReactNode; className?: string }> = ({ title, children, className }) => (
  <div className={`block-card ${className ?? ''}`} style={{ padding: 16 }}>
    {title && <h3 className="text-sm font-bold uppercase text-text-primary mb-2">{title}</h3>}
    {children}
  </div>
);

const Stat: React.FC<{ label: string; value: string; sub?: string; tone?: 'income' | 'expense' | 'blue' | 'default' }> = ({ label, value, sub, tone = 'default' }) => {
  const toneCls = tone === 'income' ? 'text-accent-income' : tone === 'expense' ? 'text-accent-expense' : tone === 'blue' ? 'text-accent-blue' : 'text-text-primary';
  return (
    <div className="block-card" style={{ padding: 16 }}>
      <div className="text-xs uppercase font-bold text-text-muted">{label}</div>
      <div className={`text-2xl font-mono font-bold mt-1 ${toneCls}`}>{value}</div>
      {sub && <div className="text-xs text-text-muted mt-1">{sub}</div>}
    </div>
  );
};

const GLAnalytics: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [entries, setEntries] = useState<JE[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [bills, setBills] = useState<any[]>([]);

  // Sub-tab navigation for round-2 features
  type SubTab = 'core' | 'anomalies' | 'capital' | 'authors' | 'power';
  const [subTab, setSubTab] = useState<SubTab>('core');

  // Filters
  const [periodStart, setPeriodStart] = useState(ymStart(-1));
  const [periodEnd, setPeriodEnd] = useState(todayISO());
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [accountSearch, setAccountSearch] = useState('');

  // Edit cap state
  const [capDraft, setCapDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!activeCompany) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError('');
        const cid = activeCompany.id;
        const [accs, jes, lns] = await Promise.all([
          api.rawQuery(
            `SELECT id, code, name, type, subtype, is_active, COALESCE(balance,0) as balance,
                    COALESCE(monthly_cap, 0) as monthly_cap
             FROM accounts WHERE company_id = ? ORDER BY code`,
            [cid]
          ),
          api.rawQuery(
            `SELECT je.id, je.entry_number, je.date, je.description, je.is_posted,
                    je.created_at, COALESCE(je.created_by,'') as created_by,
                    COALESCE(je.source_type,'') as source_type,
                    COALESCE(je.class,'') as class,
                    COALESCE((SELECT SUM(debit) FROM journal_entry_lines WHERE journal_entry_id = je.id),0) as total_debit,
                    COALESCE((SELECT SUM(credit) FROM journal_entry_lines WHERE journal_entry_id = je.id),0) as total_credit
             FROM journal_entries je WHERE je.company_id = ?`,
            [cid]
          ),
          api.rawQuery(
            `SELECT jel.id, jel.journal_entry_id, jel.account_id,
                    COALESCE(jel.debit,0) as debit, COALESCE(jel.credit,0) as credit,
                    COALESCE(jel.description,'') as description,
                    je.date, je.entry_number, COALESCE(je.description,'') as je_description,
                    je.is_posted
             FROM journal_entry_lines jel
             JOIN journal_entries je ON je.id = jel.journal_entry_id
             WHERE je.company_id = ?`,
            [cid]
          ),
        ]);
        if (cancelled) return;
        setAccounts(Array.isArray(accs) ? accs : []);
        setEntries(Array.isArray(jes) ? jes : []);
        setLines(Array.isArray(lns) ? lns : []);
        // Vendors / bills are optional — gracefully handle missing tables.
        try {
          const vrows = await api.rawQuery(
            `SELECT id, name, COALESCE(created_at,'') as created_at FROM vendors WHERE company_id = ?`,
            [cid]
          );
          if (!cancelled) setVendors(Array.isArray(vrows) ? vrows : []);
        } catch { /* table may not exist */ }
        try {
          const brows = await api.rawQuery(
            `SELECT id, COALESCE(vendor_id,'') as vendor_id, date, COALESCE(amount,total,0) as amount FROM bills WHERE company_id = ?`,
            [cid]
          );
          if (!cancelled) setBills(Array.isArray(brows) ? brows : []);
        } catch { /* table may not exist */ }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load analytics');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeCompany]);

  const accountById = useMemo(() => {
    const m = new Map<string, Account>();
    accounts.forEach((a) => m.set(a.id, a));
    return m;
  }, [accounts]);

  const inPeriod = (d: string) => d >= periodStart && d <= periodEnd;
  const periodEntries = useMemo(() => entries.filter((e) => inPeriod(e.date)), [entries, periodStart, periodEnd]);
  const periodLines = useMemo(() => lines.filter((l) => inPeriod(l.date)), [lines, periodStart, periodEnd]);

  // ── 1: Account activity report ──
  const activityRows = useMemo(() => {
    if (!selectedAccountId) return [];
    const acc = accountById.get(selectedAccountId);
    if (!acc) return [];
    const rows = lines
      .filter((l) => l.account_id === selectedAccountId)
      .sort((a, b) => (a.date + a.entry_number).localeCompare(b.date + b.entry_number));
    let running = 0;
    const isDebitNormal = acc.type === 'asset' || acc.type === 'expense';
    return rows.map((l) => {
      const delta = isDebitNormal ? l.debit - l.credit : l.credit - l.debit;
      running += delta;
      return { ...l, running };
    });
  }, [selectedAccountId, lines, accountById]);

  // ── 2: Account history monthly chart ──
  const accountHistory = useMemo(() => {
    if (!selectedAccountId) return [];
    const acc = accountById.get(selectedAccountId);
    if (!acc) return [];
    const isDebitNormal = acc.type === 'asset' || acc.type === 'expense';
    const months = last12Months();
    const map = new Map<string, { debit: number; credit: number }>();
    months.forEach((m) => map.set(m.ym, { debit: 0, credit: 0 }));
    lines.filter((l) => l.account_id === selectedAccountId).forEach((l) => {
      const ym = ymKey(l.date);
      const slot = map.get(ym);
      if (slot) { slot.debit += l.debit; slot.credit += l.credit; }
    });
    let running = 0;
    return months.map((m) => {
      const v = map.get(m.ym)!;
      running += isDebitNormal ? v.debit - v.credit : v.credit - v.debit;
      return { label: m.label, debit: v.debit, credit: v.credit, balance: running };
    });
  }, [selectedAccountId, lines, accountById]);

  // ── 3: Top accounts by activity ──
  const topAccountsByActivity = useMemo(() => {
    const counts = new Map<string, number>();
    periodLines.forEach((l) => counts.set(l.account_id, (counts.get(l.account_id) || 0) + 1));
    return Array.from(counts.entries())
      .map(([id, n]) => ({ name: accountById.get(id)?.code + ' ' + (accountById.get(id)?.name ?? ''), count: n }))
      .sort((a, b) => b.count - a.count).slice(0, 10);
  }, [periodLines, accountById]);

  // ── 4: Largest entries dashboard ──
  const largestEntries = useMemo(() => {
    return [...periodEntries]
      .sort((a, b) => (b.total_debit + b.total_credit) - (a.total_debit + a.total_credit))
      .slice(0, 20);
  }, [periodEntries]);

  // ── 5: Out-of-period entries ──
  const outOfPeriod = useMemo(() => {
    return entries.filter((e) => e.date < periodStart || e.date > periodEnd)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [entries, periodStart, periodEnd]);

  // ── 6: Suspicious entry detection ──
  const suspiciousEntries = useMemo(() => {
    const flagged: { je: JE; reasons: string[] }[] = [];
    // 90-day prior averages
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const cutoff = ninetyDaysAgo.toISOString().slice(0, 10);
    const recentVals = entries.filter((e) => e.date >= cutoff).map((e) => e.total_debit);
    const avg = recentVals.length ? recentVals.reduce((a, b) => a + b, 0) / recentVals.length : 0;
    const stddev = recentVals.length
      ? Math.sqrt(recentVals.reduce((a, b) => a + (b - avg) ** 2, 0) / recentVals.length)
      : 0;
    const bigThresh = avg + 3 * stddev;

    periodEntries.forEach((e) => {
      const reasons: string[] = [];
      const v = e.total_debit;
      if (v > 0 && v % 1000 === 0) reasons.push('round thousand');
      if (v > 0 && v % 1 === 0 && v >= 100) reasons.push('even-dollar');
      if (e.created_at) {
        const d = new Date(e.created_at);
        const h = d.getHours();
        if (h >= 20 || h < 6) reasons.push('after-hours');
        const dow = d.getDay();
        if (dow === 0 || dow === 6) reasons.push('weekend creation');
      }
      if (bigThresh > 0 && v > bigThresh && v > 1000) reasons.push('outlier vs 90d avg');
      if (reasons.length) flagged.push({ je: e, reasons });
    });
    return flagged;
  }, [periodEntries, entries]);

  // ── 7: Posted vs unposted ──
  const postedSummary = useMemo(() => {
    let pCount = 0, pTotal = 0, uCount = 0, uTotal = 0;
    periodEntries.forEach((e) => {
      if (e.is_posted) { pCount++; pTotal += e.total_debit; }
      else { uCount++; uTotal += e.total_debit; }
    });
    return { pCount, pTotal, uCount, uTotal };
  }, [periodEntries]);

  // ── 8: JE volume chart (last 12 mo) ──
  const jeVolume = useMemo(() => {
    const months = last12Months();
    const m = new Map<string, number>();
    months.forEach((mm) => m.set(mm.ym, 0));
    entries.forEach((e) => {
      const k = ymKey(e.date);
      if (m.has(k)) m.set(k, (m.get(k) || 0) + 1);
    });
    return months.map((mm) => ({ label: mm.label, count: m.get(mm.ym) || 0 }));
  }, [entries]);

  // ── 9: Account balance trend (12 mo) — uses accountHistory above ──

  // ── 10: Variance to budget (monthly_cap) ──
  const varianceToBudget = useMemo(() => {
    // Compare current-month activity vs monthly_cap on each account
    const startOfMonth = ymStart(0);
    const monthLines = lines.filter((l) => l.date >= startOfMonth);
    const totals = new Map<string, number>();
    monthLines.forEach((l) => {
      const acc = accountById.get(l.account_id);
      if (!acc) return;
      const isDr = acc.type === 'asset' || acc.type === 'expense';
      const v = Math.abs(isDr ? l.debit - l.credit : l.credit - l.debit);
      totals.set(l.account_id, (totals.get(l.account_id) || 0) + v);
    });
    return accounts
      .filter((a) => (a.monthly_cap || 0) > 0)
      .map((a) => {
        const actual = totals.get(a.id) || 0;
        const cap = a.monthly_cap || 0;
        return {
          id: a.id, code: a.code, name: a.name,
          actual, cap, variance: actual - cap,
          pct: cap > 0 ? (actual / cap) * 100 : 0,
        };
      })
      .sort((a, b) => b.pct - a.pct);
  }, [accounts, lines, accountById]);

  // ── 11: Common-size statements ──
  const commonSize = useMemo(() => {
    const totals = new Map<string, number>();
    periodLines.forEach((l) => {
      const acc = accountById.get(l.account_id);
      if (!acc) return;
      if (acc.type !== 'revenue' && acc.type !== 'expense') return;
      const v = acc.type === 'revenue' ? l.credit - l.debit : l.debit - l.credit;
      totals.set(l.account_id, (totals.get(l.account_id) || 0) + v);
    });
    let revTotal = 0;
    accounts.forEach((a) => { if (a.type === 'revenue') revTotal += totals.get(a.id) || 0; });
    const rows = accounts
      .filter((a) => a.type === 'revenue' || a.type === 'expense')
      .map((a) => ({
        ...a, amount: totals.get(a.id) || 0,
        pct: revTotal > 0 ? ((totals.get(a.id) || 0) / revTotal) * 100 : 0,
      }))
      .filter((r) => Math.abs(r.amount) > 0.005);
    return { rows, revTotal };
  }, [periodLines, accounts, accountById]);

  // ── 12: Comparative balance sheet (current vs prior period) ──
  const comparativeBS = useMemo(() => {
    const days = (new Date(periodEnd).getTime() - new Date(periodStart).getTime()) / 86400000;
    const priorEnd = new Date(new Date(periodStart).getTime() - 86400000).toISOString().slice(0, 10);
    const priorStart = new Date(new Date(priorEnd).getTime() - days * 86400000).toISOString().slice(0, 10);
    const sumLinesAsOf = (asOfStart: string, asOfEnd: string) => {
      const map = new Map<string, number>();
      lines.filter((l) => l.date >= asOfStart && l.date <= asOfEnd).forEach((l) => {
        const acc = accountById.get(l.account_id);
        if (!acc) return;
        if (acc.type === 'revenue' || acc.type === 'expense') return;
        const isDr = acc.type === 'asset';
        const v = isDr ? l.debit - l.credit : l.credit - l.debit;
        map.set(l.account_id, (map.get(l.account_id) || 0) + v);
      });
      return map;
    };
    const cur = sumLinesAsOf('0000-00-00', periodEnd);
    const prior = sumLinesAsOf('0000-00-00', priorEnd);
    return accounts
      .filter((a) => a.type === 'asset' || a.type === 'liability' || a.type === 'equity')
      .map((a) => ({
        ...a, current: cur.get(a.id) || 0, prior: prior.get(a.id) || 0,
        delta: (cur.get(a.id) || 0) - (prior.get(a.id) || 0),
      }))
      .filter((r) => Math.abs(r.current) + Math.abs(r.prior) > 0.005);
  }, [accounts, lines, periodStart, periodEnd, accountById]);

  // ── 13: Account turnover (AR / AP / Inventory) ──
  const turnover = useMemo(() => {
    const findByName = (kw: string) => accounts.find(
      (a) => a.name.toLowerCase().includes(kw) || a.subtype.toLowerCase().includes(kw)
    );
    const ar = findByName('receivable');
    const ap = findByName('payable');
    const inv = findByName('inventory');
    const days = Math.max(1, (new Date(periodEnd).getTime() - new Date(periodStart).getTime()) / 86400000);
    const revenue = accounts.filter((a) => a.type === 'revenue').reduce((s, a) => {
      const lns = periodLines.filter((l) => l.account_id === a.id);
      return s + lns.reduce((ss, l) => ss + (l.credit - l.debit), 0);
    }, 0);
    const expense = accounts.filter((a) => a.type === 'expense').reduce((s, a) => {
      const lns = periodLines.filter((l) => l.account_id === a.id);
      return s + lns.reduce((ss, l) => ss + (l.debit - l.credit), 0);
    }, 0);
    const compute = (acc: Account | undefined, denom: number) => {
      if (!acc || denom <= 0) return null;
      const bal = acc.balance || 0;
      const turns = denom / Math.max(0.01, bal);
      return { account: acc, balance: bal, turns, daysOut: days / Math.max(0.0001, turns) };
    };
    return {
      ar: compute(ar, revenue),
      ap: compute(ap, expense),
      inventory: compute(inv, expense),
    };
  }, [accounts, periodLines, periodStart, periodEnd]);

  // ── 14: Cash position dashboard ──
  const cashPosition = useMemo(() => {
    const cashAccounts = accounts.filter(
      (a) => a.type === 'asset' && (a.subtype.toLowerCase().includes('cash') || a.name.toLowerCase().includes('cash') || a.name.toLowerCase().includes('checking') || a.name.toLowerCase().includes('savings'))
    );
    if (!cashAccounts.length) return { rows: [] as { date: string; balance: number }[], lowDays: 0, lowThresh: 0 };
    const cashIds = new Set(cashAccounts.map((a) => a.id));
    const days = 90;
    const out: { date: string; balance: number }[] = [];
    // Build daily delta totals from all-time, then walk forward keeping the running balance.
    const byDate = new Map<string, number>();
    lines.forEach((l) => {
      if (!cashIds.has(l.account_id)) return;
      byDate.set(l.date, (byDate.get(l.date) || 0) + (l.debit - l.credit));
    });
    // Compute opening balance prior to (today - 90)
    const start = new Date(); start.setDate(start.getDate() - days);
    const startStr = start.toISOString().slice(0, 10);
    let running = 0;
    Array.from(byDate.entries()).filter(([d]) => d < startStr).forEach(([, v]) => running += v);
    for (let i = 0; i <= days; i++) {
      const d = new Date(start.getTime() + i * 86400000);
      const ds = d.toISOString().slice(0, 10);
      running += byDate.get(ds) || 0;
      out.push({ date: ds, balance: running });
    }
    const max = Math.max(...out.map((r) => r.balance), 1);
    const lowThresh = max * 0.2;
    const lowDays = out.filter((r) => r.balance < lowThresh).length;
    return { rows: out, lowDays, lowThresh };
  }, [accounts, lines]);

  // ── 15: GL by source-document type ──
  const bySource = useMemo(() => {
    const m = new Map<string, number>();
    periodEntries.forEach((e) => {
      const k = (e.source_type || 'manual').toLowerCase();
      const label = k === '' ? 'manual' : k;
      m.set(label, (m.get(label) || 0) + e.total_debit);
    });
    return Array.from(m.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [periodEntries]);

  // ── Save monthly_cap edits ──
  const saveCap = async (id: string) => {
    const v = Number(capDraft[id] || 0);
    try {
      await api.update('accounts', id, { monthly_cap: v });
      setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, monthly_cap: v } : a)));
      setCapDraft((d) => { const n = { ...d }; delete n[id]; return n; });
    } catch (e: any) {
      setError(e?.message || 'Failed to save cap');
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-text-muted text-sm">Loading analytics...</div>;

  const filteredAccounts = accounts.filter((a) => {
    const q = accountSearch.trim().toLowerCase();
    if (!q) return true;
    return a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q);
  });

  const subTabs: { id: SubTab; label: string; icon: React.ReactNode }[] = [
    { id: 'core', label: 'Core', icon: <BarChart3 size={12} /> },
    { id: 'anomalies', label: 'Anomalies & Forensics', icon: <AlertTriangle size={12} /> },
    { id: 'capital', label: 'Working Capital', icon: <Wallet size={12} /> },
    { id: 'authors', label: 'Author Leaderboard', icon: <Users size={12} /> },
    { id: 'power', label: 'Power Features', icon: <Sparkles size={12} /> },
  ];

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} title="Analytics error" onDismiss={() => setError('')} />}

      {/* Sub-tab nav */}
      <div className="flex flex-wrap gap-1 border-b border-border-primary">
        {subTabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold uppercase border-b-2 -mb-px ${
              subTab === t.id ? 'border-b-accent-blue text-text-primary' : 'border-b-transparent text-text-muted hover:text-text-secondary'
            }`}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {subTab === 'anomalies' && (
        <AnomalyDetector accounts={accounts} entries={entries as any} lines={lines as any} vendors={vendors} bills={bills} />
      )}
      {subTab === 'capital' && (
        <WorkingCapitalDashboard accounts={accounts} lines={lines as any} />
      )}
      {subTab === 'authors' && (
        <JEAuthorLeaderboard entries={entries as any} />
      )}
      {subTab === 'power' && (
        <PowerFeatures accounts={accounts} />
      )}
      {subTab !== 'core' ? null : <>

      {/* Period filter */}
      <Card title="Period">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-2">
            <Calendar size={14} className="text-text-muted" />
            <span className="text-text-muted uppercase font-bold">From</span>
            <input type="date" className="block-input" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-text-muted uppercase font-bold">To</span>
            <input type="date" className="block-input" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </label>
          <div className="text-text-muted ml-auto">
            {periodEntries.length} entries · {periodLines.length} lines in period
          </div>
        </div>
      </Card>

      {/* Stat row: posted/unposted + cash + JE count */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Stat label="Posted JEs" value={String(postedSummary.pCount)} sub={formatCurrency(postedSummary.pTotal)} tone="income" />
        <Stat label="Unposted JEs" value={String(postedSummary.uCount)} sub={formatCurrency(postedSummary.uTotal)} tone="expense" />
        <Stat label="Out-of-Period" value={String(outOfPeriod.length)} sub="entries dated outside the period" tone={outOfPeriod.length ? 'expense' : 'default'} />
        <Stat label="Suspicious flags" value={String(suspiciousEntries.length)} sub="round/even/after-hours/outlier" tone={suspiciousEntries.length ? 'expense' : 'default'} />
      </div>

      {/* JE volume chart */}
      <Card title="Journal Entry Volume — Last 12 Months">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={jeVolume}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="label" stroke="#9ca3af" fontSize={11} />
            <YAxis stroke="#9ca3af" fontSize={11} />
            <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151' }} />
            <Bar dataKey="count" fill="#3b82f6" />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Top accounts by activity */}
      <Card title="Top 10 Accounts by Transaction Count (this period)">
        {topAccountsByActivity.length === 0 ? (
          <div className="text-text-muted text-sm py-8 text-center">No activity in period.</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={topAccountsByActivity} layout="vertical" margin={{ left: 140 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis type="number" stroke="#9ca3af" fontSize={11} />
              <YAxis dataKey="name" type="category" stroke="#9ca3af" fontSize={10} width={140} />
              <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151' }} />
              <Bar dataKey="count" fill="#22c55e" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* GL by source type pie */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="GL by Source Document Type">
          {bySource.length === 0 ? (
            <div className="text-text-muted text-sm py-8 text-center">No entries in period.</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={bySource} dataKey="value" nameKey="name" outerRadius={90} label={(e: any) => `${e.name}`}>
                  {bySource.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: any) => formatCurrency(v)} contentStyle={{ background: '#1f2937', border: '1px solid #374151' }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Cash Position — Last 90 Days">
          {cashPosition.rows.length === 0 ? (
            <div className="text-text-muted text-sm py-8 text-center">No cash accounts found.</div>
          ) : (
            <>
              <div className="text-xs text-text-muted mb-1">
                Low-balance days (&lt; 20% of peak): <span className={cashPosition.lowDays > 0 ? 'text-accent-expense font-bold' : 'text-text-primary'}>{cashPosition.lowDays}</span>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={cashPosition.rows}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="date" stroke="#9ca3af" fontSize={10} hide />
                  <YAxis stroke="#9ca3af" fontSize={11} />
                  <Tooltip formatter={(v: any) => formatCurrency(v)} contentStyle={{ background: '#1f2937', border: '1px solid #374151' }} />
                  <Line type="monotone" dataKey="balance" stroke="#06b6d4" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </>
          )}
        </Card>
      </div>

      {/* Account picker for activity / history reports */}
      <Card title="Account Activity Report">
        <div className="flex flex-wrap items-center gap-3 text-xs mb-3">
          <div className="relative flex items-center">
            <Search size={14} className="absolute left-2 text-text-muted" />
            <input
              className="block-input pl-7"
              placeholder="Search account..."
              value={accountSearch}
              onChange={(e) => setAccountSearch(e.target.value)}
            />
          </div>
          <select
            className="block-input"
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
          >
            <option value="">— select account —</option>
            {filteredAccounts.slice(0, 200).map((a) => (
              <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
            ))}
          </select>
        </div>

        {selectedAccountId && (
          <>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={accountHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="label" stroke="#9ca3af" fontSize={11} />
                <YAxis stroke="#9ca3af" fontSize={11} />
                <Tooltip formatter={(v: any) => formatCurrency(v)} contentStyle={{ background: '#1f2937', border: '1px solid #374151' }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="debit" fill="#3b82f6" name="Debits" />
                <Bar dataKey="credit" fill="#ef4444" name="Credits" />
                <Line type="monotone" dataKey="balance" stroke="#22c55e" name="Running Balance" />
              </BarChart>
            </ResponsiveContainer>
            <div className="overflow-auto max-h-96 mt-3">
              <table className="block-table w-full text-xs">
                <thead>
                  <tr>
                    <th>Date</th><th>Entry #</th><th>Description</th>
                    <th className="text-right">Debit</th><th className="text-right">Credit</th>
                    <th className="text-right">Running</th>
                  </tr>
                </thead>
                <tbody>
                  {activityRows.length === 0 && (
                    <tr><td colSpan={6} className="text-center text-text-muted py-4">No transactions for this account.</td></tr>
                  )}
                  {activityRows.map((r) => (
                    <tr key={r.id}>
                      <td>{formatDate(r.date)}</td>
                      <td className="font-mono">{r.entry_number}</td>
                      <td>{r.description || r.je_description}</td>
                      <td className="text-right font-mono">{r.debit ? formatCurrency(r.debit) : ''}</td>
                      <td className="text-right font-mono">{r.credit ? formatCurrency(r.credit) : ''}</td>
                      <td className="text-right font-mono">{formatCurrency(r.running)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {/* Largest entries */}
      <Card title="Top 20 Largest Journal Entries (this period)">
        <div className="overflow-auto max-h-96">
          <table className="block-table w-full text-xs">
            <thead>
              <tr><th>Date</th><th>Entry #</th><th>Description</th><th>Posted?</th><th className="text-right">Total</th></tr>
            </thead>
            <tbody>
              {largestEntries.map((e) => (
                <tr key={e.id}>
                  <td>{formatDate(e.date)}</td>
                  <td className="font-mono">{e.entry_number}</td>
                  <td>{e.description}</td>
                  <td>{e.is_posted ? <span className="block-badge block-badge-income">Posted</span> : <span className="block-badge block-badge-warning">Draft</span>}</td>
                  <td className="text-right font-mono">{formatCurrency(e.total_debit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Out-of-period entries */}
      {outOfPeriod.length > 0 && (
        <Card title="Out-of-Period Entries">
          <div className="flex items-start gap-2 text-xs text-accent-expense mb-2">
            <AlertTriangle size={14} className="mt-0.5" />
            <span>Entries dated outside the selected period.</span>
          </div>
          <div className="overflow-auto max-h-72">
            <table className="block-table w-full text-xs">
              <thead><tr><th>Date</th><th>Entry #</th><th>Description</th><th className="text-right">Total</th></tr></thead>
              <tbody>
                {outOfPeriod.slice(0, 200).map((e) => (
                  <tr key={e.id}>
                    <td>{formatDate(e.date)}</td>
                    <td className="font-mono">{e.entry_number}</td>
                    <td>{e.description}</td>
                    <td className="text-right font-mono">{formatCurrency(e.total_debit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Suspicious entries */}
      {suspiciousEntries.length > 0 && (
        <Card title="Suspicious Entry Detection">
          <div className="overflow-auto max-h-96">
            <table className="block-table w-full text-xs">
              <thead><tr><th>Date</th><th>Entry #</th><th>Description</th><th>Flags</th><th className="text-right">Total</th></tr></thead>
              <tbody>
                {suspiciousEntries.map(({ je, reasons }) => (
                  <tr key={je.id}>
                    <td>{formatDate(je.date)}</td>
                    <td className="font-mono">{je.entry_number}</td>
                    <td>{je.description}</td>
                    <td>
                      {reasons.map((r) => (
                        <span key={r} className="block-badge block-badge-warning mr-1">{r}</span>
                      ))}
                    </td>
                    <td className="text-right font-mono">{formatCurrency(je.total_debit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Variance to budget per account */}
      <Card title="Variance to Budget — current month">
        <div className="text-xs text-text-muted mb-2">
          Set per-account monthly cap below. Activity is computed on the natural side (debits for expense/asset, credits for revenue/liability/equity).
        </div>
        <div className="overflow-auto max-h-96">
          <table className="block-table w-full text-xs">
            <thead>
              <tr>
                <th>Code</th><th>Account</th>
                <th className="text-right">Cap</th>
                <th className="text-right">Actual MTD</th>
                <th className="text-right">Variance</th>
                <th className="text-right">% of Cap</th>
                <th>Edit Cap</th>
              </tr>
            </thead>
            <tbody>
              {varianceToBudget.map((r) => (
                <tr key={r.id}>
                  <td className="font-mono">{r.code}</td>
                  <td>{r.name}</td>
                  <td className="text-right font-mono">{formatCurrency(r.cap)}</td>
                  <td className="text-right font-mono">{formatCurrency(r.actual)}</td>
                  <td className={`text-right font-mono ${r.variance > 0 ? 'text-accent-expense' : 'text-accent-income'}`}>
                    {formatCurrency(r.variance)}
                  </td>
                  <td className={`text-right font-mono ${r.pct > 100 ? 'text-accent-expense' : 'text-text-primary'}`}>
                    {r.pct.toFixed(0)}%
                  </td>
                  <td className="flex items-center gap-1">
                    <input
                      type="number"
                      className="block-input w-24"
                      value={capDraft[r.id] ?? ''}
                      placeholder={String(r.cap)}
                      onChange={(e) => setCapDraft({ ...capDraft, [r.id]: e.target.value })}
                    />
                    <button className="block-btn text-xs" onClick={() => saveCap(r.id)}>
                      <Save size={12} />
                    </button>
                  </td>
                </tr>
              ))}
              {varianceToBudget.length === 0 && (
                <tr><td colSpan={7} className="text-center text-text-muted py-4">
                  No accounts have a monthly cap set. Edit a row below to begin.
                </td></tr>
              )}
              {varianceToBudget.length === 0 && accounts.slice(0, 10).map((a) => (
                <tr key={a.id}>
                  <td className="font-mono">{a.code}</td>
                  <td>{a.name}</td>
                  <td className="text-right font-mono text-text-muted">—</td>
                  <td className="text-right font-mono text-text-muted">—</td>
                  <td className="text-right font-mono text-text-muted">—</td>
                  <td className="text-right font-mono text-text-muted">—</td>
                  <td className="flex items-center gap-1">
                    <input
                      type="number"
                      className="block-input w-24"
                      value={capDraft[a.id] ?? ''}
                      placeholder="0.00"
                      onChange={(e) => setCapDraft({ ...capDraft, [a.id]: e.target.value })}
                    />
                    <button className="block-btn text-xs" onClick={() => saveCap(a.id)}>
                      <Save size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Common-size P&L */}
      <Card title="Common-Size Income Statement">
        <div className="text-xs text-text-muted mb-2">
          Each line as percent of total revenue ({formatCurrency(commonSize.revTotal)}).
        </div>
        <div className="overflow-auto max-h-96">
          <table className="block-table w-full text-xs">
            <thead>
              <tr><th>Type</th><th>Code</th><th>Account</th><th className="text-right">Amount</th><th className="text-right">% of Rev</th></tr>
            </thead>
            <tbody>
              {commonSize.rows.map((r) => (
                <tr key={r.id}>
                  <td className="uppercase">{r.type}</td>
                  <td className="font-mono">{r.code}</td>
                  <td>{r.name}</td>
                  <td className="text-right font-mono">{formatCurrency(r.amount)}</td>
                  <td className="text-right font-mono">{r.pct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Comparative balance sheet */}
      <Card title="Comparative Balance Sheet — current vs prior period">
        <div className="overflow-auto max-h-96">
          <table className="block-table w-full text-xs">
            <thead>
              <tr><th>Type</th><th>Code</th><th>Account</th>
                <th className="text-right">Current</th>
                <th className="text-right">Prior</th>
                <th className="text-right">Δ</th>
              </tr>
            </thead>
            <tbody>
              {comparativeBS.map((r) => (
                <tr key={r.id}>
                  <td className="uppercase">{r.type}</td>
                  <td className="font-mono">{r.code}</td>
                  <td>{r.name}</td>
                  <td className="text-right font-mono">{formatCurrency(r.current)}</td>
                  <td className="text-right font-mono">{formatCurrency(r.prior)}</td>
                  <td className={`text-right font-mono ${r.delta > 0 ? 'text-accent-income' : r.delta < 0 ? 'text-accent-expense' : ''}`}>
                    {formatCurrency(r.delta)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Turnover ratios */}
      <Card title="Turnover & Days Outstanding">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          {(['ar', 'ap', 'inventory'] as const).map((k) => {
            const r = turnover[k];
            const label = k === 'ar' ? 'A/R Turnover' : k === 'ap' ? 'A/P Turnover' : 'Inventory Turnover';
            return (
              <div key={k} className="block-card" style={{ padding: 14 }}>
                <div className="text-xs uppercase font-bold text-text-muted">{label}</div>
                {r ? (
                  <>
                    <div className="text-2xl font-mono font-bold mt-1">{r.turns.toFixed(2)}×</div>
                    <div className="text-text-muted">~{r.daysOut.toFixed(0)} days outstanding</div>
                    <div className="text-text-muted mt-1">{r.account.code} {r.account.name}</div>
                  </>
                ) : (
                  <div className="text-text-muted mt-2">Account not detected.</div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
      </>}
    </div>
  );
};

export default GLAnalytics;
