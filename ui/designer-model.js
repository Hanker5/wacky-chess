/*
 * The piece designer's data model: the design file's shape and the edits the page
 * makes to it. No DOM here, so it runs under `node --test` too. In the browser it sets
 * window.WackyDesigner; in Node it is exported via module.exports.
 *
 * A design (saved as sides/<color>/design.json) looks like:
 *   { version: 1, side, name, pieces: [{ key, name, icon, royal, description, customArt }], setup }
 * setup is always 3 rows of 8, row 0 = the player's back rank, left to right from their seat.
 */
(function (root) {
  'use strict';

  const ROWS = 3;
  const SIZE = 8;
  const KEY_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;
  // The plain-chess template's icons: text symbols the game draws in the token's color,
  // which the emoji set doesn't have (its only chess piece is the color ♟️ emoji).
  const CHESS_GLYPHS = [
    ['♚', 'chess king', 'chess piece'],
    ['♛', 'chess queen', 'chess piece'],
    ['♜', 'chess rook', 'castle chess piece'],
    ['♝', 'chess bishop', 'chess piece'],
    ['♞', 'chess knight', 'horse chess piece'],
    ['♟', 'chess pawn', 'chess piece'],
  ];

  const emptyRow = () => new Array(SIZE).fill(null);
  const str = (value) => (typeof value === 'string' ? value : '');

  function slugKey(name, taken) {
    const used = new Set(taken);
    let base = str(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!base) base = 'piece';
    if (/^[0-9]/.test(base)) base = `_${base}`;
    let key = base;
    for (let n = 2; used.has(key); n++) key = `${base}_${n}`;
    return key;
  }

  function emptyDesign(side) {
    return { version: 1, side, name: '', pieces: [], setup: [emptyRow(), emptyRow(), emptyRow()] };
  }

  // Pad or trim any setup-like array to 3x8, keeping only keys that are in `keys`.
  function fitSetup(setup, keys) {
    const rows = Array.isArray(setup) ? setup : [];
    const out = [];
    for (let r = 0; r < ROWS; r++) {
      const row = Array.isArray(rows[r]) ? rows[r] : [];
      out.push(emptyRow().map((_, c) => (keys.has(row[c]) ? row[c] : null)));
    }
    return out;
  }

  function normalizeDesign(side, raw) {
    const d = raw && typeof raw === 'object' ? raw : {};
    const pieces = [];
    const keys = new Set();
    for (const p of Array.isArray(d.pieces) ? d.pieces : []) {
      if (!p || typeof p !== 'object') continue;
      // A missing, invalid, or repeated key gets a fresh one rather than losing the piece.
      const key = typeof p.key === 'string' && KEY_RE.test(p.key) && !keys.has(p.key)
        ? p.key : slugKey(str(p.name) || str(p.key), keys);
      keys.add(key);
      const art = p.customArt && typeof p.customArt === 'object' ? { description: str(p.customArt.description) } : null;
      pieces.push({
        key,
        name: str(p.name),
        icon: str(p.icon),
        royal: !!p.royal,
        description: str(p.description),
        customArt: art,
      });
    }
    return { version: 1, side, name: str(d.name), pieces, setup: fitSetup(d.setup, keys) };
  }

  function designFromSide(side, def) {
    const pieces = Object.entries(def.pieces).map(([key, p]) => ({
      key,
      name: p.name || key,
      icon: p.icon,
      royal: !!p.royal,
      description: p.description || '',
      customArt: null,
    }));
    return { version: 1, side, name: def.name || '', pieces, setup: fitSetup(def.setup, new Set(Object.keys(def.pieces))) };
  }

  function addPiece(design, name = 'New piece') {
    const key = slugKey(name, design.pieces.map((p) => p.key));
    design.pieces.push({ key, name, icon: '', royal: false, description: '', customArt: null });
    return key;
  }

  function removePiece(design, key) {
    design.pieces = design.pieces.filter((p) => p.key !== key);
    design.setup = design.setup.map((row) => row.map((k) => (k === key ? null : k)));
  }

  // Give a piece the key its name would get now, moving its placements along. Only for
  // pieces nothing else knows about yet: once a key is saved and built, it must stay.
  function rekeyPiece(design, key, name) {
    const fresh = slugKey(name, design.pieces.filter((p) => p.key !== key).map((p) => p.key));
    if (fresh === key) return key;
    for (const p of design.pieces) if (p.key === key) p.key = fresh;
    design.setup = design.setup.map((row) => row.map((k) => (k === key ? fresh : k)));
    return fresh;
  }

  function setCell(design, row, col, key) {
    design.setup[row][col] = key;
  }

  function isPlaced(design, key) {
    return design.setup.some((row) => row.includes(key));
  }

  function warnings(design) {
    const out = [];
    if (!design.pieces.some((p) => p.royal)) {
      out.push("No royal piece: you'll lose only when every one of your pieces is gone.");
    }
    const seen = new Map();
    for (const p of design.pieces) {
      const name = p.name.trim();
      if (!name) continue;
      const id = name.toLowerCase();
      seen.set(id, seen.has(id) ? { name: seen.get(id).name, count: seen.get(id).count + 1 } : { name, count: 1 });
    }
    for (const { name, count } of seen.values()) if (count > 1) out.push(`Two pieces are named "${name}".`);
    for (const p of design.pieces) {
      if (!p.description.trim()) out.push(`"${p.name.trim() || '(unnamed)'}" has no description yet.`);
    }
    return out;
  }

  // How well an entry's first-term match reads: 0 the label starts with it, 1 a word in
  // the label does, 2 a word in the tags does, 3 it's only inside a word.
  function rank(label, tags, term) {
    if (label.startsWith(term)) return 0;
    const word = (text) => text.split(/[\s:,-]+/).some((w) => w.startsWith(term));
    if (word(label)) return 1;
    return word(tags) ? 2 : 3;
  }

  // list entries are [emoji, label, tags] with tags space-separated.
  function searchEmoji(list, query, limit = 240) {
    const terms = str(query).toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return list.slice(0, limit);
    const tiers = [[], [], [], []];
    for (const entry of list) {
      const label = entry[1].toLowerCase();
      const tags = entry[2].toLowerCase();
      const text = `${label} ${tags}`;
      if (terms.every((t) => text.includes(t))) tiers[rank(label, tags, terms[0])].push(entry);
    }
    return tiers.flat().slice(0, limit);
  }

  const api = {
    KEY_RE, ROWS, SIZE, CHESS_GLYPHS,
    slugKey, emptyDesign, normalizeDesign, designFromSide,
    addPiece, removePiece, rekeyPiece, setCell, isPlaced, warnings, searchEmoji,
  };
  root.WackyDesigner = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
