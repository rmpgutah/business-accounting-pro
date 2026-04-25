// BulkEditModal.tsx
// Edit common fields (vendor, category, project, status) on N selected expenses.

import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';

interface Props {
  ids: string[];
  onClose: () => void;
  onSaved: () => void;
}

const BulkEditModal: React.FC<Props> = ({ ids, onClose, onSaved }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [vendors, setVendors] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [vendorId, setVendorId] = useState<string>('__skip__');
  const [categoryId, setCategoryId] = useState<string>('__skip__');
  const [projectId, setProjectId] = useState<string>('__skip__');
  const [status, setStatus] = useState<string>('__skip__');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!activeCompany) return;
    (async () => {
      const cid = activeCompany.id;
      const [v, c, p] = await Promise.all([
        api.query('vendors', { company_id: cid }),
        api.query('categories', { company_id: cid }),
        api.query('projects', { company_id: cid }),
      ]);
      setVendors(Array.isArray(v) ? v : []);
      setCategories(Array.isArray(c) ? c : []);
      setProjects(Array.isArray(p) ? p : []);
    })();
  }, [activeCompany]);

  const submit = async () => {
    const data: Record<string, any> = {};
    if (vendorId !== '__skip__') data.vendor_id = vendorId || null;
    if (categoryId !== '__skip__') data.category_id = categoryId || '';
    if (projectId !== '__skip__') data.project_id = projectId || null;
    if (status !== '__skip__') data.status = status;
    if (Object.keys(data).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setErr('');
    try {
      await api.batchUpdate('expenses', ids, data);
      onSaved();
    } catch (e: any) {
      setErr(e?.message || 'Bulk update failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div className="block-card" style={{ width: 480, padding: 0 }}>
        <div className="flex items-center justify-between p-4 border-b border-border-primary">
          <h3 className="text-sm font-bold uppercase text-text-primary">Bulk Edit ({ids.length} selected)</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary"><X size={18} /></button>
        </div>
        <div className="p-4 space-y-3">
          {err && <div className="text-xs text-accent-expense">{err}</div>}
          <div>
            <label className="text-xs uppercase font-bold text-text-muted">Vendor</label>
            <select className="block-select w-full mt-1" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              <option value="__skip__">— Don't change —</option>
              <option value="">(clear)</option>
              {vendors.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs uppercase font-bold text-text-muted">Category</label>
            <select className="block-select w-full mt-1" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="__skip__">— Don't change —</option>
              <option value="">(clear)</option>
              {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs uppercase font-bold text-text-muted">Project</label>
            <select className="block-select w-full mt-1" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="__skip__">— Don't change —</option>
              <option value="">(clear)</option>
              {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs uppercase font-bold text-text-muted">Status</label>
            <select className="block-select w-full mt-1" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="__skip__">— Don't change —</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="paid">Paid</option>
            </select>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 p-4 border-t border-border-primary">
          <button onClick={onClose} className="text-xs font-bold uppercase px-3 py-2 border border-border-primary">Cancel</button>
          <button onClick={submit} disabled={saving} className="block-btn-primary text-xs">
            {saving ? 'Saving...' : `Apply to ${ids.length}`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BulkEditModal;
