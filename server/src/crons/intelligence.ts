import { db } from '../db';
import { pushToDesktop } from '../ws';
import { v4 as uuidv4 } from 'uuid';

export async function runIntelligence() {
  await detectAnomalies();
}

async function detectAnomalies() {
  const companies = db.prepare(`SELECT DISTINCT company_id FROM invoices`).all() as any[];

  for (const { company_id } of companies) {
    const baselines = db.prepare(`
      SELECT category_id,
             AVG(amount) as avg_amount,
             COUNT(*) as n
      FROM expenses
      WHERE company_id = ?
        AND date >= date('now', '-90 days')
        AND date < date('now', '-7 days')
      GROUP BY category_id
      HAVING n >= 3
    `).all(company_id) as any[];

    for (const baseline of baselines) {
      const recent = db.prepare(`
        SELECT SUM(amount) as total
        FROM expenses
        WHERE company_id = ? AND category_id = ? AND date >= date('now', '-7 days')
      `).get(company_id, baseline.category_id) as any;

      if (!recent?.total) continue;

      const ratio = recent.total / baseline.avg_amount;
      if (ratio < 2.5) continue;

      const exists = db.prepare(`
        SELECT id FROM financial_anomalies
        WHERE company_id = ? AND category = ? AND detected_at > strftime('%s','now') - 86400
      `).get(company_id, baseline.category_id);

      if (!exists) {
        db.prepare(`
          INSERT INTO financial_anomalies (id, company_id, anomaly_type, description, amount, category)
          VALUES (?, ?, 'expense_spike', ?, ?, ?)
        `).run(
          uuidv4(), company_id,
          `Expense ${ratio.toFixed(1)}x above 90-day average in this category`,
          recent.total, baseline.category_id
        );

        pushToDesktop({
          type: 'notification:create',
          title: 'Unusual Expense Detected',
          message: `Spend is ${ratio.toFixed(1)}x above average for a category this week`,
          companyId: company_id,
        });
      }
    }
  }
}
