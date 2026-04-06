import React, { useEffect, useState } from 'react';
import {
  DollarSign,
  Receipt,
  TrendingUp,
  Percent,
  Clock,
  Zap,
} from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/format';

// ─── Types ──────────────────────────────────────────────
interface ProjectProfitabilityProps {
  projectId: string;
}

interface ProfitabilityData {
  revenue: number;
  direct_costs: number;
  labor_costs: number;
  total_costs: number;
  profit: number;
  margin: number;
  total_hours: number;
  effective_rate: number;
  budget: number;
  budget_used_pct: number;
}

// ─── Margin Color Helper ────────────────────────────────
function marginColor(margin: number): string {
  if (margin >= 20) return '#34d399';   // green
  if (margin >= 10) return '#fbbf24';   // yellow
  return '#f87171';                     // red
}

function profitColor(profit: number): string {
  return profit >= 0 ? '#34d399' : '#f87171';
}

// ─── Component ──────────────────────────────────────────
const ProjectProfitability: React.FC<ProjectProfitabilityProps> = ({ projectId }) => {
  const [data, setData] = useState<ProfitabilityData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        const result = await api.projectProfitability(projectId);
        if (!cancelled) setData(result);
      } catch (err) {
        console.error('Failed to load project profitability:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [projectId]);

  if (loading) {
    return (
      <div className="py-8 text-center text-sm text-text-muted font-mono">
        Loading profitability...
      </div>
    );
  }

  if (!data) return null;

  const budgetBarPct = Math.min(data.budget_used_pct, 100);
  const budgetBarColor = data.budget_used_pct > 90
    ? '#f87171'
    : data.budget_used_pct > 70
      ? '#fbbf24'
      : '#34d399';

  return (
    <div className="space-y-4">
      {/* Section Heading */}
      <h3
        className="text-xs font-bold text-text-muted uppercase tracking-wider"
        style={{ letterSpacing: '0.08em' }}
      >
        Profitability
      </h3>

      {/* Stat Cards: 2x3 grid */}
      <div className="grid grid-cols-3 gap-4">
        {/* Revenue */}
        <div className="stat-card border-l-2 border-l-accent-income" style={{ borderRadius: '6px' }}>
          <div className="flex items-center gap-1.5 mb-1">
            <DollarSign size={12} className="text-text-muted" />
            <span className="stat-label">Revenue</span>
          </div>
          <span className="stat-value text-accent-income">{formatCurrency(data.revenue)}</span>
        </div>

        {/* Total Costs */}
        <div className="stat-card border-l-2 border-l-accent-expense" style={{ borderRadius: '6px' }}>
          <div className="flex items-center gap-1.5 mb-1">
            <Receipt size={12} className="text-text-muted" />
            <span className="stat-label">Total Costs</span>
          </div>
          <span className="stat-value text-accent-expense">{formatCurrency(data.total_costs)}</span>
          {(data.direct_costs > 0 || data.labor_costs > 0) && (
            <div className="mt-1 text-[10px] text-text-muted font-mono">
              {data.direct_costs > 0 && <span>Direct: {formatCurrency(data.direct_costs)}</span>}
              {data.direct_costs > 0 && data.labor_costs > 0 && <span className="mx-1">|</span>}
              {data.labor_costs > 0 && <span>Labor: {formatCurrency(data.labor_costs)}</span>}
            </div>
          )}
        </div>

        {/* Profit */}
        <div className="stat-card border-l-2" style={{ borderRadius: '6px', borderLeftColor: profitColor(data.profit) }}>
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp size={12} className="text-text-muted" />
            <span className="stat-label">Profit</span>
          </div>
          <span className="stat-value" style={{ color: profitColor(data.profit) }}>
            {formatCurrency(data.profit)}
          </span>
        </div>

        {/* Margin */}
        <div className="stat-card border-l-2" style={{ borderRadius: '6px', borderLeftColor: marginColor(data.margin) }}>
          <div className="flex items-center gap-1.5 mb-1">
            <Percent size={12} className="text-text-muted" />
            <span className="stat-label">Margin</span>
          </div>
          <span className="stat-value" style={{ color: marginColor(data.margin) }}>
            {data.revenue > 0 ? `${data.margin}%` : '--'}
          </span>
        </div>

        {/* Hours Logged */}
        <div className="stat-card border-l-2 border-l-accent-blue" style={{ borderRadius: '6px' }}>
          <div className="flex items-center gap-1.5 mb-1">
            <Clock size={12} className="text-text-muted" />
            <span className="stat-label">Hours Logged</span>
          </div>
          <span className="stat-value text-text-primary">{data.total_hours}h</span>
        </div>

        {/* Effective Rate */}
        <div className="stat-card border-l-2 border-l-accent-purple" style={{ borderRadius: '6px' }}>
          <div className="flex items-center gap-1.5 mb-1">
            <Zap size={12} className="text-text-muted" />
            <span className="stat-label">Effective Rate</span>
          </div>
          <span className="stat-value text-text-primary">
            {data.effective_rate > 0 ? `${formatCurrency(data.effective_rate)}/hr` : '--'}
          </span>
        </div>
      </div>

      {/* Budget Bar */}
      {data.budget > 0 && (
        <div
          className="block-card"
          style={{
            borderRadius: '6px',
            background: 'rgba(255,255,255,0.02)',
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-bold text-text-muted uppercase tracking-wider">
              Budget Usage
            </h4>
            <span className="text-xs font-mono text-text-secondary">
              {formatCurrency(data.total_costs)} / {formatCurrency(data.budget)}
              <span className="ml-2 font-bold" style={{ color: budgetBarColor }}>
                ({data.budget_used_pct}%)
              </span>
            </span>
          </div>
          <div
            style={{
              width: '100%',
              height: 8,
              background: 'rgba(255,255,255,0.06)',
              borderRadius: '6px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${budgetBarPct}%`,
                height: '100%',
                background: budgetBarColor,
                borderRadius: '6px',
                transition: 'width 0.4s ease',
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectProfitability;
