// Black's pieces. This whole folder belongs to the Black player.
// Keep the wrapper: both sides' files share one page.
(() => {
  WackyChess.defineSide('black', {
    name: 'Black',

    pieces: {
      king: {
        name: 'King',
        icon: '♚',
        royal: true,
        description: 'Moves one square in any direction. Lose your King and you lose.',
        moves: (p, g) => g.leap(p, g.DIRS.ALL),
      },

      pawn: {
        name: 'Pawn',
        icon: '♟',
        description: 'Moves forward 1 square (2 on its first move) and captures diagonally forward.',
        moves: (p, g) => [
          ...g.slide(p, [[0, 1]], { max: p.moveCount === 0 ? 2 : 1, capture: false }),
          ...g.leap(p, [[-1, 1], [1, 1]], { capture: 'only' }),
        ],
      },

      wayfinder: {
        name: 'Wayfinder',
        icon: '🚩',
        description: 'Moves 1 square forward, or captures 1 square diagonally forward. Reaching White’s back rank wins the game for Black.',
        moves: (p, g) => [
          ...g.leap(p, [[0, 1]], { capture: false }),
          ...g.leap(p, [[-1, 1], [1, 1]], { capture: 'only' }),
        ],
        onMove(p, g) {
          if (g.rank(p) === 8) {
            g.win(p.side, `${g.nameOf(p)} reached the far side of the board!`);
          }
        },
      },

      creeper: {
        name: 'Creeper',
        icon: '💣',
        description: 'Moves 1 square in any direction. After it moves, a fuse counts down for 2 full rounds (4 moves by both players); then it destroys every piece in the surrounding 3×3 area, including itself and allies.',
        badge: (p) => p.data.fuse ? `${Math.ceil(p.data.fuse / 2)}💣` : '',
        moves: (p, g) => g.leap(p, g.DIRS.ALL),
        onMove(p, g) {
          if (p.data.fuse === undefined) {
            p.data.fuse = 4;
            p.data.justArmed = true;
            g.log('The Creeper’s 2-round fuse is lit!');
          }
        },
        onTurnStart(p, g) {
          if (p.data.fuse === undefined) return;

          // The turn start immediately after arming is not one of the four moves.
          if (p.data.justArmed) {
            delete p.data.justArmed;
            return;
          }

          p.data.fuse--;
          if (p.data.fuse > 0) return;

          g.effect('burst', { x: p.x, y: p.y, radius: 1, icon: '💥', color: '#54c96b' });
          const victims = [];
          for (let y = Math.max(0, p.y - 1); y <= Math.min(7, p.y + 1); y++) {
            for (let x = Math.max(0, p.x - 1); x <= Math.min(7, p.x + 1); x++) {
              const victim = g.at(x, y);
              if (victim) victims.push(victim);
            }
          }
          g.log('💥 The Creeper explodes!');
          for (const victim of victims) g.capture(victim, null);
        },
      },

      swapper: {
        name: 'Swapper',
        icon: '🔁',
        description: 'Moves 1 square in any direction, or trades places with any other piece on the board, friend or foe.',
        moves(p, g) {
          const out = g.leap(p, g.DIRS.ALL);
          for (const target of g.pieces()) {
            if (target.id === p.id) continue;
            out.push({
              x: target.x,
              y: target.y,
              label: `Swap with ${g.nameOf(target)} 🔁`,
              action(piece, game) {
                const from = [piece.x, piece.y];
                const targetFrom = [target.x, target.y];
                game.effect('projectile', { from, to: targetFrom, icon: game.def(piece).icon });
                game.effect('projectile', { from: targetFrom, to: from, icon: game.def(target).icon });
                game.swap(piece, target);
              },
            });
          }
          return out;
        },
      },

      teleporter: {
        name: 'Teleporter',
        icon: '🌀',
        description: 'Moves 1 square in any direction, or teleports to any empty square or captures an enemy piece anywhere on the board.',
        moves(p, g) {
          const out = g.leap(p, g.DIRS.ALL);
          for (const target of g.pieces()) {
            if (target.side === p.side) continue;
            out.push({
              x: target.x,
              y: target.y,
              label: `Teleport and capture ${g.nameOf(target)} 🌀`,
              action(piece, game, move) {
                game.effect('projectile', { from: [piece.x, piece.y], to: [move.x, move.y], icon: '🌀' });
                game.moveTo(piece, move.x, move.y);
              },
            });
          }
          for (let x = 0; x < 8; x++) {
            for (let y = 0; y < 8; y++) {
              if (!g.isEmpty(x, y)) continue;
              out.push({
                x,
                y,
                label: 'Teleport 🌀',
                action(piece, game, move) {
                  game.effect('projectile', { from: [piece.x, piece.y], to: [move.x, move.y], icon: '🌀' });
                  game.moveTo(piece, move.x, move.y);
                },
              });
            }
          }
          return out;
        },
      },
    },

    // From Black's seat: one King, the four special pieces, and pawns.
    setup: [
      ['pawn', 'swapper', 'creeper', 'king', 'wayfinder', 'teleporter', 'pawn', 'pawn'],
      ['pawn', 'pawn', 'pawn', 'pawn', 'pawn', 'pawn', 'pawn', 'pawn'],
    ],
  });
})();
