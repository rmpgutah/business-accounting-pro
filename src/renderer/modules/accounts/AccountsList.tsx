import React, { useCallback, useEffect, useState, useMemo } from 'react';
import {
  ChevronDown, ChevronRight, Plus, BookOpen, RefreshCw, Search,
  List as ListIcon, Network, Pin, Lock, FileText as FileTextIcon, Download,
  Upload, Layers, GitMerge, DollarSign, Calendar, Printer, Tag,
} from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency } from '../../lib/format';
import { ImportWizard } from '../../components/ImportWizard';
import ErrorBanner from '../../components/ErrorBanner';
import EntityChip from '../../components/EntityChip';
import { COA_TEMPLATES } from '../../lib/coa-templates';
import { toCSVString, downloadCSVBlob } from '../../lib/csv-export';

type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  subtype: string;
  description: string;
  parent_id: string | null;
  is_active: number | boolean;
  balance: number;
  is_1099_eligible?: number;
  color?: string;
  is_pinned?: number;
  is_locked?: number;
  requires_document?: number;
  sort_order?: number;
  net_dr?: number;
  last_txn_date?: string | null;
  activity_90d?: number;
}

interface AccountsListProps {
  onNewAccount: () => void;
  onEditAccount: (account: Account) => void;
}

const ACCOUNT_TYPE_ORDER: AccountType[] = ['asset', 'liability', 'equity', 'revenue', 'expense'];
const TYPE_LABELS: Record<AccountType, string> = { asset: 'Assets', liability: 'Liabilities', equity: 'Equity', revenue: 'Revenue', expense: 'Expenses' };
const TYPE_ACCENT: Record<AccountType, string> = {
  asset: 'text-accent-blue', liability: 'text-accent-expense', equity: 'text-text-primary',
  revenue: 'text-accent-income', expense: 'text-accent-expense',
};

// ─── Levenshtein for fuzzy search ───────────────────────
function levenshtein(a: string, b: string): number {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length, n = b.length;
  const dp: number[] = Array(n + 1).fill(0);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : Math.min(prev, dp[j], dp[j - 1]) + 1;
      prev = tmp;
    }
  }
  return dp[n];
}

function fuzzyMatch(needle: string, haystack: string): boolean {
  if (!needle) return true;
  const n = needle.toLowerCase(), h = haystack.toLowerCase();
  if (h.includes(n)) return true;
  // Token-level Levenshtein with threshold
  const tokens = h.split(/\s+/);
  const threshold = Math.max(1, Math.floor(n.length * 0.3));
  return tokens.some(t => levenshtein(n, t.slice(0, n.length + threshold)) <= threshold);
}

const AccountsList: React.FC<AccountsListProps> = ({ onNewAccount, onEditAccount }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [statusFilter, setStatusFilter] = useState<'active' | 'archived' | 'all'>('active');
  const [showImport, setShowImport] = useState(false);
  const [error, setError] = useState('');
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildMessage, setRebuildMessage] = useState('');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'flat' | 'tree'>('flat');
  const [filterType, setFilterType] = useState<AccountType | 'all'>('all');
  const [filterHasActivity, setFilterHasActivity] = useState(false);
  const [filterPinnedOnly, setFilterPinnedOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [showOpeningBalDialog, setShowOpeningBalDialog] = useState<Account | null>(null);
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [showQrLabels, setShowQrLabels] = useState(false);

  const reload = useCallback(async () => {
    if (!activeCompany) return;
    try {
      const data = await api.rawQuery(
        `SELECT a.* FROM accounts a WHERE a.company_id = ? ORDER BY a.is_pinned DESC, a.sort_order, a.code`,
        [activeCompany.id]
      );
      const stats = await api.accountsStats(activeCompany.id);
      const statsMap = new Map<string, any>();
      if (Array.isArray(stats)) for (const s of stats) statsMap.set(s.id, s);
      if (Array.isArray(data)) {
        const enriched = data.map((a: any) => {
          const s = statsMap.get(a.id) || {};
          const netDr = Number(s.net_dr) || 0;
          return {
            ...a,
            balance: ['asset', 'expense'].includes(a.type) ? netDr : -netDr,
            net_dr: netDr,
            last_txn_date: s.last_txn_date || null,
            activity_90d: Number(s.activity_90d) || 0,
          };
        });
        setAccounts(enriched);
      }
    } catch (err: any) {
      console.error('Failed to load accounts:', err);
      setError(err?.message || 'Failed to load accounts');
    }
  }, [activeCompany]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany) return;
      setLoading(true); setError('');
      try { await reload(); } finally { if (!cancelled) setLoading(false); }
    };
    load();
    return () => { cancelled = true; };
  }, [activeCompany, reload]);

  // Filter
  const filtered = useMemo(() => {
    let f = accounts;
    if (statusFilter === 'active') f = f.filter(a => !!a.is_active);
    else if (statusFilter === 'archived') f = f.filter(a => !a.is_active);
    if (filterType !== 'all') f = f.filter(a => a.type === filterType);
    if (filterHasActivity) f = f.filter(a => (a.activity_90d || 0) > 0);
    if (filterPinnedOnly) f = f.filter(a => !!a.is_pinned);
    if (search.trim()) {
      const q = search.trim();
      f = f.filter(a => fuzzyMatch(q, a.code) || fuzzyMatch(q, a.name));
    }
    return f;
  }, [accounts, statusFilter, filterType, filterHasActivity, filterPinnedOnly, search]);

  // Group by type for flat view
  const grouped = useMemo(() => {
    const groups: Record<AccountType, Account[]> = { asset: [], liability: [], equity: [], revenue: [], expense: [] };
    for (const acct of filtered) {
      const t = acct.type as AccountType;
      if (groups[t]) groups[t].push(acct);
    }
    for (const t of ACCOUNT_TYPE_ORDER) {
      groups[t].sort((a, b) => {
        if ((b.is_pinned ? 1 : 0) !== (a.is_pinned ? 1 : 0)) return (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0);
        return a.code.localeCompare(b.code);
      });
    }
    return groups;
  }, [filtered]);

  const groupTotal = (type: AccountType) => grouped[type].reduce((sum, a) => sum + (a.balance ?? 0), 0);
  const toggleCollapse = (type: string) => setCollapsed(prev => ({ ...prev, [type]: !prev[type] }));

  // Top counts
  const counts = useMemo(() => {
    const c: Record<AccountType, number> = { asset: 0, liability: 0, equity: 0, revenue: 0, expense: 0 };
    for (const a of accounts) if (a.is_active) c[a.type as AccountType]++;
    return c;
  }, [accounts]);

  const toggleSelected = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const handleBulkActivate = async (active: boolean) => {
    if (selected.size === 0) return;
    await api.accountsBulkToggleActive(Array.from(selected), active);
    setSelected(new Set());
    reload();
  };

  const handleExportCsv = () => {
    const rows = accounts.map(a => ({
      code: a.code, name: a.name, type: a.type, subtype: a.subtype,
      parent_id: a.parent_id || '', is_active: a.is_active ? 'yes' : 'no',
      is_pinned: a.is_pinned ? 'yes' : '', is_1099_eligible: a.is_1099_eligible ? 'yes' : '',
      requires_document: a.requires_document ? 'yes' : '', is_locked: a.is_locked ? 'yes' : '',
      color: a.color || '', balance: (a.balance ?? 0).toFixed(2),
      last_txn_date: a.last_txn_date || '', description: a.description || '',
    }));
    // downloadCSVBlob accepts row records directly — no pre-stringification.
    downloadCSVBlob(rows, `chart-of-accounts-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  // Drag-and-drop reordering / reparenting
  const [dragId, setDragId] = useState<string | null>(null);
  const handleDragStart = (id: string) => setDragId(id);
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();
  const handleDrop = async (targetId: string, asChild: boolean) => {
    if (!dragId || dragId === targetId || !activeCompany) return;
    const dragged = accounts.find(a => a.id === dragId);
    const target = accounts.find(a => a.id === targetId);
    if (!dragged || !target) return;
    if (dragged.is_locked) { alert('Cannot move locked account'); setDragId(null); return; }
    if (asChild) {
      // Reparent
      if (target.type !== dragged.type) {
        if (!confirm(`Reparent ${dragged.code} under ${target.code}? Note: types differ.`)) { setDragId(null); return; }
      }
      await api.update('accounts', dragId, { parent_id: targetId });
    } else {
      // Reorder: swap sort_order with target
      const dSO = dragged.sort_order || 0, tSO = target.sort_order || 0;
      await api.update('accounts', dragId, { sort_order: tSO });
      await api.update('accounts', targetId, { sort_order: dSO });
    }
    setDragId(null);
    reload();
  };

  // Tree view structure
  const treeRoots = useMemo(() => {
    const byParent = new Map<string | null, Account[]>();
    for (const a of filtered) {
      const p = a.parent_id || null;
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p)!.push(a);
    }
    return byParent;
  }, [filtered]);

  const renderTreeNode = (acct: Account, depth: number): React.ReactNode => {
    const children = treeRoots.get(acct.id) || [];
    return (
      <React.Fragment key={acct.id}>
        <AccountRow account={acct} depth={depth} onEdit={onEditAccount}
          selected={selected.has(acct.id)} onToggleSelect={toggleSelected}
          onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop}
          onSetOpeningBalance={() => setShowOpeningBalDialog(acct)} />
        {children.map(c => renderTreeNode(c, depth + 1))}
      </React.Fragment>
    );
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><span className="text-text-muted text-sm font-mono">Loading accounts...</span></div>;
  }

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} title="Failed to load accounts" onDismiss={() => setError('')} />}
      {rebuildMessage && (
        <div className="flex items-center justify-between px-4 py-2.5 text-xs text-accent-income bg-accent-income/10 border border-accent-income/20" style={{ borderRadius: '6px' }}>
          <span>{rebuildMessage}</span>
          <button onClick={() => setRebuildMessage('')} className="text-accent-income/60 hover:text-accent-income text-xs font-bold">Dismiss</button>
        </div>
      )}

      {/* Stat strip: counts by type */}
      <div className="grid grid-cols-6 gap-2">
        {ACCOUNT_TYPE_ORDER.map(t => (
          <div key={t} className="block-card px-3 py-2 border border-border-primary" style={{ borderRadius: '6px' }}>
            <p className="text-[9px] text-text-muted uppercase tracking-wider font-bold">{TYPE_LABELS[t]}</p>
            <p className={`text-lg font-bold font-mono ${TYPE_ACCENT[t]}`}>{counts[t]}</p>
          </div>
        ))}
        <div className="block-card px-3 py-2 border border-border-primary" style={{ borderRadius: '6px' }}>
          <p className="text-[9px] text-text-muted uppercase tracking-wider font-bold">Total</p>
          <p className="text-lg font-bold font-mono text-text-primary">{accounts.filter(a => a.is_active).length}</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="flex items-center gap-1 px-2 py-1 border border-border-primary bg-bg-primary" style={{ borderRadius: '6px' }}>
            <Search size={12} className="text-text-muted" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Fuzzy search code or name..."
              className="bg-transparent outline-none text-xs text-text-primary w-48 placeholder:text-text-muted" />
          </div>

          {/* Status filter */}
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}
            className="px-2 py-1 text-xs bg-bg-primary border border-border-primary text-text-primary" style={{ borderRadius: '6px' }}>
            <option value="active">Active only</option>
            <option value="archived">Archived only</option>
            <option value="all">All</option>
          </select>

          {/* Type filter */}
          <select value={filterType} onChange={(e) => setFilterType(e.target.value as any)}
            className="px-2 py-1 text-xs bg-bg-primary border border-border-primary text-text-primary" style={{ borderRadius: '6px' }}>
            <option value="all">All types</option>
            {ACCOUNT_TYPE_ORDER.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
          </select>

          <button onClick={() => setFilterHasActivity(!filterHasActivity)}
            className={`px-2 py-1 text-xs border ${filterHasActivity ? 'border-accent-blue text-accent-blue' : 'border-border-primary text-text-secondary'}`}
            style={{ borderRadius: '6px' }} title="Has activity in last 90 days">Active 90d</button>

          <button onClick={() => setFilterPinnedOnly(!filterPinnedOnly)}
            className={`px-2 py-1 text-xs border flex items-center gap-1 ${filterPinnedOnly ? 'border-accent-blue text-accent-blue' : 'border-border-primary text-text-secondary'}`}
            style={{ borderRadius: '6px' }}><Pin size={10} /> Pinned</button>

          {/* View mode */}
          <div className="flex border border-border-primary" style={{ borderRadius: '6px' }}>
            <button onClick={() => setViewMode('flat')}
              className={`px-2 py-1 text-xs flex items-center gap-1 ${viewMode === 'flat' ? 'bg-accent-blue text-white' : 'text-text-secondary'}`}>
              <ListIcon size={11} /> Flat
            </button>
            <button onClick={() => setViewMode('tree')}
              className={`px-2 py-1 text-xs flex items-center gap-1 ${viewMode === 'tree' ? 'bg-accent-blue text-white' : 'text-text-secondary'}`}>
              <Network size={11} /> Tree
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={async () => {
            setRebuilding(true); setRebuildMessage(''); setError('');
            try {
              const result = await api.rebuildGL();
              if (result?.error) setError(result.error);
              else { setRebuildMessage(result?.message || `Posted ${result?.posted || 0} journal entries.`); reload(); }
            } catch (err: any) { setError(err?.message || 'Failed to rebuild GL'); }
            finally { setRebuilding(false); }
          }} disabled={rebuilding}
            className="flex items-center gap-1.5 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue"
            style={{ opacity: rebuilding ? 0.6 : 1 }}>
            <RefreshCw size={12} className={rebuilding ? 'animate-spin' : ''} />
            {rebuilding ? 'Rebuilding...' : 'Rebuild GL'}
          </button>
          <button onClick={() => setShowTemplatePicker(true)} className="flex items-center gap-1 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue" style={{ borderRadius: '6px' }}>
            <Layers size={12} /> Apply Template
          </button>
          <button onClick={handleExportCsv} className="flex items-center gap-1 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue" style={{ borderRadius: '6px' }}>
            <Download size={12} /> Export CSV
          </button>
          <button onClick={() => setShowImport(true)} className="flex items-center gap-1 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue" style={{ borderRadius: '6px' }}>
            <Upload size={12} /> Import CSV
          </button>
          <button onClick={() => setShowCloseDialog(true)} className="flex items-center gap-1 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue" style={{ borderRadius: '6px' }}
            title="Year-end close to Retained Earnings">
            <Calendar size={12} /> Close Year
          </button>
          <button onClick={onNewAccount} className="block-btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold" style={{ borderRadius: '6px' }}>
            <Plus size={14} /> New Account
          </button>
        </div>
      </div>

      {/* Bulk actions toolbar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-accent-blue/10 border border-accent-blue/30" style={{ borderRadius: '6px' }}>
          <span className="text-xs text-accent-blue font-bold">{selected.size} selected</span>
          <button onClick={() => handleBulkActivate(true)} className="px-2 py-1 text-xs border border-border-primary hover:border-accent-blue" style={{ borderRadius: '6px' }}>Activate</button>
          <button onClick={() => handleBulkActivate(false)} className="px-2 py-1 text-xs border border-border-primary hover:border-accent-blue" style={{ borderRadius: '6px' }}>Deactivate</button>
          {selected.size === 2 && (
            <button onClick={() => setShowMergeDialog(true)} className="flex items-center gap-1 px-2 py-1 text-xs border border-border-primary hover:border-accent-blue" style={{ borderRadius: '6px' }}>
              <GitMerge size={11} /> Merge
            </button>
          )}
          {selected.size >= 2 && selected.size <= 4 && (
            <button onClick={() => setShowCompare(true)} className="px-2 py-1 text-xs border border-border-primary hover:border-accent-blue" style={{ borderRadius: '6px' }}>
              Compare
            </button>
          )}
          <button onClick={() => setShowQrLabels(true)} className="flex items-center gap-1 px-2 py-1 text-xs border border-border-primary hover:border-accent-blue" style={{ borderRadius: '6px' }}>
            <Tag size={11} /> Print Labels
          </button>
          <button onClick={() => setSelected(new Set())} className="ml-auto px-2 py-1 text-xs text-text-muted hover:text-text-primary">Clear</button>
        </div>
      )}

      {/* Table */}
      <div className="block-table bg-bg-secondary border border-border-primary overflow-hidden" style={{ borderRadius: '6px' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bg-tertiary border-b border-border-primary">
                <th className="w-8 px-2 py-2"><input type="checkbox"
                  checked={selected.size > 0 && selected.size === filtered.length}
                  onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map(a => a.id)) : new Set())} /></th>
                <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider w-8" />
                <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Code</th>
                <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Name</th>
                <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Type</th>
                <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Subtype</th>
                <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Last Txn</th>
                <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Balance</th>
              </tr>
            </thead>
            <tbody>
              {viewMode === 'flat' ? ACCOUNT_TYPE_ORDER.map((type) => {
                const items = grouped[type];
                const isCollapsed = collapsed[type] ?? false;
                const total = groupTotal(type);
                return (
                  <React.Fragment key={type}>
                    <tr className="bg-bg-tertiary/50 border-b border-border-primary cursor-pointer hover:bg-bg-hover" onClick={() => toggleCollapse(type)}>
                      <td className="px-2 py-2"></td>
                      <td className="px-4 py-2">{isCollapsed ? <ChevronRight size={14} className="text-text-muted" /> : <ChevronDown size={14} className="text-text-muted" />}</td>
                      <td colSpan={5} className="px-4 py-2 text-xs font-bold text-text-primary uppercase tracking-wider">
                        {TYPE_LABELS[type]} <span className="text-text-muted font-normal ml-1">({items.length})</span>
                      </td>
                      <td className={`px-4 py-2 text-right font-mono text-xs font-semibold ${TYPE_ACCENT[type]}`}>{formatCurrency(total)}</td>
                    </tr>
                    {!isCollapsed && items.map(account => (
                      <AccountRow key={account.id} account={account} depth={0} onEdit={onEditAccount}
                        selected={selected.has(account.id)} onToggleSelect={toggleSelected}
                        onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop}
                        onSetOpeningBalance={() => setShowOpeningBalDialog(account)} />
                    ))}
                  </React.Fragment>
                );
              }) : (treeRoots.get(null) || []).map(a => renderTreeNode(a, 0))}

              {accounts.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8"><EmptyState icon={BookOpen} message="No accounts found" /></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showImport && (
        <ImportWizard table="accounts" requiredFields={['code', 'name', 'type']}
          extraData={{ company_id: activeCompany?.id }}
          onDone={() => { setShowImport(false); reload(); }}
          onCancel={() => setShowImport(false)} />
      )}

      {showTemplatePicker && <TemplatePicker companyId={activeCompany?.id || ''} onClose={() => setShowTemplatePicker(false)} onApplied={() => { setShowTemplatePicker(false); reload(); }} />}
      {showMergeDialog && selected.size === 2 && (
        <MergeDialog accounts={accounts.filter(a => selected.has(a.id))} onClose={() => setShowMergeDialog(false)} onDone={() => { setShowMergeDialog(false); setSelected(new Set()); reload(); }} />
      )}
      {showOpeningBalDialog && (
        <OpeningBalanceDialog account={showOpeningBalDialog} companyId={activeCompany?.id || ''} onClose={() => setShowOpeningBalDialog(null)} onDone={() => { setShowOpeningBalDialog(null); reload(); }} />
      )}
      {showCloseDialog && (
        <CloseYearDialog companyId={activeCompany?.id || ''} onClose={() => setShowCloseDialog(false)} onDone={() => { setShowCloseDialog(false); reload(); }} />
      )}
      {showCompare && (
        <CompareDialog accounts={accounts.filter(a => selected.has(a.id))} companyId={activeCompany?.id || ''} onClose={() => setShowCompare(false)} />
      )}
      {showQrLabels && (
        <QrLabelsDialog accounts={accounts.filter(a => selected.has(a.id))} onClose={() => setShowQrLabels(false)} />
      )}
    </div>
  );
};

// ─── Account Row ────────────────────────────────────────
const AccountRow: React.FC<{
  account: Account; depth: number;
  onEdit: (a: Account) => void;
  selected: boolean; onToggleSelect: (id: string) => void;
  onDragStart: (id: string) => void; onDragOver: (e: React.DragEvent) => void;
  onDrop: (id: string, asChild: boolean) => void;
  onSetOpeningBalance: () => void;
}> = ({ account, depth, onEdit, selected, onToggleSelect, onDragStart, onDragOver, onDrop, onSetOpeningBalance }) => {
  return (
    <tr className={`border-b border-border-primary hover:bg-bg-hover cursor-pointer ${!account.is_active ? 'opacity-50' : ''}`}
      draggable={!account.is_locked}
      onDragStart={() => onDragStart(account.id)}
      onDragOver={onDragOver}
      onDrop={(e) => { e.preventDefault(); onDrop(account.id, e.shiftKey); }}
      onClick={() => onEdit(account)}>
      <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={selected} onChange={() => onToggleSelect(account.id)} />
      </td>
      <td className="px-4 py-2">
        {account.color && <span className="inline-block w-2.5 h-2.5" style={{ background: account.color, borderRadius: '50%' }} />}
      </td>
      <td className="px-4 py-2 font-mono text-xs text-text-secondary" onClick={(e) => e.stopPropagation()}>
        <div style={{ paddingLeft: depth * 16 }} className="flex items-center gap-1">
          {account.is_pinned ? <Pin size={10} className="text-accent-blue" /> : null}
          <EntityChip type="account" id={account.id} label={account.code} variant="mono" />
        </div>
      </td>
      <td className="px-4 py-2 text-xs text-text-primary font-medium truncate max-w-[260px]">
        <div className="flex items-center gap-1.5">
          {account.name}
          {account.is_locked ? <Lock size={10} className="text-accent-expense" /> : null}
          {account.is_1099_eligible ? <span className="text-[9px] bg-accent-blue/20 text-accent-blue px-1 py-0.5 font-bold" style={{ borderRadius: '3px' }}>1099</span> : null}
          {account.requires_document ? <FileTextIcon size={10} className="text-accent-blue" /> : null}
          {!account.is_active && <span className="ml-1 text-[10px] text-text-muted bg-bg-tertiary px-1.5 py-0.5" style={{ borderRadius: '6px' }}>Archived</span>}
        </div>
      </td>
      <td className="px-4 py-2 text-xs text-text-secondary capitalize">{account.type}</td>
      <td className="px-4 py-2 text-xs text-text-muted">{account.subtype || '-'}</td>
      <td className="px-4 py-2 text-xs text-text-muted font-mono">{account.last_txn_date || '-'}</td>
      <td className="px-4 py-2 text-right font-mono text-xs text-text-primary" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-2">
          <span>{formatCurrency(account.balance ?? 0)}</span>
          <button onClick={(e) => { e.stopPropagation(); onSetOpeningBalance(); }} title="Set opening balance" className="text-text-muted hover:text-accent-blue">
            <DollarSign size={11} />
          </button>
          <button onClick={async (e) => {
            e.stopPropagation();
            const company = (await api.query('accounts', { id: account.id }))?.[0];
            if (company) await api.accountsHistoryPdf(account.id, account['company_id' as keyof Account] as any || '');
          }} title="Print history sheet" className="text-text-muted hover:text-accent-blue">
            <Printer size={11} />
          </button>
        </div>
      </td>
    </tr>
  );
};

// ─── Template Picker Dialog ─────────────────────────────
const TemplatePicker: React.FC<{ companyId: string; onClose: () => void; onApplied: () => void }> = ({ companyId, onClose, onApplied }) => {
  const [applying, setApplying] = useState(false);
  const apply = async (templateId: string) => {
    const tpl = COA_TEMPLATES.find(t => t.id === templateId);
    if (!tpl) return;
    setApplying(true);
    const r = await api.accountsApplyTemplate(companyId, tpl.accounts);
    setApplying(false);
    if (r?.error) { alert(r.error); return; }
    alert(`Created ${r.created || 0} new accounts from "${tpl.name}".`);
    onApplied();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black/50">
      <div className="bg-bg-elevated border border-border-primary w-full max-w-lg" style={{ borderRadius: '6px' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-primary">
          <h2 className="text-sm font-bold">Apply Standard Chart of Accounts</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-lg">&times;</button>
        </div>
        <div className="p-4 space-y-2">
          <p className="text-xs text-text-secondary mb-3">Only accounts with codes not already in your CoA will be created.</p>
          {COA_TEMPLATES.map(tpl => (
            <button key={tpl.id} onClick={() => apply(tpl.id)} disabled={applying}
              className="w-full text-left px-3 py-2 border border-border-primary hover:border-accent-blue disabled:opacity-50"
              style={{ borderRadius: '6px' }}>
              <div className="text-sm font-bold">{tpl.name}</div>
              <div className="text-xs text-text-muted">{tpl.description}</div>
              <div className="text-[10px] text-text-muted mt-1">{tpl.accounts.length} accounts</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── Merge Dialog ───────────────────────────────────────
const MergeDialog: React.FC<{ accounts: Account[]; onClose: () => void; onDone: () => void }> = ({ accounts, onClose, onDone }) => {
  const [targetId, setTargetId] = useState(accounts[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const sourceId = accounts.find(a => a.id !== targetId)?.id || '';
  const doMerge = async () => {
    if (!confirm(`This will move ALL transactions from the source account into the target and delete the source. This cannot be undone. Continue?`)) return;
    setBusy(true);
    const r = await api.accountsMerge(sourceId, targetId);
    setBusy(false);
    if (r?.error) { alert(r.error); return; }
    onDone();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black/50">
      <div className="bg-bg-elevated border border-border-primary w-full max-w-md" style={{ borderRadius: '6px' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-primary">
          <h2 className="text-sm font-bold">Merge Accounts</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-lg">&times;</button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-text-secondary">Choose which account to keep. The other account will be merged into it and then deleted.</p>
          {accounts.map(a => (
            <label key={a.id} className="flex items-center gap-2 px-3 py-2 border border-border-primary cursor-pointer" style={{ borderRadius: '6px' }}>
              <input type="radio" checked={targetId === a.id} onChange={() => setTargetId(a.id)} />
              <span className="font-mono text-xs">{a.code}</span>
              <span className="text-sm">{a.name}</span>
              <span className="ml-auto text-[10px] text-text-muted">{targetId === a.id ? 'KEEP' : 'MERGE INTO TARGET'}</span>
            </label>
          ))}
          <button onClick={doMerge} disabled={busy} className="w-full block-btn-primary py-2 text-xs font-bold uppercase" style={{ borderRadius: '6px' }}>
            {busy ? 'Merging...' : 'Merge Accounts'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Opening Balance Dialog ─────────────────────────────
const OpeningBalanceDialog: React.FC<{ account: Account; companyId: string; onClose: () => void; onDone: () => void }> = ({ account, companyId, onClose, onDone }) => {
  const [amount, setAmount] = useState('0');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt === 0) { alert('Enter a non-zero amount'); return; }
    setBusy(true);
    const r = await api.accountsSetOpeningBalance(companyId, account.id, amt, date);
    setBusy(false);
    if (r?.error) { alert(r.error); return; }
    alert('Opening balance journal entry created.');
    onDone();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black/50">
      <div className="bg-bg-elevated border border-border-primary w-full max-w-md" style={{ borderRadius: '6px' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-primary">
          <h2 className="text-sm font-bold">Set Opening Balance: {account.code} {account.name}</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-lg">&times;</button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="block text-[10px] font-semibold uppercase mb-1">Amount</label>
            <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
              className="block-input w-full px-3 py-2 text-sm bg-bg-primary border border-border-primary" style={{ borderRadius: '6px' }} />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase mb-1">Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="block-input w-full px-3 py-2 text-sm bg-bg-primary border border-border-primary" style={{ borderRadius: '6px' }} />
          </div>
          <p className="text-[10px] text-text-muted">A balanced journal entry will be created with offsetting Opening Balance Equity. This account will be auto-created if missing.</p>
          <button onClick={submit} disabled={busy} className="w-full block-btn-primary py-2 text-xs font-bold uppercase" style={{ borderRadius: '6px' }}>
            {busy ? 'Posting...' : 'Post Opening Balance'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Close Year Dialog ──────────────────────────────────
const CloseYearDialog: React.FC<{ companyId: string; onClose: () => void; onDone: () => void }> = ({ companyId, onClose, onDone }) => {
  const [date, setDate] = useState(`${new Date().getFullYear() - 1}-12-31`);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!confirm(`Close all revenue & expense accounts to Retained Earnings as of ${date}? A closing journal entry will be posted.`)) return;
    setBusy(true);
    const r = await api.accountsCloseToRetainedEarnings(companyId, date);
    setBusy(false);
    if (r?.error) { alert(r.error); return; }
    alert(`Closing entry posted. Closed ${r.accounts_closed || 0} accounts.`);
    onDone();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black/50">
      <div className="bg-bg-elevated border border-border-primary w-full max-w-md" style={{ borderRadius: '6px' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-primary">
          <h2 className="text-sm font-bold">Year-End Close to Retained Earnings</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-lg">&times;</button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="block text-[10px] font-semibold uppercase mb-1">Period End Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="block-input w-full px-3 py-2 text-sm bg-bg-primary border border-border-primary" style={{ borderRadius: '6px' }} />
          </div>
          <p className="text-[10px] text-text-muted">All revenue and expense net balances through this date will be transferred to Retained Earnings.</p>
          <button onClick={submit} disabled={busy} className="w-full block-btn-primary py-2 text-xs font-bold uppercase" style={{ borderRadius: '6px' }}>
            {busy ? 'Posting...' : 'Post Closing Entry'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Compare Dialog ─────────────────────────────────────
const CompareDialog: React.FC<{ accounts: Account[]; companyId: string; onClose: () => void }> = ({ accounts, companyId, onClose }) => {
  const [data, setData] = useState<Record<string, { current: number; prior: number }>>({});
  useEffect(() => {
    const load = async () => {
      const today = new Date();
      const ytdStart = `${today.getFullYear()}-01-01`;
      const priorStart = `${today.getFullYear() - 1}-01-01`;
      const priorEnd = `${today.getFullYear() - 1}-12-31`;
      const out: Record<string, { current: number; prior: number }> = {};
      for (const a of accounts) {
        const cur = await api.rawQuery(
          `SELECT COALESCE(SUM(jel.debit - jel.credit), 0) as net FROM journal_entry_lines jel
           JOIN journal_entries je ON jel.journal_entry_id = je.id
           WHERE jel.account_id = ? AND je.company_id = ? AND je.date >= ?`,
          [a.id, companyId, ytdStart]
        );
        const pri = await api.rawQuery(
          `SELECT COALESCE(SUM(jel.debit - jel.credit), 0) as net FROM journal_entry_lines jel
           JOIN journal_entries je ON jel.journal_entry_id = je.id
           WHERE jel.account_id = ? AND je.company_id = ? AND je.date >= ? AND je.date <= ?`,
          [a.id, companyId, priorStart, priorEnd]
        );
        const sign = ['asset', 'expense'].includes(a.type) ? 1 : -1;
        out[a.id] = {
          current: sign * (Number((cur as any[])[0]?.net) || 0),
          prior: sign * (Number((pri as any[])[0]?.net) || 0),
        };
      }
      setData(out);
    };
    load();
  }, [accounts, companyId]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black/50">
      <div className="bg-bg-elevated border border-border-primary w-full max-w-2xl" style={{ borderRadius: '6px' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-primary">
          <h2 className="text-sm font-bold">Account Comparison</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-lg">&times;</button>
        </div>
        <div className="p-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg-tertiary">
              <tr>
                <th className="text-left px-3 py-2 text-[10px] uppercase">Account</th>
                <th className="text-right px-3 py-2 text-[10px] uppercase">Current YTD</th>
                <th className="text-right px-3 py-2 text-[10px] uppercase">Prior Year</th>
                <th className="text-right px-3 py-2 text-[10px] uppercase">Change</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map(a => {
                const d = data[a.id] || { current: 0, prior: 0 };
                const change = d.current - d.prior;
                return (
                  <tr key={a.id} className="border-b border-border-primary">
                    <td className="px-3 py-2 text-xs"><span className="font-mono">{a.code}</span> {a.name}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{formatCurrency(d.current)}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{formatCurrency(d.prior)}</td>
                    <td className={`px-3 py-2 text-right font-mono text-xs ${change >= 0 ? 'text-accent-income' : 'text-accent-expense'}`}>
                      {change >= 0 ? '+' : ''}{formatCurrency(change)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ─── QR Labels Dialog (text-only deep link, no qrcode dep) ─────
const QrLabelsDialog: React.FC<{ accounts: Account[]; onClose: () => void }> = ({ accounts, onClose }) => {
  const print = async () => {
    const cells = accounts.map(a => `
      <div style="border:2px solid #000;padding:12px;width:200px;height:120px;display:flex;flex-direction:column;justify-content:space-between;page-break-inside:avoid">
        <div style="font-size:10px;color:#666">CHART OF ACCOUNTS</div>
        <div style="font-family:monospace;font-size:24px;font-weight:bold">${a.code}</div>
        <div style="font-size:11px;font-weight:bold;line-height:1.2">${a.name.replace(/</g, '&lt;')}</div>
        <div style="font-size:8px;color:#888;font-family:monospace;word-break:break-all">bap://account/${a.id}</div>
      </div>`).join('');
    const html = `<!DOCTYPE html><html><head><title>Account Labels</title>
      <style>body{margin:24px;font-family:system-ui}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}</style>
      </head><body><div class="grid">${cells}</div></body></html>`;
    await api.printPreview(html, 'Account Labels');
    onClose();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black/50">
      <div className="bg-bg-elevated border border-border-primary w-full max-w-md" style={{ borderRadius: '6px' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-primary">
          <h2 className="text-sm font-bold">Print Account Labels</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-lg">&times;</button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-text-secondary">Generate a printable label sheet for {accounts.length} selected account(s). Each label shows the account code, name, and a deep-link reference (bap://account/&lt;id&gt;).</p>
          <button onClick={print} className="w-full block-btn-primary py-2 text-xs font-bold uppercase" style={{ borderRadius: '6px' }}>
            Generate Labels
          </button>
        </div>
      </div>
    </div>
  );
};

export default AccountsList;
