'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../tools/serve.js');
const { readBranch } = require('../tools/design-api.js');

const sha1 = (text) => crypto.createHash('sha1').update(text).digest('hex');

// A throwaway repo root with both side folders and a .git/HEAD, served on a random port.
async function withServer(head, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wacky-'));
  fs.mkdirSync(path.join(root, 'sides', 'white'), { recursive: true });
  fs.mkdirSync(path.join(root, 'sides', 'black'), { recursive: true });
  fs.mkdirSync(path.join(root, '.git'));
  fs.writeFileSync(path.join(root, '.git', 'HEAD'), head);
  const server = createServer(root);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn({ root, base });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const getJson = async (url) => {
  const res = await fetch(url);
  return { status: res.status, body: await res.json() };
};

const post = async (url, body) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

const design = (side, name = 'Goblins') => ({ version: 1, side, name, pieces: [], setup: [] });

test('GET /api/branch reports the branch and its color', async () => {
  await withServer('ref: refs/heads/match/2026-10-27-black\n', async ({ base }) => {
    assert.deepEqual((await getJson(`${base}/api/branch`)).body, { branch: 'match/2026-10-27-black', color: 'black' });
  });
  await withServer('ref: refs/heads/main\n', async ({ base }) => {
    assert.deepEqual((await getJson(`${base}/api/branch`)).body, { branch: 'main', color: null });
  });
  await withServer('3f2a9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b\n', async ({ base }) => {
    assert.deepEqual((await getJson(`${base}/api/branch`)).body, { branch: null, color: null });
  });
});

test('readBranch follows a .git file (worktree)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wacky-'));
  try {
    fs.writeFileSync(path.join(root, '.git'), 'gitdir: wt\n');
    fs.mkdirSync(path.join(root, 'wt'));
    fs.writeFileSync(path.join(root, 'wt', 'HEAD'), 'ref: refs/heads/match/x-white\n');
    assert.equal(readBranch(root), 'match/x-white');
    assert.equal(readBranch(path.join(root, 'nowhere')), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('GET /api/design/<color> with no file returns nulls', async () => {
  await withServer('ref: refs/heads/main\n', async ({ base }) => {
    assert.deepEqual(await getJson(`${base}/api/design/white`), { status: 200, body: { version: null, design: null } });
  });
});

test('GET /api/design/<color> with a broken file says so', async () => {
  await withServer('ref: refs/heads/main\n', async ({ root, base }) => {
    fs.writeFileSync(path.join(root, 'sides', 'white', 'design.json'), '{ nope');
    const { body } = await getJson(`${base}/api/design/white`);
    assert.equal(body.version, sha1('{ nope'));
    assert.equal(body.design, null);
    assert.equal(body.error, 'design.json is not valid JSON');
  });
});

test('first save with expectedVersion null writes the file', async () => {
  await withServer('ref: refs/heads/main\n', async ({ root, base }) => {
    const d = design('black');
    const res = await post(`${base}/api/design/black`, { expectedVersion: null, design: d });
    const text = fs.readFileSync(path.join(root, 'sides', 'black', 'design.json'), 'utf8');
    assert.equal(res.status, 200);
    assert.equal(text, `${JSON.stringify(d, null, 2)}\n`);
    assert.equal(res.body.version, sha1(text));
    assert.deepEqual((await getJson(`${base}/api/design/black`)).body, { version: sha1(text), design: d });
  });
});

test('save with a stale version is refused with 409', async () => {
  await withServer('ref: refs/heads/main\n', async ({ root, base }) => {
    const url = `${base}/api/design/white`;
    const v1 = (await post(url, { expectedVersion: null, design: design('white', 'one') })).body.version;
    const second = await post(url, { expectedVersion: v1, design: design('white', 'two') });
    assert.equal(second.status, 200);
    const v2 = second.body.version;
    const stale = await post(url, { expectedVersion: v1, design: design('white', 'three') });
    assert.deepEqual(stale, { status: 409, body: { error: 'changed', version: v2 } });
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'sides', 'white', 'design.json'), 'utf8')).name, 'two');
  });
});

test('save after the file was deleted is refused with 409', async () => {
  await withServer('ref: refs/heads/main\n', async ({ root, base }) => {
    const url = `${base}/api/design/white`;
    const v1 = (await post(url, { expectedVersion: null, design: design('white') })).body.version;
    fs.rmSync(path.join(root, 'sides', 'white', 'design.json'));
    assert.deepEqual(await post(url, { expectedVersion: v1, design: design('white') }),
      { status: 409, body: { error: 'changed', version: null } });
  });
});

test('force: true overwrites despite a stale version', async () => {
  await withServer('ref: refs/heads/main\n', async ({ root, base }) => {
    const url = `${base}/api/design/white`;
    await post(url, { expectedVersion: null, design: design('white', 'one') });
    const res = await post(url, { expectedVersion: 'stale', force: true, design: design('white', 'forced') });
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'sides', 'white', 'design.json'), 'utf8')).name, 'forced');
  });
});

test('bad color, bad JSON, non-object design, and side mismatch are 400', async () => {
  await withServer('ref: refs/heads/main\n', async ({ root, base }) => {
    const before = fs.readdirSync(root, { recursive: true }).sort();
    const cases = [
      [`${base}/api/design/..%2Fsecrets`, { expectedVersion: null, design: design('white') }],
      [`${base}/api/design/red`, { expectedVersion: null, design: design('white') }],
      [`${base}/api/design/white`, 'not json'],
      [`${base}/api/design/white`, { expectedVersion: null, design: [] }],
      [`${base}/api/design/white`, { expectedVersion: null }],
      [`${base}/api/design/black`, { expectedVersion: null, design: design('white') }],
    ];
    for (const [url, body] of cases) {
      const res = await post(url, body);
      assert.equal(res.status, 400, `${url} ${JSON.stringify(body)}`);
      assert.equal(typeof res.body.error, 'string');
    }
    assert.deepEqual(fs.readdirSync(root, { recursive: true }).sort(), before);
  });
});

test('body over 1 MB is 413', async () => {
  await withServer('ref: refs/heads/main\n', async ({ root, base }) => {
    const big = { expectedVersion: null, design: { ...design('white'), name: 'x'.repeat(1_000_001) } };
    const res = await post(`${base}/api/design/white`, big);
    assert.equal(res.status, 413);
    assert.ok(!fs.existsSync(path.join(root, 'sides', 'white', 'design.json')));
  });
});

test('unknown /api path is 404 and static files still serve', async () => {
  await withServer('ref: refs/heads/main\n', async ({ root, base }) => {
    assert.equal((await getJson(`${base}/api/nope`)).status, 404);
    const wrongMethod = await fetch(`${base}/api/branch`, { method: 'POST' });
    assert.equal(wrongMethod.status, 405);
    fs.writeFileSync(path.join(root, 'sides', 'white', 'pieces.js'), '// hi\n');
    const res = await fetch(`${base}/sides/white/pieces.js`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '// hi\n');
  });
});

// Raw request so the test can set Host, which fetch won't let us override.
const http = require('node:http');
function raw(base, { method = 'GET', path: p, host, type, body }) {
  const { port } = new URL(base);
  return new Promise((resolve, reject) => {
    const headers = { Host: host || `localhost:${port}` };
    if (type) headers['Content-Type'] = type;
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('requests for a foreign Host are refused (DNS rebinding)', async () => {
  await withServer('ref: refs/heads/main\n', async ({ root, base }) => {
    fs.writeFileSync(path.join(root, 'sides', 'white', 'pieces.js'), '// hi\n');
    const body = JSON.stringify({ force: true, design: design('white') });
    assert.equal(await raw(base, { path: '/api/branch', host: 'evil.example:8000' }), 403);
    assert.equal(await raw(base, { path: '/sides/white/pieces.js', host: 'evil.example' }), 403);
    assert.equal(await raw(base, { method: 'POST', path: '/api/design/white', host: 'evil.example', type: 'application/json', body }), 403);
    assert.ok(!fs.existsSync(path.join(root, 'sides', 'white', 'design.json')));
    const { port } = new URL(base);
    for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, 'localhost']) {
      assert.equal(await raw(base, { path: '/sides/white/pieces.js', host }), 200, host);
    }
  });
});

test('a save that is not application/json is refused (cross-site form or text/plain POST)', async () => {
  await withServer('ref: refs/heads/main\n', async ({ root, base }) => {
    const body = JSON.stringify({ force: true, design: design('white') });
    assert.equal(await raw(base, { method: 'POST', path: '/api/design/white', type: 'text/plain', body }), 415);
    assert.equal(await raw(base, { method: 'POST', path: '/api/design/white', type: 'application/x-www-form-urlencoded', body }), 415);
    assert.ok(!fs.existsSync(path.join(root, 'sides', 'white', 'design.json')));
    assert.equal(await raw(base, { method: 'POST', path: '/api/design/white', type: 'application/json; charset=utf-8', body }), 200);
  });
});
