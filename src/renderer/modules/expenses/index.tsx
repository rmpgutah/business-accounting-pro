import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Receipt, Building2, ShieldCheck, Settings, CheckSquare, Wallet, BarChart3, LayoutDashboard, TrendingUp, TrendingDown, Clock, DollarSign, FileText, ArrowRight, Plus, CreditCard } from 'lucide-react';
import ExpenseList from './ExpenseList';
import ExpenseForm from './ExpenseForm';
import ExpenseDetail from './ExpenseDetail';
import ExpenseAnalytics from './ExpenseAnalytics';
import VendorList from './VendorList';
import VendorForm from './VendorForm';
import VendorDetail from './VendorDetail';
import ExpenseAuditReport from './ExpenseAuditReport';
import ExpenseCategorySettings from './ExpenseCategorySettings';
import ExpenseApprovalQueue from './ExpenseApprovalQueue';
import ReimbursementRun from './ReimbursementRun';
import { useAppStore } from '../../stores/appStore';
import { useCompanyStore } from '../../stores/companyStore';
import api from '../../lib/api';
import { formatCurrency, formatDate, formatStatus } from '../../lib/format';

// ─── Types ──────────────────────────────────────────────
type Tab = 'dashboard' | 'expenses' | 'vendors' | 'approvals' | 'reimbursement' | 'audit' | 'settings' | 'analytics';
type ExpenseView = 'list' | 'form' | 'detail';

// ─── Tab Button ─────────────────────────────────────────
const TabBtn: React.FC<{
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}> = ({ active, icon, label, onClick }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold transition-colors ${
      active
        ? 'bg-bg-tertiary text-text-primary border-b-2 border-accent-blue'
        : 'text-text-muted hover:text-text-secondary transition-colors'
    }`}
    style={{ borderRadius: '6px 6px 0 0' }}
  >
    {icon}
    {label}
  </button>
);

// ─── Main Module ────────────────────────────────────────
const ExpensesModule: React.FC = () => {
  const [tab, setTab] = useState<Tab>('dashboard');
  const activeCompany = useCompanyStore((s) => s.activeCompany);

  // Dashboard state
  const [dashData, setDashData] = useState<any>(null);
  const [dashLoading, setDashLoading] = useState(true);
  const [topCategories, setTopCategories] = useState<any[]>([]);
  const [recentExpenses, setRecentExpenses] = useState<any[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [prevMonthTotal, setPrevMonthTotal] = useState(0);

  // Load dashboard data
  useEffect(() => {
    if (tab !== 'dashboard' || !activeCompany) return;
    let cancelled = false;
    (async () => {
      setDashLoading(true);
      try {
        const now = new Date();
        const mtdStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const ytdStart = `${now.getFullYear()}-01-01`;
        const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const prevStart = `${prevMonthStart.getFullYear()}-${String(prevMonthStart.getMonth() + 1).padStart(2, '0')}-01`;

        const [mainRow, cats, recent, pmethods, prevRow] = await Promise.all([
          api.rawQuery(
            `SELECT
              COALESCE(SUM(CASE WHEN date >= ? THEN amount ELSE 0 END), 0) as mtd,
              COALESCE(SUM(CASE WHEN date >= ? THEN amount ELSE 0 END), 0) as ytd,
              COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) as pending_count,
              COALESCE(SUM(CASE WHEN is_tax_deductible = 1 THEN amount ELSE 0 END), 0) as tax_deductible,
              COUNT(*) as total_count,
              COALESCE(SUM(amount), 0) as total_amount,
              COALESCE(SUM(CASE WHEN is_billable = 1 THEN amount ELSE 0 END), 0) as billable,
              COALESCE(SUM(CASE WHEN is_reimbursable = 1 AND reimbursed = 0 THEN amount ELSE 0 END), 0) as unreimbursed
            FROM expenses WHERE company_id = ?`,
            [mtdStart, ytdStart, activeCompany.id]
          ),
          api.rawQuery(
            `SELECT c.name, COALESCE(SUM(e.amount), 0) as total
            FROM expenses e
            LEFT JOIN categories c ON c.id = e.category_id
            WHERE e.company_id = ? AND e.date >= ?
            GROUP BY e.category_id ORDER BY total DESC LIMIT 5`,
            [activeCompany.id, mtdStart]
          ),
          api.rawQuery(
            `SELECT e.*, c.name as category_name, v.name as vendor_name
            FROM expenses e
            LEFT JOIN categories c ON c.id = e.category_id
            LEFT JOIN vendors v ON e.vendor_id = v.id
            WHERE e.company_id = ?
            ORDER BY e.date DESC LIMIT 8`,
            [activeCompany.id]
          ),
          api.rawQuery(
            `SELECT COALESCE(payment_method, 'Unspecified') as method,
              COALESCE(SUM(amount), 0) as total, COUNT(*) as count
            FROM expenses WHERE company_id = ? AND date >= ?
            GROUP BY payment_method ORDER BY total DESC`,
            [activeCompany.id, mtdStart]
          ),
          api.rawQuery(
            `SELECT COALESCE(SUM(amount), 0) as prev_month
            FROM expenses WHERE company_id = ? AND date >= ? AND date < ?`,
            [activeCompany.id, prevStart, mtdStart]
          ),
        ]);

        if (cancelled) return;
        const row = Array.isArray(mainRow) ? mainRow[0] : mainRow;
        setDashData(row ?? null);
        setTopCategories(Array.isArray(cats) ? cats : []);
        setRecentExpenses(Array.isArray(recent) ? recent : []);
        setPaymentMethods(Array.isArray(pmethods) ? pmethods : []);
        const prevR = Array.isArray(prevRow) ? prevRow[0] : prevRow;
        setPrevMonthTotal(prevR?.prev_month ?? 0);
      } catch (err) {
        console.error('Dashboard load failed:', err);
      } finally {
        if (!cancelled) setDashLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, activeCompany]);

  // Expense view state
  const [expenseView, setExpenseView] = useState<ExpenseView>('list');
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [expenseKey, setExpenseKey] = useState(0);

  // Vendor view state
  const [vendorView, setVendorView] = useState<'list' | 'detail'>('list');
  const [viewingVendorId, setViewingVendorId] = useState<string | null>(null);

  // Vendor modal state
  const [vendorModalOpen, setVendorModalOpen] = useState(false);
  const [editingVendorId, setEditingVendorId] = useState<string | null>(null);
  const [vendorKey, setVendorKey] = useState(0);

  // Cross-module deep links: expense → form, vendor → detail
  const consumeFocusEntity = useAppStore((s) => s.consumeFocusEntity);
  useEffect(() => {
    const expFocus = consumeFocusEntity('expense');
    if (expFocus) {
      setTab('expenses');
      setEditingExpenseId(expFocus.id);
      setExpenseView('form');
      return;
    }
    const venFocus = consumeFocusEntity('vendor');
    if (venFocus) {
      setTab('vendors');
      setViewingVendorId(venFocus.id);
      setVendorView('detail');
    }
  }, [consumeFocusEntity]);

  // ── Expense handlers ──
  const handleNewExpense = useCallback(() => {
    setEditingExpenseId(null);
    setExpenseView('form');
  }, []);

  const handleEditExpense = useCallback((id: string) => {
    setEditingExpenseId(id);
    setExpenseView('form');
  }, []);

  const handleViewExpense = useCallback((id: string) => {
    setEditingExpenseId(id);
    setExpenseView('detail');
  }, []);

  const handleExpenseBack = useCallback(() => {
    setExpenseView('list');
    setEditingExpenseId(null);
  }, []);

  const handleExpenseSaved = useCallback(() => {
    setExpenseView('list');
    setEditingExpenseId(null);
    setExpenseKey((k) => k + 1);
  }, []);

  // ── Vendor detail handler ──
  const handleViewVendor = useCallback((id: string) => {
    setViewingVendorId(id);
    setVendorView('detail');
  }, []);

  const handleVendorDetailBack = useCallback(() => {
    setVendorView('list');
    setViewingVendorId(null);
  }, []);

  // ── Vendor handlers ──
  const handleNewVendor = useCallback(() => {
    setEditingVendorId(null);
    setVendorModalOpen(true);
  }, []);

  const handleEditVendor = useCallback((id: string) => {
    setEditingVendorId(id);
    setVendorModalOpen(true);
  }, []);

  const handleVendorClose = useCallback(() => {
    setVendorModalOpen(false);
    setEditingVendorId(null);
  }, []);

  const handleVendorSaved = useCallback(() => {
    setVendorModalOpen(false);
    setEditingVendorId(null);
    setVendorKey((k) => k + 1);
  }, []);

  // ── Tab switch resets sub-views ──
  const switchTab = useCallback((t: Tab) => {
    setTab(t);
    if (t === 'expenses') {
      setExpenseView('list');
      setEditingExpenseId(null);
    }
    if (t === 'vendors') {
      setVendorView('list');
      setViewingVendorId(null);
    }
  }, []);

  return (
    <div className="p-6 h-full overflow-y-auto">
      {/* Tabs */}
      <div className="flex border-b border-border-primary mb-6 cursor-pointer">
        <TabBtn
          active={tab === 'dashboard'}
          icon={<LayoutDashboard size={16} />}
          label="Dashboard"
          onClick={() => switchTab('dashboard')}
        />
        <TabBtn
          active={tab === 'expenses'}
          icon={<Receipt size={16} />}
          label="Expenses"
          onClick={() => switchTab('expenses')}
        />
        <TabBtn
          active={tab === 'vendors'}
          icon={<Building2 size={16} />}
          label="Vendors"
          onClick={() => switchTab('vendors')}
        />
        <TabBtn
          active={tab === 'approvals'}
          icon={<CheckSquare size={16} />}
          label="Approval Queue"
          onClick={() => switchTab('approvals')}
        />
        <TabBtn
          active={tab === 'reimbursement'}
          icon={<Wallet size={16} />}
          label="Reimbursement"
          onClick={() => switchTab('reimbursement')}
        />
        <TabBtn
          active={tab === 'audit'}
          icon={<ShieldCheck size={16} />}
          label="Audit Log"
          onClick={() => switchTab('audit')}
        />
        <TabBtn
          active={tab === 'analytics'}
          icon={<BarChart3 size={16} />}
          label="Analytics"
          onClick={() => switchTab('analytics')}
        />
        <TabBtn
          active={tab === 'settings'}
          icon={<Settings size={16} />}
          label="Settings"
          onClick={() => switchTab('settings')}
        />
      </div>

      {/* Content */}

      {/* ─── Dashboard ─── */}
      {tab === 'dashboard' && (
        <div className="space-y-5">
          {dashLoading ? (
            <div className="flex items-center justify-center h-64 text-text-muted text-sm">Loading dashboard...</div>
          ) : (
            <>
              {/* KPI Row 1 */}
              <div className="grid grid-cols-4 gap-4">
                <div className="block-card p-4 text-center" style={{ borderRadius: '6px' }}>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">MTD Spending</div>
                  <div className="text-xl font-mono font-bold text-accent-expense mt-1">{formatCurrency(dashData?.mtd ?? 0)}</div>
                </div>
                <div className="block-card p-4 text-center" style={{ borderRadius: '6px' }}>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">YTD Spending</div>
                  <div className="text-xl font-mono font-bold text-text-primary mt-1">{formatCurrency(dashData?.ytd ?? 0)}</div>
                </div>
                <div className="block-card p-4 text-center" style={{ borderRadius: '6px' }}>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Pending Approval</div>
                  <div className="text-xl font-mono font-bold text-accent-blue mt-1">{dashData?.pending_count ?? 0}</div>
                </div>
                <div className="block-card p-4 text-center" style={{ borderRadius: '6px' }}>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Tax Deductible</div>
                  <div className="text-xl font-mono font-bold text-accent-income mt-1">{formatCurrency(dashData?.tax_deductible ?? 0)}</div>
                </div>
              </div>

              {/* Quick Actions */}
              <div className="flex items-center gap-3">
                <button className="block-btn-primary flex items-center gap-2 text-xs" onClick={() => { switchTab('expenses'); handleNewExpense(); }}>
                  <Plus size={14} /> New Expense
                </button>
                <button className="flex items-center gap-2 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue hover:text-accent-blue transition-colors" style={{ borderRadius: '6px' }} onClick={() => switchTab('expenses')}>
                  <CreditCard size={14} /> Import Statement
                </button>
                <button className="flex items-center gap-2 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue hover:text-accent-blue transition-colors" style={{ borderRadius: '6px' }} onClick={() => switchTab('reimbursement')}>
                  <DollarSign size={14} /> Run Reimbursement
                </button>
                <button className="flex items-center gap-2 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue hover:text-accent-blue transition-colors" style={{ borderRadius: '6px' }} onClick={() => switchTab('analytics')}>
                  <BarChart3 size={14} /> View Analytics
                </button>
              </div>

              {/* Middle Row: Top Categories + Payment Methods */}
              <div className="grid grid-cols-2 gap-4">
                {/* Top 5 Spending Categories */}
                <div className="block-card p-4" style={{ borderRadius: '6px' }}>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3">Top Categories This Month</div>
                  {topCategories.length === 0 ? (
                    <div className="text-xs text-text-muted py-4 text-center">No expenses this month</div>
                  ) : (
                    <div className="space-y-2.5">
                      {(() => {
                        const maxCat = Math.max(...topCategories.map(c => c.total || 0), 1);
                        return topCategories.map((cat, i) => (
                          <div key={i} className="flex items-center gap-3">
                            <div className="text-xs text-text-secondary w-28 truncate">{cat.name || '(uncategorized)'}</div>
                            <div className="flex-1 h-4 relative" style={{ background: 'var(--color-bg-tertiary)', borderRadius: '3px' }}>
                              <div
                                style={{
                                  width: `${Math.max(((cat.total || 0) / maxCat) * 100, 2)}%`,
                                  height: '100%',
                                  background: 'var(--color-accent-blue)',
                                  borderRadius: '3px',
                                  transition: 'width 0.3s ease',
                                }}
                              />
                            </div>
                            <div className="text-xs font-mono font-bold text-text-primary w-24 text-right">{formatCurrency(cat.total)}</div>
                          </div>
                        ));
                      })()}
                    </div>
                  )}
                </div>

                {/* Spending by Payment Method */}
                <div className="block-card p-4" style={{ borderRadius: '6px' }}>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3">Spending by Payment Method</div>
                  {paymentMethods.length === 0 ? (
                    <div className="text-xs text-text-muted py-4 text-center">No expenses this month</div>
                  ) : (
                    <div className="space-y-2.5">
                      {(() => {
                        const maxPm = Math.max(...paymentMethods.map(p => p.total || 0), 1);
                        return paymentMethods.map((pm, i) => (
                          <div key={i} className="flex items-center gap-3">
                            <div className="text-xs text-text-secondary w-28 truncate capitalize">{pm.method}</div>
                            <div className="flex-1 h-4 relative" style={{ background: 'var(--color-bg-tertiary)', borderRadius: '3px' }}>
                              <div
                                style={{
                                  width: `${Math.max(((pm.total || 0) / maxPm) * 100, 2)}%`,
                                  height: '100%',
                                  background: 'var(--color-accent-expense)',
                                  borderRadius: '3px',
                                  transition: 'width 0.3s ease',
                                }}
                              />
                            </div>
                            <div className="text-xs text-text-muted w-8 text-right">{pm.count}</div>
                            <div className="text-xs font-mono font-bold text-text-primary w-24 text-right">{formatCurrency(pm.total)}</div>
                          </div>
                        ));
                      })()}
                    </div>
                  )}
                </div>
              </div>

              {/* Recent Expenses */}
              <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
                <div className="px-4 py-3 border-b border-border-primary flex items-center justify-between">
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Recent Expenses</div>
                  <button className="text-[10px] font-semibold text-accent-blue uppercase tracking-wider flex items-center gap-1 hover:underline" onClick={() => switchTab('expenses')}>
                    View All <ArrowRight size={10} />
                  </button>
                </div>
                {recentExpenses.length === 0 ? (
                  <div className="text-xs text-text-muted py-6 text-center">No expenses yet</div>
                ) : (
                  <table className="block-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Description</th>
                        <th>Vendor</th>
                        <th>Category</th>
                        <th className="text-right">Amount</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentExpenses.map((e: any) => (
                        <tr key={e.id} className="cursor-pointer" onClick={() => { switchTab('expenses'); handleViewExpense(e.id); }}>
                          <td className="font-mono text-text-secondary text-xs">{formatDate(e.date)}</td>
                          <td className="text-text-primary font-medium text-xs truncate max-w-[180px]">{e.description || '(no description)'}</td>
                          <td className="text-text-secondary text-xs truncate max-w-[120px]">{e.vendor_name || '-'}</td>
                          <td className="text-text-secondary text-xs truncate max-w-[120px]">{e.category_name || '-'}</td>
                          <td className="text-right font-mono text-accent-expense text-xs">{formatCurrency(e.amount)}</td>
                          <td><span className={formatStatus(e.status).className}>{formatStatus(e.status).label}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* KPI Row 2 */}
              <div className="grid grid-cols-4 gap-4">
                <div className="block-card p-4 text-center" style={{ borderRadius: '6px' }}>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Billable Expenses</div>
                  <div className="text-xl font-mono font-bold text-accent-blue mt-1">{formatCurrency(dashData?.billable ?? 0)}</div>
                  <div className="text-[10px] text-text-muted mt-0.5">Year to date</div>
                </div>
                <div className="block-card p-4 text-center" style={{ borderRadius: '6px' }}>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Unreimbursed</div>
                  <div className="text-xl font-mono font-bold text-accent-expense mt-1">{formatCurrency(dashData?.unreimbursed ?? 0)}</div>
                  <div className="text-[10px] text-text-muted mt-0.5">Outstanding</div>
                </div>
                <div className="block-card p-4 text-center" style={{ borderRadius: '6px' }}>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Avg Expense</div>
                  <div className="text-xl font-mono font-bold text-text-primary mt-1">
                    {formatCurrency((dashData?.total_count ?? 0) > 0 ? (dashData?.ytd ?? 0) / (dashData?.total_count ?? 1) : 0)}
                  </div>
                  <div className="text-[10px] text-text-muted mt-0.5">Per transaction</div>
                </div>
                <div className="block-card p-4 text-center" style={{ borderRadius: '6px' }}>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">This Month vs Last</div>
                  <div className="text-xl font-mono font-bold mt-1 flex items-center justify-center gap-1.5">
                    {(() => {
                      const mtd = dashData?.mtd ?? 0;
                      const prev = prevMonthTotal;
                      if (prev === 0 && mtd === 0) return <span className="text-text-muted">--</span>;
                      if (prev === 0) return <span className="text-accent-expense flex items-center gap-1"><TrendingUp size={16} /> New</span>;
                      const pctChange = ((mtd - prev) / prev) * 100;
                      const isUp = pctChange >= 0;
                      return (
                        <span className={isUp ? 'text-accent-expense flex items-center gap-1' : 'text-accent-income flex items-center gap-1'}>
                          {isUp ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                          {Math.abs(pctChange).toFixed(0)}%
                        </span>
                      );
                    })()}
                  </div>
                  <div className="text-[10px] text-text-muted mt-0.5">
                    {formatCurrency(prevMonthTotal)} last month
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'expenses' && expenseView === 'list' && (
        <ExpenseList
          key={expenseKey}
          onNew={handleNewExpense}
          onEdit={handleEditExpense}
          onView={handleViewExpense}
        />
      )}

      {tab === 'expenses' && expenseView === 'form' && (
        <ExpenseForm
          expenseId={editingExpenseId}
          onBack={handleExpenseBack}
          onSaved={handleExpenseSaved}
        />
      )}

      {tab === 'expenses' && expenseView === 'detail' && editingExpenseId && (
        <ExpenseDetail
          expenseId={editingExpenseId}
          onBack={handleExpenseBack}
          onEdit={handleEditExpense}
        />
      )}

      {tab === 'analytics' && <ExpenseAnalytics />}

      {tab === 'vendors' && vendorView === 'list' && (
        <VendorList
          key={vendorKey}
          onNew={handleNewVendor}
          onEdit={handleEditVendor}
          onView={handleViewVendor}
        />
      )}

      {tab === 'vendors' && vendorView === 'detail' && viewingVendorId && (
        <VendorDetail
          vendorId={viewingVendorId}
          onBack={handleVendorDetailBack}
          onEdit={handleEditVendor}
        />
      )}

      {tab === 'approvals' && <ExpenseApprovalQueue />}

      {tab === 'reimbursement' && <ReimbursementRun />}

      {tab === 'audit' && (
        <ExpenseAuditReport onBack={() => setTab('expenses')} />
      )}

      {tab === 'settings' && (
        <ExpenseCategorySettings onBack={() => setTab('expenses')} />
      )}

      {/* Vendor Modal */}
      {vendorModalOpen && (
        <VendorForm
          vendorId={editingVendorId}
          onClose={handleVendorClose}
          onSaved={handleVendorSaved}
        />
      )}
    </div>
  );
};

export default ExpensesModule;
