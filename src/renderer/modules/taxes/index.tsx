import React, { useState } from 'react';
import { BarChart3, Tag, CreditCard, Settings } from 'lucide-react';
import TaxDashboard from './TaxDashboard';
import TaxCategories from './TaxCategories';
import TaxPayments from './TaxPayments';
import TaxConfiguration from './TaxConfiguration';

type Tab = 'dashboard' | 'categories' | 'payments' | 'configuration';

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: <BarChart3 size={15} /> },
  { key: 'categories', label: 'Categories', icon: <Tag size={15} /> },
  { key: 'payments', label: 'Payments', icon: <CreditCard size={15} /> },
  { key: 'configuration', label: 'Tax Configuration', icon: <Settings size={15} /> },
];

const TaxModule: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full">
      {/* Module Title */}
      <h1 className="text-lg font-bold text-text-primary">Tax Management</h1>

      {/* Tab Bar */}
      <div className="flex gap-1 border-b border-border-primary pb-0">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold transition-colors border-b-2 -mb-px ${
              activeTab === tab.key
                ? 'border-b-accent-blue text-accent-blue'
                : 'border-b-transparent text-text-muted hover:text-text-primary'
            }`}
            style={{ borderRadius: '2px 2px 0 0' }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'dashboard' && <TaxDashboard />}
      {activeTab === 'categories' && <TaxCategories />}
      {activeTab === 'payments' && <TaxPayments />}
      {activeTab === 'configuration' && <TaxConfiguration />}
    </div>
  );
};

export default TaxModule;
