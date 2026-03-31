import express, { Router } from 'express';
import crypto from 'crypto';
import { applySync } from '../db';

export const syncRouter = Router();

function verifySignature(body: string, signature: string): boolean {
  const secret = process.env.SYNC_SECRET!;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

// POST /api/sync — desktop pushes every write
syncRouter.post('/', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-bap-signature'] as string;
  if (!signature || !verifySignature(req.body.toString(), signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let payload: any;
  try { payload = JSON.parse(req.body.toString()); }
  catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  try {
    applySync(payload);
    res.json({ ok: true });
  } catch (err: any) {
    console.error('applySync error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sync/batch — offline queue drain
syncRouter.post('/batch', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-bap-signature'] as string;
  if (!signature || !verifySignature(req.body.toString(), signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let items: any[];
  try { items = JSON.parse(req.body.toString()); }
  catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  let applied = 0;
  for (const item of items) {
    try { applySync(item); applied++; } catch (e: any) {
      console.error('batch item failed:', e.message);
    }
  }
  res.json({ ok: true, applied, total: items.length });
});
