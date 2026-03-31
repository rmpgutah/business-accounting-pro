import express, { Router } from 'express';
import Stripe from 'stripe';
import { db } from '../db';
import { pushToDesktop } from '../ws';
import { v4 as uuidv4 } from 'uuid';

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
      return res.status(400).send(`Webhook error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const { invoice_id, company_id } = session.metadata!;
      const amount = (session.amount_total || 0) / 100;
      const stripePaymentId = session.payment_intent as string;

      db.prepare(`UPDATE invoices SET status = 'paid' WHERE id = ?`).run(invoice_id);
      db.prepare(`
        INSERT OR IGNORE INTO payments
          (id, invoice_id, company_id, amount, payment_date, payment_method, reference, created_at)
        VALUES (?, ?, ?, ?, strftime('%Y-%m-%d','now'), 'stripe', ?, strftime('%s','now'))
      `).run(uuidv4(), invoice_id, company_id, amount, stripePaymentId);

      pushToDesktop({ type: 'invoice:paid', invoiceId: invoice_id, companyId: company_id, amount, stripePaymentId });
    }

    res.json({ received: true });
  }
);
