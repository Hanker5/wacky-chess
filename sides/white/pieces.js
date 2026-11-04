// White's pieces. This whole folder belongs to the White player.
// Read AGENTS.md and docs/PIECE_API.md before changing anything.
//
// Keep everything inside this (() => { ... })() wrapper: both sides' files share
// one page, so top-level variables would collide with the other player's file.
(() => {
  const FLING_RANGE = 4;
  const BOMB_COOLDOWN = 3;

  // Pawns promote on the far rank, however they got there.
  const promote = (p, g) => {
    if (g.rank(p) !== 8 || p.type !== 'white:pawn') return;
    g.transform(p, 'queen');
    g.log(`${g.nameOf(p)} promoted!`);
  };

  // Destroy every piece within `radius` squares of (cx, cy), except `except`.
  // Friends, enemies and royals all die.
  const blast = (g, cx, cy, radius, except) => {
    const victims = g.pieces((q) => (!except || q.id !== except.id) &&
      Math.abs(q.x - cx) <= radius && Math.abs(q.y - cy) <= radius);
    for (const v of victims) {
      if (g.get(v.id)) g.capture(v, null);
    }
  };

  WackyChess.defineSide('white', {
    name: 'White',

    pieces: {
      king: {
        name: 'Tung Tung Tung Sahur',
        icon: 'sides/white/assets/tung_tung_sahur.svg',
        royal: true,
        description: 'Moves like a queen: slides any distance in any direction. Royal: you lose when all of your royal pieces are captured (you start with three).',
        moves: (p, g) => g.slide(p, g.DIRS.ALL),
      },
      queen: {
        name: 'Tralalero Tralala',
        icon: 'sides/white/assets/tralalero_tralala.svg',
        description: 'Slides any distance in any direction.',
        moves: (p, g) => g.slide(p, g.DIRS.ALL),
      },
      rook: {
        name: 'Bombardiro Crocodilo',
        icon: 'sides/white/assets/bombardiro_crocodilo.svg',
        description:
          'Slides any distance in a straight line. ' +
          'BOMB DROP: instead of moving, it stays where it is and destroys every piece on the 8 squares around it (3x3 grid), ' +
          'friend or enemy, royal pieces included. It is never harmed by its own bombs. ' +
          `Needs at least one piece next to it, then ${BOMB_COOLDOWN} turns to recharge (the badge counts down).`,
        badge: (p) => p.data.cooldown || '',
        moves(p, g) {
          const out = g.slide(p, g.DIRS.ORTHO);
          if (!p.data.cooldown) {
            const hasNeighbor = g.DIRS.ALL.some(([dx, dy]) => g.at(p.x + dx, p.y + dy));
            if (hasNeighbor) {
              out.push({ x: p.x, y: p.y, label: 'Drop bombs 💣', action(p, g) {
                g.log(`💣 ${g.nameOf(p)} carpet-bombs the squares around ${g.square(p.x, p.y)}!`);
                g.effect('burst', { x: p.x, y: p.y, radius: 1, icon: '💣', color: 'orange' });
                blast(g, p.x, p.y, 1, p);
                p.data.cooldown = BOMB_COOLDOWN;
              } });
            }
          }
          return out;
        },
        onTurnStart(p, g) {
          if (g.turn === p.side && p.data.cooldown) p.data.cooldown--;
        },
      },
      bishop: {
        name: 'Ballerina Cappuccina',
        icon: 'sides/white/assets/ballerina_cappuccina.svg',
        description: 'Slides any distance diagonally.',
        moves: (p, g) => g.slide(p, g.DIRS.DIAG),
      },
      knight: {
        name: 'Hydrogen Bomb',
        icon: '💥',
        description:
          'Never moves on its own (only a Catapult can move it). ' +
          'DETONATE: on your turn, instead of moving anything else, it destroys every piece in the 5x5 grid around it, ' +
          'friend or enemy, royal pieces included, and itself too. ' +
          'If a Catapult flings it, it detonates where it lands.',
        moves: (p, g) => [
          { x: p.x, y: p.y, label: 'Detonate ☢️', action(p, g) {
            g.log(`☢️ ${g.nameOf(p)} detonates on ${g.square(p.x, p.y)}!`);
            g.effect('burst', { x: p.x, y: p.y, radius: 2, icon: '💥', color: 'red' });
            blast(g, p.x, p.y, 2, p);
            if (g.get(p.id)) g.capture(p, null);
          } },
        ],
      },
      pawn: {
        name: 'Cappuccino Assassino',
        icon: 'sides/white/assets/cappuccino_assassino.svg',
        description: 'Moves 1 forward (2 on its first move) and captures diagonally forward. Becomes a Tralalero Tralala on the far rank.',
        moves: (p, g) => [
          ...g.slide(p, [[0, 1]], { max: p.moveCount === 0 ? 2 : 1, capture: false }),
          ...g.leap(p, [[-1, 1], [1, 1]], { capture: 'only' }),
        ],
        onMove(p, g) {
          promote(p, g);
        },
      },
      coughing_baby: {
        name: 'Coughing Baby',
        icon: '👶',
        description:
          'Does nothing. Cannot move and cannot capture anything by itself. ' +
          'It can still be captured, and a Catapult can fling it (and it crushes whatever it lands on, like any flung piece).',
        moves: () => [],
      },
      catapult: {
        name: 'Catapult',
        icon: 'sides/white/assets/catapult.svg',
        description:
          'Slides any distance in a straight line, like a rook. ' +
          'FLING: instead of moving, it launches any piece (either side) on one of the 8 squares around it. ' +
          `The piece flies straight away from the catapult, over anything in between, and lands 1 to ${FLING_RANGE} squares further on. ` +
          "It can land on an empty square or crush one of the Catapult's enemies there, kings included, but never on a friend of the Catapult. " +
          'If the crushed piece survives, the flung piece stays where it was. ' +
          'A flung Hydrogen Bomb detonates where it lands.',
        moves(p, g) {
          const out = g.slide(p, g.DIRS.ORTHO);
          for (const [dx, dy] of g.DIRS.ALL) {
            const ammo = g.inBounds(p.x + dx, p.y + dy) && g.at(p.x + dx, p.y + dy);
            if (!ammo) continue;
            for (let d = 1; d <= FLING_RANGE; d++) {
              const x = ammo.x + dx * d;
              const y = ammo.y + dy * d;
              if (!g.inBounds(x, y)) break;
              const target = g.at(x, y);
              if (target && !g.isEnemy(p, target)) continue;
              out.push({ x, y, label: `Fling ${g.nameOf(ammo)} 🪨`, action(p, g) {
                g.log(`🪨 ${g.nameOf(p)} flings ${g.nameOf(ammo)} to ${g.square(x, y)}!`);
                g.effect('projectile', { from: [ammo.x, ammo.y], to: [x, y], icon: g.def(ammo).icon });
                if (target) {
                  g.effect('burst', { x, y, radius: 0, icon: '💥' });
                  if (!g.capture(target, null)) return; // it survived, so the flung piece stays put
                }
                if (g.moveTo(ammo, x, y)) {
                  promote(ammo, g);
                  if (ammo.type === 'white:knight') {
                    g.log(`☢️ ${g.nameOf(ammo)} detonates on landing at ${g.square(x, y)}!`);
                    g.effect('burst', { x, y, radius: 2, icon: '💥', color: 'red' });
                    blast(g, x, y, 2, ammo);
                    if (g.get(ammo.id)) g.capture(ammo, null);
                  }
                }
              } });
            }
          }
          return out;
        },
      },
    },

    // Read from your own seat: first row is your back rank, listed left to right.
    setup: [
      ['rook', 'king', 'bishop', 'queen', 'king', 'bishop', 'king', 'rook'],
      ['pawn', 'pawn', 'pawn', 'pawn', 'pawn', 'pawn', 'pawn', 'pawn'],
      [null, 'knight', 'catapult', 'coughing_baby', 'coughing_baby', 'catapult', 'knight', null],
    ],
  });
})();
