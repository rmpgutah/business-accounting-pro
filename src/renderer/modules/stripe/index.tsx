import React, { useEffect, useState, useCallback } from 'react';
import {
  CreditCard,
  RefreshCw,
  CheckCircle,
  XCircle,
  Key,
  ArrowDownUp,
  DollarSign,
  AlertCircle,
} from 'lucide-react';
import api from '../../lib/api';

// ─── Currency Formatter ─────────────────────────────────
const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// ─── Types ──────────────────────────────────────────────
interface StripeTransaction {
  id: string;
  stripe_id: string;
  type: string;
  amount: number;
  fee: number;
  net: number;
  description: string;
  status: string;
  synced_at: string;
}

// ─── Type Badge Colors ──────────────────────────────────
function typeBadgeClass(type: string): string {
  switch (type?.toLowerCase()) {
    case 'payment':
      return 'block-badge block-badge-income';
    case 'refund':
      return 'block-badge block-badge-expense';
    case 'payout':
      return 'block-badge block-badge-blue';
    case 'fee':
      return 'block-badge block-badge-warning';
    default:
      return 'block-badge block-badge-purple';
  }
}

function statusBadgeClass(status: string): string {
  switch (status?.toLowerCase()) {
    case 'succeeded':
    case 'paid':
      return 'block-badge block-badge-income';
    case 'pending':
      return 'block-badge block-badge-warning';
    case 'failed':
      return 'block-badge block-badge-expense';
    default:
      return 'block-badge block-badge-blue';
  }
}

// ─── Stripe Sync Component ──────────────────────────────
const StripeSyncModule: React.FC = () => {
  const [apiKey, setApiKey] = useState('');
  const [savedApiKey, setSavedApiKey] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [transactions, setTransactions] = useState<StripeTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

  // Summary stats
  const [totalPayments, setTotalPayments] = useState(0);
  const [totalFees, setTotalFees] = useState(0);
  const [netRevenue, setNetRevenue] = useState(0);

  const loadData = useCallback(async () => {
    try {
      // Check for API key in settings
      const settingsResult = await api.query('settings', { key: 'stripe_api_key' });
      const keyRow = Array.isArray(settingsResult)
        ? settingsResult[0]
        : settingsResult;

      const storedKey = keyRow?.value ?? '';
      setSavedApiKey(storedKey);
      setIsConnected(!!storedKey);

      // Load transactions
      const txns: StripeTransaction[] = await api.query('stripe_transactions', undefined, {
        field: 'synced_at',
        dir: 'desc',
      });
      setTransactions(txns ?? []);

      // Calculate summary stats
      const txnList = txns ?? [];
      const payments = txnList
        .filter((t) => t.type === 'payment')
        .reduce((sum, t) => sum + (t.amount ?? 0), 0);
      const fees = txnList.reduce((sum, t) => sum + (t.fee ?? 0), 0);
      const net = txnList.reduce((sum, t) => sum + (t.net ?? 0), 0);

      setTotalPayments(payments);
      setTotalFees(fees);
      setNetRevenue(net);
    } catch (err) {
      console.error('Stripe data load failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSaveApiKey = async () => {
    setSavingKey(true);
    try {
      if (savedApiKey) {
        // Update existing setting
        const existing = await api.query('settings', { key: 'stripe_api_key' });
        const row = Array.isArray(existing) ? existing[0] : existing;
        if (row?.id) {
          await api.update('settings', row.id, { value: apiKey });
        } else {
          await api.create('settings', { key: 'stripe_api_key', value: apiKey });
        }
      } else {
        await api.create('settings', { key: 'stripe_api_key', value: apiKey });
      }
      setSavedApiKey(apiKey);
      setIsConnected(!!apiKey);
      setApiKey('');
    } catch (err) {
      console.error('Failed to save API key:', err);
    } finally {
      setSavingKey(false);
    }
  };

  const handleSync = () => {
    if (!isConnected) {
      setSyncMessage('Configure your Stripe API key first to enable sync.');
      setTimeout(() => setSyncMessage(''), 5000);
      return;
    }
    setSyncMessage(
      'Stripe sync requires the Stripe Node SDK. Configure your API key and use the CLI to sync: bap stripe-sync'
    );
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-full">
        <span className="text-text-muted text-sm">Loading Stripe data...</span>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      {/* Header */}
      <div className="module-header">
        <div className="flex items-center gap-2">
          <CreditCard size={20} className="text-accent-purple" />
          <h1 className="module-title">Stripe Data Sync</h1>
        </div>
        <div className="module-actions">
          <button
            className="block-btn-primary flex items-center gap-2"
            onClick={handleSync}
            disabled={syncing}
            style={{ opacity: syncing ? 0.6 : 1 }}
          >
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Syncing...' : 'Sync Now'}
          </button>
        </div>
      </div>

      {/* Sync message */}
      {syncMessage && (
        <div
          className="block-card p-3 flex items-center gap-2"
          style={{
            borderColor: isConnected
              ? 'var(--color-accent-warning)'
              : 'var(--color-accent-expense)',
          }}
        >
          <AlertCircle size={14} className="text-accent-warning" />
          <span className="text-sm text-text-secondary">{syncMessage}</span>
        </div>
      )}

      {/* Connection Status + API Key Config */}
      <div className="grid grid-cols-2 gap-4">
        {/* Connection Status */}
        <div className="stat-card border-l-2" style={{
          borderLeftColor: isConnected
            ? 'var(--color-accent-income)'
            : 'var(--color-accent-expense)',
        }}>
          <div className="flex items-center gap-2 mb-2">
            {isConnected ? (
              <CheckCircle size={16} className="text-accent-income" />
            ) : (
              <XCircle size={16} className="text-accent-expense" />
            )}
            <span className="stat-label">Connection Status</span>
          </div>
          <p className="stat-value" style={{
            color: isConnected
              ? 'var(--color-accent-income)'
              : 'var(--color-accent-expense)',
            fontSize: '1.125rem',
          }}>
            {isConnected ? 'Connected' : 'Not Connected'}
          </p>
          {isConnected && (
            <span className="text-xs text-text-muted mt-1">
              API Key: ****{savedApiKey.slice(-4)}
            </span>
          )}
        </div>

        {/* Configure API Key */}
        <div className="block-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Key size={14} className="text-accent-blue" />
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              Configure API Key
            </span>
          </div>
          <div className="flex gap-2">
            <input
              type="password"
              className="block-input flex-1"
              placeholder="sk_live_... or sk_test_..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <button
              className="block-btn-primary"
              onClick={handleSaveApiKey}
              disabled={!apiKey || savingKey}
              style={{ opacity: !apiKey || savingKey ? 0.5 : 1 }}
            >
              {savingKey ? 'Saving...' : 'Save'}
            </button>
          </div>
          <p className="text-xs text-text-muted mt-2">
            Enter your Stripe secret key to enable transaction sync.
          </p>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="stat-card border-l-2 border-l-accent-income">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign size={14} className="text-accent-income" />
            <span className="stat-label">Total Synced Payments</span>
          </div>
          <p className="stat-value text-accent-income">{fmt.format(totalPayments)}</p>
        </div>

        <div className="stat-card border-l-2 border-l-accent-warning">
          <div className="flex items-center gap-2 mb-1">
            <ArrowDownUp size={14} className="text-accent-warning" />
            <span className="stat-label">Total Fees</span>
          </div>
          <p className="stat-value text-accent-warning">{fmt.format(totalFees)}</p>
        </div>

        <div className="stat-card border-l-2 border-l-accent-blue">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign size={14} className="text-accent-blue" />
            <span className="stat-label">Net Revenue</span>
          </div>
          <p className="stat-value text-accent-blue">{fmt.format(netRevenue)}</p>
        </div>
      </div>

      {/* Transactions Table */}
      <div className="block-card p-5">
        <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">
          Synced Transactions
        </h2>
        {transactions.length === 0 ? (
          <div className="empty-state py-8">
            <div className="empty-state-icon">
              <CreditCard size={24} className="text-text-muted" />
            </div>
            <p className="text-text-muted text-sm">No synced transactions yet</p>
            <p className="text-text-muted text-xs mt-1">
              {isConnected
                ? 'Click "Sync Now" to pull transactions from Stripe'
                : 'Configure your API key to get started'}
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="block-table">
              <thead>
                <tr>
                  <th>Stripe ID</th>
                  <th>Type</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th style={{ textAlign: 'right' }}>Fee</th>
                  <th style={{ textAlign: 'right' }}>Net</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th>Synced Date</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((txn) => (
                  <tr key={txn.id}>
                    <td className="font-mono text-xs text-text-secondary">
                      {txn.stripe_id}
                    </td>
                    <td>
                      <span className={typeBadgeClass(txn.type)}>
                        {txn.type}
                      </span>
                    </td>
                    <td className="font-mono text-right">
                      {fmt.format(txn.amount ?? 0)}
                    </td>
                    <td className="font-mono text-right text-accent-warning">
                      {fmt.format(txn.fee ?? 0)}
                    </td>
                    <td className="font-mono text-right text-accent-income">
                      {fmt.format(txn.net ?? 0)}
                    </td>
                    <td className="text-text-secondary">{txn.description || '--'}</td>
                    <td>
                      <span className={statusBadgeClass(txn.status)}>
                        {txn.status}
                      </span>
                    </td>
                    <td className="text-xs text-text-muted">
                      {txn.synced_at
                        ? new Date(txn.synced_at).toLocaleDateString()
                        : '--'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default StripeSyncModule;
