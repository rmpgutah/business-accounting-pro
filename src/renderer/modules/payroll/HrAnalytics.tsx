import React, { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';
import api from '../../lib/api';

interface HrAnalyticsData {
  byDepartment: Array<{ department_name: string; count: number }>;
  active: number;
  inactive: number;
  newHires: number;
  departures: number;
  avgTenureDays: number;
}

function startOfYear(): string {
  return `${new Date().getFullYear()}-01-01`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const StatTile: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="block-card p-4" style={{ borderRadius: 'var(--app-radius)' }}>
    <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold mb-1">{label}</div>
    <div className="text-lg font-bold text-text-primary">{value}</div>
  </div>
);

const HrAnalytics: React.FC = () => {
  const [data, setData] = useState<HrAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState(startOfYear());
  const [endDate, setEndDate] = useState(today());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.hrAnalytics(startDate, endDate).then((result: any) => {
      if (!cancelled) setData(result);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [startDate, endDate]);

  const turnoverRate = useMemo(() => {
    if (!data) return 0;
    const total = data.active + data.inactive;
    return total > 0 ? Math.round((data.departures / total) * 1000) / 10 : 0;
  }, [data]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <label className="text-xs text-text-muted">From</label>
        <input type="date" className="block-input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <label className="text-xs text-text-muted">To</label>
        <input type="date" className="block-input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
      </div>

      {loading || !data ? (
        <div className="text-xs font-mono text-text-muted">Loading analytics...</div>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-3">
            <StatTile label="Active Employees" value={String(data.active)} />
            <StatTile label="New Hires (range)" value={String(data.newHires)} />
            <StatTile label="Departures (range)" value={String(data.departures)} />
            <StatTile label="Avg. Tenure" value={`${Math.round(data.avgTenureDays / 30.44)} mo`} />
          </div>

          <div className="block-card p-4" style={{ borderRadius: 'var(--app-radius)' }}>
            <div className="text-xs font-semibold text-text-primary mb-3">Headcount by Department</div>
            <div style={{ width: '100%', height: 240 }}>
              <ResponsiveContainer>
                <BarChart data={data.byDepartment}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="department_name" stroke="var(--color-text-muted)" fontSize={11} />
                  <YAxis stroke="var(--color-text-muted)" fontSize={11} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--color-bg-elevated)',
                      border: '1px solid var(--color-border-primary)',
                      borderRadius: '6px',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="count" fill="var(--color-accent-blue)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="text-xs text-text-muted">
            Turnover rate (departures ÷ total employees, selected range): <span className="text-text-primary font-semibold">{turnoverRate}%</span>
          </div>
        </>
      )}
    </div>
  );
};

export default HrAnalytics;
