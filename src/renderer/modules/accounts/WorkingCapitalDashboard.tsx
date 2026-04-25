// WorkingCapitalDashboard.tsx
// Features 12, 13, 14, 15: Cash conversion cycle, current/quick ratios,
// working capital trend, burn rate + runway.

import React, { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
} from 'recharts';
import { formatCurrency } from '../../lib/format';

interface Account {
  id: string; code: string; name: string; type: string; subtype: string;
  is_active: number; balance: number;
}
interface LineRow {
  id: string; journal_entry_id: string; account_id: string;
  debit: number; credit: number; date: string;
}

const Card: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="block-card" style={{ padding: 16 }}>
    <h3 className="text-sm font-bold uppercase text-text-primary mb-2">{title}</h3>
    {children}
  </div>
);

const Tile: React.FC<{ label: string; value: string; sub?: string; tone?: string }> = ({ label, value, sub, tone }) => (
  <div className="block-card" style={{ padding: 16 }}>
    <div className="text-xs uppercase font-bold text-text-muted">{label}</div>
    <div className={`text-2xl font-mono font-bold mt-1 ${tone || ''}`}>{value}</div>
    {sub && <div className="text-xs text-text-muted mt-1">{sub}</div>}
  </div>
);

const isCurrentAsset = (a: Account) => a.type === 'asset' && /current|cash|checking|savings|receivable|inventory|prepaid/i.test(a.subtype + ' ' + a.name);
const isCurrentLiab = (a: Account) => a.type === 'liability' && /current|payable|short|accrued|unearned/i.test(a.subtype + ' ' + a.name);
const isInventory = (a: Account) => /inventory/i.test(a.name + ' ' + a.subtype);
const isCash = (a: Account) => a.type === 'asset' && /cash|checking|savings/i.test(a.name + ' ' + a.subtype);
const isAR = (a: Account) => /receivable/i.test(a.name + ' ' + a.subtype);
const isAP = (a: Account) => /payable/i.test(a.name + ' ' + a.subtype);

const WorkingCapitalDashboard: React.FC<{ accounts: Account[]; lines: LineRow[] }> = ({ accounts, lines }) => {
  const balances = useMemo(() => {
    const m = new Map<string, number>();
    accounts.forEach((a) => m.set(a.id, a.balance));
    return m;
  }, [accounts]);

  const sumBy = (filter: (a: Account) => boolean) =>
    accounts.filter(filter).reduce((s, a) => s + (balances.get(a.id) || 0), 0);

  const currentAssets = sumBy(isCurrentAsset);
  const currentLiab = sumBy(isCurrentLiab);
  const inventory = sumBy(isInventory);
  const ar = sumBy(isAR);
  const ap = sumBy(isAP);

  const currentRatio = currentLiab ? currentAssets / currentLiab : 0;
  const quickRatio = currentLiab ? (currentAssets - inventory) / currentLiab : 0;

  // CCC: Cash Conversion Cycle = DSO + DIO − DPO  (annualized over last 365 days)
  const ccc = useMemo(() => {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 365);
    const cs = cutoff.toISOString().slice(0, 10);
    const inWindow = lines.filter((l) => l.date >= cs);
    const accById = new Map(accounts.map((a) => [a.id, a]));
    let revenue = 0, cogs = 0, purchases = 0;
    inWindow.forEach((l) => {
      const a = accById.get(l.account_id); if (!a) return;
      if (a.type === 'revenue') revenue += l.credit - l.debit;
      const nm = (a.name + ' ' + a.subtype).toLowerCase();
      if (a.type === 'expense' && (nm.includes('cogs') || nm.includes('cost of goods'))) cogs += l.debit - l.credit;
      if (a.type === 'expense') purchases += l.debit - l.credit;
    });
    const dso = revenue > 0 ? (ar / revenue) * 365 : 0;
    const dio = cogs > 0 ? (inventory / cogs) * 365 : 0;
    const dpo = purchases > 0 ? (ap / purchases) * 365 : 0;
    return { dso, dio, dpo, ccc: dso + dio - dpo };
  }, [lines, accounts, ar, ap, inventory]);

  // Working capital trend — last 12 months. WC = Current Assets - Current Liabilities at month-end.
  const wcTrend = useMemo(() => {
    const accById = new Map(accounts.map((a) => [a.id, a]));
    const months: { ym: string; label: string; end: string }[] = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i + 1, 0); // month-end
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months.push({ ym, label: ym, end: d.toISOString().slice(0, 10) });
    }
    return months.map((m) => {
      const cumByAcc = new Map<string, number>();
      lines.forEach((l) => {
        if (l.date > m.end) return;
        const a = accById.get(l.account_id); if (!a) return;
        const isDr = a.type === 'asset' || a.type === 'expense';
        const v = isDr ? l.debit - l.credit : l.credit - l.debit;
        cumByAcc.set(l.account_id, (cumByAcc.get(l.account_id) || 0) + v);
      });
      let ca = 0, cl = 0;
      accounts.forEach((a) => {
        const v = cumByAcc.get(a.id) || 0;
        if (isCurrentAsset(a)) ca += v;
        if (isCurrentLiab(a)) cl += v;
      });
      return { label: m.label, wc: ca - cl };
    });
  }, [accounts, lines]);

  // Burn rate — average monthly net spend over last 3/6/12 months
  const burn = useMemo(() => {
    const accById = new Map(accounts.map((a) => [a.id, a]));
    const cash = accounts.filter(isCash).reduce((s, a) => s + a.balance, 0);
    const compute = (months: number) => {
      const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - months);
      const cs = cutoff.toISOString().slice(0, 10);
      let net = 0;
      lines.forEach((l) => {
        if (l.date < cs) return;
        const a = accById.get(l.account_id); if (!a) return;
        if (a.type === 'revenue') net += l.credit - l.debit;
        if (a.type === 'expense') net -= l.debit - l.credit;
      });
      const avg = net / months; // negative = burn
      const burnPerMonth = avg < 0 ? -avg : 0;
      const runway = burnPerMonth > 0 ? cash / burnPerMonth : Infinity;
      return { avg, burnPerMonth, runway };
    };
    return { cash, m3: compute(3), m6: compute(6), m12: compute(12) };
  }, [accounts, lines]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Tile label="Current Ratio" value={currentRatio.toFixed(2)} sub="CA / CL"
          tone={currentRatio < 1 ? 'text-accent-expense' : 'text-accent-income'} />
        <Tile label="Quick Ratio" value={quickRatio.toFixed(2)} sub="(CA − Inv) / CL"
          tone={quickRatio < 1 ? 'text-accent-expense' : 'text-accent-income'} />
        <Tile label="Cash Conversion Cycle" value={`${ccc.ccc.toFixed(0)} d`} sub={`DSO ${ccc.dso.toFixed(0)} + DIO ${ccc.dio.toFixed(0)} − DPO ${ccc.dpo.toFixed(0)}`} />
        <Tile label="Cash on Hand" value={formatCurrency(burn.cash)} />
      </div>

      <Card title="Working Capital Trend — last 12 months">
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={wcTrend}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="label" stroke="#9ca3af" fontSize={11} />
            <YAxis stroke="#9ca3af" fontSize={11} />
            <Tooltip formatter={(v: any) => formatCurrency(v)} contentStyle={{ background: '#1f2937', border: '1px solid #374151' }} />
            <Line type="monotone" dataKey="wc" stroke="#3b82f6" strokeWidth={2} dot={false} name="Working Capital" />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <Card title="Burn Rate &amp; Runway">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          {([['Last 3 mo', burn.m3], ['Last 6 mo', burn.m6], ['Last 12 mo', burn.m12]] as const).map(([label, b]) => (
            <div key={label} className="block-card" style={{ padding: 14 }}>
              <div className="text-xs uppercase font-bold text-text-muted">{label}</div>
              <div className="text-lg font-mono mt-1">
                Avg net: <span className={b.avg < 0 ? 'text-accent-expense' : 'text-accent-income'}>{formatCurrency(b.avg)}</span>/mo
              </div>
              <div className="text-xs text-text-muted mt-1">
                Burn: {formatCurrency(b.burnPerMonth)}/mo
              </div>
              <div className="text-sm font-bold mt-1">
                Runway: {b.runway === Infinity ? '∞ (profitable)' : `${b.runway.toFixed(1)} months`}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};

export default WorkingCapitalDashboard;
