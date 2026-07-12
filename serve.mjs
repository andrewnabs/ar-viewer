// Minimal static file server for local preview of the AR viewer.
// (GitHub Pages serves these same files in production; this is dev-only.)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('.', import.meta.url).pathname;
const PORT = process.env.PORT || 5178;
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.mind': 'application/octet-stream',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css', '.map': 'application/json',
};

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const abs = normalize(join(ROOT, p));
    if (!abs.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
    const body = await readFile(abs);
    res.writeHead(200, { 'content-type': TYPES[extname(abs)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, () => console.log(`ar-viewer static server on http://localhost:${PORT}`));
