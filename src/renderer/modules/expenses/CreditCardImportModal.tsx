// CreditCardImportModal.tsx
// Parses Chase / AmEx (and generic) CSV exports, lets user map columns,
// previews, and inserts as draft (status=pending) expenses.

import React, { useEffect, useState } from 'react';
import { X, Upload, CheckCircle } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency } from '../../lib/format';
import { useModalBehavior, trapFocusOnKeyDown } from '../../lib/use-modal-behavior';

interface Props {
  onClose: () => void;
  onDone: () => void;
}

type Mapping = { date: string; description: string; amount: string; reference?: string; };

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const split = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { q = !q; continue; }
      if (ch === ',' && !q) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const headers = split(lines[0]);
  const rows = lines.slice(1).map(split);
  return { headers, rows };
}

function autoMap(headers: string[]): Mapping {
  const find = (...keys: string[]) => headers.find((h) => keys.some((k) => h.toLowerCase().includes(k))) || '';
  return {
    date: find('date'),
    description: find('description', 'merchant', 'payee', 'memo'),
    amount: find('amount', 'debit', 'charge'),
    reference: find('reference', 'transaction id', 'card'),
  };
}

const CreditCardImportModal: React.FC<Props> = ({ onClose, onDone }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Mapping>({ date: '', description: '', amount: '' });
  const [filename, setFilename] = useState('');
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState<{ count: number } | null>(null);

  const handleFile = async (file: File) => {
    setFilename(file.name);
    const text = await file.text();
    const { headers, rows } = parseCsv(text);
    setHeaders(headers);
    setRows(rows);
    setMapping(autoMap(headers));
  };

  const colIdx = (name: string) => headers.indexOf(name);
  const previewRows = rows.slice(0, 8).map((r) => ({
    date: r[colIdx(mapping.date)] || '',
    description: r[colIdx(mapping.description)] || '',
    amount: r[colIdx(mapping.amount)] || '',
    reference: mapping.reference ? r[colIdx(mapping.reference)] : '',
  }));

  const normDate = (s: string) => {
    const d = new Date(s);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  };
  const normAmount = (s: string) => {
    const n = Math.abs(Number((s || '').replace(/[^0-9.\-]/g, '')));
    return Number.isFinite(n) ? n : 0;
  };

  const runImport = async () => {
    if (!activeCompany) return;
    setImporting(true);
    let count = 0;
    try {
      for (const r of rows) {
        const date = normDate(r[colIdx(mapping.date)] || '');
        const amount = normAmount(r[colIdx(mapping.amount)] || '');
        const description = r[colIdx(mapping.description)] || '(imported)';
        const reference = mapping.reference ? (r[colIdx(mapping.reference)] || '') : '';
        if (!date || amount <= 0) continue;
        await api.create('expenses', {
          company_id: activeCompany.id,
          date, amount, description, reference,
          status: 'pending',
          payment_method: 'credit_card',
        });
        count++;
      }
      setDone({ count });
    } catch (e: any) {
      alert(e?.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  // A11Y: ESC close, body scroll lock, focus trap, role=dialog, restore focus
  const { containerRef } = useModalBehavior({ onClose });
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cc-import-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={trapFocusOnKeyDown(containerRef)}
        className="block-card"
        style={{ width: 720, maxHeight: '90vh', overflow: 'auto', padding: 0 }}
      >
        <div className="flex items-center justify-between p-4 border-b border-border-primary">
          <h3 id="cc-import-title" className="text-sm font-bold uppercase text-text-primary">Credit Card Import (CSV)</h3>
          <button onClick={onClose} aria-label="Close credit card import" className="text-text-muted hover:text-text-primary"><X size={18} /></button>
        </div>

        {!done ? (
          <div className="p-4 space-y-4">
            {headers.length === 0 ? (
              <div>
                <p className="text-xs text-text-muted mb-2">Supports Chase, AmEx, and most CSV exports. Pick a file to begin.</p>
                <label className="block-btn-primary inline-flex items-center gap-2 cursor-pointer text-xs">
                  <Upload size={13} /> Choose CSV
                  <input type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files && handleFile(e.target.files[0])} />
                </label>
              </div>
            ) : (
              <>
                <div className="text-xs text-text-muted">{filename} &middot; {rows.length} rows</div>
                <div className="grid grid-cols-2 gap-3">
                  {(['date', 'description', 'amount', 'reference'] as const).map((field) => (
                    <div key={field}>
                      <label className="text-xs uppercase font-bold text-text-muted">{field}</label>
                      <select
                        className="block-select w-full mt-1"
                        value={mapping[field] || ''}
                        onChange={(e) => setMapping({ ...mapping, [field]: e.target.value })}
                      >
                        <option value="">—</option>
                        {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                  ))}
                </div>

                <div className="block-card p-0 overflow-hidden">
                  <table className="block-table">
                    <thead><tr><th>Date</th><th>Description</th><th className="text-right">Amount</th><th>Reference</th></tr></thead>
                    <tbody>
                      {previewRows.map((r, i) => (
                        <tr key={i}>
                          <td className="font-mono text-xs">{normDate(r.date) || <span className="text-accent-expense">{r.date}</span>}</td>
                          <td>{r.description}</td>
                          <td className="text-right font-mono">{formatCurrency(normAmount(r.amount))}</td>
                          <td className="text-xs text-text-muted">{r.reference}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end gap-2">
                  <button onClick={onClose} className="text-xs font-bold uppercase px-3 py-2 border border-border-primary">Cancel</button>
                  <button
                    onClick={runImport}
                    disabled={importing || !mapping.date || !mapping.description || !mapping.amount}
                    className="block-btn-primary text-xs"
                  >
                    {importing ? 'Importing...' : `Import ${rows.length} as drafts`}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="p-8 text-center">
            <CheckCircle size={36} className="text-accent-income mx-auto mb-3" />
            <div className="text-sm font-bold text-text-primary">Imported {done.count} expenses as pending drafts</div>
            <button onClick={onDone} className="block-btn-primary text-xs mt-4">Done</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default CreditCardImportModal;
