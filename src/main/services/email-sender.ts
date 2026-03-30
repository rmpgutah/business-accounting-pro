/**
 * Invoice Email Sender
 * Opens the user's default email client via mailto: with pre-filled content.
 * No external dependencies required.
 */
import { shell } from 'electron';

// ─── Currency Formatter ──────────────────────────────────
const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);

// ─── Build email subject & body ──────────────────────────
function buildEmailContent(
  invoice: any,
  company: any,
  client: any
): { subject: string; body: string } {
  const companyName = company?.name || 'Our Company';
  const clientName = client?.name || 'Valued Client';
  const invoiceNum = invoice?.invoice_number || '';
  const total = fmt(invoice?.total || 0);
  const dueDate = invoice?.due_date || '';
  const balance = fmt((invoice?.total || 0) - (invoice?.amount_paid || 0));

  const subject = `Invoice ${invoiceNum} from ${companyName}`;

  const body = [
    `Dear ${clientName},`,
    '',
    `Please find attached Invoice ${invoiceNum} for ${total}.`,
    '',
    `Invoice Details:`,
    `  Invoice Number: ${invoiceNum}`,
    `  Issue Date: ${invoice?.issue_date || ''}`,
    `  Due Date: ${dueDate}`,
    `  Total: ${total}`,
    `  Balance Due: ${balance}`,
    '',
    `Payment is due by ${dueDate}. Please don't hesitate to reach out if you have any questions.`,
    '',
    `Thank you for your business.`,
    '',
    `Best regards,`,
    companyName,
    company?.email ? company.email : '',
    company?.phone ? company.phone : '',
  ]
    .filter((line) => line !== undefined)
    .join('\n');

  return { subject, body };
}

// ─── Open Email Client ──────────────────────────────────
export async function sendInvoiceEmail(
  invoice: any,
  company: any,
  client: any
): Promise<{ success: boolean; error?: string }> {
  try {
    const to = client?.email || '';
    const { subject, body } = buildEmailContent(invoice, company, client);

    // Build mailto URI
    const params = new URLSearchParams();
    params.set('subject', subject);
    params.set('body', body);

    const mailto = `mailto:${encodeURIComponent(to)}?${params.toString()}`;

    await shell.openExternal(mailto);

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to open email client' };
  }
}
