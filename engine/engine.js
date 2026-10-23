/*
 * Wacky Chess engine.
 *
 * A plain script (no modules, no build step) so index.html works when opened
 * straight from disk. In the browser it sets window.WackyChess; in Node it is
 * also exported via module.exports.
 *
 * Players never edit this file. Each side's pieces live in sides/<color>/pieces.js
 * and talk to the engine through the `game` object documented in docs/PIECE_API.md.
 */
(function (root) {
  'use strict';

  const SIDES = ['white', 'black'];
  const SIZE = 8;
  const FILES = 'abcdefgh';
  const HOOKS = ['moves', 'onMove', 'onCapture', 'onCaptured', 'onTurnStart', 'badge'];
  const IMAGE_RE = /\.(png|jpe?g|gif|svg|webp)$/i;
  const MAX_MOVE_DEPTH = 4;

  // Offsets are written from the moving piece's own seat: +y is "forward".
  const DIRS = {
    ORTHO: [[0, 1], [1, 0], [0, -1], [-1, 0]],
    DIAG: [[1, 1], [1, -1], [-1, -1], [-1, 1]],
    KNIGHT: [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]],
  };
  DIRS.ALL = DIRS.ORTHO.concat(DIRS.DIAG);

  const registry = {};
  const loadErrors = [];

  function otherSide(side) {
    return side === 'white' ? 'black' : 'white';
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function square(x, y) {
    return FILES[x] + (y + 1);
  }

  // Tag an error with which piece/hook blew up, keeping the innermost tag.
  function blame(err, where) {
    if (err && err.wackyBlame) return err;
    const message = err && err.message ? err.message : String(err);
    const wrapped = new Error(`${where} crashed: ${message}`);
    wrapped.wackyBlame = where;
    wrapped.cause = err;
    if (err && err.stack) wrapped.stack = `${wrapped.message}\n--- original ---\n${err.stack}`;
    return wrapped;
  }

  function validateSide(side, def) {
    if (!SIDES.includes(side)) {
      throw new Error(`defineSide: side must be "white" or "black", got ${JSON.stringify(side)}`);
    }
    const fail = (msg) => {
      throw new Error(`sides/${side}/pieces.js: ${msg}`);
    };
    if (!def || typeof def !== 'object') fail('defineSide needs a definition object');
    if (!def.pieces || typeof def.pieces !== 'object' || !Object.keys(def.pieces).length) {
      fail('needs a non-empty "pieces" object');
    }
    for (const [key, p] of Object.entries(def.pieces)) {
      if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) {
        fail(`piece key "${key}" should be a simple name like "fire_knight"`);
      }
      if (!p || typeof p !== 'object') fail(`piece "${key}" must be an object`);
      if (typeof p.icon !== 'string' || !p.icon) {
        fail(`piece "${key}" needs an icon (emoji, text, or image path)`);
      }
      if (typeof p.moves !== 'function') fail(`piece "${key}" needs a moves(piece, game) function`);
      for (const hook of HOOKS) {
        if (p[hook] !== undefined && typeof p[hook] !== 'function') {
          fail(`piece "${key}".${hook} must be a function`);
        }
      }
    }
    if (!Array.isArray(def.setup) || def.setup.length < 1 || def.setup.length > 3) {
      fail('"setup" must be an array of 1-3 rows, back rank first');
    }
    def.setup.forEach((row, r) => {
      if (!Array.isArray(row) || row.length !== SIZE) {
        fail(`setup row ${r} must have exactly 8 entries (use null for an empty square)`);
      }
      row.forEach((key) => {
        if (key !== null && !def.pieces[key]) fail(`setup row ${r} uses unknown piece "${key}"`);
      });
    });
  }

  function defineSide(side, def) {
    validateSide(side, def);
    registry[side] = def;
    return def;
  }

  class Game {
    /**
     * @param {object} [opts]
     * @param {object} [opts.white] side definition (defaults to the registered one)
     * @param {object} [opts.black] side definition (defaults to the registered one)
     * @param {number} [opts.seed]  seed for game.random()
     */
    constructor(opts = {}) {
      const sides = { white: opts.white || registry.white, black: opts.black || registry.black };
      for (const side of SIDES) {
        if (!sides[side]) throw new Error(`No ${side} side loaded. Did sides/${side}/pieces.js run?`);
        validateSide(side, sides[side]);
      }
      this.sides = sides;
      this.DIRS = DIRS;
      this.SIZE = SIZE;
      this.history = [];
      this._depth = 0;
      this.state = {
        turn: 'white',
        turnNumber: 1,
        pieces: [],
        captured: [],
        tiles: {},
        log: [],
        winner: null,
        result: null,
        nextId: 1,
        extraTurn: false,
        lastMove: null,
        rng: (opts.seed !== undefined ? opts.seed : Math.floor(Math.random() * 2 ** 31)) | 0,
      };
      for (const side of SIDES) {
        sides[side].setup.forEach((row, r) => {
          row.forEach((key, i) => {
            if (key === null) return;
            // Setup rows are read from each player's own seat, so Black's is rotated.
            const x = side === 'white' ? i : SIZE - 1 - i;
            const y = side === 'white' ? r : SIZE - 1 - r;
            this._place(side, `${side}:${key}`, x, y);
          });
        });
      }
      this._startTurn();
    }

    // ---------------------------------------------------------------- status

    get turn() { return this.state.turn; }
    get turnNumber() { return this.state.turnNumber; }
    /** 'white', 'black', 'draw', or null while the game is on. */
    get winner() { return this.state.winner; }
    get result() { return this.state.result; }

    sideName(side) {
      return (this.sides[side] && this.sides[side].name) || side[0].toUpperCase() + side.slice(1);
    }

    // --------------------------------------------------------------- lookups

    inBounds(x, y) {
      return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < SIZE && y >= 0 && y < SIZE;
    }

    at(x, y) {
      return this.state.pieces.find((p) => p.x === x && p.y === y) || null;
    }

    isEmpty(x, y) {
      return this.inBounds(x, y) && !this.at(x, y);
    }

    get(id) {
      return this.state.pieces.find((p) => p.id === id) || null;
    }

    isOnBoard(piece) {
      return !!piece && this.state.pieces.includes(piece);
    }

    /** All pieces, optionally filtered by {side, type} or a predicate. */
    pieces(filter) {
      const list = this.state.pieces.slice();
      if (!filter) return list;
      if (typeof filter === 'function') return list.filter(filter);
      return list.filter((p) => {
        if (filter.side && p.side !== filter.side) return false;
        if (filter.type) {
          const matches = filter.type.includes(':') ? p.type === filter.type : this.kind(p) === filter.type;
          if (!matches) return false;
        }
        return true;
      });
    }

    def(piece) {
      return this._defByType(piece.type);
    }

    /** Short piece key, e.g. "pawn" for type "white:pawn". */
    kind(piece) {
      return piece.type.split(':')[1];
    }

    nameOf(piece) {
      if (!piece) return '???';
      const def = this.def(piece);
      return `${this.sideName(piece.side)} ${(def && def.name) || this.kind(piece)}`;
    }

    isEnemy(a, b) { return !!a && !!b && a.side !== b.side; }
    isFriend(a, b) { return !!a && !!b && a.side === b.side; }
    otherSide(side) { return otherSide(side); }
    forward(side) { return side === 'white' ? 1 : -1; }
    square(x, y) { return square(x, y); }

    /** Absolute [x, y] of an offset from the piece's own seat (+dy is forward, +dx is its right). */
    rel(piece, dx, dy) {
      const f = this.forward(piece.side);
      return [piece.x + dx * f, piece.y + dy * f];
    }

    /** 1 = the piece's own back rank, 8 = the far rank. */
    rank(piece) {
      return piece.side === 'white' ? piece.y + 1 : SIZE - piece.y;
    }

    // -------------------------------------------------------- move building

    /** Slide along each direction until blocked. opts: {max, capture: true | false | 'only'}. */
    slide(piece, dirs, opts = {}) {
      const max = opts.max === undefined ? SIZE : opts.max;
      const capture = opts.capture === undefined ? true : opts.capture;
      const out = [];
      for (const [dx, dy] of dirs) {
        for (let step = 1; step <= max; step++) {
          const [x, y] = this.rel(piece, dx * step, dy * step);
          if (!this.inBounds(x, y)) break;
          const occupant = this.at(x, y);
          if (!occupant) {
            if (capture !== 'only') out.push({ x, y });
            continue;
          }
          if (capture && occupant.side !== piece.side) out.push({ x, y });
          break;
        }
      }
      return out;
    }

    /** Jump straight to each offset, ignoring anything in between. opts: {capture}. */
    leap(piece, offsets, opts = {}) {
      const capture = opts.capture === undefined ? true : opts.capture;
      const out = [];
      for (const [dx, dy] of offsets) {
        const [x, y] = this.rel(piece, dx, dy);
        if (!this.inBounds(x, y)) continue;
        const occupant = this.at(x, y);
        if (!occupant) {
          if (capture !== 'only') out.push({ x, y });
        } else if (capture && occupant.side !== piece.side) {
          out.push({ x, y });
        }
      }
      return out;
    }

    /** Every move this piece could make if it were its turn (no turn check). */
    movesFor(piece) {
      if (!this.isOnBoard(piece) || this._depth >= MAX_MOVE_DEPTH) return [];
      this._depth++;
      try {
        const raw = this._call(piece, 'moves');
        if (!Array.isArray(raw)) {
          throw blame(new Error(`returned ${typeof raw} instead of an array`), `${piece.type} moves()`);
        }
        return raw.filter((move) => {
          if (!move || typeof move.x !== 'number' || typeof move.y !== 'number') {
            throw blame(new Error(`returned a move without numeric x/y: ${JSON.stringify(move)}`), `${piece.type} moves()`);
          }
          return this._isValidMove(piece, move);
        });
      } finally {
        this._depth--;
      }
    }

    legalMoves(piece) {
      if (this.state.winner || !piece || piece.side !== this.state.turn) return [];
      return this.movesFor(piece);
    }

    /** [{piece, move}] for every legal move of `side` (defaults to the side to move). */
    allLegalMoves(side = this.state.turn) {
      if (side !== this.state.turn) return [];
      const out = [];
      for (const piece of this.pieces({ side })) {
        for (const move of this.legalMoves(piece)) out.push({ piece, move });
      }
      return out;
    }

    _isValidMove(piece, move) {
      if (!move || !this.inBounds(move.x, move.y)) return false;
      if (move.action !== undefined) return typeof move.action === 'function';
      if (move.x === piece.x && move.y === piece.y) return false;
      const occupant = this.at(move.x, move.y);
      return !occupant || occupant.side !== piece.side;
    }

    // ------------------------------------------------------------ playing

    /** Make a move for the side to move. Rolls everything back if any hook throws. */
    play(pieceOrId, move) {
      if (this.state.winner) throw new Error('The game is over.');
      const piece = typeof pieceOrId === 'object' ? pieceOrId : this.get(pieceOrId);
      if (!this.isOnBoard(piece)) throw new Error('That piece is not on the board.');
      if (piece.side !== this.state.turn) throw new Error(`It is ${this.state.turn}'s turn.`);
      if (!this._isValidMove(piece, move)) throw new Error('Illegal move.');

      const before = clone(this.state);
      try {
        const from = { x: piece.x, y: piece.y };
        const to = { x: move.x, y: move.y };
        const label = move.label ? ` (${move.label})` : '';
        this.log(`${this.nameOf(piece)} ${square(from.x, from.y)} → ${square(to.x, to.y)}${label}`);
        if (move.action) {
          try {
            move.action(piece, this, move);
          } catch (err) {
            throw blame(err, `${piece.type} move "${move.label || 'action'}"`);
          }
        } else {
          this.moveTo(piece, move.x, move.y);
        }
        if (this.isOnBoard(piece)) {
          piece.moveCount++;
          this._call(piece, 'onMove', { from, to, move });
        }
        this.state.lastMove = { from, to };
        this._endTurn();
      } catch (err) {
        this.state = before;
        throw err;
      }
      this.history.push(before);
    }

    undo() {
      if (!this.history.length) return false;
      this.state = this.history.pop();
      return true;
    }

    // ------------------------------------------------- board manipulation

    /** Move a piece, capturing whatever is on the target square. Returns true if it moved. */
    moveTo(piece, x, y) {
      if (!this.isOnBoard(piece) || !this.inBounds(x, y)) return false;
      if (piece.x === x && piece.y === y) return true;
      const occupant = this.at(x, y);
      if (occupant && !this.capture(occupant, piece)) return false;
      // A capture hook might have killed the mover or dropped something on the square.
      if (!this.isOnBoard(piece) || this.at(x, y)) return false;
      piece.x = x;
      piece.y = y;
      return true;
    }

    /** Capture a piece (attacker may be null). onCaptured returning false saves it. */
    capture(victim, attacker = null) {
      if (!this.isOnBoard(victim)) return false;
      if (this._call(victim, 'onCaptured', attacker) === false) return false;
      if (!this.isOnBoard(victim)) return true;
      this._removeFromBoard(victim);
      this.state.captured.push(victim);
      this.log(attacker ? `${this.nameOf(attacker)} captured ${this.nameOf(victim)}` : `${this.nameOf(victim)} was destroyed`);
      if (attacker && this.isOnBoard(attacker)) this._call(attacker, 'onCapture', victim);
      return true;
    }

    /** Take a piece off the board with no hooks and no capture credit. */
    remove(piece) {
      if (!this.isOnBoard(piece)) return false;
      this._removeFromBoard(piece);
      return true;
    }

    /** Create a new piece. Returns it, or null if the square is taken or off-board. */
    spawn(side, type, x, y, data = {}) {
      if (!SIDES.includes(side)) throw new Error(`spawn: unknown side ${JSON.stringify(side)}`);
      if (!this.inBounds(x, y) || this.at(x, y)) return null;
      return this._place(side, this._qualify(type, [side, otherSide(side)]), x, y, data);
    }

    /** Change what a piece is. Keeps its id, side, position, and data. Short names look in the owner's catalog first. */
    transform(piece, type) {
      const origin = piece.type.split(':')[0];
      piece.type = this._qualify(type, [piece.side, origin, otherSide(piece.side)]);
      return piece;
    }

    /** Switch a piece to the other team (or a given side). */
    convert(piece, side = otherSide(piece.side)) {
      piece.side = side;
      return piece;
    }

    swap(a, b) {
      [a.x, b.x] = [b.x, a.x];
      [a.y, b.y] = [b.y, a.y];
    }

    /** The side that just moved goes again after this move. */
    extraTurn() {
      this.state.extraTurn = true;
    }

    win(side, reason = '') {
      if (this.state.winner) return;
      this.state.winner = side;
      this.state.result = reason || `${this.sideName(side)} wins!`;
      this.log(`🏆 ${this.state.result}`);
    }

    draw(reason = 'Draw') {
      if (this.state.winner) return;
      this.state.winner = 'draw';
      this.state.result = reason;
      this.log(`🤝 ${reason}`);
    }

    log(message) {
      this.state.log.push({ turn: this.state.turnNumber, side: this.state.turn, text: String(message) });
    }

    // ---------------------------------------------------------------- tiles

    /** A per-square object for traps, lava, etc. Created on first access. Render with {icon, color, label}. */
    tile(x, y) {
      const key = `${x},${y}`;
      if (!this.state.tiles[key]) this.state.tiles[key] = {};
      return this.state.tiles[key];
    }

    /** Like tile() but returns null instead of creating one. */
    peekTile(x, y) {
      return this.state.tiles[`${x},${y}`] || null;
    }

    clearTile(x, y) {
      delete this.state.tiles[`${x},${y}`];
    }

    // --------------------------------------------------------------- random

    /** Seeded random number in [0, 1). Use this instead of Math.random so undo stays consistent. */
    random() {
      let t = (this.state.rng = (this.state.rng + 0x6d2b79f5) | 0);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    randomInt(n) {
      return Math.floor(this.random() * n);
    }

    pick(list) {
      return list.length ? list[this.randomInt(list.length)] : undefined;
    }

    // ------------------------------------------------------------- internal

    _defByType(type) {
      const [side, key] = type.split(':');
      const def = this.sides[side];
      return def && Object.prototype.hasOwnProperty.call(def.pieces, key) ? def.pieces[key] : null;
    }

    _qualify(type, preferredSides) {
      const candidates = type.includes(':') ? [type] : [...new Set(preferredSides)].map((side) => `${side}:${type}`);
      const found = candidates.find((t) => this._defByType(t));
      if (!found) throw new Error(`Unknown piece type "${type}" (tried ${candidates.join(', ')})`);
      return found;
    }

    _place(side, type, x, y, data = {}) {
      const piece = { id: this.state.nextId++, side, type, x, y, moveCount: 0, data: clone(data) };
      this.state.pieces.push(piece);
      return piece;
    }

    _removeFromBoard(piece) {
      this.state.pieces.splice(this.state.pieces.indexOf(piece), 1);
    }

    _call(piece, hook, ...args) {
      const def = this.def(piece);
      const fn = def && def[hook];
      if (!fn) return undefined;
      try {
        return fn.call(def, piece, this, ...args);
      } catch (err) {
        throw blame(err, `${piece.type} ${hook}()`);
      }
    }

    _alive(side) {
      const mine = this.state.pieces.filter((p) => p.side === side);
      const hasRoyals = Object.values(this.sides[side].pieces).some((d) => d.royal);
      return hasRoyals ? mine.some((p) => this.def(p).royal) : mine.length > 0;
    }

    _checkWinner() {
      if (this.state.winner) return;
      const dead = SIDES.filter((side) => !this._alive(side));
      if (dead.length === 2) {
        this.draw('Both sides were wiped out at once!');
      } else if (dead.length === 1) {
        const loser = dead[0];
        const hasRoyals = Object.values(this.sides[loser].pieces).some((d) => d.royal);
        this.win(otherSide(loser), `${this.sideName(otherSide(loser))} wins: ${this.sideName(loser)} ${hasRoyals ? 'lost all its royal pieces' : 'was wiped out'}.`);
      }
    }

    _endTurn() {
      this._checkWinner();
      if (this.state.winner) return;
      if (this.state.extraTurn) {
        this.state.extraTurn = false;
        this.log(`${this.sideName(this.state.turn)} moves again!`);
      } else {
        this.state.turn = otherSide(this.state.turn);
      }
      this.state.turnNumber++;
      this._startTurn();
    }

    _startTurn() {
      for (const piece of this.state.pieces.slice()) {
        if (this.isOnBoard(piece)) this._call(piece, 'onTurnStart');
      }
      this._checkWinner();
      if (this.state.winner) return;
      if (this.allLegalMoves().length === 0) {
        const stuck = this.state.turn;
        this.win(otherSide(stuck), `${this.sideName(otherSide(stuck))} wins: ${this.sideName(stuck)} has no legal moves.`);
      }
    }
  }

  // Collect script errors (e.g. a typo in a side file) so the UI can show them.
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('error', (e) => {
      loadErrors.push(`${e.filename ? e.filename.split('/').slice(-3).join('/') : 'script'}:${e.lineno || '?'} ${e.message}`);
    });
  }

  const api = {
    SIDES, SIZE, FILES, DIRS, registry, loadErrors,
    defineSide, validateSide, Game, otherSide, square,
    isImageIcon: (icon) => IMAGE_RE.test(icon),
  };
  root.WackyChess = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
