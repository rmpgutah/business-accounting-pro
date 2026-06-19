import { v4 as uuid } from 'uuid';
import * as db from '../database';
import { detectAnomaly, detectDuplicates } from './algorithms/anomalyDetection';
import { forecastValue } from './algorithms/cashFlowForecast';
import { detectVendorPattern, suggestCategoryForVendor } from './algorithms/patternDetection';

class IntelligenceService {
  /**
   * Suggest expense category for a new expense based on vendor history.
   */
  suggestCategory(companyId: string, vendorId: string): string | null {
    try {
      const rows = db.getDb().prepare(
        `SELECT vendor_id, category_id FROM expenses WHERE company_id = ? AND vendor_id = ?`
      ).all(companyId, vendorId) as Array<{ vendor_id: string; category_id: string }>;
      return suggestCategoryForVendor(
        vendorId,
        rows.map(r => ({ vendorId: r.vendor_id, categoryId: r.category_id }))
      );
    } catch { return null; }
  }

  /**
   * Detect duplicate invoices (same amount + client within ±3 days).
   */
  detectDuplicateInvoices(companyId: string): string[][] {
    try {
      const rows = db.getDb().prepare(
        `SELECT id, total as amount, issue_date as date, client_id as entity FROM invoices WHERE company_id = ?`
      ).all(companyId) as Array<{ id: string; amount: number; date: string; entity: string }>;
      return detectDuplicates(rows);
    } catch { return []; }
  }

  /**
   * Anomaly check on a payroll amount.
   */
  detectPayrollAnomaly(employeeId: string, currentGross: number): { isAnomaly: boolean; zScore: number; mean: number } {
    try {
      const rows = db.getDb().prepare(
        `SELECT gross_pay FROM pay_stubs WHERE employee_id = ? ORDER BY created_at DESC LIMIT 12`
      ).all(employeeId) as Array<{ gross_pay: number }>;
      const history = rows.map(r => r.gross_pay).filter(v => v > 0);
      const r = detectAnomaly(currentGross, history);
      return { isAnomaly: r.isAnomaly, zScore: r.zScore, mean: r.mean };
    } catch { return { isAnomaly: false, zScore: 0, mean: 0 }; }
  }

  /**
   * Cash flow forecast for the next N days.
   */
  forecastCashFlow(companyId: string, daysAhead: number): { predicted: number; low: number; high: number } {
    try {
      const rows = db.getDb().prepare(
        `SELECT date(date) as d, SUM(CASE WHEN type='credit' THEN amount ELSE -amount END) as net
         FROM bank_transactions WHERE company_id = ? GROUP BY date(date) ORDER BY date(date) DESC LIMIT 90`
      ).all(companyId) as Array<{ d: string; net: number }>;
      if (rows.length < 5) return { predicted: 0, low: 0, high: 0 };
      let cum = 0;
      const points = rows.reverse().map((r, i) => { cum += r.net; return { x: i, y: cum }; });
      const f = forecastValue(points, points.length + daysAhead);
      return { predicted: f.predicted, low: f.confidenceLow, high: f.confidenceHigh };
    } catch { return { predicted: 0, low: 0, high: 0 }; }
  }

  /**
   * Predict payment date for an outstanding invoice based on client's history.
   */
  predictPaymentDate(invoiceId: string): { predictedDate: string | null; avgDaysToPay: number } {
    try {
      const inv = db.getDb().prepare(
        `SELECT client_id, issue_date FROM invoices WHERE id = ?`
      ).get(invoiceId) as any;
      if (!inv) return { predictedDate: null, avgDaysToPay: 0 };
      const rows = db.getDb().prepare(
        `SELECT julianday(p.date) - julianday(i.issue_date) as days
         FROM payments p JOIN invoices i ON p.invoice_id = i.id
         WHERE i.client_id = ? AND p.amount >= i.total LIMIT 20`
      ).all(inv.client_id) as Array<{ days: number }>;
      if (rows.length === 0) return { predictedDate: null, avgDaysToPay: 0 };
      const avg = rows.reduce((s, r) => s + r.days, 0) / rows.length;
      const predicted = new Date(new Date(inv.issue_date).getTime() + avg * 86_400_000);
      return { predictedDate: predicted.toISOString().slice(0, 10), avgDaysToPay: avg };
    } catch { return { predictedDate: null, avgDaysToPay: 0 }; }
  }

  /**
   * Refresh pattern cache (vendor patterns).
   */
  refreshPatterns(companyId: string): void {
    try {
      const rows = db.getDb().prepare(
        `SELECT vendor_id, amount, date FROM expenses WHERE company_id = ? AND date >= date('now', '-180 days') AND vendor_id IS NOT NULL AND vendor_id != ''`
      ).all(companyId) as Array<{ vendor_id: string; amount: number; date: string }>;
      const patterns = detectVendorPattern(
        rows.map(r => ({ vendorId: r.vendor_id, amount: r.amount, date: r.date }))
      );
      const dbI = db.getDb();
      const now = new Date().toISOString();
      for (const p of patterns) {
        const existing = dbI.prepare(
          `SELECT id FROM pattern_cache WHERE company_id = ? AND pattern_type = ? AND entity_id = ?`
        ).get(companyId, 'vendor_payment', p.vendorId) as any;
        if (existing) {
          dbI.prepare(
            `UPDATE pattern_cache SET pattern_data_json = ?, confidence = ?, sample_size = ?, last_computed_at = ? WHERE id = ?`
          ).run(JSON.stringify(p), 0.7, rows.filter(r => r.vendor_id === p.vendorId).length, now, existing.id);
        } else {
          dbI.prepare(
            `INSERT INTO pattern_cache (id, company_id, pattern_type, entity_type, entity_id, pattern_data_json, confidence, sample_size, last_computed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(uuid(), companyId, 'vendor_payment', 'vendor', p.vendorId, JSON.stringify(p), 0.7, rows.filter(r => r.vendor_id === p.vendorId).length, now);
        }
      }
    } catch (err) {
      console.warn('[IntelligenceService] refreshPatterns failed:', err);
    }
  }
}

export const intelligenceService = new IntelligenceService();
