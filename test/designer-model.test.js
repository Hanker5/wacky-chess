'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../ui/designer-model.js');

const row = (entries = {}) => {
  const r = [null, null, null, null, null, null, null, null];
  for (const [i, key] of Object.entries(entries)) r[i] = key;
  return r;
};
const piece = (key, extra = {}) => ({ key, name: key, icon: '', royal: false, description: 'd', customArt: null, ...extra });

test('slugKey makes engine-valid, unique keys', () => {
  assert.equal(D.slugKey('Goblin King', []), 'goblin_king');
  assert.equal(D.slugKey('Goblin King', ['goblin_king']), 'goblin_king_2');
  assert.equal(D.slugKey('Goblin King', ['goblin_king', 'goblin_king_2']), 'goblin_king_3');
  assert.equal(D.slugKey('🔥🔥', []), 'piece');
  assert.equal(D.slugKey('3 Headed Dog', []), '_3_headed_dog');
  for (const n of ['', '  ', '!!!', 'Ünïcode Ünit', '3']) assert.match(D.slugKey(n, []), D.KEY_RE);
});

test('addPiece appends a blank piece with a fresh key', () => {
  const d = D.emptyDesign('white');
  const a = D.addPiece(d, 'Frog');
  const b = D.addPiece(d, 'Frog');
  assert.deepEqual([a, b], ['frog', 'frog_2']);
  assert.deepEqual(d.pieces[1], { key: 'frog_2', name: 'Frog', icon: '', royal: false, description: '', customArt: null });
  assert.equal(D.addPiece(d), 'new_piece');
});

test('emptyDesign has three empty rows', () => {
  assert.deepEqual(D.emptyDesign('black'), { version: 1, side: 'black', name: '', pieces: [], setup: [row(), row(), row()] });
});

test('removePiece clears its placements', () => {
  const d = { ...D.emptyDesign('white'), pieces: [piece('king'), piece('goblin')] };
  d.setup[0][3] = 'king';
  d.setup[1] = row({ 0: 'goblin', 1: 'goblin', 2: 'goblin', 3: 'goblin', 4: 'goblin', 5: 'goblin', 6: 'goblin', 7: 'goblin' });
  D.removePiece(d, 'goblin');
  assert.deepEqual(d.pieces.map((p) => p.key), ['king']);
  assert.deepEqual(d.setup[1], row());
  assert.equal(d.setup[0][3], 'king');
});

test('setCell and isPlaced track placements', () => {
  const d = { ...D.emptyDesign('white'), pieces: [piece('frog')] };
  assert.equal(D.isPlaced(d, 'frog'), false);
  D.setCell(d, 2, 5, 'frog');
  assert.equal(d.setup[2][5], 'frog');
  assert.equal(D.isPlaced(d, 'frog'), true);
  D.setCell(d, 2, 5, null);
  assert.equal(D.isPlaced(d, 'frog'), false);
});

test('normalizeDesign repairs short or stale files', () => {
  const raw = { pieces: [{ key: 'a', name: 'A', royal: 1 }, { key: 'b', customArt: { description: 7 } }], setup: [['a', 'ghost']] };
  const d = D.normalizeDesign('white', raw);
  assert.deepEqual(d.pieces.map((p) => p.key), ['a', 'b']);
  assert.deepEqual(d.pieces[0], { key: 'a', name: 'A', icon: '', royal: true, description: '', customArt: null });
  assert.deepEqual(d.pieces[1].customArt, { description: '' });
  assert.equal(d.setup.length, 3);
  for (const r of d.setup) assert.equal(r.length, 8);
  assert.equal(d.setup[0][0], 'a');
  assert.equal(d.setup[0][1], null);
  assert.equal(d.side, 'white');
  assert.equal(d.version, 1);
  assert.deepEqual(D.normalizeDesign('black', null), D.emptyDesign('black'));
  assert.equal(D.normalizeDesign('black', { side: 'white', name: 'Goblins' }).side, 'black');
});

test('normalizeDesign does not change its input', () => {
  const raw = { pieces: [{ key: 'a' }], setup: [['a']] };
  const copy = JSON.parse(JSON.stringify(raw));
  D.normalizeDesign('white', raw);
  assert.deepEqual(raw, copy);
});

test('designFromSide pads setup and keeps image icons', () => {
  const moves = () => [];
  const def = {
    name: 'Undead',
    pieces: {
      king: { icon: '♚', royal: true, description: 'K', moves },
      cat: { name: 'Catapult', icon: 'sides/white/assets/catapult.svg', moves },
    },
    setup: [row({ 3: 'king', 7: 'cat' })],
  };
  const d = D.designFromSide('white', def);
  assert.equal(d.name, 'Undead');
  assert.deepEqual(d.pieces[0], { key: 'king', name: 'king', icon: '♚', royal: true, description: 'K', customArt: null });
  assert.deepEqual(d.pieces[1], { key: 'cat', name: 'Catapult', icon: 'sides/white/assets/catapult.svg', royal: false, description: '', customArt: null });
  assert.equal(d.setup.length, 3);
  assert.equal(d.setup[0][7], 'cat');
  assert.deepEqual(d.setup[2], row());
  assert.deepEqual(def.setup, [row({ 3: 'king', 7: 'cat' })]);
});

test('warnings lists royal, duplicate, and description problems in order', () => {
  const d = { ...D.emptyDesign('white'), pieces: [piece('frog', { name: 'Frog', description: '' }), piece('frog_2', { name: ' frog ', description: 'x' })] };
  assert.deepEqual(D.warnings(d), [
    "No royal piece: you'll lose only when every one of your pieces is gone.",
    'Two pieces are named "Frog".',
    '"Frog" has no description yet.',
  ]);
  const unnamed = { ...D.emptyDesign('white'), pieces: [piece('x', { name: '  ', royal: true, description: ' ' })] };
  assert.deepEqual(D.warnings(unnamed), ['"(unnamed)" has no description yet.']);
});

test('searchEmoji matches every term across label and tags, label-prefix first', () => {
  const list = [['🍄', 'mushroom', 'fungus toadstool'], ['🐸', 'frog', 'face'], ['🍄‍🟫', 'brown mushroom', 'food fungus']];
  const emojis = (q, limit) => D.searchEmoji(list, q, limit).map(([e]) => e);
  assert.deepEqual(emojis('mush'), ['🍄', '🍄‍🟫']);
  assert.deepEqual(emojis('Mushroom brown'), ['🍄‍🟫']);
  assert.deepEqual(emojis('fungus brown'), ['🍄‍🟫']);
  assert.deepEqual(emojis('brown'), ['🍄‍🟫']);
  assert.deepEqual(emojis('toad'), ['🍄']);
  assert.deepEqual(emojis('', 2), ['🍄', '🐸']);
  assert.deepEqual(emojis('zzz'), []);
});

test('rekeyPiece renames a key and its placements', () => {
  const d = { ...D.emptyDesign('white'), pieces: [piece('new_piece'), piece('goblin_king')] };
  d.setup[2][3] = 'new_piece';
  d.setup[0][0] = 'new_piece';
  assert.equal(D.rekeyPiece(d, 'new_piece', 'Goblin King'), 'goblin_king_2');
  assert.deepEqual(d.pieces.map((p) => p.key), ['goblin_king_2', 'goblin_king']);
  assert.equal(d.setup[2][3], 'goblin_king_2');
  assert.equal(d.setup[0][0], 'goblin_king_2');
  assert.equal(D.rekeyPiece(d, 'goblin_king_2', 'Goblin King'), 'goblin_king_2');
});

test('normalizeDesign re-keys pieces with a missing, invalid, or repeated key instead of dropping them', () => {
  const raw = { pieces: [{ key: 'a', name: 'A' }, { key: 'a', name: 'Also A' }, { key: '9bad' }, { name: 'Frog' }, null], setup: [['a', '9bad']] };
  const d = D.normalizeDesign('white', raw);
  assert.deepEqual(d.pieces.map((p) => p.key), ['a', 'also_a', '_9bad', 'frog']);
  for (const p of d.pieces) assert.match(p.key, D.KEY_RE);
  assert.equal(d.setup[0][0], 'a');
  assert.equal(d.setup[0][1], null);
});

test('searchEmoji ignores case in the data and ranks whole words above substrings', () => {
  const list = [
    ['😉', 'winking face', 'face wink'],
    ['🍙', 'rice ball', 'Japanese ball rice'],
    ['👑', 'crown', 'clothing king queen'],
    ['🗾', 'map of Japan', 'Japan map'],
    ['🤴', 'King', 'monarch'],
    ['🇿🇼', 'flag: Zimbabwe', 'ZW flag'],
  ];
  const emojis = (q) => D.searchEmoji(list, q).map(([e]) => e);
  assert.deepEqual(emojis('zimbabwe'), ['🇿🇼']);
  assert.deepEqual(emojis('ZW'), ['🇿🇼']);
  assert.deepEqual(emojis('king'), ['🤴', '👑', '😉']);
  assert.deepEqual(emojis('japan'), ['🗾', '🍙']);
});

test('the picker offers the template chess glyphs first, searchable by name', () => {
  assert.deepEqual(D.CHESS_GLYPHS.map(([g]) => g), ['♚', '♛', '♜', '♝', '♞', '♟']);
  const list = D.CHESS_GLYPHS.concat([['🤴', 'prince', 'king crown'], ['♟️', 'chess pawn', 'chess dupe expendable']]);
  assert.equal(D.searchEmoji(list, 'queen')[0][0], '♛');
  assert.equal(D.searchEmoji(list, 'king')[0][0], '♚');
  assert.deepEqual(D.searchEmoji(list, 'pawn').map(([e]) => e), ['♟', '♟️']);
  assert.deepEqual(D.searchEmoji(list, '', 6).map(([e]) => e), ['♚', '♛', '♜', '♝', '♞', '♟']);
});

const catalogueEntry = {
  id: '2026-10-30/white/knight', match: '2026-10-30', side: 'white', sideName: 'White', key: 'knight',
  name: 'Gardener', icon: '🪏', royal: false, description: 'Jumps or plants.', customArt: null,
  companions: [
    { key: 'plant', name: 'Plant', icon: '🌱', royal: false, description: 'Grows.', customArt: null },
    { key: 'plant_2', name: 'Plant', icon: '☘️', royal: false, description: 'Grows more.', customArt: { description: 'a clover' } },
  ],
};

test('addFromCatalogue adds the piece and its companions as normal cards with from', () => {
  const d = D.emptyDesign('black');
  d.pieces.push(piece('knight'), piece('plant'));
  const before = JSON.stringify(d.setup);
  assert.deepEqual(D.addFromCatalogue(d, catalogueEntry), ['knight_2', 'plant_2', 'plant_2_2']);
  assert.deepEqual(d.pieces.slice(0, 2).map((p) => p.key), ['knight', 'plant']);
  assert.deepEqual(d.pieces[2], {
    key: 'knight_2', name: 'Gardener', icon: '🪏', royal: false,
    description: 'Jumps or plants.', customArt: null, from: '2026-10-30/white/knight',
  });
  assert.equal(d.pieces[4].from, '2026-10-30/white/knight#plant_2');
  assert.deepEqual(d.pieces[4].customArt, { description: 'a clover' });
  assert.notEqual(d.pieces[4].customArt, catalogueEntry.companions[1].customArt); // copied, not shared
  assert.equal(JSON.stringify(d.setup), before);
  D.addFromCatalogue(d, catalogueEntry); // twice = two independent copies
  assert.equal(d.pieces.length, 8);
});

test('normalizeDesign keeps a string from and drops anything else', () => {
  const d = D.normalizeDesign('white', { pieces: [piece('a', { from: '2026-10-28/black/rook' }), piece('b', { from: 7 })] });
  assert.equal(d.pieces[0].from, '2026-10-28/black/rook');
  assert.equal('from' in d.pieces[1], false);
});

test('filterCatalogue searches name and description and filters by match', () => {
  const list = [
    { ...catalogueEntry, name: 'Zombie', description: 'Shambles toward enemies.', match: '2026-10-30' },
    { ...catalogueEntry, name: 'Corolla', description: 'CHARGE through pieces.', match: '2026-10-28' },
  ];
  assert.deepEqual(D.filterCatalogue(list, { query: 'charge' }).map((e) => e.name), ['Corolla']);
  assert.deepEqual(D.filterCatalogue(list, { query: 'toward ZOMBIE' }).map((e) => e.name), ['Zombie']);
  assert.deepEqual(D.filterCatalogue(list, { match: '2026-10-30' }).map((e) => e.name), ['Zombie']);
  assert.equal(D.filterCatalogue(list, {}).length, 2);
  assert.deepEqual(D.catalogueMatches([...list, list[0]]), ['2026-10-30', '2026-10-28']);
});

test('fromLabel names the match and side', () => {
  assert.equal(D.fromLabel('2026-10-28/black/rook'), 'from 10-28 · Black');
  assert.equal(D.fromLabel('2026-10-30/white/knight#plant_2'), 'from 10-30 · White');
  assert.equal(D.fromLabel(undefined), '');
});

test('companionNote names the helpers only when they share a name', () => {
  const c = (name) => ({ key: name, name, icon: '', royal: false, description: '', customArt: null });
  assert.equal(D.companionNote([]), '');
  assert.equal(D.companionNote([c('Plant'), c('Plant'), c('Plant')]), '+3 Plant');
  assert.equal(D.companionNote([c('Checker King')]), '+1 Checker King');
  assert.equal(D.companionNote([c('Undead Pawn'), c('Undead Knight')]), '+2 helpers');
  assert.equal(D.companionNote(undefined), '');
});
