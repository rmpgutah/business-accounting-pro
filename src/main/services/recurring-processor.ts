import { v4 as uuid } from 'uuid';
import * as db from '../database';

// ─── Date Helpers ─────────────────────────────────────────
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function addFrequency(dateStr: string, frequency: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  switch (frequency) {
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'biweekly':
      d.setDate(d.getDate() + 14);
      break;
    case 'monthly':
      d.setMonth(d.getMonth() + 1);
      break;
    case 'quarterly':
      d.setMonth(d.getMonth() + 3);
      break;
    case 'annually':
      d.setFullYear(d.getFullYear() + 1);
      break;
  }
  return d.toISOString().slice(0, 10);
}

function getNextInvoiceNumber(companyId: string): string {
  const dbInstance = db.getDb();
  const row = dbInstance.prepare(
    "SELECT invoice_number FROM invoices WHERE company_id = ? ORDER BY created_at DESC LIMIT 1"
  ).get(companyId) as any;

  if (row?.invoice_number) {
    const match = row.invoice_number.match(/(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10) + 1;
      const prefix = row.invoice_number.slice(0, row.invoice_number.length - match[1].length);
      return `${prefix}${String(num).padStart(match[1].length, '0')}`;
    }
  }
  return 'INV-1001';
}

// ─── Process Due Templates ───────────────────────────────
export interface ProcessingResult {
  processed: number;
  invoicesCreated: number;
  expensesCreated: number;
  errors: string[];
}

let lastProcessedAt: string | null = null;

export function getLastProcessedAt(): string | null {
  return lastProcessedAt;
}

export function processRecurringTemplates(companyId?: string): ProcessingResult {
  const result: ProcessingResult = {
    processed: 0,
    invoicesCreated: 0,
    expensesCreated: 0,
    errors: [],
  };

  const today = todayStr();
  const dbInstance = db.getDb();

  // Find all active templates that are due
  let sql = `SELECT * FROM recurring_templates WHERE is_active = 1 AND next_date <= ?`;
  const params: any[] = [today];
  if (companyId) {
    sql += ' AND company_id = ?';
    params.push(companyId);
  }

  const templates = dbInstance.prepare(sql).all(...params) as any[];

  for (const template of templates) {
    try {
      let templateData: any = {};
      try {
        templateData = typeof template.template_data === 'string'
          ? JSON.parse(template.template_data)
          : template.template_data || {};
      } catch {
        templateData = {};
      }

      if (template.type === 'invoice') {
        const invoiceNumber = getNextInvoiceNumber(template.company_id);
        // Bug fix #18: || '' produced an empty-string FK reference → SQLite FK violation.
        // Use null so DB accepts it (client_id is nullable on invoices).
        // Guard: skip templates that require a client but have none configured.
        const clientId = templateData.client_id || null;
        if (!clientId) {
          result.errors.push(`Template "${template.name}" skipped — no client_id configured`);
          continue;
        }
        const paymentTerms = templateData.payment_terms || 30;
        const dueDate = new Date(today);
        dueDate.setDate(dueDate.getDate() + paymentTerms);

        const lineItems: any[] = templateData.line_items || [];
        const subtotal = lineItems.reduce((sum: number, li: any) => sum + (li.amount || (li.quantity || 1) * (li.unit_price || 0)), 0);
        const taxAmount = templateData.tax_amount || 0;
        const discountAmount = templateData.discount_amount || 0;
        const total = subtotal + taxAmount - discountAmount;

        // Create the invoice
        const invoice = db.create('invoices', {
          company_id: template.company_id,
          client_id: clientId,
          invoice_number: invoiceNumber,
          status: 'sent',
          issue_date: today,
          due_date: dueDate.toISOString().slice(0, 10),
          subtotal,
          tax_amount: taxAmount,
          discount_amount: discountAmount,
          total,
          amount_paid: 0,
          notes: templateData.notes || '',
          terms: templateData.terms || '',
          is_recurring: 1,
          recurring_template_id: template.id,
        });

        // Create line items
        for (const li of lineItems) {
          db.create('invoice_line_items', {
            invoice_id: invoice.id,
            description: li.description || '',
            quantity: li.quantity || 1,
            unit_price: li.unit_price || 0,
            amount: li.amount || (li.quantity || 1) * (li.unit_price || 0),
            tax_rate: li.tax_rate || 0,
            account_id: li.account_id || null,
            project_id: li.project_id || null,
          });
        }

        // Create notification
        let clientName = 'Unknown';
        if (clientId) {
          const client = db.getById('clients', clientId);
          if (client) clientName = client.name;
        }

        db.create('notifications', {
          company_id: template.company_id,
          type: 'recurring',
          title: `Recurring invoice ${invoiceNumber} created`,
          message: `Recurring invoice ${invoiceNumber} for ${clientName} — $${total.toFixed(2)}`,
          entity_type: 'invoice',
          entity_id: invoice.id,
          is_read: 0,
        });

        // Audit log
        db.logAudit(template.company_id, 'invoices', invoice.id, 'create', {
          source: 'recurring',
          template_id: template.id,
          template_name: template.name,
        });

        result.invoicesCreated++;
      } else if (template.type === 'expense') {
        const expense = db.create('expenses', {
          company_id: template.company_id,
          vendor_id: templateData.vendor_id || null,
          category_id: templateData.category_id || '',
          account_id: templateData.account_id || null,
          date: today,
          amount: templateData.amount || 0,
          tax_amount: templateData.tax_amount || 0,
          description: templateData.description || template.name,
          reference: `recurring:${template.id}`,
          is_billable: templateData.is_billable ? 1 : 0,
          is_reimbursable: 0,
          project_id: templateData.project_id || null,
          client_id: templateData.client_id || null,
          status: 'pending',
          payment_method: templateData.payment_method || '',
          is_recurring: 1,
          recurring_template_id: template.id,
        });

        db.create('notifications', {
          company_id: template.company_id,
          type: 'recurring',
          title: `Recurring expense created`,
          message: `Recurring expense "${template.name}" — $${(templateData.amount || 0).toFixed(2)}`,
          entity_type: 'expense',
          entity_id: expense.id,
          is_read: 0,
        });

        db.logAudit(template.company_id, 'expenses', expense.id, 'create', {
          source: 'recurring',
          template_id: template.id,
          template_name: template.name,
        });

        result.expensesCreated++;
      }

      // Advance next_date
      const nextDate = addFrequency(template.next_date, template.frequency);

      // Check if past end_date
      if (template.end_date && nextDate > template.end_date) {
        db.update('recurring_templates', template.id, {
          is_active: 0,
          next_date: nextDate,
          last_generated: today,
        });
      } else {
        db.update('recurring_templates', template.id, {
          next_date: nextDate,
          last_generated: today,
        });
      }

      result.processed++;
    } catch (err: any) {
      result.errors.push(`Template "${template.name}" (${template.id}): ${err.message || String(err)}`);
      console.error(`Recurring processing error for template ${template.id}:`, err);
    }
  }

  lastProcessedAt = new Date().toISOString();
  return result;
}

// ─── Get History of Auto-Generated Records ───────────────
export function getRecurringHistory(companyId: string, templateId?: string): any[] {
  const dbInstance = db.getDb();
  let sql: string;
  let params: any[];

  if (templateId) {
    sql = `
      SELECT 'invoice' as record_type, i.id, i.invoice_number as reference, i.total as amount, i.issue_date as date, i.status, c.name as client_name
      FROM invoices i
      LEFT JOIN clients c ON i.client_id = c.id
      WHERE i.company_id = ? AND i.is_recurring = 1 AND i.recurring_template_id = ?
      UNION ALL
      SELECT 'expense' as record_type, e.id, e.description as reference, e.amount, e.date, e.status, v.name as client_name
      FROM expenses e
      LEFT JOIN vendors v ON e.vendor_id = v.id
      WHERE e.company_id = ? AND e.is_recurring = 1 AND e.recurring_template_id = ?
      ORDER BY date DESC
      LIMIT 50
    `;
    params = [companyId, templateId, companyId, templateId];
  } else {
    sql = `
      SELECT 'invoice' as record_type, i.id, i.invoice_number as reference, i.total as amount, i.issue_date as date, i.status, c.name as client_name, rt.name as template_name
      FROM invoices i
      LEFT JOIN clients c ON i.client_id = c.id
      LEFT JOIN recurring_templates rt ON i.recurring_template_id = rt.id
      WHERE i.company_id = ? AND i.is_recurring = 1
      UNION ALL
      SELECT 'expense' as record_type, e.id, e.description as reference, e.amount, e.date, e.status, v.name as client_name, rt.name as template_name
      FROM expenses e
      LEFT JOIN vendors v ON e.vendor_id = v.id
      LEFT JOIN recurring_templates rt ON e.recurring_template_id = rt.id
      WHERE e.company_id = ? AND e.is_recurring = 1
      ORDER BY date DESC
      LIMIT 100
    `;
    params = [companyId, companyId];
  }

  return dbInstance.prepare(sql).all(...params);
}
