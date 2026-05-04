import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import rateLimit from 'express-rate-limit';
import { initDb } from './db';
import { initWebSocket } from './ws';
import { syncRouter } from './routes/sync';
import { portalRouter } from './routes/portal';
import { stripeRouter } from './routes/stripe';
import { authRouter } from './routes/auth';
import { backupRouter } from './routes/backup';
import { startCrons } from './crons';

// Startup guards — fail fast if required env vars are missing
const REQUIRED_ENV = ['SYNC_SECRET', 'DESKTOP_WS_TOKEN'];
const OPTIONAL_ENV = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}
for (const key of OPTIONAL_ENV) {
  if (!process.env[key]) {
    console.warn(`Optional env var missing: ${key} — some features disabled`);
  }
}

const app = express();
app.use(cors());
app.use(express.json());

// Rate limiting — prevent abuse on all API routes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,                   // 300 requests per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,                    // stricter for auth endpoints
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts, please try again later' },
});

initDb();

app.use('/api/auth', authLimiter, authRouter);
app.use('/api/sync', apiLimiter, syncRouter);
app.use('/api/backup', apiLimiter, backupRouter);

// Portal — order matters here:
//   1) Serve static SPA assets (Vite's base:'/portal/' emits absolute
//      `/portal/assets/*.js` and `/portal/favicon.svg`). express.static
//      handles these without falling through to portalRouter, so the
//      `:token` route below never tries to match `/assets`.
//   2) Mount the portalRouter for API + the SPA-fallback route at /:token.
//      The router's own `/:token` handler does `res.sendFile('index.html')`
//      so React-Router-style deep links resolve to the SPA shell.
const portalDist = path.join(__dirname, '..', 'portal', 'dist');
app.use('/portal', express.static(portalDist, {
  // Don't auto-serve index.html on directory hits — let the router decide.
  index: false,
  // Cache hashed asset bundles aggressively; index.html short.
  setHeaders: (res, filePath) => {
    if (/\/assets\//.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));
app.use('/portal', apiLimiter, portalRouter);
app.use('/api/stripe', apiLimiter, stripeRouter);
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/api/health', (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
initWebSocket(server);
startCrons();

const PORT = Number(process.env.PORT) || 3001;
server.on('error', (err: NodeJS.ErrnoException) => {
  console.error('Server failed to start:', err.message);
  process.exit(1);
});
server.listen(PORT, () => console.log(`BAP sync server listening on :${PORT}`));
