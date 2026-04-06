import React, { useState } from 'react';
import { FileBarChart, Plus, Play, Download, Save, Trash2 } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';

const AVAILABLE_FIELDS: Record<string, string[]> = {
  invoices: ['invoice_number', 'client_id', 'status', 'issue_date', 'due_date', 'subtotal', 'tax_amount', 'total', 'amount_paid'],
  expenses: ['date', 'description', 'category_id', 'vendor_id', 'amount', 'tax_amount', 'status', 'payment_method', 'is_billable'],
  clients: ['name', 'email', 'phone', 'status', 'payment_terms'],
  time_entries: ['date', 'duration_minutes', 'description', 'is_billable', 'hourly_rate', 'client_id', 'project_id'],
  projects: ['name', 'client_id', 'status', 'budget', 'budget_type', 'hourly_rate', 'start_date', 'end_date'],
  employees: ['name', 'email', 'type', 'pay_type', 'pay_rate', 'pay_schedule', 'status'],
};

const AGGREGATIONS = ['None', 'SUM', 'COUNT', 'AVG', 'MIN', 'MAX'];

interface ReportConfig {
  name: string;
  table: string;
  fields: string[];
  filters: Array<{ field: string; operator: string; value: string }>;
  groupBy: string;
  aggregation: string;
  aggregationField: string;
  sortField: string;
  sortDir: 'asc' | 'desc';
}

const defaultConfig: ReportConfig = {
  name: 'Untitled Report',
  table: 'invoices',
  fields: [],
  filters: [],
  groupBy: '',
  aggregation: 'None',
  aggregationField: '',
  sortField: '',
  sortDir: 'asc',
};

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export default function CustomReportsModule() {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [config, setConfig] = useState<ReportConfig>({ ...defaultConfig });
  const [results, setResults] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const availableFields = AVAILABLE_FIELDS[config.table] || [];

  const toggleField = (field: string) => {
    setConfig((prev) => ({
      ...prev,
      fields: prev.fields.includes(field)
        ? prev.fields.filter((f) => f !== field)
        : [...prev.fields, field],
    }));
  };

  const addFilter = () => {
    setConfig((prev) => ({
      ...prev,
      filters: [...prev.filters, { field: availableFields[0] || '', operator: '=', value: '' }],
    }));
  };

  const removeFilter = (idx: number) => {
    setConfig((prev) => ({
      ...prev,
      filters: prev.filters.filter((_, i) => i !== idx),
    }));
  };

  const updateFilter = (idx: number, key: string, value: string) => {
    setConfig((prev) => ({
      ...prev,
      filters: prev.filters.map((f, i) => (i === idx ? { ...f, [key]: value } : f)),
    }));
  };

  const runReport = async () => {
    setError('');
    // Validate table name is in the allowed list
    if (!(config.table in AVAILABLE_FIELDS)) {
      setError(`Invalid data source: "${config.table}"`);
      return;
    }
    // Validate all selected fields are in the allowed list for this table
    const allowed = AVAILABLE_FIELDS[config.table];
    const invalidFields = config.fields.filter((f) => !allowed.includes(f));
    if (invalidFields.length > 0) {
      setError(`Invalid fields for ${config.table}: ${invalidFields.join(', ')}`);
      return;
    }
    // Validate filter fields, groupBy, and sortField
    const allReferencedFields = [
      ...config.filters.map((f) => f.field),
      config.groupBy,
      config.sortField,
    ].filter(Boolean);
    const invalidRefs = allReferencedFields.filter((f) => !allowed.includes(f));
    if (invalidRefs.length > 0) {
      setError(`Invalid referenced fields: ${invalidRefs.join(', ')}`);
      return;
    }

    if (!activeCompany) return;
    setLoading(true);
    try {
      const selectFields = config.fields.length > 0 ? config.fields.join(', ') : '*';
      let sql = `SELECT ${selectFields} FROM ${config.table}`;

      // Always scope to active company
      const params: any[] = [activeCompany.id];
      const conditions: string[] = ['company_id = ?'];
      config.filters
        .filter((f) => f.value)
        .forEach((f) => {
          params.push(f.value);
          conditions.push(`${f.field} ${f.operator} ?`);
        });
      sql += ` WHERE ${conditions.join(' AND ')}`;

      if (config.groupBy) sql += ` GROUP BY ${config.groupBy}`;
      if (config.sortField) sql += ` ORDER BY ${config.sortField} ${config.sortDir.toUpperCase()}`;
      sql += ' LIMIT 500';

      const data = await api.rawQuery(sql, params);
      setResults(data);
    } catch (err) {
      console.error('Report query failed:', err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const exportCSV = () => {
    if (!results || results.length === 0) return;
    const headers = Object.keys(results[0]);
    const rows = results.map((r) => headers.map((h) => String(r[h] ?? '')).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${config.name.replace(/\s+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="module-header">
        <h1 className="module-title">Report Builder</h1>
        <div className="module-actions">
          <button className="block-btn-primary flex items-center gap-2" onClick={runReport} disabled={loading}>
            <Play size={14} />
            {loading ? 'Running...' : 'Run Report'}
          </button>
          {results && results.length > 0 && (
            <button className="block-btn flex items-center gap-2" onClick={exportCSV}>
              <Download size={14} />
              Export CSV
            </button>
          )}
        </div>
      </div>

      {error && (
        <div
          style={{
            background: 'rgba(248,113,113,0.08)',
            border: '1px solid #ef4444',
            borderRadius: '6px',
            padding: '12px 16px',
            marginBottom: '16px',
          }}
        >
          <p style={{ color: '#ef4444', fontSize: '13px', margin: 0 }}>{error}</p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        {/* Config Panel */}
        <div className="space-y-4">
          <div className="block-card space-y-3">
            <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider">Report Name</h3>
            <input
              className="block-input"
              value={config.name}
              onChange={(e) => setConfig({ ...config, name: e.target.value })}
            />
          </div>

          <div className="block-card space-y-3">
            <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider">Data Source</h3>
            <select
              className="block-select"
              value={config.table}
              onChange={(e) => setConfig({ ...config, table: e.target.value, fields: [], filters: [] })}
            >
              {Object.keys(AVAILABLE_FIELDS).map((t) => (
                <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1).replace('_', ' ')}</option>
              ))}
            </select>
          </div>

          <div className="block-card space-y-3">
            <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider">Fields</h3>
            <div className="flex flex-wrap gap-2">
              {availableFields.map((f) => (
                <button
                  key={f}
                  onClick={() => toggleField(f)}
                  className={`px-2 py-1 text-xs font-medium transition-colors ${
                    config.fields.includes(f)
                      ? 'bg-accent-blue text-white'
                      : 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover border border-border-primary'
                  }`}
                  style={{ borderRadius: '6px' }}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div className="block-card space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider">Filters</h3>
              <button className="text-accent-blue text-xs hover:underline" onClick={addFilter}>+ Add</button>
            </div>
            {config.filters.map((f, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <select className="block-select text-xs" style={{ width: 'auto' }} value={f.field} onChange={(e) => updateFilter(idx, 'field', e.target.value)}>
                  {availableFields.map((af) => <option key={af} value={af}>{af}</option>)}
                </select>
                <select className="block-select text-xs" style={{ width: '60px' }} value={f.operator} onChange={(e) => updateFilter(idx, 'operator', e.target.value)}>
                  <option value="=">=</option>
                  <option value="!=">!=</option>
                  <option value=">">{'>'}</option>
                  <option value="<">{'<'}</option>
                  <option value="LIKE">LIKE</option>
                </select>
                <input className="block-input text-xs" value={f.value} onChange={(e) => updateFilter(idx, 'value', e.target.value)} placeholder="Value" />
                <button onClick={() => removeFilter(idx)} className="text-text-muted hover:text-accent-expense">
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>

          <div className="block-card space-y-3">
            <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider">Sort</h3>
            <div className="flex gap-2">
              <select className="block-select" value={config.sortField} onChange={(e) => setConfig({ ...config, sortField: e.target.value })}>
                <option value="">None</option>
                {availableFields.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <select className="block-select" style={{ width: '80px' }} value={config.sortDir} onChange={(e) => setConfig({ ...config, sortDir: e.target.value as 'asc' | 'desc' })}>
                <option value="asc">ASC</option>
                <option value="desc">DESC</option>
              </select>
            </div>
          </div>
        </div>

        {/* Results Panel */}
        <div className="col-span-2">
          {results === null ? (
            <div className="empty-state">
              <div className="empty-state-icon">
                <FileBarChart size={24} className="text-text-muted" />
              </div>
              <p className="text-text-secondary text-sm">Configure your report and click Run</p>
              <p className="text-text-muted text-xs mt-1">Select fields, add filters, then run to see results</p>
            </div>
          ) : results.length === 0 ? (
            <div className="empty-state">
              <p className="text-text-secondary text-sm">No results found</p>
              <p className="text-text-muted text-xs mt-1">Try adjusting your filters</p>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-text-muted">{results.length} results</span>
              </div>
              <div className="overflow-auto" style={{ maxHeight: '600px' }}>
                <table className="block-table">
                  <thead>
                    <tr>
                      {Object.keys(results[0]).map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((row, i) => (
                      <tr key={i}>
                        {Object.values(row).map((val: any, j) => (
                          <td key={j} className="text-text-secondary text-xs">
                            {typeof val === 'number' && String(Object.keys(row)[j]).match(/amount|total|price|rate|pay|cost|balance|fee|net/)
                              ? fmt.format(val)
                              : String(val ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
