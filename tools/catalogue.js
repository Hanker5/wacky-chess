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
const vm = require('node:vm');

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

module.exports = {
  loadSides, rewriteIcon, isStock, draftEntries, findDuplicates, mergeEntries, makeCompanion, dropEntry,
};
