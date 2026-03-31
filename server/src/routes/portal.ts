import { Router } from 'express';
import path from 'path';
import { db } from '../db';

export const portalRouter = Router();

portalRouter.get('/:token/data', (req, res) => {
  const row = db.prepare(
    `SELECT invoice_id, company_id, expires_at FROM invoice_tokens WHERE token = ?`
  ).get(req.params.token) as any;

  if (!row) return res.status(404).json({ error: 'Invoice not found' });
  if (row.expires_at < Math.floor(Date.now() / 1000)) {
    return res.status(410).json({ error: 'Link expired' });
  }

  const invoice = db.prepare(`SELECT * FROM invoices WHERE id = ?`).get(row.invoice_id) as any;
  if (!invoice) return res.status(404).json({ error: 'Invoice not found in replica' });

  const lineItems = db.prepare(
    `SELECT * FROM invoice_line_items WHERE invoice_id = ?`
  ).all(row.invoice_id);

  const company = db.prepare(`SELECT * FROM companies WHERE id = ?`).get(row.company_id);

  res.json({ invoice, lineItems, company });
});

portalRouter.get('/:token', (_req, res) => {
  res.sendFile('index.html', {
    root: path.join(__dirname, '..', '..', 'portal', 'dist')
  });
});
