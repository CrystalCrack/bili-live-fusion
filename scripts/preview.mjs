import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../extension/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let requested;
  try { requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); res.end(); return; }
  const target = path.resolve(root, `.${requested === '/' ? '/studio.html' : requested}`);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) { res.writeHead(403); res.end(); return; }
  fs.readFile(target, (error, data) => {
    if (error) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Security-Policy': "script-src 'self'; object-src 'none'; base-uri 'self'", 'X-Content-Type-Options': 'nosniff' }); res.end(data);
  });
});
const port = Number(process.env.PORT || 4173);
server.listen(port, '127.0.0.1', () => process.stdout.write(`bili直播融合姬预览：http://127.0.0.1:${port}\n按 Ctrl+C 结束预览。\n`));
