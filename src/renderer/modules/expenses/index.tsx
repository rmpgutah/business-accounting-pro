import React, { useState, useCallback, useEffect } from 'react';
import { Receipt, Building2, ShieldCheck, Settings, CheckSquare, Wallet, BarChart3 } from 'lucide-react';
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

// ─── Types ──────────────────────────────────────────────
type Tab = 'expenses' | 'vendors' | 'approvals' | 'reimbursement' | 'audit' | 'settings' | 'analytics';
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
  const [tab, setTab] = useState<Tab>('expenses');

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
