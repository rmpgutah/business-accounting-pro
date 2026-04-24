import React, { useEffect, useState, useCallback } from 'react';
import { Upload, FileText, Check, AlertTriangle, Trash2 } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatDate } from '../../lib/format';

// ─── Types ──────────────────────────────────────────────
interface BankAccount {
  id: string;
  name: string;
  institution: string;
}

interface ParsedRow {
  date: string;
  description: string;
  amount: number;
  selected: boolean;
}

// ─── Currency Formatter ─────────────────────────────────
const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// ─── CSV Parser ─────────────────────────────────────────
function parseCSV(text: string): ParsedRow[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];

  // Parse header to find column indices
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/"/g, ''));
  const dateIdx = header.findIndex(
    (h) => h === 'date' || h === 'transaction date' || h === 'posted date'
  );
  const descIdx = header.findIndex(
    (h) =>
      h === 'description' ||
      h === 'memo' ||
      h === 'payee' ||
      h === 'name' ||
      h === 'transaction'
  );
  const amtIdx = header.findIndex(
    (h) => h === 'amount' || h === 'total' || h === 'value'
  );

  // Fallback: assume Date, Description, Amount order
  const di = dateIdx >= 0 ? dateIdx : 0;
  const dsi = descIdx >= 0 ? descIdx : 1;
  const ai = amtIdx >= 0 ? amtIdx : 2;

  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Simple CSV split (handles quoted fields)
    const cols: string[] = [];
    let current = '';
    let inQuote = false;
    for (const ch of line) {
      if (ch === '"') {
        inQuote = !inQuote;
      } else if (ch === ',' && !inQuote) {
        cols.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    cols.push(current.trim());

    const date = cols[di] || '';
    const description = cols[dsi] || '';
    const amount = parseFloat((cols[ai] || '0').replace(/[^0-9.\-]/g, '')) || 0;

    if (date || description) {
      rows.push({ date, description, amount, selected: true });
    }
  }

  return rows;
}

// ─── Component ──────────────────────────────────────────
const ImportTransactions: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [selectedBankId, setSelectedBankId] = useState('');
  const [csvPath, setCsvPath] = useState('');
  const [csvContent, setCsvContent] = useState('');
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    success: boolean;
    count: number;
  } | null>(null);
  const [parseError, setParseError] = useState('');

  useEffect(() => {
    if (!activeCompany) return;
    const loadAccounts = async () => {
      try {
        const data = await api.query('bank_accounts', {
          company_id: activeCompany.id,
        });
        setBankAccounts(Array.isArray(data) ? data : []);
      } catch {
        setBankAccounts([]);
      }
    };
    loadAccounts();
  }, [activeCompany]);

  const handleParse = useCallback(() => {
    setParseError('');
    setImportResult(null);

    if (!csvContent.trim()) {
      setParseError('Please paste CSV content or enter a file path.');
      return;
    }

    const rows = parseCSV(csvContent);
    if (rows.length === 0) {
      setParseError(
        'No transactions found. Ensure CSV has headers (Date, Description, Amount) and at least one data row.'
      );
      return;
    }

    setParsedRows(rows);
  }, [csvContent]);

  const toggleRow = (idx: number) => {
    setParsedRows((prev) =>
      prev.map((r, i) =>
        i === idx ? { ...r, selected: !r.selected } : r
      )
    );
  };

  const toggleAll = () => {
    const allSelected = parsedRows.every((r) => r.selected);
    setParsedRows((prev) =>
      prev.map((r) => ({ ...r, selected: !allSelected }))
    );
  };

  const selectedCount = parsedRows.filter((r) => r.selected).length;

  const handleImport = async () => {
    if (!selectedBankId) {
      setParseError('Please select a bank account.');
      return;
    }

    const toImport = parsedRows.filter((r) => r.selected);
    if (toImport.length === 0) {
      setParseError('No transactions selected for import.');
      return;
    }

    setImporting(true);
    setParseError('');

    try {
      let imported = 0;
      for (const row of toImport) {
        // Bug fix #10: add type (debit/credit) derived from amount sign and
        // set is_matched default so bank reconciliation queries work correctly.
        await api.create('bank_transactions', {
          bank_account_id: selectedBankId,
          date: row.date,
          description: row.description,
          amount: row.amount,
          type: row.amount >= 0 ? 'credit' : 'debit',
          status: 'pending',
          is_matched: 0,
        });
        imported++;
      }

      setImportResult({ success: true, count: imported });
      setParsedRows([]);
      setCsvContent('');
    } catch (err: any) {
      setParseError(err?.message || 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  const clearPreview = () => {
    setParsedRows([]);
    setCsvContent('');
    setImportResult(null);
    setParseError('');
  };

  return (
    <div className="space-y-4">
      {/* Bank Account Selector */}
      <div
        className="block-card p-4"
        style={{ borderRadius: '6px' }}
      >
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <label className="block text-xs text-text-muted font-semibold uppercase tracking-wider mb-1">
              Bank Account
            </label>
            <select
              className="block-select w-full"
              value={selectedBankId}
              onChange={(e) => setSelectedBankId(e.target.value)}
            >
              <option value="">-- Select bank account --</option>
              {bankAccounts.map((ba) => (
                <option key={ba.id} value={ba.id}>
                  {ba.name}
                  {ba.institution ? ` (${ba.institution})` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* CSV Input */}
      <div
        className="block-card p-4 space-y-3"
        style={{ borderRadius: '6px' }}
      >
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-text-muted" />
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            Import CSV
          </h3>
        </div>

        <div>
          <label className="block text-xs text-text-muted mb-1">
            CSV File Path (optional reference)
          </label>
          <input
            type="text"
            className="block-input w-full"
            placeholder="/path/to/bank-statement.csv"
            value={csvPath}
            onChange={(e) => setCsvPath(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-xs text-text-muted mb-1">
            Paste CSV Content
          </label>
          <textarea
            className="block-input w-full font-mono text-xs"
            rows={8}
            placeholder={`Date,Description,Amount\n2024-01-15,Office Supplies,-45.99\n2024-01-16,Client Payment,1500.00`}
            value={csvContent}
            onChange={(e) => setCsvContent(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleParse}
            disabled={!csvContent.trim()}
            className="block-btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
            style={{ borderRadius: '6px' }}
          >
            <Upload size={14} />
            Parse CSV
          </button>
          {parsedRows.length > 0 && (
            <button
              onClick={clearPreview}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-text-muted hover:text-text-primary bg-bg-tertiary hover:bg-bg-hover transition-colors"
              style={{ borderRadius: '6px' }}
            >
              <Trash2 size={14} />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Errors / Success */}
      {parseError && (
        <div
          className="flex items-center gap-2 px-4 py-2 text-xs text-accent-expense bg-accent-expense/10 border border-accent-expense/20"
          style={{ borderRadius: '6px' }}
        >
          <AlertTriangle size={14} />
          {parseError}
        </div>
      )}

      {importResult && importResult.success && (
        <div
          className="flex items-center gap-2 px-4 py-2 text-xs text-accent-income bg-accent-income/10 border border-accent-income/20"
          style={{ borderRadius: '6px' }}
        >
          <Check size={14} />
          Successfully imported {importResult.count} transaction
          {importResult.count !== 1 ? 's' : ''}.
        </div>
      )}

      {/* Preview Table */}
      {parsedRows.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-text-muted">
              {selectedCount} of {parsedRows.length} transactions selected
            </p>
            <button
              onClick={handleImport}
              disabled={importing || selectedCount === 0 || !selectedBankId}
              className="block-btn-primary flex items-center gap-1.5 px-4 py-2 text-xs font-semibold disabled:opacity-40"
              style={{ borderRadius: '6px' }}
            >
              <Check size={14} />
              {importing
                ? 'Importing...'
                : `Import ${selectedCount} Transaction${selectedCount !== 1 ? 's' : ''}`}
            </button>
          </div>

          <div
            className="block-card p-0 overflow-hidden"
            style={{ borderRadius: '6px' }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-bg-tertiary border-b border-border-primary">
                  <th className="text-center px-3 py-2 w-10">
                    <input
                      type="checkbox"
                      checked={parsedRows.every((r) => r.selected)}
                      onChange={toggleAll}
                      className="accent-accent-blue"
                    />
                  </th>
                  <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                    Date
                  </th>
                  <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                    Description
                  </th>
                  <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {parsedRows.map((row, i) => (
                  <tr
                    key={i}
                    className={`border-b border-border-primary/50 transition-colors ${
                      row.selected
                        ? 'hover:bg-bg-hover/30'
                        : 'opacity-40'
                    }`}
                  >
                    <td className="text-center px-3 py-2">
                      <input
                        type="checkbox"
                        checked={row.selected}
                        onChange={() => toggleRow(i)}
                        className="accent-accent-blue"
                      />
                    </td>
                    <td className="px-4 py-2 text-xs font-mono text-text-secondary">
                      {formatDate(row.date)}
                    </td>
                    <td className="px-4 py-2 text-xs text-text-primary">
                      {row.description}
                    </td>
                    <td
                      className={`px-4 py-2 text-right font-mono text-xs ${
                        row.amount >= 0
                          ? 'text-accent-income'
                          : 'text-accent-expense'
                      }`}
                    >
                      {fmt.format(row.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImportTransactions;
