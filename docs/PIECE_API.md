# Piece API

Everything a side needs goes in **one file**: `sides/<color>/pieces.js`. Images, if
you want any, go in `sides/<color>/assets/`.

The side folder may also hold `design.json`, the player's sketch from the piece
designer (`designer.html`). It's a design input for whoever writes `pieces.js`, kept
in sync with it by the player's agent (see "Building from a design" in `AGENTS.md`).
The engine never reads it.

- [The side file](#the-side-file)
- [Piece definitions](#piece-definitions)
- [Moves](#moves)
- [Hooks](#hooks)
- [The `game` object](#the-game-object)
- [Visual effects](#visual-effects)
- [Rules the engine enforces](#rules-the-engine-enforces)
- [Examples of wacky pieces](#examples-of-wacky-pieces)
- [Gotchas](#gotchas)

## The side file

```js
(() => {                         // keep the wrapper: both files share one page
  WackyChess.defineSide('black', {
    name: 'The Goblin Horde',    // shown in the UI instead of "Black"
    pieces: {
      goblin_king: { /* piece definition */ },
      goblin:      { /* ... */ },
    },
    setup: [
      // From YOUR seat: first row is your back rank, listed left to right.
      // 1-3 rows, 8 entries each, null = empty square.
      [null, 'goblin', null, 'goblin_king', null, null, 'goblin', null],
      ['goblin', 'goblin', 'goblin', 'goblin', 'goblin', 'goblin', 'goblin', 'goblin'],
    ],
  });
})();
```

Black's setup is rotated 180°, so each player writes it as they see it from their
own chair. Your rows sit on ranks 1-3 (White) or 8-6 (Black). The middle two ranks
always start empty.

## Piece definitions

| Field         | Required | What it is |
|---------------|----------|------------|
| `icon`        | yes      | Emoji, a short bit of text, or an image path like `sides/black/assets/goblin.png` (relative to the repo root). |
| `moves(p, g)` | yes      | Returns the array of moves this piece can make right now. See [Moves](#moves). |
| `name`        | no       | Display name. Defaults to the key. |
| `description` | no, but please | Shown in the piece guide and when the piece is clicked. **Your opponent learns your pieces from this.** |
| `royal`       | no       | `true` = a king-like piece. Lose all your royal pieces and you lose. |
| `badge(p, g)` | no       | Returns a short string/number drawn on the piece (cooldowns, charges, kill count). Return `''` or `null` for none. |
| `onMove`, `onCapture`, `onCaptured`, `onTurnStart` | no | [Hooks](#hooks). |

Each piece on the board is a plain object:

```js
{ id: 7, side: 'black', type: 'black:goblin', x: 3, y: 6, moveCount: 0, data: {} }
```

- `x` is 0-7 for files a-h, and `y` is 0-7 for ranks 1-8. White starts at the bottom (`y = 0`).
- `moveCount` counts how many times this piece has been played.
- `data` is yours to store anything in (charges, cooldowns, mood). Store **only plain
  data**: numbers, strings, booleans, arrays, and plain objects. No functions. The
  game copies it for undo.

## Moves

`moves(piece, game)` returns an array of move objects:

```js
{ x, y }                                  // ordinary move: go there, capturing an enemy on it
{ x, y, label: 'Leap' }                   // label shows in the log and in the menu when moves share a square
{ x, y, label: 'Explode', action(piece, game, move) { ... } }   // special move
```

- **Ordinary moves** go to `(x, y)` and capture an enemy there. Out-of-bounds
  squares, the piece's own square, and squares with a friendly piece are dropped
  automatically.
- **Action moves** do *only* what `action` does. The engine will not move the piece
  for you. `(x, y)` is just the square the player clicks to pick the move. It can
  be the piece's own square, a friendly piece, an empty square, or anything else.
  Call `game.moveTo(...)`, `game.capture(...)` and so on inside the action.
- When several moves share one square, the player gets a menu of their labels.
- `moves()` must **not change anything**. It is also called to preview moves and to
  check whether a side is stuck. Make all changes inside actions and hooks.

### Move builders

Offsets are **from the piece's own seat**: `[dx, dy]` with `+dy` = forward and
`+dx` = the piece's right. They flip automatically for Black.

```js
game.slide(piece, dirs, opts)    // slide along each direction until blocked
game.leap(piece, offsets, opts)  // jump straight to each offset
// opts.max      slide only: max distance (default unlimited)
// opts.capture  true (default): empty or enemy squares
//               false:          empty squares only
//               'only':         enemy squares only
```

`game.DIRS` holds `ORTHO`, `DIAG`, `ALL` (8 directions) and `KNIGHT`. You can also
write your own offset lists, for example `[[0, 3], [3, 0], [0, -3], [-3, 0]]`.

```js
moves: (p, g) => [
  ...g.slide(p, g.DIRS.DIAG, { max: 2 }),
  ...g.leap(p, [[0, 1]], { capture: false }),
],
```

## Hooks

All hooks get `(piece, game, ...extra)`. They may change anything.

| Hook | When | Extra args |
|------|------|------------|
| `onMove(p, g, info)` | After this piece is played, if it's still on the board. Use it for promotion and other after-effects. | `info = { from: {x,y}, to: {x,y}, move }` |
| `onCapture(p, g, victim)` | After this piece captures something. During an ordinary move the attacker has **not moved onto the square yet**. | the captured piece (already off the board) |
| `onCaptured(p, g, attacker)` | When something tries to capture this piece. **Return `false` to survive.** The attacker then stays where it was. | the attacker, or `null` for explosions and other attacker-less captures |
| `onTurnStart(p, g)` | At the start of **every** turn, for every piece on the board. Check `g.turn === p.side` if you only care about your own turns. | |

## The `game` object

**Looking around**

| | |
|---|---|
| `g.at(x, y)` | The piece on that square, or `null`. |
| `g.isEmpty(x, y)` | `true` if the square is on the board and empty. |
| `g.inBounds(x, y)` | |
| `g.get(id)` | A piece by id. |
| `g.pieces(filter?)` | Array of pieces. Filter with `{ side: 'white', type: 'pawn' }` or a function. |
| `g.def(piece)` | The piece's definition object (`.name`, `.royal`, and so on). |
| `g.kind(piece)` | Short type, e.g. `'pawn'`. (`piece.type` is `'white:pawn'`.) |
| `g.nameOf(piece)` | Something like `"Black Goblin"`, for log messages. |
| `g.isEnemy(a, b)`, `g.isFriend(a, b)` | |
| `g.rel(piece, dx, dy)` | `[x, y]` of an offset from the piece's seat. |
| `g.rank(piece)` | 1 = its own back rank, 8 = the far rank. |
| `g.forward(side)` | `+1` for White, `-1` for Black (in raw `y`). |
| `g.otherSide(side)` | |
| `g.turn`, `g.turnNumber` | Whose turn it is, and the move counter. |
| `g.movesFor(piece)` | The moves a piece could make, ignoring whose turn it is (to check threats, for example). |
| `g.square(x, y)` | `'e4'` style name. |

**Changing things.** Use these only in actions and hooks.

| | |
|---|---|
| `g.moveTo(piece, x, y)` | Move it, capturing **whatever** is on the target, friend or foe. Returns `true` if it moved. |
| `g.capture(victim, attacker?)` | Capture a piece (runs `onCaptured`/`onCapture`). Returns `true` if it died. |
| `g.remove(piece)` | Remove it quietly: no hooks, and it doesn't count as captured. |
| `g.spawn(side, type, x, y, data?)` | New piece. Returns it, or `null` if the square is taken. |
| `g.transform(piece, type)` | Turn it into another type. It keeps its id, side, position, and `data`. |
| `g.convert(piece, side?)` | Switch it to the other team. |
| `g.swap(a, b)` | Swap two pieces' positions. |
| `g.extraTurn()` | The side that just moved moves again. |
| `g.win(side, reason)`, `g.draw(reason)` | End the game. |
| `g.log(text)` | Add a line to the game log. |

Type names in `spawn`/`transform` can be short (`'zombie'`) or qualified
(`'black:zombie'`). Short names look in that side's catalog first, then the other
side's. To make the opponent's piece types, use the qualified name.

**Tiles** (square effects such as traps, lava, or portals)

| | |
|---|---|
| `g.tile(x, y)` | A plain object for that square, created on first use. Set `icon`, `color` (any CSS color), and `label` (hover text) to draw it. You can store anything else there too. |
| `g.peekTile(x, y)` | The same object, or `null` if it was never created. Use this inside `moves()`. |
| `g.clearTile(x, y)` | |

Tiles don't *do* anything on their own. Your pieces' hooks give them meaning (see
the Trapper below).

**Randomness:** use `g.random()`, `g.randomInt(n)`, or `g.pick(array)`. Don't use
`Math.random()`. The game's random numbers are seeded, so undo replays the same luck.

## Visual effects

Actions and hooks can queue animations with `g.effect(kind, options)`. Effects are
pure decoration: they never change the game, and they're ignored outside the browser.

```js
g.effect('projectile', { from: [x, y], to: [x, y], icon: '🥧' })     // an icon flies between two squares
g.effect('burst', { x, y, radius: 1, icon: '✨', color: 'gold' })     // an expanding flash
```

| Option | Kind | What it is |
|--------|------|------------|
| `from`, `to` | projectile | `[x, y]` squares. Required. |
| `x`, `y` | burst | The center square. Required. |
| `radius` | burst | How far it reaches, in squares: `0` = one square, `1` (default) = the 3×3 area, and so on. |
| `icon` | both | Emoji, text, or an image path. Optional. A projectile without one is a dot. |
| `color` | both | Any CSS color. Optional (bursts default to orange). |

After a move, the UI plays every effect that move queued, in order, over the board as it
looked *before* the move. Then it shows the new position. That includes effects from
hooks that run as a result, like `onCaptured` or the next turn's `onTurnStart`. So queue
effects in the order things happen: a projectile first, then the burst where it lands.
They don't replay on undo, and they're skipped when the system asks for reduced motion.

```js
// Inside moves(), for a target square (x, y):
{ x, y, label: 'Throw pie 🥧', action(p, g) {
  g.effect('projectile', { from: [p.x, p.y], to: [x, y], icon: '🥧' });
  g.effect('burst', { x, y, radius: 0, icon: '💦', color: 'white' });
  g.capture(g.at(x, y), p);
} }
```

Like everything else that changes the game state, call `g.effect` only in actions and
hooks, never in `moves()`.

## Rules the engine enforces

- White moves first. Each turn you play exactly one move with one piece.
- No check or checkmate. Capturing royals ends the game.
- **You lose** when you have no royal pieces left. If your side defines no royal
  types at all, you lose when you have no pieces left.
- **You lose** if it's your turn and you have no legal moves.
- If both sides are wiped out at the same moment, it's a draw.
- If any piece code throws an error, the whole move is cancelled and the error is
  shown (blaming the piece and hook). The game keeps going.

## Examples of wacky pieces

```js
// Explodes, taking out everything around it (friends too) and itself.
bomb: {
  name: 'Bomb', icon: '💣',
  description: 'Steps 1 square. Or detonate: destroys itself and every piece next to it.',
  moves: (p, g) => [
    ...g.leap(p, g.DIRS.ALL, { capture: false }),
    { x: p.x, y: p.y, label: 'Detonate 💥', action(p, g) {
      for (const [dx, dy] of g.DIRS.ALL) {
        const victim = g.at(...g.rel(p, dx, dy));
        if (victim) g.capture(victim, null);
      }
      g.capture(p, null);
    } },
  ],
},

// Grows stronger with kills (data + badge + transform).
vampire: {
  name: 'Vampire', icon: '🧛',
  description: 'Moves like a king. After 3 captures it becomes a Bat Lord.',
  moves: (p, g) => g.leap(p, g.DIRS.ALL),
  badge: (p) => p.data.kills || '',
  onCapture(p, g) {
    p.data.kills = (p.data.kills || 0) + 1;
    if (p.data.kills >= 3) { g.transform(p, 'bat_lord'); g.log('🦇 A Bat Lord rises!'); }
  },
},

// Teleports anywhere, then needs 3 of its own turns to recharge (onTurnStart + badge).
wizard: {
  name: 'Wizard', icon: '🧙',
  description: 'Steps 1 square, or teleports to any empty square. Teleporting needs 3 turns to recharge.',
  badge: (p) => p.data.cooldown || '',
  moves(p, g) {
    const out = g.leap(p, g.DIRS.ALL);
    if (!p.data.cooldown) {
      for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) {
        if (g.isEmpty(x, y)) out.push({ x, y, label: 'Teleport ✨', action(p, g, m) {
          g.moveTo(p, m.x, m.y);
          p.data.cooldown = 3;
        } });
      }
    }
    return out;
  },
  onTurnStart(p, g) {
    if (g.turn === p.side && p.data.cooldown) p.data.cooldown--;
  },
},

// Lays traps (tiles). Its onTurnStart springs them on enemies.
trapper: {
  name: 'Trapper', icon: '🪤',
  description: 'Moves 1 straight. Or lays a hidden-ish trap next to it; enemies ending a turn on a trap are destroyed.',
  moves: (p, g) => [
    ...g.leap(p, g.DIRS.ORTHO),
    ...g.leap(p, g.DIRS.DIAG, { capture: false }).map((m) => ({ ...m, label: 'Lay trap', action(p, g, m) {
      Object.assign(g.tile(m.x, m.y), { icon: '🪤', label: `${p.side}'s trap`, trapOwner: p.side });
    } })),
  ],
  onTurnStart(p, g) {
    for (const enemy of g.pieces({ side: g.otherSide(p.side) })) {
      const t = g.peekTile(enemy.x, enemy.y);
      if (t && t.trapOwner === p.side) {
        g.clearTile(enemy.x, enemy.y);
        g.log(`🪤 ${g.nameOf(enemy)} stepped on a trap!`);
        g.capture(enemy, null);
      }
    }
  },
},

// Survives the first hit (onCaptured returning false).
knight_errant: {
  name: 'Shield Knight', icon: '🛡️',
  description: 'Moves like a knight. Its shield blocks the first capture against it.',
  moves: (p, g) => g.leap(p, g.DIRS.KNIGHT),
  badge: (p) => (p.data.shieldBroken ? '' : '🛡'),
  onCaptured(p, g, attacker) {
    if (p.data.shieldBroken) return true;
    p.data.shieldBroken = true;
    g.log(`${g.nameOf(p)}'s shield shatters!`);
    return false;
  },
},

// Steals an adjacent enemy (convert), then gets another move (extraTurn).
hypnotist: {
  name: 'Hypnotist', icon: '🌀',
  description: 'Moves 1 diagonally. Can hypnotize an adjacent non-royal enemy onto your team, once per game, and then move again.',
  moves(p, g) {
    const out = g.leap(p, g.DIRS.DIAG, { capture: false });
    if (!p.data.used) {
      for (const [dx, dy] of g.DIRS.ALL) {
        const [x, y] = g.rel(p, dx, dy);
        const t = g.inBounds(x, y) && g.at(x, y);
        if (t && g.isEnemy(p, t) && !g.def(t).royal) {
          out.push({ x, y, label: 'Hypnotize 🌀', action(p, g) {
            g.convert(t, p.side);
            p.data.used = true;
            g.extraTurn();
          } });
        }
      }
    }
    return out;
  },
},
```

## Gotchas

- **Keep the `(() => { ... })()` wrapper.** Both side files load into one page. A
  top-level `const goblin = ...` in both files would crash the page.
- **`moves()` must not change anything**, not even `p.data`, and must not call `g.effect`.
- Inside an action that runs over a list (like the Hypnotist), capture the target in
  the closure. Don't look it up again later.
- `onCapture` fires before the attacker moves in. If you spawn something on the
  victim's square there, the attacker can't move in and stays put.
- `game.moveTo` captures friends too. Check first if that's not what you want.
- Hooks can trigger other hooks: a capture inside `onTurnStart` runs the victim's
  `onCaptured`. Avoid infinite loops, like two pieces that capture each other forever.
- Run `node tools/check.js <your color>` after every change. It plays hundreds of
  random games and reports any crash in your pieces, with the seed to reproduce it.
