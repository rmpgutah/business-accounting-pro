import React, { useState, useEffect } from 'react';
import { Landmark, Plus, Upload, Link2, Check, X, ArrowLeft } from 'lucide-react';
import api from '../../lib/api';

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export default function BankReconModule() {
  const [tab, setTab] = useState<'accounts' | 'import' | 'reconcile'>('accounts');
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', institution: '', account_number_last4: '', current_balance: 0 });
  const [selectedAccount, setSelectedAccount] = useState<any>(null);
  const [bankTransactions, setBankTransactions] = useState<any[]>([]);
  const [csvData, setCsvData] = useState('');

  useEffect(() => { loadAccounts(); }, []);

  const loadAccounts = async () => {
    try {
      const data = await api.query('bank_accounts');
      setBankAccounts(data);
    } catch { /* empty */ }
  };

  const createAccount = async () => {
    if (!form.name) return;
    await api.create('bank_accounts', form);
    setForm({ name: '', institution: '', account_number_last4: '', current_balance: 0 });
    setShowForm(false);
    loadAccounts();
  };

  const loadTransactions = async (accountId: string) => {
    try {
      const data = await api.query('bank_transactions', { bank_account_id: accountId }, { field: 'date', dir: 'desc' });
      setBankTransactions(data);
    } catch { /* empty */ }
  };

  const importCSV = async () => {
    if (!selectedAccount || !csvData.trim()) return;
    const lines = csvData.trim().split('\n');
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',').map(s => s.trim().replace(/"/g, ''));
      if (parts.length >= 3) {
        const amount = parseFloat(parts[2]);
        await api.create('bank_transactions', {
          bank_account_id: selectedAccount.id,
          date: parts[0],
          description: parts[1],
          amount: Math.abs(amount),
          type: amount < 0 ? 'debit' : 'credit',
        });
      }
    }
    setCsvData('');
    loadTransactions(selectedAccount.id);
  };

  const tabs = [
    { id: 'accounts' as const, label: 'Bank Accounts' },
    { id: 'import' as const, label: 'Import' },
    { id: 'reconcile' as const, label: 'Reconcile' },
  ];

  return (
    <div>
      <div className="module-header">
        <h1 className="module-title">Bank Reconciliation</h1>
      </div>

      <div className="flex gap-2 mb-6">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id ? 'bg-accent-blue text-white' : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover border border-border-primary'
            }`}
            style={{ borderRadius: '2px' }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'accounts' && (
        <div>
          <div className="flex justify-end mb-4">
            <button className="block-btn-primary flex items-center gap-2" onClick={() => setShowForm(true)}>
              <Plus size={14} /> Add Bank Account
            </button>
          </div>

          {showForm && (
            <div className="block-card mb-4 space-y-3 max-w-lg">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Account Name</label>
                  <input className="block-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Institution</label>
                  <input className="block-input" value={form.institution} onChange={(e) => setForm({ ...form, institution: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Last 4 Digits</label>
                  <input className="block-input" maxLength={4} value={form.account_number_last4} onChange={(e) => setForm({ ...form, account_number_last4: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Balance</label>
                  <input className="block-input" type="number" step="0.01" value={form.current_balance} onChange={(e) => setForm({ ...form, current_balance: parseFloat(e.target.value) || 0 })} />
                </div>
              </div>
              <div className="flex gap-2">
                <button className="block-btn-primary" onClick={createAccount}>Save</button>
                <button className="block-btn" onClick={() => setShowForm(false)}>Cancel</button>
              </div>
            </div>
          )}

          {bankAccounts.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon"><Landmark size={24} className="text-text-muted" /></div>
              <p className="text-text-secondary text-sm">No bank accounts added</p>
              <p className="text-text-muted text-xs mt-1">Add a bank account to start reconciling transactions</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {bankAccounts.map((acct) => (
                <div key={acct.id} className="block-card cursor-pointer hover:border-border-focus" onClick={() => { setSelectedAccount(acct); setTab('reconcile'); loadTransactions(acct.id); }}>
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-text-primary">{acct.name}</h3>
                      <p className="text-xs text-text-muted">{acct.institution} ****{acct.account_number_last4}</p>
                    </div>
                    <div className="text-right">
                      <div className="stat-value text-lg">{fmt.format(acct.current_balance)}</div>
                      <p className="text-xs text-text-muted">
                        {acct.last_reconciled_date ? `Reconciled: ${acct.last_reconciled_date}` : 'Never reconciled'}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'import' && (
        <div className="max-w-xl space-y-4">
          <div className="block-card space-y-3">
            <h3 className="text-sm font-semibold">Import Bank Transactions</h3>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Select Account</label>
              <select className="block-select" value={selectedAccount?.id || ''} onChange={(e) => setSelectedAccount(bankAccounts.find(a => a.id === e.target.value))}>
                <option value="">Select...</option>
                {bankAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Paste CSV Data (Date, Description, Amount)</label>
              <textarea className="block-input font-mono text-xs" rows={10} placeholder="Date,Description,Amount&#10;2026-03-01,Coffee Shop,-4.50&#10;2026-03-02,Client Payment,1500.00" value={csvData} onChange={(e) => setCsvData(e.target.value)} />
            </div>
            <button className="block-btn-primary flex items-center gap-2" onClick={importCSV} disabled={!selectedAccount || !csvData.trim()}>
              <Upload size={14} /> Import Transactions
            </button>
          </div>
        </div>
      )}

      {tab === 'reconcile' && (
        <div>
          {selectedAccount && (
            <div className="mb-4">
              <p className="text-sm text-text-secondary">
                Reconciling: <strong className="text-text-primary">{selectedAccount.name}</strong> — {bankTransactions.length} transactions
              </p>
            </div>
          )}

          {bankTransactions.length === 0 ? (
            <div className="empty-state">
              <p className="text-text-secondary text-sm">No transactions to reconcile</p>
              <p className="text-text-muted text-xs mt-1">Import bank transactions first</p>
            </div>
          ) : (
            <table className="block-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Amount</th>
                  <th>Type</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {bankTransactions.map((txn) => (
                  <tr key={txn.id}>
                    <td className="text-text-muted text-xs font-mono">{txn.date}</td>
                    <td className="text-text-primary">{txn.description}</td>
                    <td className={`font-mono ${txn.type === 'credit' ? 'text-accent-income' : 'text-accent-expense'}`}>
                      {txn.type === 'debit' ? '-' : '+'}{fmt.format(txn.amount)}
                    </td>
                    <td><span className={txn.type === 'credit' ? 'block-badge-income' : 'block-badge-expense'}>{txn.type}</span></td>
                    <td><span className={txn.status === 'matched' ? 'block-badge-income' : txn.status === 'excluded' ? 'block-badge-expense' : 'block-badge-warning'}>{txn.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
