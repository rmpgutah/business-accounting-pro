import express, { Router } from 'express';
import Stripe from 'stripe';
import { db } from '../db';
import { pushToDesktop } from '../ws';

export const stripeRouter = Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });

stripeRouter.post('/checkout', async (req, res) => {
  const { token } = req.body as { token: string };
  const row = db.prepare(
    `SELECT invoice_id, company_id FROM invoice_tokens WHERE token = ?`
  ).get(token) as any;

  if (!row) return res.status(404).json({ error: 'Invalid token' });

  const invoice = db.prepare(`SELECT * FROM invoices WHERE id = ?`).get(row.invoice_id) as any;
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  const amountCents = Math.round(Number(invoice.total) * 100);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: `Invoice ${invoice.invoice_number}` },
          unit_amount: amountCents,
        },
        quantity: 1,
      }],
      success_url: `${req.headers.origin}/portal/${token}?paid=1`,
      cancel_url: `${req.headers.origin}/portal/${token}`,
      metadata: { invoice_id: row.invoice_id, company_id: row.company_id, token },
    });
    res.json({ url: session.url });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

stripeRouter.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    const sig = req.headers['stripe-signature'] as string;
    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body, sig, process.env.STRIPE_WEBHOOK_SECRET!
      );
    } catch (err: any) {
      return res.status(400).json({ error: 'Webhook signature verification failed' });
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const { invoice_id, company_id } = session.metadata!;
      const amount = (session.amount_total || 0) / 100;
      const stripePaymentId = session.payment_intent as string;

      // Idempotency: key the payment row on the Stripe payment_intent (unique
      // per payment). Stripe re-delivers webhooks at-least-once; a random uuid
      // id never collides, so the old code inserted a duplicate payment on
      // every retry. With id = payment_intent, INSERT OR IGNORE suppresses
      // redeliveries. The payments column is `date` (not `payment_date`).
      const ins = db.prepare(`
        INSERT OR IGNORE INTO payments
          (id, invoice_id, company_id, amount, date, payment_method, reference, created_at)
        VALUES (?, ?, ?, ?, date('now'), 'stripe', ?, datetime('now'))
      `).run(stripePaymentId, invoice_id, company_id, amount, stripePaymentId);

      // Only mutate the invoice + notify the desktop when this is a NEW payment,
      // so retries don't double-count amount_paid. Canonical balance is
      // total − amount_paid, so update amount_paid (not just status).
      if (ins.changes > 0) {
        db.prepare(`
          UPDATE invoices
             SET amount_paid = MIN(total, COALESCE(amount_paid, 0) + ?),
                 status = CASE WHEN COALESCE(amount_paid, 0) + ? >= total THEN 'paid' ELSE 'partial' END
           WHERE id = ?
        `).run(amount, amount, invoice_id);
        pushToDesktop({ type: 'invoice:paid', invoiceId: invoice_id, companyId: company_id, amount, stripePaymentId });
      }
    }

    res.json({ received: true });
  }
);
