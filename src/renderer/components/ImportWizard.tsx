// src/renderer/components/ImportWizard.tsx
import React, { useState } from 'react';
import { Upload, X, Check } from 'lucide-react';
import api from '../lib/api';

interface Props {
  table: string;
  requiredFields: string[];
  extraData?: Record<string, unknown>;
  onDone: () => void;
  onCancel: () => void;
}

export const ImportWizard: React.FC<Props> = ({ table, requiredFields, extraData = {}, onDone, onCancel }) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; errors: string[] } | null>(null);
  const [error, setError] = useState('');

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = String(ev.target?.result ?? '');
      const lines = text.split('\n').filter(l => l.trim());
      if (lines.length < 2) { setError('CSV must have a header row and at least one data row.'); return; }
      const hdrs = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
      const dataRows = lines.slice(1).map(line => {
        const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
        return Object.fromEntries(hdrs.map((h, i) => [h, vals[i] ?? '']));
      });
      setHeaders(hdrs);
      setRows(dataRows);
      const autoMap: Record<string, string> = {};
      for (const f of requiredFields) {
        const match = hdrs.find(h => h.toLowerCase() === f.toLowerCase());
        if (match) autoMap[f] = match;
      }
      setMapping(autoMap);
      setStep(2);
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    const missing = requiredFields.filter(f => !mapping[f]);
    if (missing.length > 0) { setError(`Map required fields: ${missing.join(', ')}`); return; }
    setImporting(true);
    let imported = 0;
    const errors: string[] = [];
    for (const row of rows) {
      const data: Record<string, unknown> = { ...extraData };
      for (const [field, col] of Object.entries(mapping)) data[field] = row[col] ?? '';
      try { await api.create(table, data); imported++; }
      catch (e: any) { errors.push(String(e?.message ?? e)); }
    }
    setResult({ imported, errors });
    setStep(3);
    setImporting(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-bg-secondary w-full max-w-xl border border-border-primary">
        <div className="flex justify-between items-center p-4 border-b border-border-primary">
          <h2 className="font-black uppercase tracking-wider text-sm">Import {table} — Step {step} of 3</h2>
          <button onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="p-4">
          {error && <div className="bg-accent-expense-bg border border-red-300 text-red-700 text-xs p-2 mb-3">{error}</div>}

          {step === 1 && (
            <div className="text-center py-8">
              <Upload size={32} className="mx-auto text-text-muted mb-4" />
              <p className="text-sm text-text-muted mb-1">Upload a CSV file</p>
              <p className="text-xs text-text-muted mb-4">Required columns: <span className="font-bold">{requiredFields.join(', ')}</span></p>
              <label className="cursor-pointer inline-block bg-accent-blue text-white px-4 py-2 text-xs font-bold uppercase hover:opacity-90">
                Choose CSV File
                <input type="file" accept=".csv" className="hidden" onChange={handleFile} />
              </label>
            </div>
          )}

          {step === 2 && (
            <div>
              <p className="text-xs text-text-muted mb-3">{rows.length} rows found. Map CSV columns to fields:</p>
              {requiredFields.map(field => (
                <div key={field} className="flex items-center gap-3 mb-2">
                  <span className="text-xs font-bold w-36 uppercase text-text-secondary">{field}</span>
                  <select className="border border-border-secondary px-2 py-1.5 text-sm flex-1 focus:outline-none"
                    value={mapping[field] ?? ''}
                    onChange={e => { setMapping(prev => ({ ...prev, [field]: e.target.value })); setError(''); }}>
                    <option value="">— select column —</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
              {rows[0] && (
                <div className="mt-3 text-xs text-text-muted border border-border-primary bg-bg-secondary p-2">
                  Preview row 1: {Object.entries(rows[0]).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                </div>
              )}
            </div>
          )}

          {step === 3 && result && (
            <div className="text-center py-6">
              <Check size={32} className="mx-auto text-accent-income mb-3" />
              <p className="font-bold text-sm">{result.imported} record{result.imported !== 1 ? 's' : ''} imported successfully</p>
              {result.errors.length > 0 && (
                <p className="text-xs text-accent-expense mt-2">{result.errors.length} error{result.errors.length !== 1 ? 's' : ''}: {result.errors.slice(0, 3).join('; ')}</p>
              )}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 p-4 border-t border-border-primary">
          {step === 2 && (
            <>
              <button onClick={() => setStep(1)} className="px-4 py-2 text-xs font-bold uppercase border border-border-secondary hover:border-border-focus">Back</button>
              <button onClick={handleImport} disabled={importing}
                className="px-4 py-2 text-xs font-bold uppercase bg-accent-blue text-white hover:opacity-90 disabled:opacity-50">
                {importing ? 'Importing…' : `Import ${rows.length} Row${rows.length !== 1 ? 's' : ''}`}
              </button>
            </>
          )}
          {step === 3 && <button onClick={onDone} className="px-4 py-2 text-xs font-bold uppercase bg-accent-blue text-white hover:opacity-90">Done</button>}
        </div>
      </div>
    </div>
  );
};
