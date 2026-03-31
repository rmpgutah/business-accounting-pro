import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { initDb } from './db';
import { initWebSocket } from './ws';
import { syncRouter } from './routes/sync';
import { portalRouter } from './routes/portal';
import { stripeRouter } from './routes/stripe';
import { startCrons } from './crons';

const app = express();
app.use(cors());
app.use(express.json());

initDb();

app.use('/api/sync', syncRouter);
app.use('/portal', portalRouter);
app.use('/api/stripe', stripeRouter);
app.get('/health', (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
initWebSocket(server);
startCrons();

const PORT = Number(process.env.PORT) || 3001;
server.on('error', (err: NodeJS.ErrnoException) => {
  console.error('Server failed to start:', err.message);
  process.exit(1);
});
server.listen(PORT, () => console.log(`BAP sync server listening on :${PORT}`));
