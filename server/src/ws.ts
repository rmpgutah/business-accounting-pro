import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';

const desktopClients = new Set<WebSocket>();

export function initWebSocket(server: http.Server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('error', (err: Error) => console.error('WSS server error:', err.message));

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url!, `http://localhost`);
    const token = url.searchParams.get('token');
    if (token !== process.env.DESKTOP_WS_TOKEN) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    desktopClients.add(ws);
    console.log(`Desktop client connected (${desktopClients.size} total)`);

    ws.on('close', () => {
      desktopClients.delete(ws);
    });

    ws.on('error', (err: Error) => console.error('WS error:', err.message));

    ws.on('message', (data: Buffer) => {
      if (data.toString() === 'ping') ws.send('pong');
    });
  });
}

export function pushToDesktop(event: { type: string; [key: string]: unknown }) {
  const msg = JSON.stringify(event);
  for (const ws of desktopClients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}
