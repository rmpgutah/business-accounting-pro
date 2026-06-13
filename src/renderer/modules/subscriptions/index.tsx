// src/renderer/modules/subscriptions/index.tsx
//
// Subscriptions module — surfaces the dark subscription/billing backend.
// Tabs: Subscriptions (lifecycle) · Metrics (MRR/ARR/churn) · Proration & Renewals · Detected (phantom subs).

import React, { useState } from 'react';
import { CreditCard, TrendingUp, Calculator, ScanSearch } from 'lucide-react';
import LifecycleTab from './LifecycleTab';
import MetricsTab from './MetricsTab';
import ProrationTab from './ProrationTab';
import PhantomTab from './PhantomTab';

type TabId = 'subscriptions' | 'metrics' | 'proration' | 'detected';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'subscriptions', label: 'Subscriptions', icon: <CreditCard size={14} /> },
  { id: 'metrics', label: 'Metrics', icon: <TrendingUp size={14} /> },
  { id: 'proration', label: 'Proration & Renewals', icon: <Calculator size={14} /> },
  { id: 'detected', label: 'Detected', icon: <ScanSearch size={14} /> },
];

const SubscriptionsModule: React.FC = () => {
  const [tab, setTab] = useState<TabId>('subscriptions');

  return (
    <div className="h-full flex flex-col">
      <div className="module-header">
        <h1 className="text-lg font-bold text-text-primary">Subscriptions</h1>
      </div>

      <div className="flex flex-wrap items-center gap-1 px-4 border-b" style={{ borderColor: 'var(--color-border-primary)' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="flex items-center gap-1.5 px-3 py-2.5 text-[13px] font-medium transition-colors"
            style={
              tab === t.id
                ? { color: 'var(--accent-primary)', borderBottom: '2px solid var(--accent-primary)' }
                : { color: 'var(--color-text-secondary)', borderBottom: '2px solid transparent' }
            }
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'subscriptions' && <LifecycleTab />}
        {tab === 'metrics' && <MetricsTab />}
        {tab === 'proration' && <ProrationTab />}
        {tab === 'detected' && <PhantomTab />}
      </div>
    </div>
  );
};

export default SubscriptionsModule;
