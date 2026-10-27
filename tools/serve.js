#!/usr/bin/env node
/*
 * Tiny static server so the game works in any browser.
 *
 *   npm start                (or: node tools/serve.js [port])
 *
 * Opening index.html straight from disk breaks in sandboxed browsers (Flatpak/Snap
 * Firefox or Chrome): they're handed only that one file, not engine/, ui/, or sides/.
 * Serving the folder over http://localhost avoids that. It also serves the small
 * /api/ that designer.html saves through (see tools/design-api.js).
 */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { handleApi } = require('./design-api.js');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8000);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

// Only answer requests addressed to this machine by name. Another website that points
// its own hostname at 127.0.0.1 (DNS rebinding) gets nothing.
function localHost(req) {
  const port = req.socket.localPort;
  return ['localhost', '127.0.0.1', `localhost:${port}`, `127.0.0.1:${port}`].includes(req.headers.host);
}

const createServer = (root = ROOT) => http.createServer((req, res) => {
  if (!localHost(req)) {
    res.writeHead(403).end('Forbidden: open the game at http://localhost');
    return;
  }
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (err) {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (urlPath.startsWith('/api/')) {
    handleApi(req, res, root);
    return;
  }
  const file = path.join(root, urlPath.endsWith('/') ? `${urlPath}index.html` : urlPath);
  if (!file.startsWith(root + path.sep) || file.includes(`${path.sep}.git${path.sep}`)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end(`Not found: ${urlPath}`);
      return;
    }
    // no-store so edits to a side file show up on a plain reload.
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
});

module.exports = { createServer };

if (require.main === module) {
  const server = createServer();
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is busy. Try: node tools/serve.js ${PORT + 1}`);
      process.exit(1);
    }
    throw err;
  });
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Wacky Chess is running at http://localhost:${PORT}/  (Ctrl+C to stop)`);
    console.log(`Design a side at http://localhost:${PORT}/designer.html`);
  });
}
