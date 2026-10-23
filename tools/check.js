#!/usr/bin/env node
/*
 * Sanity-check the side files and fuzz them with random games.
 *
 *   node tools/check.js            check both sides
 *   node tools/check.js black      only report problems blamed on black's pieces
 *   node tools/check.js --games 500 --seed 7
 *
 * Exits non-zero if a side fails to load or any piece code crashes.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : Number(args[i + 1]);
};
const only = args.find((a) => a === 'white' || a === 'black');
const games = flag('--games', 300);
const maxPlies = flag('--plies', 300);
const baseSeed = flag('--seed', 1);

const W = require(path.join(ROOT, 'engine/engine.js'));
let failed = false;

// Run the side files as classic scripts in one shared global scope, like the browser does,
// so top-level name collisions between the two files show up here too.
for (const side of W.SIDES) {
  const file = path.join(ROOT, 'sides', side, 'pieces.js');
  try {
    vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
    if (!W.registry[side]) throw new Error(`never called WackyChess.defineSide('${side}', ...)`);
  } catch (err) {
    failed = true;
    console.error(`✖ sides/${side}/pieces.js failed to load:\n  ${err.stack || err}\n`);
  }
}
if (failed) process.exit(1);

for (const side of W.SIDES) {
  const def = W.registry[side];
  const entries = Object.entries(def.pieces);
  console.log(`${def.name || side} (${side}) — ${entries.length} piece types`);
  for (const [key, p] of entries) {
    const hooks = ['onMove', 'onCapture', 'onCaptured', 'onTurnStart', 'badge'].filter((h) => p[h]);
    console.log(`  ${p.icon}  ${key}${p.royal ? ' 👑' : ''}${hooks.length ? `  [${hooks.join(', ')}]` : ''}`);
    if (!p.description) console.log(`     ⚠ no description — your opponent won't know what it does`);
    if (W.isImageIcon(p.icon) && !fs.existsSync(path.join(ROOT, p.icon))) {
      failed = true;
      console.log(`     ✖ icon file not found: ${p.icon} (paths are relative to the repo root)`);
    }
  }
  if (!entries.some(([, p]) => p.royal)) {
    console.log('  ⚠ no royal pieces: this side only loses when every piece is gone');
  }
}

// Random self-play. Errors are grouped by message so one bug doesn't flood the output.
const errors = new Map();
const tally = { white: 0, black: 0, draw: 0, unfinished: 0 };
let plies = 0;

function record(err, seed, ply) {
  const where = err.wackyBlame || 'engine';
  if (only && !where.startsWith(`${only}:`)) return;
  const key = err.message;
  if (!errors.has(key)) errors.set(key, { err, seed, ply, count: 0 });
  errors.get(key).count++;
}

for (let i = 0; i < games; i++) {
  const seed = baseSeed + i;
  let game;
  try {
    game = new W.Game({ seed });
  } catch (err) {
    record(err, seed, 0);
    continue;
  }
  // A separate seeded stream picks the moves, so game.random() stays the game's own.
  let pickState = seed * 7919;
  const pick = (n) => {
    pickState = (pickState * 1103515245 + 12345) % 2147483648;
    return pickState % n;
  };
  let ply = 0;
  let undos = 0;
  while (!game.winner && ply < maxPlies) {
    let options;
    try {
      options = game.allLegalMoves();
    } catch (err) {
      record(err, seed, ply);
      break;
    }
    if (!options.length) break;
    const { piece, move } = options[pick(options.length)];
    try {
      game.play(piece, move);
    } catch (err) {
      record(err, seed, ply);
      break;
    }
    // Exercise undo now and then; it must not break anything.
    ply++;
    if (ply % 37 === 0 && undos < ply / 37) {
      undos++;
      game.undo();
      ply--;
    }
  }
  plies += ply;
  tally[game.winner || 'unfinished']++;
}

console.log(`\nRandom games: ${games} (up to ${maxPlies} moves each, avg ${(plies / games).toFixed(0)})`);
console.log(`  white won ${tally.white}, black won ${tally.black}, draws ${tally.draw}, unfinished ${tally.unfinished}`);

if (errors.size) {
  failed = true;
  console.log(`\n✖ ${errors.size} distinct crash${errors.size > 1 ? 'es' : ''}${only ? ` in ${only}'s pieces` : ''}:`);
  for (const { err, seed, ply, count } of errors.values()) {
    console.log(`\n  ${err.message}\n    seen ${count}x, first in game seed ${seed} at move ${ply}`);
    const original = err.cause && err.cause.stack ? err.cause.stack : err.stack;
    console.log(original.split('\n').slice(1, 5).map((l) => `    ${l.trim()}`).join('\n'));
  }
} else {
  console.log(`\n✔ no crashes${only ? ` in ${only}'s pieces` : ''}`);
}
process.exit(failed ? 1 : 0);
