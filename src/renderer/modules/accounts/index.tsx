import React, { useState, useCallback, useEffect, useMemo, lazy, Suspense } from 'react';
import {
  BookOpen, FileSpreadsheet, BarChart3, Scale, GitBranch, Lock, ShieldCheck,
  HelpCircle, X, Clock,
} from 'lucide-react';
import AccountsList from './AccountsList';
import AccountForm from './AccountForm';
import JournalEntries from './JournalEntries';
import JournalEntryForm from './JournalEntryForm';
import { useAppStore } from '../../stores/appStore';
import api from '../../lib/api';

// GLAnalytics is owned by this agent. Other tabs (Trial Balance, GL,
// Reconciliation, Period Close, Audit) are owned by sibling agents and are
// rendered through a dynamic require() at runtime so this file builds even
// before they land. If a sibling module is absent we fall back to a stub.
const GLAnalytics = lazy(() => import('./GLAnalytics'));

const ComingSoon: React.FC<{ name: string }> = ({ name }) => (
  <div className="block-card text-text-muted text-sm" style={{ padding: 24 }}>
    {name} is being prepared by a sibling agent. Check back shortly.
  </div>
);

// Loader that tries a runtime require; if not yet present, renders the stub.
const SiblingTab: React.FC<{ name: string; modulePath: string }> = ({ name, modulePath }) => {
  const [Comp, setComp] = useState<React.ComponentType | null>(null);
  const [tried, setTried] = useState(false);
  useEffect(() => {
    let cancelled = false;
    // @ts-ignore — Vite resolves this dynamic import via glob; missing modules
    // resolve to undefined at build time, so we accept the rejection silently.
    const all = import.meta.glob('./*.tsx');
    const key = `./${modulePath}.tsx`;
    if (all[key]) {
      (all[key] as any)().then((mod: any) => {
        if (!cancelled) setComp(() => (mod.default || mod[modulePath]) as React.ComponentType);
      }).catch(() => { if (!cancelled) setTried(true); });
    } else {
      setTried(true);
    }
    return () => { cancelled = true; };
  }, [modulePath]);
  if (Comp) return <Comp />;
  if (tried) return <ComingSoon name={name} />;
  return <div className="text-text-muted text-sm">Loading…</div>;
};

// ─── Types ──────────────────────────────────────────────
type Tab =
  | 'chart-of-accounts'
  | 'journal-entries'
  | 'trial-balance'
  | 'general-ledger'
  | 'reconciliation'
  | 'period-close'
  | 'analytics'
  | 'audit';

interface RecentEntry { id: string; entry_number: string; date: string; description: string; ts: number; }
const RECENT_KEY = 'bap-accounts-recent-jes';

// ─── Component ──────────────────────────────────────────
const AccountsModule: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('chart-of-accounts');

  // Account form state
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [editingAccount, setEditingAccount] = useState<any | null>(null);

  // Journal entry form state
  const [showEntryForm, setShowEntryForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<any | null>(null);

  // Help overlay (hotkey help, feature 25)
  const [showHelp, setShowHelp] = useState(false);

  // Onboarding tour (feature 27)
  const [tourStep, setTourStep] = useState<number>(() => {
    if (typeof window === 'undefined') return -1;
    return localStorage.getItem('bap-accounts-tour-done') ? -1 : 0;
  });

  // Recent entries (feature 26)
  const [recents, setRecents] = useState<RecentEntry[]>(() => {
    if (typeof window === 'undefined') return [];
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
  });

  const pushRecent = useCallback((e: any) => {
    if (!e?.id) return;
    const next: RecentEntry = {
      id: e.id, entry_number: e.entry_number, date: e.date, description: e.description, ts: Date.now(),
    };
    setRecents((prev) => {
      const merged = [next, ...prev.filter((p) => p.id !== e.id)].slice(0, 5);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(merged)); } catch {}
      return merged;
    });
  }, []);

  // Force re-render of lists after save
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey((k) => k + 1);

  // Cross-module deep links: account / journal_entry → open edit modal on correct tab
  const consumeFocusEntity = useAppStore((s) => s.consumeFocusEntity);
  useEffect(() => {
    const acctFocus = consumeFocusEntity('account');
    if (acctFocus) {
      setActiveTab('chart-of-accounts');
      api.get('accounts', acctFocus.id).then((a) => {
        if (a) {
          setEditingAccount(a);
          setShowAccountForm(true);
        }
      }).catch(() => {});
      return;
    }
    const jeFocus = consumeFocusEntity('journal_entry');
    if (jeFocus) {
      setActiveTab('journal-entries');
      api.get('journal_entries', jeFocus.id).then((e) => {
        if (e) {
          setEditingEntry(e);
          setShowEntryForm(true);
          pushRecent(e);
        }
      }).catch(() => {});
    }
  }, [consumeFocusEntity, pushRecent]);

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
    pushRecent(entry);
  }, [pushRecent]);

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
  const tabs: { id: Tab; label: string; icon: React.ReactNode; key: string }[] = useMemo(() => [
    { id: 'chart-of-accounts', label: 'Chart',          icon: <BookOpen size={14} />,        key: '1' },
    { id: 'journal-entries',    label: 'Journal Entries', icon: <FileSpreadsheet size={14} />, key: '2' },
    { id: 'trial-balance',      label: 'Trial Balance',  icon: <Scale size={14} />,           key: '3' },
    { id: 'general-ledger',     label: 'General Ledger', icon: <BookOpen size={14} />,        key: '4' },
    { id: 'reconciliation',     label: 'Reconciliation', icon: <GitBranch size={14} />,       key: '5' },
    { id: 'period-close',       label: 'Period Close',   icon: <Lock size={14} />,            key: '6' },
    { id: 'analytics',          label: 'Analytics',      icon: <BarChart3 size={14} />,       key: '7' },
    { id: 'audit',              label: 'Audit',          icon: <ShieldCheck size={14} />,     key: '8' },
  ], []);

  // ─── Hotkeys (features 25 + 29) ────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const inForm = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (inForm) return;
      if (e.key === '?' || (e.shiftKey && e.key === '/')) { setShowHelp((v) => !v); return; }
      if (e.key === 'Escape') { setShowHelp(false); return; }
      // Number keys 1..8 → tabs
      if (/^[1-8]$/.test(e.key)) {
        const t = tabs.find((x) => x.key === e.key);
        if (t) { setActiveTab(t.id); e.preventDefault(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tabs]);

  const dismissTour = () => {
    setTourStep(-1);
    try { localStorage.setItem('bap-accounts-tour-done', '1'); } catch {}
  };

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full relative">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-text-primary">
          Accounts & General Ledger
        </h1>
        <div className="flex items-center gap-2">
          <button
            className="block-btn text-xs flex items-center gap-1"
            title="Keyboard shortcuts (?)"
            onClick={() => setShowHelp(true)}
          >
            <HelpCircle size={14} /> Shortcuts
          </button>
        </div>
      </div>

      {/* Sticky tab navigation (feature 16 + 24) */}
      <div className="flex flex-wrap gap-1 border-b border-border-primary sticky top-0 z-10 bg-bg-primary">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? 'border-b-accent-blue text-text-primary'
                : 'border-b-transparent text-text-muted hover:text-text-secondary transition-colors'
            }`}
            title={`${tab.label} (${tab.key})`}
          >
            {tab.icon}
            {tab.label}
            <span className="text-[9px] text-text-muted ml-0.5">{tab.key}</span>
          </button>
        ))}
      </div>

      {/* Recent JEs strip (feature 26) */}
      {recents.length > 0 && activeTab === 'journal-entries' && (
        <div className="flex items-center gap-2 text-[11px] flex-wrap">
          <Clock size={12} className="text-text-muted" />
          <span className="uppercase font-bold text-text-muted">Recent</span>
          {recents.map((r) => (
            <button
              key={r.id}
              className="block-btn text-[11px]"
              onClick={() => api.get('journal_entries', r.id).then((e: any) => { if (e) handleEditEntry(e); })}
              title={r.description}
            >
              {r.entry_number}
            </button>
          ))}
        </div>
      )}

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

      <Suspense fallback={<div className="text-text-muted text-sm">Loading…</div>}>
        {activeTab === 'trial-balance' && <SiblingTab name="Trial Balance" modulePath="TrialBalance" />}
        {activeTab === 'general-ledger' && <SiblingTab name="General Ledger" modulePath="GeneralLedger" />}
        {activeTab === 'reconciliation' && <SiblingTab name="Reconciliation" modulePath="Reconciliation" />}
        {activeTab === 'period-close' && <SiblingTab name="Period Close" modulePath="PeriodClose" />}
        {activeTab === 'analytics' && <GLAnalytics />}
        {activeTab === 'audit' && <SiblingTab name="Audit Trail" modulePath="AuditTrail" />}
      </Suspense>

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

      {/* Hotkey help overlay */}
      {showHelp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowHelp(false)}>
          <div className="block-card max-w-md w-full" style={{ padding: 20 }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold uppercase text-text-primary">Keyboard Shortcuts</h3>
              <button onClick={() => setShowHelp(false)} className="text-text-muted hover:text-text-primary"><X size={16} /></button>
            </div>
            <table className="w-full text-xs">
              <tbody>
                {[
                  ['?', 'Toggle this help'],
                  ['1', 'Chart of Accounts'],
                  ['2', 'Journal Entries'],
                  ['3', 'Trial Balance'],
                  ['4', 'General Ledger'],
                  ['5', 'Reconciliation'],
                  ['6', 'Period Close'],
                  ['7', 'Analytics'],
                  ['8', 'Audit'],
                  ['Esc', 'Close dialog / overlay'],
                  ['Shift+Click', 'Select range in tables'],
                  ['Right-click', 'Quick actions on JE rows'],
                ].map(([k, l]) => (
                  <tr key={k}>
                    <td className="py-1 pr-3"><kbd className="block-badge">{k}</kbd></td>
                    <td className="text-text-secondary">{l}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Onboarding tour overlay (feature 27) */}
      {tourStep >= 0 && (
        <div className="fixed inset-0 z-40 pointer-events-none">
          <div className="absolute bottom-6 right-6 max-w-sm pointer-events-auto block-card" style={{ padding: 16 }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs uppercase font-bold text-accent-blue">Welcome — step {tourStep + 1} of 4</span>
              <button onClick={dismissTour} className="text-text-muted hover:text-text-primary"><X size={14} /></button>
            </div>
            <div className="text-sm text-text-primary mb-3">
              {[
                'This is the Accounts module. Use the numbered tabs (1–8) or click to switch between Chart, Journal Entries, Trial Balance, GL, and Analytics.',
                'Press ? at any time to see all keyboard shortcuts. Right-click a journal entry for quick actions like Edit, Duplicate, Reverse, and Post.',
                'The Analytics tab gives you 15 reports — activity timelines, suspicious entry detection, budget variance, common-size statements, and more.',
                'Recent journal entries you opened appear above the JE list. Saved filter views and column visibility help you focus on what matters.',
              ][tourStep]}
            </div>
            <div className="flex justify-end gap-2">
              <button className="block-btn text-xs" onClick={dismissTour}>Skip</button>
              <button
                className="block-btn block-btn-primary text-xs"
                onClick={() => (tourStep >= 3 ? dismissTour() : setTourStep((s) => s + 1))}
              >
                {tourStep >= 3 ? 'Done' : 'Next'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AccountsModule;
