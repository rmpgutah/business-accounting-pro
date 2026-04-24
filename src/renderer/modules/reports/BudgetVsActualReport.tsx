import React, { useEffect, useState } from 'react';
import { Printer, Download } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { downloadCSVBlob, dateStampedFilename } from '../../lib/csv-export';
import { formatDate } from '../../lib/format';

// ─── Types ──────────────────────────────────────────────
interface Budget {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
}

interface ComparisonLine {
  category: string;
  budgeted: number;
  actual: number;
  variance: number;
  variance_pct: number;
}

// ─── Currency Formatter ─────────────────────────────────
const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
});

// ─── Component ──────────────────────────────────────────
const BudgetVsActualReport: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [selectedBudgetId, setSelectedBudgetId] = useState('');
  const [comparison, setComparison] = useState<ComparisonLine[]>([]);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [loading, setLoading] = useState(false);

  // Load budgets list
  useEffect(() => {
    if (!activeCompany) return;
    api.query('budgets', { company_id: activeCompany.id }).then((rows) => {
      const list = Array.isArray(rows) ? rows as Budget[] : [];
      setBudgets(list);
      if (list.length > 0 && !selectedBudgetId) {
        setSelectedBudgetId(list[0].id);
      }
    }).catch((err: any) => {
      console.error('Failed to load budgets:', err);
    });
  }, [activeCompany]);

  // Load comparison data
  useEffect(() => {
    if (!selectedBudgetId) return;
    setLoading(true);
    api.budgetVsActual(selectedBudgetId).then((result) => {
      if (result?.error) {
        setComparison([]);
        setBudget(null);
      } else {
        setComparison(result.comparison || []);
        setBudget(result.budget || null);
      }
    }).catch(() => {
      setComparison([]);
    }).finally(() => setLoading(false));
  }, [selectedBudgetId]);

  // Totals
  const totalBudgeted = comparison.reduce((s, c) => s + c.budgeted, 0);
  const totalActual = comparison.reduce((s, c) => s + c.actual, 0);
  const totalVariance = totalBudgeted - totalActual;
  const totalVariancePct = totalBudgeted > 0 ? Math.round((totalVariance / totalBudgeted) * 100) : 0;

  // Variance color
  const varColor = (v: number) => v >= 0 ? 'text-accent-income' : 'text-accent-expense';
  const barColor = (pct: number) => {
    const usage = 100 - pct; // pct is variance %, usage = how much of budget used
    if (usage <= 80) return '#22c55e';
    if (usage <= 100) return '#eab308';
    return '#ef4444';
  };

  const handleExportCSV = () => {
    const rows = comparison.map((c) => ({
      category: c.category,
      budgeted: c.budgeted,
      actual: c.actual,
      variance: c.variance,
      variance_pct: c.variance_pct,
    }));
    rows.push({
      category: 'TOTAL',
      budgeted: totalBudgeted,
      actual: totalActual,
      variance: totalVariance,
      variance_pct: totalVariancePct,
    });
    const slug = `budget-vs-actual-${budget?.name || 'report'}`;
    downloadCSVBlob(rows, dateStampedFilename(slug));
  };

  const handlePrint = async () => {
    // HTML escape helper (XSS prevention for print output)
    const escHtml = (s: string | null | undefined): string => {
      if (!s) return '';
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    };

    const rows = comparison.map((c) =>
      `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${escHtml(c.category)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-variant-numeric:tabular-nums;">${fmt.format(c.budgeted)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-variant-numeric:tabular-nums;">${fmt.format(c.actual)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-variant-numeric:tabular-nums;color:${c.variance >= 0 ? '#16a34a' : '#dc2626'}">${fmt.format(c.variance)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;">${c.variance_pct}%</td>
      </tr>`
    ).join('');

    const utilizationPct = totalBudgeted > 0 ? ((totalActual / totalBudgeted) * 100).toFixed(1) : '0.0';
    const utilizationColor = parseFloat(utilizationPct) > 100 ? '#dc2626' : parseFloat(utilizationPct) > 85 ? '#eab308' : '#16a34a';
    const generatedDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const companyName = escHtml(activeCompany?.name || 'Company');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      @page { size: letter; margin: 0.5in 0.6in; }
      body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; padding: 40px 44px; color: #1e293b; font-size: 11px; line-height: 1.5; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .hdr { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #0f172a; padding-bottom: 14px; margin-bottom: 20px; }
      .co { font-size: 20px; font-weight: 800; color: #0f172a; }
      .co-sub { font-size: 10px; color: #94a3b8; margin-top: 2px; }
      .badge { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: #0f172a; padding: 5px 14px; border: 2px solid #0f172a; }
      .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px; }
      .stat { border: 1px solid #e2e8f0; padding: 12px 14px; background: #f8fafc; }
      .stat-lbl { font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.7px; color: #94a3b8; margin-bottom: 3px; }
      .stat-val { font-size: 18px; font-weight: 800; font-variant-numeric: tabular-nums; }
      table { width: 100%; border-collapse: collapse; }
      th { background: #f8fafc; padding: 7px 12px; text-align: left; font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; border-bottom: 2px solid #0f172a; color: #64748b; }
      td { padding: 7px 12px; border-bottom: 1px solid #e2e8f0; font-size: 11px; color: #334155; }
      tr:nth-child(even) td { background: rgba(248,250,252,0.5); }
      .total td { font-weight: 800; border-top: 2px solid #0f172a; border-bottom: none; background: #f8fafc; font-size: 12px; }
      .r { text-align: right; font-variant-numeric: tabular-nums; font-family: 'SF Mono', Menlo, monospace; }
      .footer { display: flex; justify-content: space-between; margin-top: 24px; padding-top: 8px; border-top: 1px solid #e2e8f0; font-size: 9px; color: #94a3b8; }
      @media print { tr { page-break-inside: avoid; } body { padding: 0; } }
    </style></head><body>
      <div class="hdr"><div><div class="co">${companyName}</div><div class="co-sub">${escHtml(budget?.start_date || '')} through ${escHtml(budget?.end_date || '')}</div></div><div class="badge">Budget vs Actual</div></div>

      <div class="stats">
        <div class="stat" style="border-left:3px solid #0f172a;"><div class="stat-lbl">Budget</div><div class="stat-val">${fmt.format(totalBudgeted)}</div></div>
        <div class="stat" style="border-left:3px solid #2563eb;"><div class="stat-lbl">Actual Spend</div><div class="stat-val" style="color:#2563eb;">${fmt.format(totalActual)}</div></div>
        <div class="stat" style="border-left:3px solid ${totalVariance >= 0 ? '#16a34a' : '#dc2626'};"><div class="stat-lbl">Variance</div><div class="stat-val" style="color:${totalVariance >= 0 ? '#16a34a' : '#dc2626'};">${fmt.format(totalVariance)}</div></div>
        <div class="stat" style="border-left:3px solid ${utilizationColor};"><div class="stat-lbl">Utilization</div><div class="stat-val" style="color:${utilizationColor};">${utilizationPct}%</div></div>
      </div>

      <table><thead><tr><th>Category</th><th class="r">Budgeted</th><th class="r">Actual</th><th class="r">Variance</th><th class="r">%</th></tr></thead>
      <tbody>${rows}
        <tr class="total">
          <td>Total</td>
          <td class="r">${fmt.format(totalBudgeted)}</td>
          <td class="r">${fmt.format(totalActual)}</td>
          <td class="r" style="color:${totalVariance >= 0 ? '#16a34a' : '#dc2626'}">${fmt.format(totalVariance)}</td>
          <td class="r">${totalVariancePct}%</td>
        </tr>
      </tbody></table>

      <div class="footer"><span>${companyName}</span><span>Generated ${generatedDate}</span></div>
    </body></html>`;
    await api.printPreview(html, 'Budget vs Actual Report');
  };

  if (budgets.length === 0 && !loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        No budgets found. Create a budget first to run this report.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-4">
        <div>
          <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Budget</label>
          <select
            className="block-select"
            value={selectedBudgetId}
            onChange={(e) => setSelectedBudgetId(e.target.value)}
          >
            {budgets.map((b) => (
              <option key={b.id} value={b.id}>{b.name} ({formatDate(b.start_date)} to {formatDate(b.end_date)})</option>
            ))}
          </select>
        </div>
        <div className="ml-auto flex gap-2">
          <button
            className="block-btn flex items-center gap-2 text-xs"
            onClick={handlePrint}
          >
            <Printer size={14} />
            Print
          </button>
          <button
            className="block-btn flex items-center gap-2 text-xs"
            onClick={handleExportCSV}
          >
            <Download size={14} />
            Export CSV
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {budget && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Total Budget', value: fmt.format(totalBudgeted), color: 'text-text-primary' },
            { label: 'Actual Spend', value: fmt.format(totalActual), color: 'text-accent-blue' },
            { label: 'Variance', value: fmt.format(totalVariance), color: varColor(totalVariance) },
            { label: 'Remaining', value: `${totalVariancePct}%`, color: varColor(totalVariance) },
          ].map((card) => (
            <div key={card.label} className="block-card p-4 text-center">
              <p className="text-[10px] uppercase tracking-widest text-text-muted font-bold mb-1">{card.label}</p>
              <p className={`text-lg font-bold font-mono ${card.color}`}>{card.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-32 text-text-muted text-sm">Loading...</div>
      ) : comparison.length === 0 ? (
        <div className="flex items-center justify-center h-32 text-text-muted text-sm">No budget line data available.</div>
      ) : (
        <div className="block-card overflow-hidden" style={{ borderRadius: '6px' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bg-tertiary/50">
                <th className="px-4 py-2 text-left text-xs font-bold text-text-muted uppercase tracking-wider">Category</th>
                <th className="px-4 py-2 text-right text-xs font-bold text-text-muted uppercase tracking-wider">Budgeted</th>
                <th className="px-4 py-2 text-right text-xs font-bold text-text-muted uppercase tracking-wider">Actual</th>
                <th className="px-4 py-2 text-right text-xs font-bold text-text-muted uppercase tracking-wider">Variance</th>
                <th className="px-4 py-2 text-right text-xs font-bold text-text-muted uppercase tracking-wider">%</th>
                <th className="px-4 py-2 text-xs font-bold text-text-muted uppercase tracking-wider" style={{ width: 120 }}>Usage</th>
              </tr>
            </thead>
            <tbody>
              {comparison.map((c) => {
                const usagePct = c.budgeted > 0 ? Math.min(Math.round((c.actual / c.budgeted) * 100), 150) : 0;
                return (
                  <tr key={c.category} className="border-b border-border-primary/30 hover:bg-bg-hover/30 transition-colors">
                    <td className="px-4 py-2 text-text-primary font-medium">{c.category}</td>
                    <td className="px-4 py-2 text-right font-mono text-text-secondary">{fmt.format(c.budgeted)}</td>
                    <td className="px-4 py-2 text-right font-mono text-text-primary">{fmt.format(c.actual)}</td>
                    <td className={`px-4 py-2 text-right font-mono font-bold ${varColor(c.variance)}`}>{fmt.format(c.variance)}</td>
                    <td className={`px-4 py-2 text-right font-mono ${varColor(c.variance)}`}>{c.variance_pct}%</td>
                    <td className="px-4 py-2">
                      <div className="w-full h-2 bg-bg-tertiary" style={{ borderRadius: '6px' }}>
                        <div
                          className="h-full"
                          style={{
                            width: `${Math.min(usagePct, 100)}%`,
                            background: barColor(c.variance_pct),
                            borderRadius: '6px',
                            transition: 'width 0.3s ease',
                          }}
                        />
                      </div>
                      <span className="text-[10px] text-text-muted">{usagePct}% used</span>
                    </td>
                  </tr>
                );
              })}
              {/* Total row */}
              <tr className="border-t-2 border-border-primary bg-bg-tertiary/30">
                <td className="px-4 py-2 font-bold text-text-primary">Total</td>
                <td className="px-4 py-2 text-right font-mono font-bold text-text-secondary">{fmt.format(totalBudgeted)}</td>
                <td className="px-4 py-2 text-right font-mono font-bold text-text-primary">{fmt.format(totalActual)}</td>
                <td className={`px-4 py-2 text-right font-mono font-bold ${varColor(totalVariance)}`}>{fmt.format(totalVariance)}</td>
                <td className={`px-4 py-2 text-right font-mono font-bold ${varColor(totalVariance)}`}>{totalVariancePct}%</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default BudgetVsActualReport;
