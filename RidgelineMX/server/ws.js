// =====================================================================
//  Minimal WebSocket server (RFC 6455) with no npm dependencies.
//  Handles the upgrade handshake, text frames, ping/pong and close.
//  Messages larger than MAX_PAYLOAD are rejected.
// =====================================================================
import crypto from 'crypto';
import { EventEmitter } from 'events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 16 * 1024;

export class WsConnection extends EventEmitter {
  constructor(socket, req) {
    super();
    this.socket = socket;
    this.ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
    this.buf = Buffer.alloc(0);
    this.open = true;
    this.lastPong = Date.now();
    this.fragments = null;
    socket.setNoDelay(true);
    socket.on('data', (d) => this.onData(d));
    socket.on('close', () => this.finish());
    socket.on('error', () => this.finish());
  }

  onData(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    if (this.buf.length > MAX_PAYLOAD * 4) return this.close(1009, 'too big');
    while (this.open) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const op = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; const hi = b.readUInt32BE(2); len = b.readUInt32BE(6); if (hi) return this.close(1009, 'too big'); off = 10; }
      if (len > MAX_PAYLOAD) return this.close(1009, 'too big');
      if (!masked) return this.close(1002, 'unmasked');
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4);
      const data = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      this.buf = b.subarray(off + 4 + len);
      this.handleFrame(fin, op, data);
    }
  }

  handleFrame(fin, op, data) {
    if (op === 0x8) { this.close(1000, ''); return; }
    if (op === 0x9) { this.sendFrame(0xA, data); return; }
    if (op === 0xA) { this.lastPong = Date.now(); return; }
    if (op === 0x1 || op === 0x2) {
      if (fin) this.emit('message', data.toString('utf8'));
      else this.fragments = [data];
      return;
    }
    if (op === 0x0 && this.fragments) {
      this.fragments.push(data);
      const total = this.fragments.reduce((a, f) => a + f.length, 0);
      if (total > MAX_PAYLOAD) return this.close(1009, 'too big');
      if (fin) { const all = Buffer.concat(this.fragments); this.fragments = null; this.emit('message', all.toString('utf8')); }
    }
  }

  sendFrame(op, payload) {
    if (!this.open || this.socket.destroyed) return;
    const len = payload.length;
    let head;
    if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
    else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[1] = 127; head.writeUInt32BE(0, 2); head.writeUInt32BE(len, 6); }
    head[0] = 0x80 | op;
    try { this.socket.write(Buffer.concat([head, payload])); } catch { this.finish(); }
  }

  send(obj) { this.sendFrame(0x1, Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf8')); }
  ping() { this.sendFrame(0x9, Buffer.alloc(0)); }

  close(code = 1000, reason = '') {
    if (!this.open) return;
    const p = Buffer.alloc(2 + Buffer.byteLength(reason));
    p.writeUInt16BE(code, 0); p.write(reason, 2);
    this.sendFrame(0x8, p);
    this.finish();
  }

  finish() {
    if (!this.open) return;
    this.open = false;
    try { this.socket.end(); this.socket.destroy(); } catch { /* ignore */ }
    this.emit('close');
  }
}

// Attach to an http.Server; calls onConnection(conn) for /ws upgrades
export function attachWebSocket(server, path, onConnection) {
  server.on('upgrade', (req, socket) => {
    let url;
    try { url = new URL(req.url, 'http://x'); } catch { socket.destroy(); return; }
    const key = req.headers['sec-websocket-key'];
    if (url.pathname !== path || !key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    onConnection(new WsConnection(socket, req));
  });
}
