import api from '../../../lib/api';

export interface WidgetDef {
  type: string;
  title: string;
  accent: 'income' | 'expense' | 'warning' | 'blue';
  /** loads the data object the widget renders; must never throw (catch → null/[]) */
  load: (companyId: string) => Promise<any>;
}

const todayISO = () => new Date().toISOString().slice(0, 10);
const ytdStartISO = () => `${new Date().getFullYear()}-01-01`;

export const WIDGET_DEFS: WidgetDef[] = [
  { type: 'kpis', title: 'Key Metrics', accent: 'blue',
    load: () => api.dashboardStats(ytdStartISO(), todayISO()).catch(() => null) },
  { type: 'cash-forecast', title: 'Cash Forecast (90d)', accent: 'income',
    load: () => api.cashProjection(90).catch(() => null) },
  { type: 'anomalies', title: 'Anomalies', accent: 'warning',
    load: () => api.listAnomalies().catch(() => []) },
  { type: 'ar-aging', title: 'AR Aging', accent: 'income',
    load: () => api.reportArAging(todayISO()).catch(() => null) },
  { type: 'ap-aging', title: 'AP Aging', accent: 'expense',
    load: () => api.reportApAging(todayISO()).catch(() => null) },
  { type: 'top-clients', title: 'Top Clients', accent: 'blue',
    load: (companyId) => api.rawQuery(
      `SELECT c.name, COALESCE(SUM(i.total),0) AS total
       FROM invoices i JOIN clients c ON c.id = i.client_id
       WHERE i.company_id = ? GROUP BY i.client_id ORDER BY total DESC LIMIT 6`,
      [companyId]).catch(() => []) },
];

export const widgetDef = (type: string) => WIDGET_DEFS.find(w => w.type === type);
