// =====================================================================
//  RIDGELINE MX SERVER
//  One process does both jobs:
//    1. serves the game to the browser   (http://localhost:5323)
//    2. runs multiplayer parties over WebSockets at /ws on the same port
//  Run:    node server/server.js      (or double-click Play.bat)
//  Deploy: any Node 18+ host that keeps WebSocket connections open
//          (Render, Railway, Fly.io, a VPS...). Set PORT if needed.
//  No npm install needed - zero dependencies.
// =====================================================================
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeStaticHandler } from './static.js';
import { attachWebSocket } from './ws.js';
import { Lobby } from './lobby.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 5323;
const HOST = process.env.HOST || '0.0.0.0';

const serveStatic = makeStaticHandler(ROOT);
const lobby = new Lobby((msg) => console.log(new Date().toISOString().slice(11, 19), msg));

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, ...lobby.stats() }));
    return;
  }
  serveStatic(req, res);
});

attachWebSocket(server, '/ws', (conn) => lobby.onConnection(conn));

server.listen(PORT, HOST, () => {
  console.log(`Ridgeline MX running at http://localhost:${PORT}  (multiplayer on ws://localhost:${PORT}/ws)`);
});
