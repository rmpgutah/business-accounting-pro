import React, { useState, useCallback } from 'react';
import { BookOpen, FileSpreadsheet } from 'lucide-react';
import AccountsList from './AccountsList';
import AccountForm from './AccountForm';
import JournalEntries from './JournalEntries';
import JournalEntryForm from './JournalEntryForm';

// ─── Types ──────────────────────────────────────────────
type Tab = 'chart-of-accounts' | 'journal-entries';

// ─── Component ──────────────────────────────────────────
const AccountsModule: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('chart-of-accounts');

  // Account form state
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [editingAccount, setEditingAccount] = useState<any | null>(null);

  // Journal entry form state
  const [showEntryForm, setShowEntryForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<any | null>(null);

  // Force re-render of lists after save
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);

  // ─── Account Handlers ─────────────────────────────
  const handleNewAccount = useCallback(() => {
    setEditingAccount(null);
    setShowAccountForm(true);
  }, []);

  const handleEditAccount = useCallback((account: any) => {
    setEditingAccount(account);
    setShowAccountForm(true);
  }, []);

  const handleAccountSaved = useCallback(() => {
    setShowAccountForm(false);
    setEditingAccount(null);
    refresh();
  }, []);

  const handleAccountFormClose = useCallback(() => {
    setShowAccountForm(false);
    setEditingAccount(null);
  }, []);

  // ─── Journal Entry Handlers ───────────────────────
  const handleNewEntry = useCallback(() => {
    setEditingEntry(null);
    setShowEntryForm(true);
  }, []);

  const handleEditEntry = useCallback((entry: any) => {
    setEditingEntry(entry);
    setShowEntryForm(true);
  }, []);

  const handleEntrySaved = useCallback(() => {
    setShowEntryForm(false);
    setEditingEntry(null);
    refresh();
  }, []);

  const handleEntryFormClose = useCallback(() => {
    setShowEntryForm(false);
    setEditingEntry(null);
  }, []);

  // ─── Tab Config ───────────────────────────────────
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    {
      id: 'chart-of-accounts',
      label: 'Chart of Accounts',
      icon: <BookOpen size={14} />,
    },
    {
      id: 'journal-entries',
      label: 'Journal Entries',
      icon: <FileSpreadsheet size={14} />,
    },
  ];

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-text-primary">
          Accounts & General Ledger
        </h1>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b border-border-primary">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? 'border-b-accent-blue text-text-primary'
                : 'border-b-transparent text-text-muted hover:text-text-secondary'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'chart-of-accounts' && (
        <AccountsList
          key={`accounts-${refreshKey}`}
          onNewAccount={handleNewAccount}
          onEditAccount={handleEditAccount}
        />
      )}

      {activeTab === 'journal-entries' && (
        <JournalEntries
          key={`entries-${refreshKey}`}
          onNewEntry={handleNewEntry}
          onEditEntry={handleEditEntry}
        />
      )}

      {/* Account Form Modal */}
      {showAccountForm && (
        <AccountForm
          account={editingAccount}
          onClose={handleAccountFormClose}
          onSaved={handleAccountSaved}
        />
      )}

      {/* Journal Entry Form Modal */}
      {showEntryForm && (
        <JournalEntryForm
          entry={editingEntry}
          onClose={handleEntryFormClose}
          onSaved={handleEntrySaved}
        />
      )}
    </div>
  );
};

export default AccountsModule;
