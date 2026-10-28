// White's pieces. This whole folder belongs to the White player.
// Read AGENTS.md and docs/PIECE_API.md before changing anything.
//
// Keep everything inside this (() => { ... })() wrapper: both sides' files share
// one page, so top-level variables would collide with the other player's file.
(() => {
  // The 8 directions in order around a circle, so +-1 is a 45 degree turn and +-2 is 90.
  const RING = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
  const TURNS = [-2, -1, 1, 2];

  const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

  // Counts a cooldown down at the start of the owner's own turns.
  const tick = (p, g) => {
    if (g.turn === p.side && p.data.cooldown) p.data.cooldown--;
  };

  const cooldownBadge = (p) => p.data.cooldown || '';

  WackyChess.defineSide('white', {
    name: 'White',

    pieces: {
      king: {
        name: 'King',
        icon: '♚',
        royal: true,
        description: 'Moves one square in any direction. Lose all your royal pieces and you lose.',
        moves: (p, g) => g.leap(p, g.DIRS.ALL),
      },

      queen: {
        name: 'Flash',
        icon: '⚡️',
        royal: true,
        description: 'Slides any distance in any direction, and may make one 45° or 90° turn partway through the move. It cannot move through pieces, and captures only on the square where its path ends.',
        moves(p, g) {
          const f = g.forward(p.side);
          const out = new Map();
          const add = (x, y) => {
            const key = `${x},${y}`;
            if (!out.has(key)) out.set(key, { x, y });
          };
          // Walks from (x, y) along dir. Returns the empty squares on the way (adding every
          // legal end square to the move list).
          const walk = (x, y, [dx, dy]) => {
            const empties = [];
            for (;;) {
              x += dx * f;
              y += dy * f;
              if (!g.inBounds(x, y)) break;
              const occupant = g.at(x, y);
              if (!occupant) {
                add(x, y);
                empties.push([x, y]);
                continue;
              }
              if (occupant.side !== p.side) add(x, y);
              break;
            }
            return empties;
          };
          const legs = RING.map((dir) => walk(p.x, p.y, dir));
          // Straight moves are listed first, so a square reachable both ways stays a plain move.
          RING.forEach((dir, i) => {
            for (const [x, y] of legs[i]) {
              for (const t of TURNS) walk(x, y, RING[(i + t + 8) % 8]);
            }
          });
          return [...out.values()];
        },
      },

      rook: {
        name: 'Tank',
        icon: '💪',
        description: 'Moves one square in any of 8 directions, capturing as it goes. Instead of moving it can THROW an adjacent friendly piece onto any empty square within 5 squares of the Tank. It can never throw onto an occupied square or throw enemies. Or it can SMASH the ground, destroying every piece (friend or foe) in the 3x3 area around it; the Tank is safe. Smash has a 5-turn cooldown.',
        badge: cooldownBadge,
        moves(p, g) {
          const out = g.leap(p, g.DIRS.ALL);
          if (!p.data.cooldown) {
            out.push({ x: p.x, y: p.y, label: 'Smash 💥', action(p, g) {
              const victims = g.pieces((v) => v !== p && cheb(v, p) <= 1);
              p.data.cooldown = 5;
              g.effect('burst', { x: p.x, y: p.y, radius: 1, icon: '💥', color: 'orange' });
              g.log(`💥 The Tank smashes the ground!`);
              for (const v of victims) g.capture(v, null);
            } });
          }
          const friends = g.pieces((q) => q !== p && q.side === p.side && cheb(q, p) === 1);
          for (const q of friends) {
            const name = g.def(q).name || g.kind(q);
            for (let x = p.x - 5; x <= p.x + 5; x++) {
              for (let y = p.y - 5; y <= p.y + 5; y++) {
                if (!g.isEmpty(x, y)) continue;
                out.push({ x, y, label: `Throw ${name} from ${g.square(q.x, q.y)}`, action(p, g) {
                  g.effect('move', { from: [q.x, q.y], to: [x, y] });
                  g.moveTo(q, x, y);
                  g.log(`💪 The Tank throws ${g.nameOf(q)} to ${g.square(x, y)}.`);
                  if (g.kind(q) === 'pawn' && g.rank(q) === 8) {
                    g.transform(q, 'queen');
                    g.log(`${g.nameOf(q)} promoted!`);
                  }
                } });
              }
            }
          }
          return out;
        },
        onTurnStart: tick,
      },

      bishop: {
        name: 'Grenade Launcher',
        icon: '💣️',
        description: 'Moves like a pawn: 1 forward (2 on its first move) without capturing, and captures diagonally forward. It never promotes. Instead it can lob a grenade at any square exactly 1 to 3 squares away in a straight line (any of 8 directions, over pieces). The blast destroys every piece in the 3x3 area around the target, friend or foe, royals included, and the Launcher itself if it is in the blast. 5-turn cooldown.',
        badge: cooldownBadge,
        moves(p, g) {
          const out = [
            ...g.slide(p, [[0, 1]], { max: p.moveCount === 0 ? 2 : 1, capture: false }),
            ...g.leap(p, [[-1, 1], [1, 1]], { capture: 'only' }),
          ];
          if (!p.data.cooldown) {
            for (const [dx, dy] of RING) {
              for (let step = 1; step <= 3; step++) {
                const [x, y] = g.rel(p, dx * step, dy * step);
                if (!g.inBounds(x, y)) break;
                out.push({ x, y, label: 'Grenade 💣', action(p, g) {
                  const victims = g.pieces((v) => cheb(v, { x, y }) <= 1);
                  p.data.cooldown = 5;
                  g.effect('projectile', { from: [p.x, p.y], to: [x, y], icon: '💣' });
                  g.effect('burst', { x, y, radius: 1, icon: '💥', color: 'orange' });
                  g.log(`💣 A grenade lands on ${g.square(x, y)}!`);
                  for (const v of victims) g.capture(v, null);
                } });
              }
            }
          }
          return out;
        },
        onTurnStart: tick,
      },

      knight: {
        name: 'Light',
        icon: '💡',
        description: 'Cannot move. Instead it can shine its light: a 50% chance that the opponent is blinded (cannot see the pieces on the board) for their next two turns. Using it takes your turn whether or not it works, and it can only be tried once every 10 of your turns. If the Light is captured the blindness ends.',
        badge: (p) => (p.data.cooldown ? p.data.cooldown : p.data.blind ? '🌑' : ''),
        moves: (p) => (p.data.cooldown ? [] : [{ x: p.x, y: p.y, label: 'Blind 🌑', action(p, g) {
          p.data.cooldown = 10;
          g.effect('burst', { x: p.x, y: p.y, radius: 7, icon: '💡', color: 'yellow' });
          if (g.random() < 0.5) {
            p.data.blindPending = 2;
            g.log('💡 The Light flashes. The opponent is blinded for two turns!');
          } else {
            g.log('💡 The Light flickers and fails to blind anyone.');
          }
        } }]),
        onTurnStart(p, g) {
          tick(p, g);
          if (g.turn !== p.side) {
            // The opponent's turn: they are blind while blindPending turns remain.
            p.data.blind = (p.data.blindPending || 0) > 0;
            if (p.data.blind) p.data.blindPending--;
          } else {
            p.data.blind = false;
          }
        },
      },

      pawn: {
        name: 'Pawn',
        icon: '♟',
        description: 'Moves 1 forward (2 on its first move), and captures forward and diagonally forward. Becomes a Flash on the far rank.',
        moves: (p, g) => [
          ...g.slide(p, [[0, 1]], { max: p.moveCount === 0 ? 2 : 1, capture: false }),
          ...g.leap(p, [[0, 1], [-1, 1], [1, 1]], { capture: 'only' }),
        ],
        onMove(p, g) {
          if (g.rank(p) === 8) {
            g.transform(p, 'queen');
            g.log(`${g.nameOf(p)} promoted to a Flash!`);
          }
        },
      },

      necromancer: {
        name: 'Necromancer',
        icon: '🪄',
        description: 'Moves one square in any direction. Once per game it can raise the dead: every EMPTY square in the 5x5 area around it fills with a Dead Body. Pieces already there are untouched, but they are hemmed in. Dead Bodies never move, block movement, and can be captured.',
        badge: (p) => (p.data.used ? '' : '💀'),
        moves(p, g) {
          const out = g.leap(p, g.DIRS.ALL);
          if (!p.data.used) {
            out.push({ x: p.x, y: p.y, label: 'Raise the dead 💀', action(p, g) {
              p.data.used = true;
              g.effect('burst', { x: p.x, y: p.y, radius: 2, icon: '💀', color: 'purple' });
              g.log('💀 The Necromancer raises the dead!');
              for (let x = p.x - 2; x <= p.x + 2; x++) {
                for (let y = p.y - 2; y <= p.y + 2; y++) {
                  if (g.isEmpty(x, y)) g.spawn(p.side, 'dead', x, y);
                }
              }
            } });
          }
          return out;
        },
      },

      dead: {
        name: 'Dead Body',
        icon: '💀',
        description: 'Raised by the Necromancer. Never moves and blocks the square, but can be captured.',
        moves: () => [],
      },
    },

    // Read from your own seat: first row is your back rank, listed left to right.
    setup: [
      ['rook', 'queen', 'bishop', 'necromancer', 'king', 'bishop', 'knight', 'rook'],
      ['pawn', 'pawn', 'pawn', 'pawn', 'pawn', 'pawn', 'pawn', 'pawn'],
      [null, null, null, null, null, null, null, null],
    ],
  });
})();
