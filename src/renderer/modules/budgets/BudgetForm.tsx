import React, { useState, useEffect } from 'react';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';

// ─── Types ──────────────────────────────────────────────
interface BudgetLineInput {
  category: string;
  amount: string;
}

interface Account {
  id: string;
  name: string;
}

interface BudgetFormProps {
  onBack: () => void;
  onCreated: (id: string) => void;
}

// ─── Currency Formatter ─────────────────────────────────
const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// ─── Component ──────────────────────────────────────────
const BudgetForm: React.FC<BudgetFormProps> = ({ onBack, onCreated }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [step, setStep] = useState<'budget' | 'lines'>('budget');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [saving, setSaving] = useState(false);
  const [budgetId, setBudgetId] = useState<string | null>(null);
  const [budgetError, setBudgetError] = useState('');
  const [linesError, setLinesError] = useState('');

  // Budget fields
  const [name, setName] = useState('');
  const [period, setPeriod] = useState<'monthly' | 'quarterly' | 'annual'>('monthly');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Line items
  const [lines, setLines] = useState<BudgetLineInput[]>([{ category: '', amount: '' }]);

  useEffect(() => {
    const loadAccounts = async () => {
      if (!activeCompany) return;
      try {
        const data = await api.query('accounts', { company_id: activeCompany.id });
        setAccounts(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Failed to load accounts:', err);
      }
    };
    loadAccounts();
  }, [activeCompany]);

  const handleCreateBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setBudgetError('Budget name is required.');
      return;
    }
    if (!startDate || !endDate) {
      setBudgetError('Start date and end date are required.');
      return;
    }
    setBudgetError('');
    setSaving(true);
    try {
      const result = await api.create('budgets', {
        name: name.trim(),
        period,
        start_date: startDate,
        end_date: endDate,
        status: 'active',
      });
      const id = result?.id || result;
      setBudgetId(id);
      setStep('lines');
    } catch (err) {
      console.error('Failed to create budget:', err);
    } finally {
      setSaving(false);
    }
  };

  const addLine = () => {
    setLines([...lines, { category: '', amount: '' }]);
  };

  const removeLine = (idx: number) => {
    setLines(lines.filter((_, i) => i !== idx));
  };

  const updateLine = (idx: number, field: keyof BudgetLineInput, value: string) => {
    const updated = [...lines];
    updated[idx] = { ...updated[idx], [field]: value };
    setLines(updated);
  };

  const handleSaveLines = async () => {
    if (!budgetId) return;
    // Validate: any filled-in line with empty or non-numeric amount is an error
    const filledLines = lines.filter((l) => l.category.trim() || l.amount.trim());
    const invalidLine = filledLines.find(
      (l) => l.amount.trim() === '' || isNaN(parseFloat(l.amount)) || parseFloat(l.amount) <= 0
    );
    if (invalidLine) {
      setLinesError('Each line item must have a valid amount greater than 0.');
      return;
    }
    const validLines = lines.filter((l) => l.category.trim() && parseFloat(l.amount) > 0);
    if (validLines.length === 0) {
      setLinesError('Add at least one line item with a category and amount.');
      return;
    }
    setLinesError('');

    setSaving(true);
    try {
      for (const line of validLines) {
        await api.create('budget_lines', {
          budget_id: budgetId,
          category: line.category.trim(),
          amount: parseFloat(line.amount),
        });
      }
      onCreated(budgetId);
    } catch (err) {
      console.error('Failed to save budget lines:', err);
    } finally {
      setSaving(false);
    }
  };

  const totalBudgeted = lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          className="block-btn flex items-center gap-2 text-xs"
          onClick={onBack}
        >
          <ArrowLeft size={14} />
          Back
        </button>
        <h2 className="text-lg font-bold text-text-primary">
          {step === 'budget' ? 'Create New Budget' : 'Add Budget Line Items'}
        </h2>
      </div>

      {step === 'budget' ? (
        /* ─── Step 1: Budget Details ─────────────────── */
        <div className="block-card p-5" style={{ borderRadius: '2px' }}>
          <form onSubmit={handleCreateBudget} className="space-y-4">
            {budgetError && (
              <div
                className="text-xs text-accent-expense bg-accent-expense/10 px-3 py-2 border border-accent-expense/20"
                style={{ borderRadius: '2px' }}
              >
                {budgetError}
              </div>
            )}
            <div>
              <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1">
                Budget Name *
              </label>
              <input
                type="text"
                className="block-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Q1 2026 Operating Budget"
                required
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1">
                  Period *
                </label>
                <select
                  className="block-select"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value as any)}
                >
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annual">Annual</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1">
                  Start Date *
                </label>
                <input
                  type="date"
                  className="block-input"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1">
                  End Date *
                </label>
                <input
                  type="date"
                  className="block-input"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="pt-2">
              <button type="submit" className="block-btn-primary" disabled={saving}>
                {saving ? 'Creating...' : 'Create Budget & Add Lines'}
              </button>
            </div>
          </form>
        </div>
      ) : (
        /* ─── Step 2: Line Items Editor ──────────────── */
        <div className="space-y-4">
          <div className="block-card p-5" style={{ borderRadius: '2px' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-text-primary">
                Budget Line Items
              </h3>
              <span className="text-xs font-mono text-text-muted">
                Total: {fmt.format(totalBudgeted)}
              </span>
            </div>

            <div className="space-y-2">
              {/* Header row */}
              <div className="grid grid-cols-12 gap-2 px-1">
                <div className="col-span-6">
                  <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                    Category
                  </span>
                </div>
                <div className="col-span-4">
                  <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                    Amount
                  </span>
                </div>
                <div className="col-span-2" />
              </div>

              {lines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-6">
                    <input
                      type="text"
                      className="block-input"
                      value={line.category}
                      onChange={(e) => updateLine(idx, 'category', e.target.value)}
                      placeholder="Category or account name"
                      list="account-options"
                    />
                  </div>
                  <div className="col-span-4">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="block-input"
                      value={line.amount}
                      onChange={(e) => updateLine(idx, 'amount', e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="col-span-2 flex justify-end">
                    {lines.length > 1 && (
                      <button
                        type="button"
                        className="text-text-muted hover:text-accent-expense p-1"
                        onClick={() => removeLine(idx)}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Account datalist for autocomplete */}
            <datalist id="account-options">
              {accounts.map((a) => (
                <option key={a.id} value={a.name} />
              ))}
            </datalist>

            {linesError && (
              <div
                className="text-xs text-accent-expense bg-accent-expense/10 px-3 py-2 border border-accent-expense/20 mt-2"
                style={{ borderRadius: '2px' }}
              >
                {linesError}
              </div>
            )}

            <div className="flex items-center gap-2 mt-4">
              <button
                type="button"
                className="block-btn flex items-center gap-2 text-xs"
                onClick={addLine}
              >
                <Plus size={14} />
                Add Line
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              className="block-btn-primary"
              onClick={handleSaveLines}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Line Items'}
            </button>
            <button className="block-btn" onClick={onBack}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BudgetForm;
