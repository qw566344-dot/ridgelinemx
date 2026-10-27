// Serves the game files (client/ and shared/) over plain HTTP.
// Sends no-store so the browser never runs a stale copy of a module.
import fs from 'fs';
import path from 'path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

export function makeStaticHandler(rootDir) {
  const roots = {
    '/shared/': path.join(rootDir, 'shared'),
    '/tools/out/': path.join(rootDir, 'tools', 'out'),
    '/': path.join(rootDir, 'client'),
  };
  return function handle(req, res) {
    let urlPath;
    try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { urlPath = '/'; }
    if (urlPath === '/') urlPath = '/index.html';
    const prefix = Object.keys(roots).find((p) => urlPath.startsWith(p));
    const base = roots[prefix];
    const file = path.normalize(path.join(base, urlPath.slice(prefix.length)));
    if (!file.startsWith(base)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      });
      fs.createReadStream(file).pipe(res);
    });
  };
}
