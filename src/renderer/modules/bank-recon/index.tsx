import React, { useState, useEffect, useMemo } from 'react';
import {
  Landmark,
  Building,
  Upload,
  GitMerge,
  Shield,
  LayoutDashboard,
  Wallet,
  Activity,
  CheckCircle,
  AlertTriangle,
  Clock,
  Zap,
} from 'lucide-react';
import BankAccountList, { type BankAccount } from './BankAccountList';
import BankAccountForm from './BankAccountForm';
import ImportTransactions from './ImportTransactions';
import ReconcileView from './ReconcileView';
import BankRules from './BankRules';
import { useAppStore } from '../../stores/appStore';
import { useCompanyStore } from '../../stores/companyStore';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';

// ─── Tab Types ──────────────────────────────────────────
type TabId = 'dashboard' | 'accounts' | 'import' | 'reconcile' | 'rules';

interface Tab {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

const TABS: Tab[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={14} /> },
  { id: 'accounts', label: 'Accounts', icon: <Building size={14} /> },
  { id: 'import', label: 'Import', icon: <Upload size={14} /> },
  { id: 'reconcile', label: 'Reconcile', icon: <GitMerge size={14} /> },
  { id: 'rules', label: 'Bank Rules', icon: <Shield size={14} /> },
];

// ─── Dashboard ──────────────────────────────────────────

interface AccountSummary {
  id: string;
  name: string;
  bookBalance: number;
  bankBalance: number;
  difference: number;
  lastReconciled: string | null;
  unreconciledCount: number;
}

const BankReconDashboard: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [unreconciledCount, setUnreconciledCount] = useState(0);
  const [pendingMatches, setPendingMatches] = useState(0);
  const [unmatchedItems, setUnmatchedItems] = useState(0);
  const [recentImports, setRecentImports] = useState<any[]>([]);
  const [rulesActive, setRulesActive] = useState(0);
  const [rulesAppliedThisMonth, setRulesAppliedThisMonth] = useState(0);
  const [lastReconciledDate, setLastReconciledDate] = useState<string | null>(
    null
  );

  useEffect(() => {
    if (!activeCompany) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [bankAccts, allTxns, rules] = await Promise.all([
          api.query('bank_accounts', { company_id: activeCompany.id }),
          api.query('bank_transactions', undefined, undefined, 5000),
          api.query('bank_rules', { company_id: activeCompany.id }),
        ]);
        if (cancelled) return;
        const acctList: any[] = Array.isArray(bankAccts) ? bankAccts : [];
        const txnList: any[] = Array.isArray(allTxns) ? allTxns : [];
        const rulesList: any[] = Array.isArray(rules) ? rules : [];

        // Compute per-account summaries (only for company's own accounts)
        const acctIds = new Set(acctList.map((a) => a.id));
        const myTxns = txnList.filter((t) =>
          acctIds.has(t.bank_account_id)
        );

        const summaries: AccountSummary[] = [];
        let totalUnreconciled = 0;
        let totalUnmatched = 0;
        let latestReconciled: string | null = null;

        for (const acct of acctList) {
          const acctTxns = myTxns.filter(
            (t) => t.bank_account_id === acct.id
          );
          const bankBalance = acctTxns.reduce(
            (s, t) => s + (Number(t.amount) || 0),
            0
          );
          const bookBalance = Number(acct.current_balance) || 0;
          const unreconciled = acctTxns.filter(
            (t) => t.status !== 'matched'
          ).length;
          totalUnreconciled += unreconciled;
          totalUnmatched += acctTxns.filter(
            (t) => t.status === 'pending'
          ).length;
          if (
            acct.last_reconciled_date &&
            (!latestReconciled ||
              acct.last_reconciled_date > latestReconciled)
          ) {
            latestReconciled = acct.last_reconciled_date;
          }
          summaries.push({
            id: acct.id,
            name: acct.name,
            bookBalance,
            bankBalance,
            difference: bankBalance - bookBalance,
            lastReconciled: acct.last_reconciled_date || null,
            unreconciledCount: unreconciled,
          });
        }
        setAccounts(summaries);
        setUnreconciledCount(totalUnreconciled);
        setUnmatchedItems(totalUnmatched);
        setLastReconciledDate(latestReconciled);

        // Recent imports — group by imported_at date
        const recentByDate = new Map<string, number>();
        for (const t of myTxns) {
          const d = (t.imported_at || '').slice(0, 10);
          if (!d) continue;
          recentByDate.set(d, (recentByDate.get(d) || 0) + 1);
        }
        const sortedImports = [...recentByDate.entries()]
          .sort((a, b) => (a[0] < b[0] ? 1 : -1))
          .slice(0, 5)
          .map(([date, count]) => ({ date, count }));
        setRecentImports(sortedImports);

        // Pending matches: try to count auto-suggestible pairs
        try {
          const matches: any[] = await api.rawQuery(
            `SELECT COUNT(*) AS c FROM bank_reconciliation_matches`,
            []
          );
          setPendingMatches(Number(matches?.[0]?.c) || 0);
        } catch {
          setPendingMatches(0);
        }

        // Rules stats
        const active = rulesList.filter((r) => r.is_active).length;
        setRulesActive(active);
        const monthStart = new Date();
        monthStart.setDate(1);
        const monthIso = monthStart.toISOString().slice(0, 10);
        const appliedThisMonth = rulesList.reduce(
          (s, r) =>
            s +
            ((r.updated_at || '') >= monthIso ? Number(r.times_applied) || 0 : 0),
          0
        );
        setRulesAppliedThisMonth(appliedThisMonth);
      } catch (err) {
        console.error('Bank-recon dashboard load failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [activeCompany]);

  const totals = useMemo(() => {
    const totalCash = accounts.reduce((s, a) => s + a.bookBalance, 0);
    return { totalCash };
  }, [accounts]);

  const healthScore = useMemo(() => {
    // Score: 100 if reconciled today and no unreconciled.
    // Lose points for stale recon (max 50) and unreconciled count (max 50).
    let score = 100;
    if (lastReconciledDate) {
      const days =
        (Date.now() - new Date(lastReconciledDate).getTime()) / 86400000;
      score -= Math.min(50, Math.floor(days * 1.5));
    } else {
      score -= 50;
    }
    score -= Math.min(50, Math.floor(unreconciledCount * 0.5));
    return Math.max(0, Math.min(100, Math.round(score)));
  }, [lastReconciledDate, unreconciledCount]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm font-mono">
        Loading dashboard...
      </div>
    );
  }

  const healthColor =
    healthScore >= 80
      ? '#22c55e'
      : healthScore >= 50
        ? '#eab308'
        : '#ef4444';

  return (
    <div className="space-y-5">
      {/* 6 KPI cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="stat-card" style={{ borderRadius: '6px' }}>
          <div className="flex items-start justify-between">
            <div>
              <div className="stat-label text-text-muted">Bank Accounts</div>
              <div className="stat-value font-mono text-text-primary">
                {accounts.length}
              </div>
            </div>
            <Building size={20} className="text-accent-blue opacity-60 mt-1" />
          </div>
        </div>
        <div className="stat-card" style={{ borderRadius: '6px' }}>
          <div className="flex items-start justify-between">
            <div>
              <div className="stat-label text-text-muted">Total Cash</div>
              <div className="stat-value font-mono text-accent-income">
                {formatCurrency(totals.totalCash)}
              </div>
            </div>
            <Wallet size={20} className="text-accent-income opacity-60 mt-1" />
          </div>
        </div>
        <div className="stat-card" style={{ borderRadius: '6px' }}>
          <div className="flex items-start justify-between">
            <div>
              <div className="stat-label text-text-muted">Unreconciled</div>
              <div className="stat-value font-mono text-accent-expense">
                {unreconciledCount}
              </div>
            </div>
            <AlertTriangle
              size={20}
              className="text-accent-expense opacity-60 mt-1"
            />
          </div>
        </div>
        <div className="stat-card" style={{ borderRadius: '6px' }}>
          <div className="flex items-start justify-between">
            <div>
              <div className="stat-label text-text-muted">Last Reconciled</div>
              <div className="stat-value font-mono text-text-primary text-base">
                {lastReconciledDate ? formatDate(lastReconciledDate) : '—'}
              </div>
            </div>
            <Clock size={20} className="text-accent-blue opacity-60 mt-1" />
          </div>
        </div>
        <div className="stat-card" style={{ borderRadius: '6px' }}>
          <div className="flex items-start justify-between">
            <div>
              <div className="stat-label text-text-muted">Pending Matches</div>
              <div className="stat-value font-mono text-accent-blue">
                {pendingMatches}
              </div>
            </div>
            <GitMerge size={20} className="text-accent-blue opacity-60 mt-1" />
          </div>
        </div>
        <div className="stat-card" style={{ borderRadius: '6px' }}>
          <div className="flex items-start justify-between">
            <div>
              <div className="stat-label text-text-muted">Unmatched Items</div>
              <div className="stat-value font-mono text-accent-expense">
                {unmatchedItems}
              </div>
            </div>
            <Activity
              size={20}
              className="text-accent-expense opacity-60 mt-1"
            />
          </div>
        </div>
      </div>

      {/* Reconciliation Health Score */}
      <div className="block-card p-4" style={{ borderRadius: '6px' }}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
              Reconciliation Health Score
            </div>
            <div className="text-xs text-text-muted mt-1">
              Calculated from time since last reconciliation and unreconciled
              count.
            </div>
          </div>
          <div className="flex items-baseline gap-1">
            <span
              className="text-3xl font-bold font-mono"
              style={{ color: healthColor }}
            >
              {healthScore}
            </span>
            <span className="text-xs text-text-muted">/ 100</span>
          </div>
        </div>
        <div
          style={{
            height: 10,
            background: 'var(--color-bg-tertiary)',
            borderRadius: '6px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${healthScore}%`,
              height: '100%',
              background: healthColor,
              transition: 'width 0.3s',
            }}
          />
        </div>
      </div>

      {/* Two-column: balance summary + recent imports */}
      <div className="grid grid-cols-2 gap-4">
        {/* Account Balance Summary */}
        <div className="block-card p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-border-primary">
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
              Account Balance Summary
            </span>
          </div>
          {accounts.length === 0 ? (
            <div className="p-4 text-center text-xs text-text-muted">
              No bank accounts yet.
            </div>
          ) : (
            <table className="block-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th className="text-right">Book</th>
                  <th className="text-right">Bank</th>
                  <th className="text-right">Diff</th>
                  <th>Last Recon</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td className="text-text-primary text-sm font-medium">
                      {a.name}
                    </td>
                    <td className="text-right font-mono text-xs text-text-secondary">
                      {formatCurrency(a.bookBalance)}
                    </td>
                    <td className="text-right font-mono text-xs text-text-secondary">
                      {formatCurrency(a.bankBalance)}
                    </td>
                    <td
                      className={`text-right font-mono text-xs ${
                        Math.abs(a.difference) < 0.01
                          ? 'text-accent-income'
                          : 'text-accent-expense'
                      }`}
                    >
                      {formatCurrency(a.difference)}
                    </td>
                    <td className="text-xs text-text-muted font-mono">
                      {a.lastReconciled
                        ? formatDate(a.lastReconciled)
                        : 'Never'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Recent Imports + Auto-Match Rules */}
        <div className="space-y-4">
          <div className="block-card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-border-primary">
              <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                Recent Imports
              </span>
            </div>
            {recentImports.length === 0 ? (
              <div className="p-4 text-center text-xs text-text-muted">
                No transaction imports yet.
              </div>
            ) : (
              <table className="block-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="text-right">Transactions</th>
                  </tr>
                </thead>
                <tbody>
                  {recentImports.map((i) => (
                    <tr key={i.date}>
                      <td className="font-mono text-xs text-text-secondary">
                        {formatDate(i.date)}
                      </td>
                      <td className="text-right font-mono text-xs text-text-primary">
                        {i.count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="block-card p-4" style={{ borderRadius: '6px' }}>
            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3">
              Auto-Match Rules
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] text-text-muted">Active Rules</div>
                <div className="font-mono text-lg text-accent-blue flex items-center gap-1.5">
                  <Zap size={16} className="opacity-70" />
                  {rulesActive}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-text-muted">
                  Applied This Month
                </div>
                <div className="font-mono text-lg text-accent-income flex items-center gap-1.5">
                  <CheckCircle size={16} className="opacity-70" />
                  {rulesAppliedThisMonth}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Component ──────────────────────────────────────────
const BankReconModule: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [showForm, setShowForm] = useState(false);
  const [editingAccount, setEditingAccount] = useState<BankAccount | null>(
    null
  );

  // Cross-module deep link: bank_account → open edit form
  const consumeFocusEntity = useAppStore((s) => s.consumeFocusEntity);
  useEffect(() => {
    const focus = consumeFocusEntity('bank_account');
    if (focus) {
      setActiveTab('accounts');
      api.get('bank_accounts', focus.id).then((acc) => {
        if (acc) {
          setEditingAccount(acc);
          setShowForm(true);
        }
      }).catch(() => {});
    }
  }, [consumeFocusEntity]);

  const handleAdd = () => {
    setEditingAccount(null);
    setShowForm(true);
  };

  const handleEdit = (account: BankAccount) => {
    setEditingAccount(account);
    setShowForm(true);
  };

  const handleSave = () => {
    setShowForm(false);
    setEditingAccount(null);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingAccount(null);
  };

  const renderContent = () => {
    if (activeTab === 'dashboard') {
      return <BankReconDashboard />;
    }

    if (activeTab === 'accounts') {
      if (showForm) {
        return (
          <BankAccountForm
            account={editingAccount}
            onSave={handleSave}
            onCancel={handleCancel}
          />
        );
      }
      return <BankAccountList onAdd={handleAdd} onEdit={handleEdit} />;
    }

    if (activeTab === 'import') {
      return <ImportTransactions />;
    }

    if (activeTab === 'reconcile') {
      return <ReconcileView />;
    }

    if (activeTab === 'rules') {
      return <BankRules />;
    }

    return null;
  };

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      {/* Module header */}
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 flex items-center justify-center bg-bg-tertiary border border-border-primary"
          style={{ borderRadius: '6px' }}
        >
          <Landmark size={18} className="text-accent-blue" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-text-primary">
            Bank Reconciliation
          </h1>
          <p className="text-xs text-text-muted mt-0.5">
            Link bank accounts, import transactions, and reconcile with your books.
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div
        className="flex border-b border-border-primary"
        style={{ borderRadius: '0px' }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              if (tab.id !== 'accounts') {
                setShowForm(false);
                setEditingAccount(null);
              }
            }}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold transition-colors border-b-2 -mb-[1px] ${
              activeTab === tab.id
                ? 'text-accent-blue border-accent-blue'
                : 'text-text-muted hover:text-text-primary border-transparent transition-colors'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {renderContent()}
    </div>
  );
};

export default BankReconModule;
