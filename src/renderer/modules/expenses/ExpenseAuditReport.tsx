import React, { useEffect, useState, useMemo } from 'react';
import { ArrowLeft, ShieldCheck, Download } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { downloadCSVBlob } from '../../lib/csv-export';
import { formatDate } from '../../lib/format';
import { parseJSON } from './expense-helpers';

interface AuditRow {
  id: string;
  entity_id: string;
  action: string;
  changes: string;
  performed_by: string;
  timestamp: string;
}

interface Props {
  onBack: () => void;
}

/**
 * Feature 23 — Audit-trail compliance report.
 * Lists every expense edit / approval / payment row pulled from `audit_log`
 * filtered by entity_type='expenses'. Read-only.
 */
const ExpenseAuditReport: React.FC<Props> = ({ onBack }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany) return;
      try {
        const r = await api.rawQuery(
          `SELECT id, entity_id, action, changes, performed_by, timestamp
           FROM audit_log WHERE company_id = ? AND entity_type = 'expenses'
           ORDER BY timestamp DESC LIMIT 1000`,
          [activeCompany.id]
        );
        if (!cancelled) setRows(Array.isArray(r) ? r : []);
      } catch (err) {
        console.error('Failed to load audit log:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activeCompany]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (actionFilter) {
        const ch = parseJSON<any>(r.changes, {});
        const act = ch?._action || r.action;
        if (act !== actionFilter) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        if (!(r.entity_id?.toLowerCase().includes(q)
          || r.performed_by?.toLowerCase().includes(q)
          || r.changes?.toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }, [rows, search, actionFilter]);

  const handleExport = () => {
    const data = filtered.map(r => {
      const ch = parseJSON<any>(r.changes, {});
      return {
        timestamp: r.timestamp,
        action: ch?._action || r.action,
        expense_id: r.entity_id,
        performed_by: r.performed_by,
        details: typeof r.changes === 'string' ? r.changes : JSON.stringify(r.changes),
      };
    });
    downloadCSVBlob(data, 'expense-audit-log.csv');
  };

  return (
    <div className="space-y-4">
      <div className="module-header">
        <div className="flex items-center gap-3">
          <button className="block-btn flex items-center gap-2 px-3 py-2" onClick={onBack}>
            <ArrowLeft size={16} /> Back
          </button>
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-accent-blue" />
            <h2 className="module-title text-text-primary">Expense Audit Trail</h2>
          </div>
        </div>
        <button onClick={handleExport} className="block-btn flex items-center gap-2 px-3 py-2">
          <Download size={14} /> Export CSV
        </button>
      </div>

      <div className="block-card p-3 flex items-center gap-3">
        <input
          type="text"
          className="block-input flex-1"
          placeholder="Search expense ID, user, or change details..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="block-select"
          style={{ width: 'auto', minWidth: '160px' }}
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
        >
          <option value="">All actions</option>
          <option value="create">Create</option>
          <option value="update">Update</option>
          <option value="delete">Delete</option>
          <option value="export_pdf">Export PDF</option>
          <option value="email_pdf">Email PDF</option>
          <option value="print">Print</option>
        </select>
      </div>

      {loading ? (
        <div className="text-center text-text-muted text-sm py-12">Loading audit trail...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-text-muted text-sm py-12">
          No audit log entries match your filters.
        </div>
      ) : (
        <div className="block-card p-0 overflow-hidden">
          <table className="block-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Action</th>
                <th>Expense ID</th>
                <th>User</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const ch = parseJSON<any>(r.changes, {});
                const act = ch?._action || r.action;
                const detailKeys = Object.keys(ch).filter(k => k !== '_action');
                const detailStr = detailKeys.length > 0
                  ? detailKeys.map(k => `${k}: ${typeof ch[k] === 'object' ? JSON.stringify(ch[k]) : ch[k]}`).join(', ')
                  : '—';
                return (
                  <tr key={r.id}>
                    <td className="font-mono text-xs text-text-secondary">
                      {formatDate(r.timestamp?.slice(0, 10))} {r.timestamp?.slice(11, 19)}
                    </td>
                    <td>
                      <span className="text-xs font-bold uppercase tracking-wider text-accent-blue">{act}</span>
                    </td>
                    <td className="font-mono text-xs">{r.entity_id?.slice(0, 12)}…</td>
                    <td className="text-text-secondary text-xs">{r.performed_by || '—'}</td>
                    <td className="text-xs text-text-muted truncate max-w-[400px]" title={detailStr}>{detailStr}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default ExpenseAuditReport;
