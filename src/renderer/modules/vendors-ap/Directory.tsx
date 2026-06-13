// src/renderer/modules/vendors-ap/Directory.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { Search, Plus, Download } from 'lucide-react';
import api from '../../lib/api';
import { Section, Empty, Th, Td, TOK, gradeColor } from './shared/ui';
import { VENDOR_TYPE, VENDOR_APPROVAL, ClassificationBadge } from '../../lib/classifications';
import VendorForm from '../expenses/VendorForm';

const Directory: React.FC<{ onViewVendor?: (id: string) => void }> = ({ onViewVendor }) => {
  const [vendors, setVendors] = useState<any[]>([]);
  const [scores, setScores] = useState<Record<string, any>>({});
  const [q, setQ] = useState('');
  const [formId, setFormId] = useState<string | null | undefined>(undefined); // undefined=closed, null=new, string=edit
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(() => {
    let cancelled = false;
    const run = (query: string) => {
      const p = query.trim() ? api.vnSearch(query.trim()) : api.vnList();
      p.then((r: any) => { if (!cancelled && Array.isArray(r)) setVendors(r); }).catch(() => {});
    };
    run(q);
    api.vnAllScores().then((r: any) => {
      if (cancelled || !Array.isArray(r)) return;
      const map: Record<string, any> = {};
      for (const s of r) map[s.vendorId || s.id] = s;
      setScores(map);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [q, reloadKey]);

  useEffect(() => load(), [load]);

  const open = (id: string) => { if (id && onViewVendor) onViewVendor(id); };
  const exportCsv = () => {
    api.vnExport().then((rows: any) => {
      if (!Array.isArray(rows) || rows.length === 0) return;
      const headers = Object.keys(rows[0]);
      const csv = [headers.join(','), ...rows.map((row: any) => headers.map(h => JSON.stringify(row[h] ?? '')).join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'vendors.csv';
      a.click();
    }).catch(() => {});
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 flex-1 max-w-md block-input px-2" style={{ borderRadius: 'var(--app-radius)' }}>
          <Search size={14} className="text-text-muted shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vendors by name, email, phone…"
            className="bg-transparent outline-none text-[13px] py-1.5 flex-1 text-text-primary" />
        </div>
        <button className="block-btn text-xs flex items-center gap-1" onClick={exportCsv}><Download size={13} /> Export</button>
        <button className="block-btn block-btn-primary text-xs flex items-center gap-1" onClick={() => setFormId(null)}><Plus size={13} /> New Vendor</button>
      </div>

      <Section title="Vendors" count={vendors.length}>
        {vendors.length === 0 ? <Empty msg={q ? 'No vendors match your search.' : 'No vendors yet. Click “New Vendor” to add one.'} /> : (
          <div style={{ maxHeight: 520, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: `1px solid ${TOK.border}` }}>
                <Th>Vendor</Th><Th>Type</Th><Th>Approval</Th><Th right>Grade</Th><Th>Terms</Th><Th /></tr></thead>
              <tbody>
                {vendors.map((v: any) => {
                  const sc = scores[v.id];
                  return (
                    <tr key={v.id} style={{ borderBottom: `1px solid ${TOK.border}`, cursor: 'pointer' }} onClick={() => open(v.id)}>
                      <Td>{v.name}</Td>
                      <Td><ClassificationBadge def={VENDOR_TYPE} value={v.vendor_type} size="xs" /></Td>
                      <Td><ClassificationBadge def={VENDOR_APPROVAL} value={v.approval_status} size="xs" /></Td>
                      <Td right><span className="font-bold font-mono" style={{ color: sc ? gradeColor(sc.grade) : TOK.muted }}>{sc ? `${sc.grade} · ${sc.score}` : '—'}</span></Td>
                      <Td>{v.payment_terms != null ? `Net ${v.payment_terms}` : '—'}</Td>
                      <Td right>
                        <button className="block-btn text-[10px]" onClick={(e) => { e.stopPropagation(); setFormId(v.id); }}>Edit</button>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {formId !== undefined && (
        <VendorForm
          vendorId={formId ?? undefined}
          onClose={() => setFormId(undefined)}
          onSaved={() => { setFormId(undefined); setReloadKey(k => k + 1); }}
        />
      )}
    </div>
  );
};

export default Directory;
