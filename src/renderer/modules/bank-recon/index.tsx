import React, { useState } from 'react';
import { Landmark, Building, Upload, GitMerge, Shield } from 'lucide-react';
import BankAccountList, { type BankAccount } from './BankAccountList';
import BankAccountForm from './BankAccountForm';
import ImportTransactions from './ImportTransactions';
import ReconcileView from './ReconcileView';
import BankRules from './BankRules';

// ─── Tab Types ──────────────────────────────────────────
type TabId = 'accounts' | 'import' | 'reconcile' | 'rules';

interface Tab {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

const TABS: Tab[] = [
  { id: 'accounts', label: 'Accounts', icon: <Building size={14} /> },
  { id: 'import', label: 'Import', icon: <Upload size={14} /> },
  { id: 'reconcile', label: 'Reconcile', icon: <GitMerge size={14} /> },
  { id: 'rules', label: 'Bank Rules', icon: <Shield size={14} /> },
];

// ─── Component ──────────────────────────────────────────
const BankReconModule: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('accounts');
  const [showForm, setShowForm] = useState(false);
  const [editingAccount, setEditingAccount] = useState<BankAccount | null>(
    null
  );

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
