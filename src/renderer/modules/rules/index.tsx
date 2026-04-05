// src/renderer/modules/rules/index.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { Shield, AlertTriangle } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatDate } from '../../lib/format';
import { RuleList } from './RuleList';
import { RuleForm } from './RuleForm';

const TABS = [
  { key: 'bank', label: 'Bank' },
  { key: 'automation', label: 'Automation' },
  { key: 'pricing', label: 'Pricing' },
  { key: 'tax', label: 'Tax' },
  { key: 'approval', label: 'Approval' },
  { key: 'alert', label: 'Alert' },
];

const RulesModule: React.FC = () => {
  const { activeCompany } = useCompanyStore();
  const [tab, setTab] = useState('bank');
  const [rules, setRules] = useState<any[]>([]);
  const [approvals, setApprovals] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!activeCompany) return;
    setLoading(true);
    const rows = await api.listRules(activeCompany.id, tab);
    setRules(rows ?? []);
    if (tab === 'approval') {
      const queue = await api.listApprovals(activeCompany.id, 'pending');
      setApprovals(queue ?? []);
    }
    setLoading(false);
  }, [activeCompany, tab]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this rule?')) return;
    await api.deleteRule(id);
    load();
  };

  const handleToggle = async (id: string, is_active: boolean) => {
    await api.updateRule(id, { is_active: is_active ? 1 : 0 });
    load();
  };

  const handleResolve = async (id: string, status: 'approved' | 'rejected') => {
    await api.resolveApproval(id, status);
    setApprovals(prev => prev.filter(a => a.id !== id));
  };

  return (
    <div className="h-full flex flex-col bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-3">
        <Shield size={20} className="text-indigo-600" />
        <h1 className="font-black uppercase tracking-widest text-sm">Rules</h1>
      </div>
      <div className="bg-white border-b border-gray-200 px-6 flex">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-3 text-xs font-black uppercase tracking-wider border-b-2 transition-colors ${tab === t.key ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-400 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto p-6">
        {tab === 'approval' && approvals.length > 0 && (
          <div className="mb-6 border border-orange-300 bg-orange-50 p-4">
            <h2 className="text-xs font-black uppercase tracking-wider text-orange-700 mb-3 flex items-center gap-2">
              <AlertTriangle size={14} /> {approvals.length} Pending Approval{approvals.length !== 1 ? 's' : ''}
            </h2>
            {approvals.map((a: any) => (
              <div key={a.id} className="flex items-center justify-between bg-white border border-orange-200 px-4 py-3 mb-2">
                <div>
                  <div className="font-bold text-sm">{a.rule_name}</div>
                  <div className="text-xs text-gray-400">{a.record_type} · {a.record_id} · {formatDate(a.created_at)}</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleResolve(a.id, 'approved')} className="px-3 py-1 bg-green-600 text-white text-xs font-bold uppercase hover:bg-green-700">Approve</button>
                  <button onClick={() => handleResolve(a.id, 'rejected')} className="px-3 py-1 bg-red-100 text-red-700 border border-red-300 text-xs font-bold uppercase hover:bg-red-200">Reject</button>
                </div>
              </div>
            ))}
          </div>
        )}
        {loading
          ? <div className="text-xs text-gray-400 p-4">Loading…</div>
          : <RuleList rules={rules} onEdit={rule => { setEditing(rule); setShowForm(true); }} onDelete={handleDelete} onToggle={handleToggle} onNew={() => { setEditing(null); setShowForm(true); }} />
        }
      </div>
      {showForm && (
        <RuleForm category={tab} rule={editing} onSave={() => { setShowForm(false); load(); }} onCancel={() => setShowForm(false)} />
      )}
    </div>
  );
};

export default RulesModule;
