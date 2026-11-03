// Local dev server: static files + the /api/candles function, no Vercel CLI needed. `npm run dev`
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import handler from './api/candles.js';

const root = process.cwd();
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/candles') {
    req.query = Object.fromEntries(url.searchParams);
    res.status = c => ((res.statusCode = c), res);
    res.json = o => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); return res; };
    return handler(req, res);
  }
  const file = normalize(join(root, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(root + sep)) return res.writeHead(403).end();
  try {
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }).end(await readFile(file));
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(3000, () => console.log('pipscope on http://localhost:3000'));
