import React, { useEffect, useState } from 'react';
import { Sparkles, TrendingUp, AlertTriangle, CheckCircle, RefreshCw } from 'lucide-react';
import api from '../lib/api';
import { formatCurrency } from '../lib/format';

interface Insight {
  type: 'forecast' | 'anomaly' | 'duplicate' | 'pattern' | 'risk';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
}

const InsightsPanel: React.FC = () => {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadInsights();
  }, []);

  const loadInsights = async () => {
    setLoading(true);
    const list: Insight[] = [];
    try {
      const cf = await api.intelCashForecast(30);
      if (cf?.predicted < 0) {
        list.push({
          type: 'forecast',
          severity: 'critical',
          title: 'Cash flow forecast: Negative in 30 days',
          detail: `Projected cash position: ${formatCurrency(cf.predicted)} (range ${formatCurrency(cf.low)} – ${formatCurrency(cf.high)})`,
        });
      } else if (cf?.predicted) {
        list.push({
          type: 'forecast',
          severity: 'info',
          title: '30-day cash flow forecast',
          detail: `Projected: ${formatCurrency(cf.predicted)} (range ${formatCurrency(cf.low)} – ${formatCurrency(cf.high)})`,
        });
      }

      const dupes = await api.intelDuplicateInvoices();
      if (Array.isArray(dupes) && dupes.length > 0) {
        list.push({
          type: 'duplicate',
          severity: 'warning',
          title: `${dupes.length} potential duplicate invoice(s)`,
          detail: 'Same amount and client within 3 days. Review to confirm.',
        });
      }

      const anoms = await api.intelListAnomalies();
      if (Array.isArray(anoms) && anoms.length > 0) {
        list.push({
          type: 'anomaly',
          severity: 'warning',
          title: `${anoms.length} unresolved anomaly alert(s)`,
          detail: 'Transactions deviating from normal patterns.',
        });
      }
    } catch (err) {
      console.warn('Failed to load insights:', err);
    }
    setInsights(list);
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="block-card p-4" style={{ borderRadius: '6px' }}>
        <div className="text-xs text-text-muted">Loading insights...</div>
      </div>
    );
  }
  if (insights.length === 0) {
    return (
      <div className="block-card p-4" style={{ borderRadius: '6px' }}>
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <CheckCircle size={14} className="text-accent-income" />
          No insights at the moment. Everything looks normal.
        </div>
      </div>
    );
  }

  return (
    <div className="block-card p-0 overflow-hidden" style={{ borderRadius: '6px' }}>
      <div className="px-4 py-3 border-b border-border-primary flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-accent-blue" />
          <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider">AI Insights</h3>
        </div>
        <button
          onClick={loadInsights}
          className="text-text-muted hover:text-text-primary transition-colors"
          title="Refresh insights"
        >
          <RefreshCw size={12} />
        </button>
      </div>
      <div className="divide-y divide-border-primary">
        {insights.map((insight, i) => (
          <div key={i} className="px-4 py-3">
            <div className="flex items-start gap-2">
              {insight.severity === 'critical' && <AlertTriangle size={14} className="text-accent-expense shrink-0 mt-0.5" />}
              {insight.severity === 'warning' && <AlertTriangle size={14} className="text-accent-warning shrink-0 mt-0.5" />}
              {insight.severity === 'info' && <TrendingUp size={14} className="text-accent-blue shrink-0 mt-0.5" />}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-text-primary">{insight.title}</div>
                <div className="text-xs text-text-muted mt-0.5">{insight.detail}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default InsightsPanel;
