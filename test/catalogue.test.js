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
