'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../engine/engine.js');

const king = { icon: 'K', royal: true, moves: (p, g) => g.leap(p, g.DIRS.ALL) };
const rook = { icon: 'R', moves: (p, g) => g.slide(p, g.DIRS.ORTHO) };
const empty = () => [null, null, null, null, null, null, null, null];

// A side with a king on its back-rank e-file-ish square plus any extra pieces/rows.
function side(extraPieces = {}, setup) {
  const row = empty();
  row[4] = 'king';
  return { pieces: { king, ...extraPieces }, setup: setup || [row] };
}

function rowWith(entries) {
  const row = empty();
  for (const [i, key] of Object.entries(entries)) row[i] = key;
  return row;
}

function find(g, side, kind) {
  return g.pieces({ side, type: kind })[0];
}

function moveTo(g, piece, x, y) {
  const move = g.legalMoves(piece).find((m) => m.x === x && m.y === y);
  assert.ok(move, `expected ${piece.type} to be able to reach ${g.square(x, y)}`);
  g.play(piece, move);
}

test('setup is read from each seat: black is rotated 180°', () => {
  const setup = [rowWith({ 0: 'rook', 4: 'king' })];
  const g = new W.Game({ white: side({ rook }, setup), black: side({ rook }, setup) });
  assert.deepEqual([find(g, 'white', 'rook').x, find(g, 'white', 'rook').y], [0, 0]);
  assert.deepEqual([find(g, 'black', 'rook').x, find(g, 'black', 'rook').y], [7, 7]);
  assert.deepEqual([find(g, 'black', 'king').x, find(g, 'black', 'king').y], [3, 7]);
});

test('relative offsets flip for black', () => {
  const g = new W.Game({ white: side(), black: side() });
  const bk = find(g, 'black', 'king');
  assert.deepEqual(g.rel(bk, 1, 1), [bk.x - 1, bk.y - 1]);
  assert.equal(g.rank(bk), 1);
});

test('slide stops at blockers and captures enemies only', () => {
  const setup = [rowWith({ 0: 'rook', 4: 'king' })];
  const g = new W.Game({ white: side({ rook }, setup), black: side({}, [rowWith({ 3: 'king' })]) });
  const rookMoves = g.legalMoves(find(g, 'white', 'rook')).map((m) => g.square(m.x, m.y));
  // Up the a-file to a8 (nothing there), right until the own king on e1.
  assert.ok(rookMoves.includes('a8'));
  assert.ok(rookMoves.includes('d1'));
  assert.ok(!rookMoves.includes('e1'));
});

test('capturing the only royal wins', () => {
  const g = new W.Game({
    white: side({ rook }, [rowWith({ 0: 'rook', 4: 'king' })]),
    black: side({}, [rowWith({ 7: 'king' })]), // black king lands on a8
  });
  moveTo(g, find(g, 'white', 'rook'), 0, 7);
  assert.equal(g.winner, 'white');
  assert.match(g.result, /royal/);
});

test('a side without royal pieces loses when wiped out', () => {
  const pawnish = { icon: 'P', moves: (p, g) => g.leap(p, [[0, 1]]) };
  const g = new W.Game({
    white: side({ rook }, [rowWith({ 0: 'rook', 4: 'king' })]),
    black: { pieces: { pawnish }, setup: [rowWith({ 7: 'pawnish' })] },
  });
  moveTo(g, find(g, 'white', 'rook'), 0, 7);
  assert.equal(g.winner, 'white');
});

test('undo restores the previous position', () => {
  const g = new W.Game({ white: side({ rook }, [rowWith({ 0: 'rook', 4: 'king' })]), black: side() });
  moveTo(g, find(g, 'white', 'rook'), 0, 5);
  assert.equal(g.turn, 'black');
  assert.ok(g.undo());
  assert.equal(g.turn, 'white');
  assert.deepEqual([find(g, 'white', 'rook').x, find(g, 'white', 'rook').y], [0, 0]);
  assert.equal(g.undo(), false);
});

test('onCaptured returning false saves the piece and the attacker stays put', () => {
  const shield = { icon: 'S', moves: () => [], onCaptured: () => false };
  const g = new W.Game({
    white: side({ rook }, [rowWith({ 0: 'rook', 4: 'king' })]),
    black: side({ shield }, [rowWith({ 7: 'shield', 3: 'king' })]),
  });
  moveTo(g, find(g, 'white', 'rook'), 0, 7);
  assert.ok(find(g, 'black', 'shield'));
  assert.deepEqual([find(g, 'white', 'rook').x, find(g, 'white', 'rook').y], [0, 0]);
  assert.equal(g.turn, 'black');
});

test('action moves, extra turns, spawn, and tiles', () => {
  const summoner = {
    icon: 'Z',
    moves: (p, g) => [{
      x: p.x, y: p.y + 1, label: 'Summon',
      action(piece, game) {
        game.spawn(piece.side, 'rook', piece.x, piece.y + 1);
        game.tile(piece.x, piece.y + 2).icon = '🔥';
        game.extraTurn();
      },
    }],
  };
  const g = new W.Game({ white: side({ summoner, rook }, [rowWith({ 0: 'summoner', 4: 'king' })]), black: side() });
  const s = find(g, 'white', 'summoner');
  g.play(s, g.legalMoves(s)[0]);
  assert.equal(g.turn, 'white', 'extra turn keeps it white');
  assert.deepEqual([find(g, 'white', 'rook').x, find(g, 'white', 'rook').y], [0, 1]);
  assert.equal(g.peekTile(0, 2).icon, '🔥');
  assert.equal(find(g, 'white', 'summoner').y, 0, 'action replaced the default move');
});

test('a crashing hook rolls the move back and names the culprit', () => {
  const grenade = { icon: 'G', moves: (p, g) => g.leap(p, [[0, 1]]), onMove: () => { throw new Error('kaboom'); } };
  const g = new W.Game({ white: side({ grenade }, [rowWith({ 0: 'grenade', 4: 'king' })]), black: side() });
  assert.throws(() => moveTo(g, find(g, 'white', 'grenade'), 0, 1), /white:grenade onMove\(\) crashed: kaboom/);
  assert.equal(find(g, 'white', 'grenade').y, 0);
  assert.equal(g.turn, 'white');
});

test('a side with no legal moves loses', () => {
  const statue = { icon: 'S', royal: true, moves: () => [] };
  const g = new W.Game({
    white: side({ rook }, [rowWith({ 0: 'rook', 4: 'king' })]),
    black: { pieces: { statue }, setup: [rowWith({ 0: 'statue' })] },
  });
  moveTo(g, find(g, 'white', 'rook'), 0, 1);
  assert.equal(g.winner, 'white');
  assert.match(g.result, /no legal moves/);
});

test('transform and spawn resolve short names, falling back to the other catalog', () => {
  const zombie = { icon: 'Z', moves: () => [] };
  const g = new W.Game({ white: side({ rook }, [rowWith({ 0: 'rook', 4: 'king' })]), black: side({ zombie }) });
  const r = find(g, 'white', 'rook');
  g.transform(r, 'zombie');
  assert.equal(r.type, 'black:zombie');
  assert.throws(() => g.transform(r, 'dragon'), /Unknown piece type "dragon"/);
});

test('validation explains what is wrong', () => {
  assert.throws(() => W.validateSide('black', { pieces: { king }, setup: [['king']] }), /exactly 8 entries/);
  assert.throws(() => W.validateSide('black', { pieces: { king }, setup: [rowWith({ 0: 'queen' })] }), /unknown piece "queen"/);
  assert.throws(() => W.validateSide('black', { pieces: { bad: { icon: 'x' } }, setup: [empty()] }), /moves\(piece, game\)/);
});

test('seeded random is reproducible and survives undo', () => {
  const a = new W.Game({ white: side({ rook }, [rowWith({ 0: 'rook', 4: 'king' })]), black: side(), seed: 42 });
  const b = new W.Game({ white: side(), black: side(), seed: 42 });
  assert.equal(a.random(), b.random());
  moveTo(a, find(a, 'white', 'rook'), 0, 3);
  const next = a.random();
  a.undo();
  assert.equal(a.random(), next);
});

test('the default sides load and play like chess', () => {
  globalThis.WackyChess = W;
  require('../sides/white/pieces.js');
  require('../sides/black/pieces.js');
  const g = new W.Game();
  assert.equal(g.pieces().length, 32);
  assert.equal(g.at(3, 0).type, 'white:queen');
  assert.equal(g.at(3, 7).type, 'black:queen');
  assert.equal(g.allLegalMoves().length, 20);
});
