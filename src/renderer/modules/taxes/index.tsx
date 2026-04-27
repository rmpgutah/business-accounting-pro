import React, { useState } from 'react';
import { BarChart3, FileText, PieChart, Tag, Settings } from 'lucide-react';
import TaxDashboard from './TaxDashboard';
import TaxFiling from './TaxFiling';
import TaxReports from './TaxReports';
import TaxCategories from './TaxCategories';
import TaxConfiguration from './TaxConfiguration';

type Tab = 'dashboard' | 'filing' | 'reports' | 'categories' | 'configuration';

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: <BarChart3 size={15} /> },
  { key: 'filing', label: 'Filing & Compliance', icon: <FileText size={15} /> },
  { key: 'reports', label: 'Reports', icon: <PieChart size={15} /> },
  { key: 'categories', label: 'Categories', icon: <Tag size={15} /> },
  { key: 'configuration', label: 'Configuration', icon: <Settings size={15} /> },
];

const TaxModule: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full">
      <h1 className="text-lg font-bold text-text-primary">Tax Management</h1>
      <div className="flex gap-1 border-b border-border-primary pb-0">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold transition-colors border-b-2 -mb-px ${
              activeTab === tab.key
                ? 'border-b-accent-blue text-accent-blue'
                : 'border-b-transparent text-text-muted hover:text-text-primary transition-colors'
            }`}
            style={{ borderRadius: '6px 6px 0 0' }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>
      {activeTab === 'dashboard' && <TaxDashboard />}
      {activeTab === 'filing' && <TaxFiling />}
      {activeTab === 'reports' && <TaxReports />}
      {activeTab === 'categories' && <TaxCategories />}
      {activeTab === 'configuration' && <TaxConfiguration />}
    </div>
  );
};

export default TaxModule;
