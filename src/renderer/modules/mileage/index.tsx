// src/renderer/modules/mileage/index.tsx
//
// P4.49 — Mileage log module.
//
// IRS-compliant business mileage tracking with auto-deduction
// calculation. Each trip records date, purpose, miles, and
// optionally a project/client. The deduction amount is computed
// using the IRS standard mileage rate for the trip's tax year
// (seeded from mileage_rates table).
//
// Year-summary dashboard shows total miles + deduction for the
// active year — drop into Schedule C / vehicle expenses on
// tax filing.

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Car, Trash2, Save, X } from 'lucide-react';
import api from '../../lib/api';
import { useToast } from '../../components/ToastProvider';
import { parseSmartDate } from '../../lib/smartDate';

interface MileageEntry {
  id?: string;
  trip_date: string;
  purpose: string;
  start_location: string;
  end_location: string;
  miles: number;
  rate_per_mile: number;
  deduction_amount: number;
  vehicle: string;
  project_id?: string | null;
  client_id?: string | null;
  is_billable?: boolean;
  billed_invoice_id?: string | null;
  // Joined on list (rawQuery), not persisted.
  project_name?: string;
  client_name?: string;
  notes: string;
}

interface DropdownOption { id: string; name: string; }

const EMPTY_ENTRY = (today: string): MileageEntry => ({
  trip_date: today,
  purpose: '',
  start_location: '',
  end_location: '',
  miles: 0,
  rate_per_mile: 0,
  deduction_amount: 0,
  vehicle: '',
  project_id: null,
  client_id: null,
  is_billable: false,
  notes: '',
});

const MileageModule: React.FC = () => {
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const currentYear = new Date().getFullYear();

  const [entries, setEntries] = useState<MileageEntry[]>([]);
  const [year, setYear] = useState(currentYear);
  const [summary, setSummary] = useState<{ count: number; totalMiles: number; totalDeduction: number } | null>(null);
  const [currentRate, setCurrentRate] = useState(0.70);
  const [editing, setEditing] = useState<MileageEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<DropdownOption[]>([]);
  const [clients, setClients] = useState<DropdownOption[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Hydrate trips with project/client display names so the table can show
      // them without per-row joins. api.mileageList still returns flat rows;
      // we enrich them client-side from the loaded option lists.
      const [list, s, r, projList, clientList] = await Promise.all([
        api.mileageList({ year }),
        api.mileageSummary(year),
        api.mileageCurrentRate(year),
        api.query('projects', {}),
        api.query('clients', {}),
      ]);
      const projOpts: DropdownOption[] = Array.isArray(projList)
        ? projList.map((p: any) => ({ id: p.id, name: p.name }))
        : [];
      const clientOpts: DropdownOption[] = Array.isArray(clientList)
        ? clientList.map((c: any) => ({ id: c.id, name: c.name }))
        : [];
      setProjects(projOpts);
      setClients(clientOpts);
      const projMap = new Map(projOpts.map(p => [p.id, p.name]));
      const clientMap = new Map(clientOpts.map(c => [c.id, c.name]));
      if (Array.isArray(list)) {
        setEntries((list as MileageEntry[]).map(e => ({
          ...e,
          project_name: e.project_id ? projMap.get(e.project_id) : undefined,
          client_name: e.client_id ? clientMap.get(e.client_id) : undefined,
        })));
      }
      if (!s.error) setSummary(s);
      if (!r.error) setCurrentRate(r.business_rate);
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.trip_date || !editing.miles || editing.miles <= 0) {
      toast.warning('Trip date and miles are required');
      return;
    }
    // Smart date parsing on save (allows "today", "+3d", etc.).
    const resolvedDate = parseSmartDate(editing.trip_date) || editing.trip_date;
    const r = await api.mileageSave({ ...editing, trip_date: resolvedDate });
    if (r?.error) {
      toast.error('Save failed: ' + r.error);
      return;
    }
    toast.success('Trip saved · deduction $' + (r.deduction_amount || 0).toFixed(2));
    setEditing(null);
    await load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this trip? This cannot be undone.')) return;
    const r = await api.mileageDelete(id);
    if (r?.error) toast.error(r.error);
    else { toast.success('Trip deleted'); await load(); }
  };

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Car size={22} /> Mileage Log
        </h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <select
            className="block-input"
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value))}
            style={{ width: 100 }}
          >
            {[currentYear - 2, currentYear - 1, currentYear].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button
            className="block-btn-primary flex items-center gap-2"
            onClick={() => setEditing(EMPTY_ENTRY(today))}
          >
            <Plus size={14} /> Log Trip
          </button>
        </div>
      </div>

      {/* YTD summary */}
      <div className="block-card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          <Stat label="Trips" value={summary?.count?.toString() ?? '0'} />
          <Stat label="Total Miles" value={(summary?.totalMiles ?? 0).toFixed(1)} />
          <Stat label="IRS Rate ($/mi)" value={'$' + currentRate.toFixed(3)} />
          <Stat label="Total Deduction" value={'$' + (summary?.totalDeduction ?? 0).toFixed(2)} highlight />
        </div>
      </div>

      {/* List */}
      <div className="block-card" style={{ padding: 0 }}>
        {loading && <div style={{ padding: 20, color: 'var(--color-text-muted)' }}>Loading…</div>}
        {!loading && entries.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)' }}>
            <Car size={32} style={{ margin: '0 auto 8px', opacity: 0.5 }} />
            <div style={{ fontSize: 13, fontWeight: 600 }}>No trips logged in {year}</div>
            <div style={{ fontSize: 11, marginTop: 4 }}>Click "Log Trip" to record one.</div>
          </div>
        )}
        {!loading && entries.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border-primary)' }}>
                {['Date', 'Purpose', 'From → To', 'Project / Client', 'Miles', 'Rate', 'Deduction', 'Bill', ''].map((h, i) => (
                  <th key={h} style={{ padding: '8px 12px', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 800, color: 'var(--color-text-muted)', textAlign: i >= 4 && i <= 6 ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                  <td style={{ padding: '8px 12px', fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace' }}>{e.trip_date}</td>
                  <td style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600 }}>{e.purpose || '—'}</td>
                  <td style={{ padding: '8px 12px', fontSize: 11, color: 'var(--color-text-muted)' }}>
                    {e.start_location || '—'}{e.end_location ? ' → ' + e.end_location : ''}
                  </td>
                  <td style={{ padding: '8px 12px', fontSize: 11 }}>
                    {(e.project_name || e.client_name)
                      ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          {e.project_name && <span style={{ color: 'var(--color-text-primary)' }}>{e.project_name}</span>}
                          {e.client_name && <span style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>{e.client_name}</span>}
                        </div>
                      )
                      : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
                  </td>
                  <td style={{ padding: '8px 12px', fontSize: 12, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace' }}>{e.miles.toFixed(1)}</td>
                  <td style={{ padding: '8px 12px', fontSize: 11, textAlign: 'right', color: 'var(--color-text-muted)' }}>${e.rate_per_mile.toFixed(3)}</td>
                  <td style={{ padding: '8px 12px', fontSize: 12, textAlign: 'right', fontWeight: 700, fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-positive)' }}>${e.deduction_amount.toFixed(2)}</td>
                  <td style={{ padding: '8px 12px', fontSize: 11, textAlign: 'center' }}>
                    {e.billed_invoice_id
                      ? <span title="Already invoiced" style={{ color: 'var(--color-positive)', fontSize: 10 }}>✓ inv.</span>
                      : e.is_billable
                        ? <span title="Marked billable" style={{ color: 'var(--color-accent-blue)' }}>✓</span>
                        : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                    <button
                      onClick={() => setEditing(e)}
                      className="block-btn text-xs"
                      style={{ marginRight: 4 }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => e.id && handleDelete(e.id)}
                      className="block-btn text-xs"
                      style={{ color: 'var(--color-accent-expense)', borderColor: 'var(--color-accent-expense)' }}
                    >
                      <Trash2 size={11} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Edit modal */}
      {editing && (
        <div
          onClick={() => setEditing(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-primary)', borderRadius: 8, maxWidth: 600, width: '100%', padding: 24 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700 }}>{editing.id ? 'Edit Trip' : 'Log Trip'}</h3>
              <button onClick={() => setEditing(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Trip Date">
                <input
                  className="block-input"
                  value={editing.trip_date}
                  onChange={(ev) => setEditing({ ...editing, trip_date: ev.target.value })}
                  placeholder="YYYY-MM-DD or 'today', '-3d', etc."
                />
              </Field>
              <Field label="Vehicle">
                <input
                  className="block-input"
                  value={editing.vehicle}
                  onChange={(ev) => setEditing({ ...editing, vehicle: ev.target.value })}
                  placeholder="2024 Tesla Model Y"
                />
              </Field>
              <div style={{ gridColumn: 'span 2' }}>
                <Field label="Purpose">
                  <input
                    className="block-input"
                    value={editing.purpose}
                    onChange={(ev) => setEditing({ ...editing, purpose: ev.target.value })}
                    placeholder="Client meeting · job site visit · supply pickup"
                  />
                </Field>
              </div>
              <Field label="From">
                <input
                  className="block-input"
                  value={editing.start_location}
                  onChange={(ev) => setEditing({ ...editing, start_location: ev.target.value })}
                  placeholder="Home"
                />
              </Field>
              <Field label="To">
                <input
                  className="block-input"
                  value={editing.end_location}
                  onChange={(ev) => setEditing({ ...editing, end_location: ev.target.value })}
                  placeholder="Client office"
                />
              </Field>
              <Field label="Miles">
                <input
                  type="number"
                  step="0.1"
                  className="block-input"
                  value={editing.miles || ''}
                  onChange={(ev) => setEditing({ ...editing, miles: parseFloat(ev.target.value) || 0 })}
                />
              </Field>
              <Field label="Rate/mile (auto-filled)">
                <input
                  type="number"
                  step="0.001"
                  className="block-input"
                  value={editing.rate_per_mile || ''}
                  onChange={(ev) => setEditing({ ...editing, rate_per_mile: parseFloat(ev.target.value) || 0 })}
                  placeholder={'Default ' + currentRate.toFixed(3)}
                />
              </Field>
              {/* Project / Client linkage — drives billable mileage into the
                  same invoice prefill pipeline used by billable expenses. */}
              <Field label="Project (optional)">
                <select
                  className="block-input"
                  value={editing.project_id || ''}
                  onChange={(ev) => setEditing({ ...editing, project_id: ev.target.value || null })}
                >
                  <option value="">— None —</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Client (optional)">
                <select
                  className="block-input"
                  value={editing.client_id || ''}
                  onChange={(ev) => setEditing({ ...editing, client_id: ev.target.value || null })}
                >
                  <option value="">— None —</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <div style={{ gridColumn: 'span 2' }}>
                <label
                  className="flex items-center gap-2 text-xs"
                  title={editing.billed_invoice_id
                    ? 'Already invoiced — uncheck not available'
                    : !editing.client_id
                      ? 'Pick a Client first to make this trip billable'
                      : 'Bill this trip on the next invoice for the selected client'}
                  style={{ cursor: editing.billed_invoice_id || !editing.client_id ? 'not-allowed' : 'pointer' }}
                >
                  <input
                    type="checkbox"
                    checked={!!editing.is_billable}
                    disabled={!!editing.billed_invoice_id || !editing.client_id}
                    onChange={(ev) => setEditing({ ...editing, is_billable: ev.target.checked })}
                  />
                  <span style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                    Bill to client
                  </span>
                  {editing.billed_invoice_id && (
                    <span style={{ color: 'var(--color-positive)', fontSize: 10 }}>· invoiced</span>
                  )}
                </label>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <Field label="Notes">
                  <textarea
                    className="block-input"
                    rows={2}
                    value={editing.notes}
                    onChange={(ev) => setEditing({ ...editing, notes: ev.target.value })}
                  />
                </Field>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                Estimated deduction: <strong style={{ color: 'var(--color-positive)' }}>${(editing.miles * (editing.rate_per_mile || currentRate)).toFixed(2)}</strong>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setEditing(null)} className="block-btn">Cancel</button>
                <button onClick={handleSave} className="block-btn-primary flex items-center gap-2">
                  <Save size={14} /> Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; highlight?: boolean }> = ({ label, value, highlight }) => (
  <div>
    <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)', marginBottom: 4 }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'SF Mono, Menlo, monospace', color: highlight ? 'var(--color-positive)' : 'var(--color-text-primary)' }}>{value}</div>
  </div>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--color-text-muted)' }}>{label}</span>
    {children}
  </div>
);

export default MileageModule;
