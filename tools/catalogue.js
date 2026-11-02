#!/usr/bin/env node
/*
 * Maintain the piece catalogue: catalogue/catalogue.json plus a snapshot of every
 * finished match's side files, so players can reuse past pieces from the designer.
 *
 *   node tools/catalogue.js add <match>                  snapshot origin/match/<match> and draft its entries
 *   node tools/catalogue.js companion <parentId> <childId>  fold a helper piece into its parent's entry
 *   node tools/catalogue.js drop <id>                    remove an entry (stock piece, duplicate)
 *
 * Snapshots are history: they're copied byte for byte and never patched. Only the
 * icons in catalogue.json are rewritten to point inside catalogue/.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SIDE_ORDER = ['white', 'black'];
const COMPANION_FIELDS = ['key', 'name', 'icon', 'royal', 'description', 'customArt'];

// Run an engine and side files in a context of their own, so old snapshots can't
// collide with each other or with the engine this process loaded.
function loadSides(engineSrc, sideSrcs) {
  const ctx = vm.createContext({});
  vm.runInContext(engineSrc, ctx, { filename: 'engine.js' });
  for (const side of SIDE_ORDER) {
    if (sideSrcs[side] !== undefined) vm.runInContext(sideSrcs[side], ctx, { filename: `sides/${side}/pieces.js` });
  }
  return ctx.WackyChess.registry;
}

function rewriteIcon(icon, match, side) {
  const prefix = `sides/${side}/assets/`;
  return typeof icon === 'string' && icon.startsWith(prefix)
    ? `catalogue/${match}/${side}/assets/${icon.slice(prefix.length)}`
    : icon;
}

function isStock(def, templatePieces) {
  return Object.values(templatePieces).some((t) => t.icon === def.icon && t.description === def.description);
}

function draftEntries({ match, side, sideDef, design, templatePieces }) {
  const art = new Map(((design && design.pieces) || []).map((p) => [p.key, p.customArt]));
  return Object.entries(sideDef.pieces)
    .filter(([, def]) => !isStock(def, templatePieces))
    .map(([key, def]) => ({
      id: `${match}/${side}/${key}`,
      match,
      side,
      sideName: sideDef.name || side,
      key,
      name: def.name || key,
      icon: rewriteIcon(def.icon, match, side),
      royal: !!def.royal,
      description: def.description || '',
      customArt: art.get(key) ? { description: String(art.get(key).description || '') } : null,
      companions: [],
    }));
}

function findDuplicates(entries, existing) {
  const known = [];
  for (const x of existing) {
    known.push({ id: x.id, name: x.name, description: x.description });
    for (const c of x.companions || []) known.push({ id: `${x.id}#${c.key}`, name: c.name, description: c.description });
  }
  const out = [];
  for (const entry of entries) {
    const hit = known.find((k) => k.name === entry.name && k.description === entry.description);
    if (hit) out.push({ id: entry.id, duplicateOf: hit.id });
  }
  return out;
}

// Newest match first, White before Black; Array#sort is stable, so each side keeps
// its side-file piece order.
function sortEntries(entries) {
  return entries.slice().sort((a, b) => (a.match === b.match
    ? SIDE_ORDER.indexOf(a.side) - SIDE_ORDER.indexOf(b.side)
    : (a.match < b.match ? 1 : -1)));
}

function mergeEntries(catalogue, match, entries) {
  const kept = ((catalogue && catalogue.entries) || []).filter((x) => x.match !== match);
  return { version: 1, entries: sortEntries([...kept, ...entries]) };
}

function findEntry(catalogue, id) {
  const entry = catalogue.entries.find((x) => x.id === id);
  if (!entry) throw new Error(`No catalogue entry ${id}`);
  return entry;
}

function makeCompanion(catalogue, parentId, childId) {
  const parent = findEntry(catalogue, parentId);
  const child = findEntry(catalogue, childId);
  if (parent.match !== child.match || parent.side !== child.side) {
    throw new Error(`${childId} can only be a companion of a piece from the same match and side`);
  }
  const companion = Object.fromEntries(COMPANION_FIELDS.map((f) => [f, child[f]]));
  return {
    ...catalogue,
    entries: catalogue.entries
      .filter((x) => x !== child)
      .map((x) => (x === parent ? { ...x, companions: [...x.companions, companion] } : x)),
  };
}

function dropEntry(catalogue, id) {
  const entry = findEntry(catalogue, id);
  return { ...catalogue, entries: catalogue.entries.filter((x) => x !== entry) };
}

// ------------------------------------------------------------- git side

// git(args) -> { ok, out: Buffer }. Injected so the tests can fake it.
function realGit(args) {
  const r = spawnSync('git', args, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: r.stdout || Buffer.alloc(0) };
}

const branchExists = (git, ref) => git(['rev-parse', '--verify', '--quiet', ref]).ok;

// The catalogue is public, so only a match whose player branches are merged (or gone)
// may go in: an unmerged player branch may still hold a secret side.
function checkSecrecy(match, git) {
  const ref = `origin/match/${match}`;
  if (!branchExists(git, ref)) return `No branch ${ref}. Run git fetch, and check the match name.`;
  for (const color of SIDE_ORDER) {
    const player = `${ref}-${color}`;
    if (branchExists(git, player) && !git(['merge-base', '--is-ancestor', player, ref]).ok) {
      return `match/${match}-${color} isn't merged into match/${match} yet, so its pieces may still be secret. Merge it first.`;
    }
  }
  return null;
}

function show(git, spec) {
  const r = git(['show', spec]);
  if (!r.ok) throw new Error(`git show ${spec} failed`);
  return r.out;
}

function readCatalogue(root) {
  const file = path.join(root, 'catalogue', 'catalogue.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { version: 1, entries: [] };
}

function writeCatalogue(root, catalogue) {
  fs.mkdirSync(path.join(root, 'catalogue'), { recursive: true });
  fs.writeFileSync(path.join(root, 'catalogue', 'catalogue.json'), `${JSON.stringify(catalogue, null, 2)}\n`);
}

// Snapshot origin/match/<match> into catalogue/<match>/ and draft its entries into
// catalogue.json, replacing anything that match had there before.
function snapshotMatch(match, git, root) {
  const ref = `origin/match/${match}`;
  const engineSrc = show(git, `${ref}:engine/engine.js`).toString('utf8');
  const sources = {};
  for (const side of SIDE_ORDER) sources[side] = show(git, `${ref}:sides/${side}/pieces.js`);
  const registry = loadSides(engineSrc, { white: sources.white.toString('utf8'), black: sources.black.toString('utf8') });
  const template = loadSides(show(git, 'origin/main:engine/engine.js').toString('utf8'), {
    white: show(git, 'origin/main:sides/white/pieces.js').toString('utf8'),
    black: show(git, 'origin/main:sides/black/pieces.js').toString('utf8'),
  });
  const templatePieces = { ...template.white.pieces, ...template.black.pieces };

  const dir = path.join(root, 'catalogue', match);
  fs.rmSync(dir, { recursive: true, force: true });
  const catalogue = readCatalogue(root);
  const others = catalogue.entries.filter((x) => x.match !== match);
  const drafted = [];
  const report = [];
  for (const side of SIDE_ORDER) {
    const sideDir = path.join(dir, side);
    fs.mkdirSync(sideDir, { recursive: true });
    fs.writeFileSync(path.join(sideDir, 'pieces.js'), sources[side]);
    const prefix = `sides/${side}/assets/`;
    const assets = git(['ls-tree', '-r', '--name-only', ref, '--', prefix]).out.toString('utf8').split('\n').filter(Boolean);
    for (const asset of assets) {
      const target = path.join(sideDir, 'assets', asset.slice(prefix.length));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, show(git, `${ref}:${asset}`));
    }

    let design = null;
    const designFile = git(['show', `${ref}:sides/${side}/design.json`]);
    if (designFile.ok) {
      try { design = JSON.parse(designFile.out.toString('utf8')); } catch (err) { design = null; }
    }
    const sideDef = registry[side];
    const entries = draftEntries({ match, side, sideDef, design, templatePieces });
    const dupes = new Map(findDuplicates(entries, others).map((d) => [d.id, d.duplicateOf]));
    const inSetup = new Set(sideDef.setup.flat());
    for (const entry of entries) {
      const flags = [];
      if (dupes.has(entry.id)) flags.push(`⚠ possible duplicate of ${dupes.get(entry.id)}`);
      if (!inSetup.has(entry.key)) flags.push('· not in starting setup (helper?)');
      report.push(`${entry.id}  ${entry.name}${flags.length ? `  ${flags.join('  ')}` : ''}`);
    }
    for (const [key, def] of Object.entries(sideDef.pieces)) {
      if (isStock(def, templatePieces)) report.push(`left out (stock chess): ${match}/${side}/${key}`);
    }
    drafted.push(...entries);
  }
  const merged = mergeEntries(catalogue, match, drafted);
  writeCatalogue(root, merged);
  return { catalogue: merged, report };
}

module.exports = {
  loadSides, rewriteIcon, isStock, draftEntries, findDuplicates, mergeEntries, makeCompanion, dropEntry,
  checkSecrecy, snapshotMatch,
};

if (require.main === module) {
  const [cmd, ...args] = process.argv.slice(2);
  const usage = () => {
    console.error('Usage:\n  node tools/catalogue.js add <match>\n  node tools/catalogue.js companion <parentId> <childId>\n  node tools/catalogue.js drop <id>');
    process.exit(1);
  };
  try {
    if (cmd === 'add' && args.length === 1) {
      if (!realGit(['fetch', '--prune']).ok) console.warn('⚠ git fetch failed; using the branches you already have.');
      const refusal = checkSecrecy(args[0], realGit);
      if (refusal) {
        console.error(`✖ ${refusal}`);
        process.exit(1);
      }
      const { report } = snapshotMatch(args[0], realGit, ROOT);
      console.log(report.join('\n'));
      console.log('\nNext: fold helpers in with `companion`, remove duplicates and near-stock pieces with `drop`, then run node --test.');
    } else if (cmd === 'companion' && args.length === 2) {
      writeCatalogue(ROOT, makeCompanion(readCatalogue(ROOT), args[0], args[1]));
      console.log(`${args[1]} is now a companion of ${args[0]}`);
    } else if (cmd === 'drop' && args.length === 1) {
      writeCatalogue(ROOT, dropEntry(readCatalogue(ROOT), args[0]));
      console.log(`dropped ${args[0]}`);
    } else {
      usage();
    }
  } catch (err) {
    console.error(`✖ ${err.message}`);
    process.exit(1);
  }
}
