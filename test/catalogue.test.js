'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../tools/catalogue.js');

const ROOT = path.join(__dirname, '..');
const engineSrc = fs.readFileSync(path.join(ROOT, 'engine', 'engine.js'), 'utf8');
const templateWhiteSrc = fs.readFileSync(path.join(ROOT, 'sides', 'white', 'pieces.js'), 'utf8');

const fixtureBlack = `(() => {
  WackyChess.defineSide('black', {
    name: 'Goblins',
    pieces: {
      king: { icon: '♚', royal: true, description: 'Moves one square in any direction. Lose all your royal pieces and you lose.', moves: (p, g) => g.leap(p, g.DIRS.ALL) },
      zombie: { name: 'Zombie', icon: '🧟', description: 'Shambles.', moves: () => [] },
      art: { name: 'Art', icon: 'sides/black/assets/art.svg', description: 'Has art.', moves: () => [] },
    },
    setup: [[null, null, null, 'king', 'zombie', null, null, null]],
  });
})();`;
const fixtureDesign = { pieces: [{ key: 'art', customArt: { description: 'a goblin' } }] };

const e = (id, extra = {}) => {
  const [match, side, key] = id.split('/');
  return { id, match, side, sideName: side, key, name: key, icon: '?', royal: false, description: key, customArt: null, companions: [], ...extra };
};

test('loadSides runs side code in a fresh context', () => {
  const reg = C.loadSides(engineSrc, { black: fixtureBlack });
  assert.deepEqual(Object.keys(reg.black.pieces), ['king', 'zombie', 'art']);
  assert.equal(globalThis.WackyChess?.registry?.black?.pieces?.art, undefined); // no leak
});

test('rewriteIcon only rewrites real side asset paths', () => {
  assert.equal(C.rewriteIcon('sides/black/assets/a/b.svg', '2026-10-30', 'black'), 'catalogue/2026-10-30/black/assets/a/b.svg');
  assert.equal(C.rewriteIcon('sides/white/assets/x.svg', '2026-10-30', 'black'), 'sides/white/assets/x.svg');
  assert.equal(C.rewriteIcon('🚗', '2026-10-30', 'black'), '🚗');
});

test('draftEntries skips stock pieces and fills every field', () => {
  const reg = C.loadSides(engineSrc, { black: fixtureBlack });
  const templatePieces = C.loadSides(engineSrc, { white: templateWhiteSrc }).white.pieces;
  const out = C.draftEntries({ match: '2026-10-30', side: 'black', sideDef: reg.black, design: fixtureDesign, templatePieces });
  assert.deepEqual(out.map((x) => x.id), ['2026-10-30/black/zombie', '2026-10-30/black/art']);
  assert.deepEqual(out[1], {
    id: '2026-10-30/black/art', match: '2026-10-30', side: 'black', sideName: 'Goblins',
    key: 'art', name: 'Art', icon: 'catalogue/2026-10-30/black/assets/art.svg', royal: false,
    description: 'Has art.', customArt: { description: 'a goblin' }, companions: [],
  });
  assert.equal(out[0].customArt, null);
});

test('mergeEntries replaces a re-added match and keeps the order', () => {
  let cat = { version: 1, entries: [e('2026-10-26/black/y'), e('2026-10-28/white/x')] };
  cat = C.mergeEntries(cat, '2026-10-30', [e('2026-10-30/black/a'), e('2026-10-30/white/w')]);
  cat = C.mergeEntries(cat, '2026-10-30', [e('2026-10-30/black/b'), e('2026-10-30/black/c')]);
  assert.deepEqual(cat.entries.map((x) => x.id),
    ['2026-10-30/black/b', '2026-10-30/black/c', '2026-10-28/white/x', '2026-10-26/black/y']);
  assert.equal(cat.version, 1);
});

test('findDuplicates matches on name and description, including companions', () => {
  const existing = [e('2026-10-28/black/rook', {
    name: 'Corolla', description: 'Vroom.',
    companions: [{ key: 'ninja', name: 'Pawn', icon: '♟', royal: false, description: 'Sneaky.', customArt: null }],
  })];
  const fresh = [
    e('2026-10-30/white/rook', { name: 'Corolla', description: 'Vroom.' }),
    e('2026-10-30/white/p', { name: 'Pawn', description: 'Sneaky.' }),
    e('2026-10-30/white/q', { name: 'Corolla', description: 'Different.' }),
  ];
  assert.deepEqual(C.findDuplicates(fresh, existing), [
    { id: '2026-10-30/white/rook', duplicateOf: '2026-10-28/black/rook' },
    { id: '2026-10-30/white/p', duplicateOf: '2026-10-28/black/rook#ninja' },
  ]);
});

test('makeCompanion and dropEntry reshape the catalogue and refuse bad ids', () => {
  const cat = { version: 1, entries: [e('2026-10-30/white/knight'), e('2026-10-30/white/plant'), e('2026-10-30/black/door')] };
  const out = C.makeCompanion(cat, '2026-10-30/white/knight', '2026-10-30/white/plant');
  assert.deepEqual(out.entries.map((x) => x.id), ['2026-10-30/white/knight', '2026-10-30/black/door']);
  assert.deepEqual(out.entries[0].companions,
    [{ key: 'plant', name: 'plant', icon: '?', royal: false, description: 'plant', customArt: null }]);
  assert.equal(cat.entries.length, 3); // input untouched
  assert.deepEqual(cat.entries[0].companions, []);
  assert.throws(() => C.makeCompanion(cat, '2026-10-30/white/knight', '2026-10-30/black/door'), /same match and side/);
  assert.throws(() => C.makeCompanion(cat, 'nope', '2026-10-30/white/plant'), /nope/);
  assert.equal(C.dropEntry(cat, '2026-10-30/black/door').entries.length, 2);
  assert.throws(() => C.dropEntry(cat, 'nope'), /nope/);
});

// A fake `git` for checkSecrecy: which branches exist, and which player branches are merged.
const fakeGit = (branches, merged = []) => (args) => {
  if (args[0] === 'rev-parse') return { ok: branches.includes(args[args.length - 1]), out: Buffer.from('') };
  if (args[0] === 'merge-base') return { ok: merged.includes(args[2]), out: Buffer.from('') };
  throw new Error(`unexpected git ${args.join(' ')}`);
};

test('checkSecrecy refuses a match whose player branches are not merged', () => {
  const m = 'origin/match/2026-11-05';
  assert.equal(C.checkSecrecy('2026-11-05', fakeGit([m])), null);
  assert.equal(C.checkSecrecy('2026-11-05', fakeGit([m, `${m}-white`], [`${m}-white`])), null);
  assert.match(C.checkSecrecy('2026-11-05', fakeGit([m, `${m}-black`])), /match\/2026-11-05-black/);
  assert.match(C.checkSecrecy('2026-11-05', fakeGit([])), /origin\/match\/2026-11-05/);
});

// The real catalogue, if there is one: well-formed, every file present, and every key
// still found in its snapshot. Snapshots are history, so one that no longer loads on
// today's engine is reported as a todo rather than failing the run.
const CATALOGUE = path.join(ROOT, 'catalogue', 'catalogue.json');
test('catalogue/catalogue.json is complete and matches its snapshots', { skip: !fs.existsSync(CATALOGUE) && 'no catalogue yet' }, (t) => {
  const cat = JSON.parse(fs.readFileSync(CATALOGUE, 'utf8'));
  assert.equal(cat.version, 1);
  const fields = ['id', 'match', 'side', 'sideName', 'key', 'name', 'icon', 'royal', 'description', 'customArt', 'companions'];
  const ids = new Set();
  const bySnapshot = new Map();
  for (const entry of cat.entries) {
    assert.deepEqual(Object.keys(entry).sort(), fields.slice().sort(), entry.id);
    assert.equal(entry.id, `${entry.match}/${entry.side}/${entry.key}`);
    assert.ok(!ids.has(entry.id), `duplicate id ${entry.id}`);
    ids.add(entry.id);
    assert.ok(entry.description.trim(), `${entry.id} has no description`);
    for (const piece of [entry, ...entry.companions]) {
      if (piece.icon.startsWith('catalogue/')) assert.ok(fs.existsSync(path.join(ROOT, piece.icon)), `missing ${piece.icon}`);
    }
    const snap = `${entry.match}/${entry.side}`;
    assert.ok(fs.existsSync(path.join(ROOT, 'catalogue', snap, 'pieces.js')), `missing snapshot ${snap}`);
    if (!bySnapshot.has(snap)) bySnapshot.set(snap, []);
    bySnapshot.get(snap).push(entry);
  }
  for (const [snap, entries] of bySnapshot) {
    const side = entries[0].side;
    let pieces;
    try {
      pieces = C.loadSides(engineSrc, { [side]: fs.readFileSync(path.join(ROOT, 'catalogue', snap, 'pieces.js'), 'utf8') })[side].pieces;
    } catch (err) {
      t.todo(`${snap} no longer loads on the current engine: ${err.message}`);
      continue;
    }
    for (const entry of entries) {
      assert.ok(pieces[entry.key], `${entry.id} not in snapshot`);
      for (const c of entry.companions) assert.ok(pieces[c.key], `${entry.id}#${c.key} not in snapshot`);
    }
  }
});

test('addMatch stops when git fetch fails, instead of trusting stale branches', () => {
  const git = (args) => (args[0] === 'fetch' ? { ok: false, out: Buffer.from('') } : fakeGit(['origin/match/2026-11-05'])(args));
  assert.throws(() => C.addMatch('2026-11-05', git, '/nonexistent'), /fetch/);
});

test('makeCompanion refuses to fold an entry into itself or one that has companions of its own', () => {
  const cat = { version: 1, entries: [e('2026-10-30/white/king'), e('2026-10-30/white/knight', {
    companions: [{ key: 'plant', name: 'Plant', icon: '🌱', royal: false, description: 'Grows.', customArt: null }],
  })] };
  assert.throws(() => C.makeCompanion(cat, '2026-10-30/white/king', '2026-10-30/white/king'), /itself/);
  assert.throws(() => C.makeCompanion(cat, '2026-10-30/white/king', '2026-10-30/white/knight'), /companions of its own/);
});
