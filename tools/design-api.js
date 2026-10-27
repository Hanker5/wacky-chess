/*
 * The small JSON API behind designer.html, mounted by tools/serve.js under /api/.
 *
 *   GET  /api/branch          { branch, color }
 *   GET  /api/design/<color>  { version, design }
 *   POST /api/design/<color>  { expectedVersion, force?, design } -> { version }
 *
 * It only ever writes sides/white/design.json or sides/black/design.json. A save is
 * refused (409) if the file changed since the page loaded it, e.g. because the
 * player's agent rewrote it, unless the page sends force: true.
 */
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const COLORS = ['white', 'black'];
const MAX_BODY = 1_000_000;

function readBranch(root) {
  try {
    let gitDir = path.join(root, '.git');
    if (fs.statSync(gitDir).isFile()) {
      const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(gitDir, 'utf8'));
      if (!m) return null;
      gitDir = path.resolve(root, m[1].trim());
    }
    const m = /^ref: refs\/heads\/(.+)$/m.exec(fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8'));
    return m ? m[1].trim() : null;
  } catch (err) {
    return null;
  }
}

function colorFromBranch(branch) {
  const m = /^match\/.+-(white|black)$/.exec(branch || '');
  return m ? m[1] : null;
}

const version = (text) => crypto.createHash('sha1').update(text).digest('hex');

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readCurrent(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    return null;
  }
}

function readBody(req, done) {
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size <= MAX_BODY) chunks.push(chunk);
  });
  req.on('end', () => done(size > MAX_BODY ? null : Buffer.concat(chunks).toString('utf8')));
}

function saveDesign(req, res, color, file) {
  readBody(req, (text) => {
    if (text === null) return send(res, 413, { error: `Design is too big (over ${MAX_BODY} bytes).` });
    let body;
    try {
      body = JSON.parse(text);
    } catch (err) {
      return send(res, 400, { error: 'Request body is not valid JSON.' });
    }
    const design = body && body.design;
    if (!design || typeof design !== 'object' || Array.isArray(design)) {
      return send(res, 400, { error: 'Request needs a "design" object.' });
    }
    if (design.side !== color) {
      return send(res, 400, { error: `This design is for ${JSON.stringify(design.side)}, not ${color}.` });
    }
    const current = readCurrent(file);
    const currentVersion = current === null ? null : version(current);
    if (body.force !== true && currentVersion !== (body.expectedVersion ?? null)) {
      return send(res, 409, { error: 'changed', version: currentVersion });
    }
    const out = `${JSON.stringify(design, null, 2)}\n`;
    fs.writeFileSync(file, out);
    return send(res, 200, { version: version(out) });
  });
}

function handleApi(req, res, root) {
  const urlPath = new URL(req.url, 'http://localhost').pathname;
  if (urlPath === '/api/branch') {
    if (req.method !== 'GET') return send(res, 405, { error: 'Use GET.' });
    const branch = readBranch(root);
    return send(res, 200, { branch, color: colorFromBranch(branch) });
  }
  const m = /^\/api\/design\/([^/]+)$/.exec(urlPath);
  if (!m) return send(res, 404, { error: `No such API: ${urlPath}` });
  const color = COLORS.find((c) => c === m[1]);
  if (!color) return send(res, 400, { error: 'Color must be "white" or "black".' });
  const file = path.join(root, 'sides', color, 'design.json');
  if (req.method === 'POST') return saveDesign(req, res, color, file);
  if (req.method !== 'GET') return send(res, 405, { error: 'Use GET or POST.' });
  const current = readCurrent(file);
  if (current === null) return send(res, 200, { version: null, design: null });
  try {
    return send(res, 200, { version: version(current), design: JSON.parse(current) });
  } catch (err) {
    return send(res, 200, { version: version(current), design: null, error: 'design.json is not valid JSON' });
  }
}

module.exports = { readBranch, colorFromBranch, handleApi };
