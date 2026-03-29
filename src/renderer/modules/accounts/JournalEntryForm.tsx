import React, { useEffect, useState } from 'react';
import { X, Save, Plus, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';

// ─── Types ──────────────────────────────────────────────
interface AccountOption {
  id: string;
  code: string;
  name: string;
}

interface LineItem {
  key: string; // local key for React
  account_id: string;
  debit: string;
  credit: string;
  description: string;
}

interface JournalEntry {
  id: string;
  entry_number: string;
  date: string;
  description: string;
  reference: string;
  status: 'posted' | 'unposted';
}

interface JournalEntryFormProps {
  entry: JournalEntry | null; // null = create mode
  onClose: () => void;
  onSaved: () => void;
}

// ─── Currency Formatter ─────────────────────────────────
const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// ─── Helpers ────────────────────────────────────────────
let keyCounter = 0;
const nextKey = () => `line_${++keyCounter}`;

const emptyLine = (): LineItem => ({
  key: nextKey(),
  account_id: '',
  debit: '',
  credit: '',
  description: '',
});

const parseAmount = (val: string): number => {
  const n = parseFloat(val);
  return isNaN(n) ? 0 : Math.round(n * 100) / 100;
};

// ─── Component ──────────────────────────────────────────
const JournalEntryForm: React.FC<JournalEntryFormProps> = ({
  entry,
  onClose,
  onSaved,
}) => {
  const { activeCompany } = useCompanyStore();
  const isEdit = entry !== null;

  const [date, setDate] = useState(
    entry?.date ?? new Date().toISOString().slice(0, 10)
  );
  const [description, setDescription] = useState(entry?.description ?? '');
  const [reference, setReference] = useState(entry?.reference ?? '');
  const [lines, setLines] = useState<LineItem[]>([emptyLine(), emptyLine()]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Load accounts for dropdown
  useEffect(() => {
    const load = async () => {
      if (!activeCompany) return;
      try {
        const data = await api.query('accounts', {
          company_id: activeCompany.id,
          is_active: true,
        });
        if (Array.isArray(data)) {
          setAccounts(
            data.map((a: any) => ({ id: a.id, code: a.code, name: a.name }))
          );
        }
      } catch (err) {
        console.error('Failed to load accounts:', err);
      }
    };
    load();
  }, [activeCompany]);

  // Load existing lines when editing
  useEffect(() => {
    if (!entry) return;

    const loadLines = async () => {
      try {
        const data = await api.query('journal_entry_lines', {
          journal_entry_id: entry.id,
        });
        if (Array.isArray(data) && data.length > 0) {
          setLines(
            data.map((l: any) => ({
              key: nextKey(),
              account_id: l.account_id ?? '',
              debit: l.debit ? String(l.debit) : '',
              credit: l.credit ? String(l.credit) : '',
              description: l.description ?? '',
            }))
          );
        }
      } catch (err) {
        console.error('Failed to load entry lines:', err);
      }
    };
    loadLines();
  }, [entry]);

  // ─── Line Item Handlers ─────────────────────────────
  const updateLine = (
    key: string,
    field: keyof LineItem,
    value: string
  ) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line.key !== key) return line;

        const updated = { ...line, [field]: value };

        // If user enters a debit, clear credit and vice versa
        if (field === 'debit' && value) {
          updated.credit = '';
        } else if (field === 'credit' && value) {
          updated.debit = '';
        }

        return updated;
      })
    );
  };

  const addLine = () => {
    setLines((prev) => [...prev, emptyLine()]);
  };

  const removeLine = (key: string) => {
    if (lines.length <= 2) return; // minimum 2 lines
    setLines((prev) => prev.filter((l) => l.key !== key));
  };

  // ─── Totals ─────────────────────────────────────────
  const totalDebit = lines.reduce((sum, l) => sum + parseAmount(l.debit), 0);
  const totalCredit = lines.reduce((sum, l) => sum + parseAmount(l.credit), 0);
  const isBalanced =
    Math.abs(totalDebit - totalCredit) < 0.005 && totalDebit > 0;

  // ─── Validation & Save ──────────────────────────────
  const validate = (): boolean => {
    const errs: Record<string, string> = {};

    if (!date) errs.date = 'Date is required';
    if (!description.trim()) errs.description = 'Description is required';

    // Check lines have accounts
    const validLines = lines.filter(
      (l) => l.account_id && (parseAmount(l.debit) > 0 || parseAmount(l.credit) > 0)
    );
    if (validLines.length < 2) {
      errs.lines = 'At least two line items with accounts and amounts are required';
    }

    // Balance check
    const ld = validLines.reduce((s, l) => s + parseAmount(l.debit), 0);
    const lc = validLines.reduce((s, l) => s + parseAmount(l.credit), 0);
    if (Math.abs(ld - lc) >= 0.005) {
      errs.balance = 'Total debits must equal total credits';
    }

    if (ld === 0 && lc === 0) {
      errs.balance = 'Entry must have non-zero amounts';
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!validate() || !activeCompany) return;

    setSaving(true);
    try {
      const validLines = lines.filter(
        (l) =>
          l.account_id &&
          (parseAmount(l.debit) > 0 || parseAmount(l.credit) > 0)
      );

      const entryPayload = {
        company_id: activeCompany.id,
        date,
        description: description.trim(),
        reference: reference.trim() || null,
        total_debit: totalDebit,
        total_credit: totalCredit,
        status: 'unposted' as const,
      };

      let entryId: string;

      if (isEdit && entry) {
        await api.update('journal_entries', entry.id, entryPayload);
        entryId = entry.id;

        // Remove existing lines then re-create
        const existingLines = await api.query('journal_entry_lines', {
          journal_entry_id: entry.id,
        });
        if (Array.isArray(existingLines)) {
          for (const el of existingLines) {
            await api.remove('journal_entry_lines', el.id);
          }
        }
      } else {
        const created = await api.create('journal_entries', entryPayload);
        entryId = created.id;
      }

      // Create line items
      for (let i = 0; i < validLines.length; i++) {
        const l = validLines[i];
        await api.create('journal_entry_lines', {
          journal_entry_id: entryId,
          account_id: l.account_id,
          debit: parseAmount(l.debit),
          credit: parseAmount(l.credit),
          description: l.description.trim() || null,
          line_order: i + 1,
        });
      }

      onSaved();
    } catch (err: any) {
      console.error('Failed to save journal entry:', err);
      setErrors({ _form: err?.message ?? 'Failed to save journal entry' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-8 bg-black/50">
      <div
        className="bg-bg-elevated border border-border-primary w-full max-w-3xl shadow-xl"
        style={{ borderRadius: '2px' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-primary">
          <h2 className="text-sm font-bold text-text-primary">
            {isEdit ? 'Edit Journal Entry' : 'New Journal Entry'}
          </h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 max-h-[75vh] overflow-y-auto">
          {errors._form && (
            <div
              className="bg-accent-expense/10 border border-accent-expense/30 text-accent-expense text-xs px-3 py-2"
              style={{ borderRadius: '2px' }}
            >
              {errors._form}
            </div>
          )}

          {/* Top fields */}
          <div className="grid grid-cols-3 gap-4">
            {/* Date */}
            <div>
              <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
                Date *
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={`block-input w-full px-3 py-2 text-sm bg-bg-primary border ${
                  errors.date ? 'border-accent-expense' : 'border-border-primary'
                } text-text-primary focus:outline-none focus:border-accent-blue`}
                style={{ borderRadius: '2px' }}
              />
              {errors.date && (
                <p className="text-[10px] text-accent-expense mt-1">
                  {errors.date}
                </p>
              )}
            </div>

            {/* Description */}
            <div>
              <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
                Description *
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Entry description"
                className={`block-input w-full px-3 py-2 text-sm bg-bg-primary border ${
                  errors.description
                    ? 'border-accent-expense'
                    : 'border-border-primary'
                } text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue`}
                style={{ borderRadius: '2px' }}
              />
              {errors.description && (
                <p className="text-[10px] text-accent-expense mt-1">
                  {errors.description}
                </p>
              )}
            </div>

            {/* Reference */}
            <div>
              <label className="block text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-1">
                Reference
              </label>
              <input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="e.g. INV-001"
                className="block-input w-full px-3 py-2 text-sm bg-bg-primary border border-border-primary text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
                style={{ borderRadius: '2px' }}
              />
            </div>
          </div>

          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                Line Items
              </label>
              <button
                onClick={addLine}
                className="flex items-center gap-1 text-xs text-accent-blue hover:text-accent-blue/80 transition-colors"
              >
                <Plus size={12} />
                Add Line
              </button>
            </div>

            {errors.lines && (
              <p className="text-[10px] text-accent-expense mb-2">
                {errors.lines}
              </p>
            )}

            <div
              className="border border-border-primary overflow-hidden"
              style={{ borderRadius: '2px' }}
            >
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-bg-tertiary border-b border-border-primary">
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                      Account
                    </th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider w-32">
                      Debit
                    </th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider w-32">
                      Credit
                    </th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                      Description
                    </th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr
                      key={line.key}
                      className="border-b border-border-primary"
                    >
                      <td className="px-2 py-1.5">
                        <select
                          value={line.account_id}
                          onChange={(e) =>
                            updateLine(line.key, 'account_id', e.target.value)
                          }
                          className="block-select w-full px-2 py-1 text-xs bg-bg-primary border border-border-primary text-text-primary focus:outline-none focus:border-accent-blue"
                          style={{ borderRadius: '2px' }}
                        >
                          <option value="">Select account...</option>
                          {accounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.code} — {a.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={line.debit}
                          onChange={(e) =>
                            updateLine(line.key, 'debit', e.target.value)
                          }
                          placeholder="0.00"
                          className="block-input w-full px-2 py-1 text-xs text-right font-mono bg-bg-primary border border-border-primary text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
                          style={{ borderRadius: '2px' }}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={line.credit}
                          onChange={(e) =>
                            updateLine(line.key, 'credit', e.target.value)
                          }
                          placeholder="0.00"
                          className="block-input w-full px-2 py-1 text-xs text-right font-mono bg-bg-primary border border-border-primary text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
                          style={{ borderRadius: '2px' }}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          value={line.description}
                          onChange={(e) =>
                            updateLine(line.key, 'description', e.target.value)
                          }
                          placeholder="Line memo"
                          className="block-input w-full px-2 py-1 text-xs bg-bg-primary border border-border-primary text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue"
                          style={{ borderRadius: '2px' }}
                        />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <button
                          onClick={() => removeLine(line.key)}
                          disabled={lines.length <= 2}
                          className="text-text-muted hover:text-accent-expense transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>

                {/* Totals Footer */}
                <tfoot>
                  <tr className="bg-bg-tertiary border-t border-border-primary">
                    <td className="px-3 py-2 text-xs font-bold text-text-primary text-right">
                      Totals
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs font-bold text-text-primary">
                      {fmt.format(totalDebit)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs font-bold text-text-primary">
                      {fmt.format(totalCredit)}
                    </td>
                    <td colSpan={2} className="px-3 py-2">
                      {!isBalanced && (totalDebit > 0 || totalCredit > 0) && (
                        <span className="flex items-center gap-1 text-[10px] text-accent-expense font-semibold">
                          <AlertTriangle size={11} />
                          Difference: {fmt.format(Math.abs(totalDebit - totalCredit))}
                        </span>
                      )}
                      {isBalanced && (
                        <span className="text-[10px] text-accent-income font-semibold">
                          Balanced
                        </span>
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {errors.balance && (
            <div
              className="bg-accent-expense/10 border border-accent-expense/30 text-accent-expense text-xs px-3 py-2 flex items-center gap-2"
              style={{ borderRadius: '2px' }}
            >
              <AlertTriangle size={14} />
              {errors.balance}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border-primary">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold text-text-secondary bg-bg-tertiary border border-border-primary hover:bg-bg-hover transition-colors"
            style={{ borderRadius: '2px' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !isBalanced}
            className="block-btn-primary flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold disabled:opacity-50"
            style={{ borderRadius: '2px' }}
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            {isEdit ? 'Update Entry' : 'Save Entry'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default JournalEntryForm;
