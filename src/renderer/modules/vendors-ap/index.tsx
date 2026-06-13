// src/renderer/modules/vendors-ap/index.tsx
//
// Vendor & AP Command Center — surfaces the dark vn:/feat: backend.
// Tabs: Overview · Directory · Approvals · Payments · 1099 & Tax · Compliance · Portal.
// Selecting a vendor from Overview/Directory opens the Vendor 360 detail view.

import React, { useState } from 'react';
import {
  LayoutDashboard, Building2, CheckSquare, Banknote, FileText, ShieldCheck, Inbox, Activity, TrendingUp, GitCompare,
} from 'lucide-react';
import Overview from './Overview';
import Directory from './Directory';
import Vendor360 from './Vendor360';
import ApprovalsWorkbench from './ApprovalsWorkbench';
import PaymentsCenter from './PaymentsCenter';
import TaxCompliance1099 from './TaxCompliance1099';
import ComplianceHub from './ComplianceHub';
import PortalAdmin from './PortalAdmin';
import Intelligence from './Intelligence';
import Optimization from './Optimization';
import Matching from './Matching';

type TabId = 'overview' | 'directory' | 'approvals' | 'payments' | 'tax1099' | 'compliance' | 'portal' | 'intelligence' | 'optimization' | 'matching';
const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={14} /> },
  { id: 'directory', label: 'Directory', icon: <Building2 size={14} /> },
  { id: 'approvals', label: 'Approvals', icon: <CheckSquare size={14} /> },
  { id: 'payments', label: 'Payments', icon: <Banknote size={14} /> },
  { id: 'tax1099', label: '1099 & Tax', icon: <FileText size={14} /> },
  { id: 'compliance', label: 'Compliance', icon: <ShieldCheck size={14} /> },
  { id: 'portal', label: 'Vendor Portal', icon: <Inbox size={14} /> },
  { id: 'intelligence', label: 'Intelligence', icon: <Activity size={14} /> },
  { id: 'optimization', label: 'Optimization', icon: <TrendingUp size={14} /> },
  { id: 'matching', label: 'Matching', icon: <GitCompare size={14} /> },
];

const VendorsApModule: React.FC = () => {
  const [tab, setTab] = useState<TabId>('overview');
  const [vendorId, setVendorId] = useState<string | null>(null);

  const viewVendor = (id: string) => { if (id) setVendorId(id); };
  const backToList = () => setVendorId(null);

  return (
    <div className="h-full flex flex-col">
      <div className="module-header">
        <h1 className="text-lg font-bold text-text-primary">Vendor &amp; AP Command Center</h1>
      </div>

      {vendorId ? (
        <div className="flex-1 overflow-y-auto p-4">
          <Vendor360 vendorId={vendorId} onBack={backToList} />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1 px-4 border-b" style={{ borderColor: 'var(--color-border-primary)' }}>
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="flex items-center gap-1.5 px-3 py-2.5 text-[13px] font-medium transition-colors"
                style={tab === t.id
                  ? { color: 'var(--accent-primary)', borderBottom: '2px solid var(--accent-primary)' }
                  : { color: 'var(--color-text-secondary)', borderBottom: '2px solid transparent' }}
              >
                {t.icon}{t.label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {tab === 'overview' && <Overview onViewVendor={viewVendor} />}
            {tab === 'directory' && <Directory onViewVendor={viewVendor} />}
            {tab === 'approvals' && <ApprovalsWorkbench />}
            {tab === 'payments' && <PaymentsCenter />}
            {tab === 'tax1099' && <TaxCompliance1099 onViewVendor={viewVendor} />}
            {tab === 'compliance' && <ComplianceHub onViewVendor={viewVendor} />}
            {tab === 'portal' && <PortalAdmin />}
            {tab === 'intelligence' && <Intelligence onViewVendor={viewVendor} />}
            {tab === 'optimization' && <Optimization onViewVendor={viewVendor} />}
            {tab === 'matching' && <Matching onViewVendor={viewVendor} />}
          </div>
        </>
      )}
    </div>
  );
};

export default VendorsApModule;
