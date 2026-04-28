import React, { useEffect, useState, useMemo } from 'react';
import { Printer } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency } from '../../lib/format';
import ErrorBanner from '../../components/ErrorBanner';

// ─── Types ──────────────────────────────────────────────
interface InventoryRow {
  name: string;
  sku: string;
  quantity: number;
  unit_cost: number;
  total_value: number;
  reorder_point: number;
  reorder_qty: number;
  status: 'in-stock' | 'low-stock' | 'out-of-stock';
}

// ─── Component ──────────────────────────────────────────
const InventoryValuation: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<InventoryRow[]>([]);

  useEffect(() => {
    if (!activeCompany) return;
    let cancelled = false;
    setLoading(true);
    setError('');

    api.rawQuery(
      `SELECT name, sku, COALESCE(quantity, 0) as quantity, COALESCE(unit_cost, 0) as unit_cost,
              COALESCE(quantity * unit_cost, 0) as total_value,
              COALESCE(reorder_point, 0) as reorder_point,
              COALESCE(reorder_qty, 0) as reorder_qty
       FROM inventory_items
       WHERE company_id = ?
       ORDER BY total_value DESC`,
      [activeCompany.id]
    )
      .then((rows: any[]) => {
        if (cancelled) return;
        setData(
          (rows ?? []).map((r: any) => {
            const qty = Number(r.quantity) || 0;
            const reorderPt = Number(r.reorder_point) || 0;
            let status: InventoryRow['status'] = 'in-stock';
            if (qty === 0) status = 'out-of-stock';
            else if (reorderPt > 0 && qty <= reorderPt) status = 'low-stock';
            return {
              name: r.name || 'Unnamed Item',
              sku: r.sku || '—',
              quantity: qty,
              unit_cost: Number(r.unit_cost) || 0,
              total_value: Number(r.total_value) || 0,
              reorder_point: reorderPt,
              reorder_qty: Number(r.reorder_qty) || 0,
              status,
            };
          })
        );
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message || 'Failed to load inventory data');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [activeCompany]);

  const totalItems = data.length;
  const totalValue = useMemo(() => data.reduce((s, r) => s + r.total_value, 0), [data]);
  const lowStockCount = useMemo(() => data.filter((r) => r.status === 'low-stock').length, [data]);
  const outOfStockCount = useMemo(() => data.filter((r) => r.status === 'out-of-stock').length, [data]);
  const avgItemValue = totalItems > 0 ? totalValue / totalItems : 0;

  const statusBadge = (status: InventoryRow['status']) => {
    switch (status) {
      case 'in-stock':
        return <span className="inline-block px-2 py-0.5 text-[10px] font-semibold bg-accent-income/10 text-accent-income" style={{ borderRadius: '4px' }}>In Stock</span>;
      case 'low-stock':
        return <span className="inline-block px-2 py-0.5 text-[10px] font-semibold bg-accent-warning/10 text-accent-warning" style={{ borderRadius: '4px' }}>Low Stock</span>;
      case 'out-of-stock':
        return <span className="inline-block px-2 py-0.5 text-[10px] font-semibold bg-accent-expense/10 text-accent-expense" style={{ borderRadius: '4px' }}>Out of Stock</span>;
    }
  };

  const handlePrint = () => {
    const rows = data.map((r) => {
      const statusText = r.status === 'in-stock' ? 'In Stock' : r.status === 'low-stock' ? 'Low Stock' : 'Out of Stock';
      const statusColor = r.status === 'in-stock' ? 'text-green' : r.status === 'low-stock' ? '' : 'text-red';
      return `<tr>
        <td>${r.name}</td>
        <td>${r.sku}</td>
        <td class="text-right">${r.quantity}</td>
        <td class="text-right font-mono">${formatCurrency(r.unit_cost)}</td>
        <td class="text-right font-mono font-bold">${formatCurrency(r.total_value)}</td>
        <td class="text-right">${r.reorder_point > 0 ? r.reorder_point : '—'}</td>
        <td class="${statusColor}">${statusText}</td>
      </tr>`;
    }).join('');

    const html = `<div class="rpt-page">
      <div class="rpt-hdr"><div><div class="rpt-co">${activeCompany?.name || 'Company'}</div><div class="rpt-co-sub">Inventory Valuation</div></div><div class="rpt-badge">As of ${new Date().toLocaleDateString()}</div></div>
      <div class="rpt-stats">
        <div class="rpt-stat"><div class="rpt-stat-label">Total Items</div><div class="rpt-stat-val">${totalItems}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-label">Total Value</div><div class="rpt-stat-val">${formatCurrency(totalValue)}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-label">Low Stock</div><div class="rpt-stat-val">${lowStockCount}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-label">Avg Item Value</div><div class="rpt-stat-val">${formatCurrency(avgItemValue)}</div></div>
      </div>
      <table><thead><tr><th>Item</th><th>SKU</th><th class="text-right">Qty</th><th class="text-right">Unit Cost</th><th class="text-right">Total Value</th><th class="text-right">Reorder Pt</th><th>Status</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr class="rpt-total"><td>Total</td><td></td><td class="text-right">${data.reduce((s, r) => s + r.quantity, 0)}</td><td></td><td class="text-right font-mono">${formatCurrency(totalValue)}</td><td></td><td></td></tr></tfoot></table>
      <div class="rpt-footer"><span>Generated ${new Date().toLocaleDateString()}</span><span>Business Accounting Pro</span></div>
    </div>`;
    api.printPreview(html, 'Inventory Valuation');
  };

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}

      {/* Controls */}
      <div className="block-card p-4 flex items-center justify-between" style={{ borderRadius: '6px' }}>
        <div className="text-xs text-text-muted">Current inventory as of {new Date().toLocaleDateString()}</div>
        <button onClick={handlePrint} className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors" style={{ borderRadius: '6px' }} title="Print">
          <Printer size={15} />
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total Items', value: String(totalItems), accent: 'text-accent-blue' },
          { label: 'Total Value', value: formatCurrency(totalValue), accent: 'text-accent-income' },
          { label: 'Low Stock Items', value: String(lowStockCount + outOfStockCount), accent: lowStockCount + outOfStockCount > 0 ? 'text-accent-warning' : 'text-accent-income' },
          { label: 'Avg Item Value', value: formatCurrency(avgItemValue), accent: 'text-text-primary' },
        ].map((card) => (
          <div key={card.label} className="block-card p-4" style={{ borderRadius: '6px' }}>
            <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">{card.label}</div>
            <div className={`text-lg font-bold ${card.accent} mt-1 font-mono`}>{card.value}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-text-muted text-sm font-mono">Generating report...</div>
      ) : data.length === 0 ? (
        <div className="flex items-center justify-center h-64 text-text-muted text-sm">No inventory items found.</div>
      ) : (
        <div className="block-card overflow-hidden" style={{ borderRadius: '6px' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bg-tertiary border-b border-border-primary">
                <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Item</th>
                <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">SKU</th>
                <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Qty</th>
                <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Unit Cost</th>
                <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Total Value</th>
                <th className="text-right px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Reorder Qty</th>
                <th className="text-left px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr key={row.sku + i} className="border-b border-border-primary/50 hover:bg-bg-hover/30 transition-colors">
                  <td className="px-4 py-2 text-xs text-text-primary font-medium">{row.name}</td>
                  <td className="px-4 py-2 text-xs text-text-muted font-mono">{row.sku}</td>
                  <td className="text-right px-4 py-2 text-xs text-text-primary font-mono">{row.quantity}</td>
                  <td className="text-right px-4 py-2 text-xs text-text-secondary font-mono">{formatCurrency(row.unit_cost)}</td>
                  <td className="text-right px-4 py-2 text-xs text-text-primary font-mono font-semibold">{formatCurrency(row.total_value)}</td>
                  <td className="text-right px-4 py-2 text-xs text-text-muted font-mono">{row.reorder_qty > 0 ? row.reorder_qty : '—'}</td>
                  <td className="px-4 py-2">{statusBadge(row.status)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border-primary bg-bg-tertiary/50">
                <td className="px-4 py-2 text-xs font-bold text-text-primary">Total</td>
                <td className="px-4 py-2"></td>
                <td className="text-right px-4 py-2 text-xs font-bold text-text-primary font-mono">{data.reduce((s, r) => s + r.quantity, 0)}</td>
                <td className="px-4 py-2"></td>
                <td className="text-right px-4 py-2 text-xs font-bold text-accent-income font-mono">{formatCurrency(totalValue)}</td>
                <td className="px-4 py-2"></td>
                <td className="px-4 py-2"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
};

export default InventoryValuation;
