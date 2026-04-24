import React, { useState, useCallback } from 'react';
import {
  Upload, Download, FileSpreadsheet, Database,
  CheckCircle, AlertTriangle, ArrowRight, X, Archive,
} from 'lucide-react';
import api from '../../lib/api';

// ─── Constants ──────────────────────────────────────────
const IMPORTABLE_TABLES: { value: string; label: string; columns: string[] }[] = [
  {
    value: 'clients',
    label: 'Clients',
    columns: ['name', 'email', 'phone', 'address_line1', 'city', 'state', 'zip', 'country', 'type', 'status', 'payment_terms', 'tax_id', 'notes'],
  },
  {
    value: 'expenses',
    label: 'Expenses',
    columns: ['date', 'amount', 'description', 'reference', 'status', 'payment_method', 'tax_amount', 'is_billable'],
  },
  {
    value: 'invoices',
    label: 'Invoices',
    columns: ['invoice_number', 'client_id', 'issue_date', 'due_date', 'subtotal', 'tax_amount', 'discount_amount', 'total', 'amount_paid', 'status', 'notes', 'terms'],
  },
  {
    value: 'accounts',
    label: 'Chart of Accounts',
    columns: ['code', 'name', 'type', 'subtype', 'description', 'is_active'],
  },
  {
    value: 'vendors',
    label: 'Vendors',
    columns: ['name', 'email', 'phone', 'address', 'tax_id', 'payment_terms', 'notes', 'status'],
  },
];

const EXPORTABLE_TABLES = [
  { value: 'clients', label: 'Clients' },
  { value: 'invoices', label: 'Invoices' },
  { value: 'expenses', label: 'Expenses' },
  { value: 'accounts', label: 'Chart of Accounts' },
  { value: 'vendors', label: 'Vendors' },
  { value: 'projects', label: 'Projects' },
  { value: 'employees', label: 'Employees' },
  { value: 'time_entries', label: 'Time Entries' },
  { value: 'journal_entries', label: 'Journal Entries' },
  { value: 'categories', label: 'Categories' },
  { value: 'payments', label: 'Payments' },
];

// ─── Import Section ─────────────────────────────────────
const ImportSection: React.FC = () => {
  const [preview, setPreview] = useState<{
    filePath: string;
    fileName: string;
    headers: string[];
    previewRows: string[][];
    totalRows: number;
  } | null>(null);
  const [targetTable, setTargetTable] = useState('clients');
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    imported: number;
    skipped: number;
    errors: string[];
    total: number;
  } | null>(null);

  const handleSelectFile = useCallback(async () => {
    setResult(null);
    const data = await api.importPreviewCSV();
    if (!data) return;
    setPreview(data);

    // Auto-map columns where CSV header matches a DB column
    const tableConfig = IMPORTABLE_TABLES.find(t => t.value === targetTable);
    const autoMap: Record<string, string> = {};
    if (tableConfig) {
      for (const csvHeader of data.headers) {
        const normalized = csvHeader.toLowerCase().replace(/\s+/g, '_');
        const match = tableConfig.columns.find(
          col => col === normalized || col.replace(/_/g, '') === normalized.replace(/_/g, '')
        );
        autoMap[csvHeader] = match || '(skip)';
      }
    }
    setColumnMapping(autoMap);
  }, [targetTable]);

  const handleMappingChange = useCallback((csvCol: string, dbCol: string) => {
    setColumnMapping(prev => ({ ...prev, [csvCol]: dbCol }));
  }, []);

  const handleImport = useCallback(async () => {
    if (!preview) return;
    setImporting(true);
    setResult(null);
    try {
      const res = await api.importExecute(preview.filePath, columnMapping, targetTable);
      setResult(res);
    } catch (err: any) {
      setResult({ imported: 0, skipped: 0, errors: [err.message || 'Import failed'], total: 0 });
    } finally {
      setImporting(false);
    }
  }, [preview, columnMapping, targetTable]);

  const tableConfig = IMPORTABLE_TABLES.find(t => t.value === targetTable);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div
          className="w-8 h-8 flex items-center justify-center bg-bg-tertiary border border-border-primary shrink-0"
          style={{ borderRadius: '6px' }}
        >
          <Upload size={16} className="text-accent-blue" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-text-primary">Import Data</h3>
          <p className="text-xs text-text-muted mt-0.5">Import CSV files into your database</p>
        </div>
      </div>

      <div className="border-t border-border-primary pt-4 space-y-4">
        {/* Step 1: Select table + file */}
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="block text-xs text-text-muted mb-1">Target Table</label>
            <select
              className="block-select"
              value={targetTable}
              onChange={(e) => {
                setTargetTable(e.target.value);
                setPreview(null);
                setResult(null);
                setColumnMapping({});
              }}
            >
              {IMPORTABLE_TABLES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-xs text-text-muted mb-1">CSV File</label>
            <button
              className="block-btn flex items-center gap-1.5 w-full justify-center"
              onClick={handleSelectFile}
            >
              <FileSpreadsheet size={14} />
              {preview ? preview.fileName : 'Select CSV File...'}
            </button>
          </div>
        </div>

        {/* Step 2: Preview Table */}
        {preview && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">
                Preview: {preview.totalRows} row{preview.totalRows !== 1 ? 's' : ''} found
              </span>
              <button
                className="text-xs text-text-muted hover:text-text-primary flex items-center gap-1 transition-colors"
                onClick={() => { setPreview(null); setResult(null); setColumnMapping({}); }}
              >
                <X size={12} />
                Clear
              </button>
            </div>

            <div className="block-card p-0 overflow-auto" style={{ maxHeight: '200px' }}>
              <table className="block-table text-xs">
                <thead>
                  <tr>
                    {preview.headers.map((h, i) => (
                      <th key={i} className="text-[10px] whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.previewRows.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => (
                        <td key={ci} className="text-[11px] max-w-[150px] truncate">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Step 3: Column Mapping */}
            <div>
              <h4 className="text-xs font-semibold text-text-primary mb-2">Column Mapping</h4>
              <div className="grid grid-cols-2 gap-2">
                {preview.headers.map((csvCol) => (
                  <div key={csvCol} className="flex items-center gap-2">
                    <span className="text-xs text-text-secondary font-mono flex-1 truncate" title={csvCol}>
                      {csvCol}
                    </span>
                    <ArrowRight size={12} className="text-text-muted shrink-0" />
                    <select
                      className="block-select text-xs flex-1"
                      value={columnMapping[csvCol] || '(skip)'}
                      onChange={(e) => handleMappingChange(csvCol, e.target.value)}
                    >
                      <option value="(skip)">(skip)</option>
                      {tableConfig?.columns.map(col => (
                        <option key={col} value={col}>{col}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* Step 4: Import Button */}
            <div className="flex items-center justify-between">
              <div>
                {result && (
                  <div className="flex items-center gap-2 text-xs">
                    {result.imported > 0 && (
                      <span className="flex items-center gap-1 text-accent-income font-semibold">
                        <CheckCircle size={12} />
                        {result.imported} imported
                      </span>
                    )}
                    {result.skipped > 0 && (
                      <span className="flex items-center gap-1 text-accent-warning font-semibold">
                        <AlertTriangle size={12} />
                        {result.skipped} skipped
                      </span>
                    )}
                  </div>
                )}
                {result && result.errors.length > 0 && (
                  <div className="mt-2 text-[11px] text-accent-expense max-h-[60px] overflow-y-auto">
                    {result.errors.map((err, i) => (
                      <div key={i}>{err}</div>
                    ))}
                  </div>
                )}
              </div>
              <button
                className="block-btn-primary flex items-center gap-1.5"
                onClick={handleImport}
                disabled={importing || !preview}
              >
                <Upload size={14} />
                {importing ? 'Importing...' : `Import ${preview.totalRows} Rows`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Export Section ──────────────────────────────────────
const ExportSection: React.FC = () => {
  const [exportTable, setExportTable] = useState('clients');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState('');
  const [backupMsg, setBackupMsg] = useState('');
  const [backupLoading, setBackupLoading] = useState(false);

  const handleExport = useCallback(async () => {
    // Validate date range before hitting main.
    if (dateFrom && dateTo && dateFrom > dateTo) {
      setExportMsg('“Date From” must be on or before “Date To”.');
      setTimeout(() => setExportMsg(''), 5000);
      return;
    }
    setExporting(true);
    setExportMsg('Preparing export…');
    try {
      const filters: Record<string, any> = {};
      if (dateFrom) filters.created_at_gte = dateFrom;
      // Make the "to" bound inclusive of the entire end day.
      if (dateTo) filters.created_at_lte = `${dateTo} 23:59:59`;
      const result = await api.exportCsv(
        exportTable,
        Object.keys(filters).length > 0 ? filters : undefined
      );
      if (result?.path) {
        setExportMsg(`Exported to ${result.path}`);
      } else if (result?.error) {
        setExportMsg(`Export failed: ${result.error}`);
      } else if (result?.cancelled) {
        setExportMsg('Export cancelled');
      } else {
        setExportMsg('Export completed.');
      }
    } catch (err: any) {
      // Surface permission / disk-full errors clearly.
      const msg = err?.message || 'Export failed';
      setExportMsg(/permission|EACCES|EPERM/i.test(msg)
        ? `Export failed — write permission denied. Try a different folder. (${msg})`
        : msg);
    } finally {
      setExporting(false);
      setTimeout(() => setExportMsg(''), 8000);
    }
  }, [exportTable, dateFrom, dateTo]);

  const handleFullBackup = useCallback(async () => {
    setBackupLoading(true);
    setBackupMsg('Creating backup — this may take a moment…');
    try {
      const result = await api.exportFullBackup();
      if (result?.path) {
        setBackupMsg(
          `Backup saved: ${result.path} (${result.tableCount ?? '?'} tables, ${result.rowCount ?? '?'} rows)`
        );
      } else if (result?.error) {
        setBackupMsg(`Backup failed: ${result.error}`);
      } else if (result?.cancelled) {
        setBackupMsg('Backup cancelled');
      } else {
        setBackupMsg('Backup completed.');
      }
    } catch (err: any) {
      const msg = err?.message || 'Backup failed';
      setBackupMsg(/permission|EACCES|EPERM|ENOSPC/i.test(msg)
        ? `Backup failed — check disk space / write permissions. (${msg})`
        : msg);
    } finally {
      setBackupLoading(false);
      setTimeout(() => setBackupMsg(''), 10000);
    }
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div
          className="w-8 h-8 flex items-center justify-center bg-bg-tertiary border border-border-primary shrink-0"
          style={{ borderRadius: '6px' }}
        >
          <Download size={16} className="text-accent-blue" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-text-primary">Export Data</h3>
          <p className="text-xs text-text-muted mt-0.5">Export tables as CSV files or create a full backup</p>
        </div>
      </div>

      <div className="border-t border-border-primary pt-4 space-y-4">
        {/* Single table export */}
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs text-text-muted mb-1">Table</label>
            <select
              className="block-select"
              value={exportTable}
              onChange={(e) => setExportTable(e.target.value)}
            >
              {EXPORTABLE_TABLES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Date From</label>
            <input
              type="date"
              className="block-input"
              style={{ width: 'auto' }}
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Date To</label>
            <input
              type="date"
              className="block-input"
              style={{ width: 'auto' }}
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <button
            className="block-btn-primary flex items-center gap-1.5"
            onClick={handleExport}
            disabled={exporting}
          >
            <Download size={14} />
            {exporting ? 'Exporting...' : 'Export'}
          </button>
        </div>

        {exportMsg && (
          <p className="text-xs text-text-muted">{exportMsg}</p>
        )}

        {/* Full backup */}
        <div className="border-t border-border-primary pt-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-xs font-semibold text-text-primary">Full Backup</h4>
              <p className="text-[11px] text-text-muted mt-0.5">
                Export every table as CSV files bundled in a ZIP archive
              </p>
            </div>
            <button
              className="block-btn-success flex items-center gap-1.5"
              onClick={handleFullBackup}
              disabled={backupLoading}
              style={{ background: 'var(--color-accent-income)', color: '#fff', border: 'none', borderRadius: '6px', padding: '6px 14px', fontWeight: 600, cursor: 'pointer' }}
            >
              <Archive size={14} />
              {backupLoading ? 'Creating Backup...' : 'Export All Data'}
            </button>
          </div>
          {backupMsg && (
            <p className="text-xs text-text-muted mt-2">{backupMsg}</p>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Main Component ─────────────────────────────────────
const ImportExport: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="block-card space-y-4">
        <ImportSection />
      </div>
      <div className="block-card space-y-4">
        <ExportSection />
      </div>
    </div>
  );
};

export default ImportExport;
