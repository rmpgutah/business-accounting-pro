import React, { useEffect, useState } from 'react';
import { Printer, Download } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency, formatDate } from '../../lib/format';
import { downloadCSVBlob } from '../../lib/csv-export';

const PayrollRegister: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [runs, setRuns] = useState<any[]>([]);
  const [stubs, setStubs] = useState<any[]>([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeCompany) return;
    api.query('payroll_runs', { company_id: activeCompany.id }, { field: 'pay_date', dir: 'desc' })
      .then(r => {
        const list = Array.isArray(r) ? r : [];
        setRuns(list);
        if (list.length > 0 && !selectedRunId) setSelectedRunId(list[0].id);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeCompany]);

  useEffect(() => {
    if (!selectedRunId) { setStubs([]); return; }
    api.rawQuery(
      `SELECT ps.*, e.name as employee_name, e.type as employee_type, e.pay_type
       FROM pay_stubs ps
       JOIN employees e ON ps.employee_id = e.id
       WHERE ps.payroll_run_id = ?
       ORDER BY e.name`,
      [selectedRunId]
    ).then(r => setStubs(Array.isArray(r) ? r : [])).catch(() => setStubs([]));
  }, [selectedRunId]);

  const selectedRun = runs.find(r => r.id === selectedRunId);
  const totals = stubs.reduce((acc, s) => ({
    gross: acc.gross + (s.gross_pay || 0),
    federal: acc.federal + (s.federal_tax || 0),
    state: acc.state + (s.state_tax || 0),
    ss: acc.ss + (s.social_security || 0),
    medicare: acc.medicare + (s.medicare || 0),
    net: acc.net + (s.net_pay || 0),
  }), { gross: 0, federal: 0, state: 0, ss: 0, medicare: 0, net: 0 });

  const handleExportCSV = () => {
    const rows = stubs.map(s => ({
      employee: s.employee_name,
      type: s.employee_type,
      hours: s.hours_regular,
      gross_pay: s.gross_pay,
      federal_tax: s.federal_tax,
      state_tax: s.state_tax,
      social_security: s.social_security,
      medicare: s.medicare,
      net_pay: s.net_pay,
    }));
    downloadCSVBlob(rows, `payroll-register-${selectedRun?.pay_date || 'export'}.csv`);
  };

  const handlePrint = async () => {
    // HTML escape helper (XSS prevention for print output)
    const escHtml = (s: string | null | undefined): string => {
      if (!s) return '';
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    };

    const rowsHtml = stubs.map(s => `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${escHtml(s.employee_name)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-transform:capitalize">${escHtml(s.employee_type)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-variant-numeric:tabular-nums;">${s.hours_regular || 0}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-variant-numeric:tabular-nums;">${formatCurrency(s.gross_pay)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-variant-numeric:tabular-nums;">${formatCurrency(s.federal_tax)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-variant-numeric:tabular-nums;">${formatCurrency(s.state_tax)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-variant-numeric:tabular-nums;">${formatCurrency(s.social_security)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-variant-numeric:tabular-nums;">${formatCurrency(s.medicare)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-variant-numeric:tabular-nums;font-weight:700;">${formatCurrency(s.net_pay)}</td>
    </tr>`).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      @page { size: letter; margin: 0.5in 0.6in; }
      body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; padding: 40px; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      h1 { font-size: 18px; margin-bottom: 4px; } h2 { font-size: 14px; color: #475569; margin-bottom: 16px; }
      table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 11px; }
      th { background: #f8fafc; padding: 8px 12px; text-align: left; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #0f172a; color: #475569; }
      tr:nth-child(even) td { background: #fafafa; }
      @media print { tr { page-break-inside: avoid; } }
      .total td { font-weight: 700; border-top: 2px solid #0f172a; }
    </style></head><body>
      <h1>Payroll Register</h1>
      <h2>Pay Date: ${escHtml(selectedRun?.pay_date || '')} &middot; Period: ${escHtml(selectedRun?.pay_period_start || '')} to ${escHtml(selectedRun?.pay_period_end || '')} &middot; Type: ${escHtml(selectedRun?.run_type || 'Regular')}</h2>
      <table>
        <thead><tr><th>Employee</th><th>Type</th><th style="text-align:right">Hours</th><th style="text-align:right">Gross</th><th style="text-align:right">Federal</th><th style="text-align:right">State</th><th style="text-align:right">SS</th><th style="text-align:right">Medicare</th><th style="text-align:right">Net</th></tr></thead>
        <tbody>${rowsHtml}
          <tr class="total">
            <td style="padding:8px 12px;" colspan="3">Total (${stubs.length} employees)</td>
            <td style="padding:8px 12px;text-align:right;font-variant-numeric:tabular-nums;">${formatCurrency(totals.gross)}</td>
            <td style="padding:8px 12px;text-align:right;font-variant-numeric:tabular-nums;">${formatCurrency(totals.federal)}</td>
            <td style="padding:8px 12px;text-align:right;font-variant-numeric:tabular-nums;">${formatCurrency(totals.state)}</td>
            <td style="padding:8px 12px;text-align:right;font-variant-numeric:tabular-nums;">${formatCurrency(totals.ss)}</td>
            <td style="padding:8px 12px;text-align:right;font-variant-numeric:tabular-nums;">${formatCurrency(totals.medicare)}</td>
            <td style="padding:8px 12px;text-align:right;font-variant-numeric:tabular-nums;font-weight:700;">${formatCurrency(totals.net)}</td>
          </tr>
        </tbody>
      </table>
    </body></html>`;
    await api.printPreview(html, 'Payroll Register');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div>
          <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">Payroll Run</label>
          <select className="block-select" value={selectedRunId} onChange={(e) => setSelectedRunId(e.target.value)}>
            {runs.map(r => (
              <option key={r.id} value={r.id}>
                {formatDate(r.pay_date)} — {r.pay_period_start} to {r.pay_period_end} ({r.run_type || 'Regular'})
              </option>
            ))}
          </select>
        </div>
        <div className="ml-auto flex gap-2">
          <button className="block-btn flex items-center gap-2 text-xs" onClick={handlePrint}><Printer size={14} /> Print</button>
          <button className="block-btn flex items-center gap-2 text-xs" onClick={handleExportCSV}><Download size={14} /> Export CSV</button>
        </div>
      </div>

      {selectedRun && (
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'Total Gross', value: formatCurrency(totals.gross), color: 'text-text-primary' },
            { label: 'Total Taxes', value: formatCurrency(totals.federal + totals.state + totals.ss + totals.medicare), color: 'text-accent-expense' },
            { label: 'Total Net', value: formatCurrency(totals.net), color: 'text-accent-income' },
            { label: 'Employees', value: String(stubs.length), color: 'text-accent-blue' },
          ].map(c => (
            <div key={c.label} className="block-card p-4 text-center" style={{ borderRadius: '6px' }}>
              <p className={`text-2xl font-bold font-mono ${c.color}`}>{c.value}</p>
              <p className="text-[10px] text-text-muted uppercase tracking-wider font-bold mt-1">{c.label}</p>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="text-center py-8 text-text-muted text-sm">Loading...</div>
      ) : stubs.length === 0 ? (
        <div className="text-center py-8 text-text-muted text-sm">
          {runs.length === 0 ? 'No payroll runs found. Process payroll first.' : 'Select a payroll run to view details.'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="block-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Type</th>
                <th className="text-right">Hours</th>
                <th className="text-right">Gross</th>
                <th className="text-right">Federal</th>
                <th className="text-right">State</th>
                <th className="text-right">SS</th>
                <th className="text-right">Medicare</th>
                <th className="text-right">Net Pay</th>
              </tr>
            </thead>
            <tbody>
              {stubs.map((s: any) => (
                <tr key={s.id}>
                  <td className="text-text-primary font-medium truncate max-w-[180px]">{s.employee_name}</td>
                  <td className="capitalize text-xs">{s.employee_type}</td>
                  <td className="text-right font-mono text-xs">{s.hours_regular || '—'}</td>
                  <td className="text-right font-mono">{formatCurrency(s.gross_pay)}</td>
                  <td className="text-right font-mono text-xs">{formatCurrency(s.federal_tax)}</td>
                  <td className="text-right font-mono text-xs">{formatCurrency(s.state_tax)}</td>
                  <td className="text-right font-mono text-xs">{formatCurrency(s.social_security)}</td>
                  <td className="text-right font-mono text-xs">{formatCurrency(s.medicare)}</td>
                  <td className="text-right font-mono font-bold text-accent-income">{formatCurrency(s.net_pay)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-border-primary bg-bg-tertiary/30">
                <td className="font-bold" colSpan={3}>Total ({stubs.length} employees)</td>
                <td className="text-right font-mono font-bold">{formatCurrency(totals.gross)}</td>
                <td className="text-right font-mono font-bold text-xs">{formatCurrency(totals.federal)}</td>
                <td className="text-right font-mono font-bold text-xs">{formatCurrency(totals.state)}</td>
                <td className="text-right font-mono font-bold text-xs">{formatCurrency(totals.ss)}</td>
                <td className="text-right font-mono font-bold text-xs">{formatCurrency(totals.medicare)}</td>
                <td className="text-right font-mono font-bold text-accent-income">{formatCurrency(totals.net)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default PayrollRegister;
