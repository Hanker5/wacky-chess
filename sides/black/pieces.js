// Black's pieces. This whole folder belongs to the Black player.
// Read AGENTS.md and docs/PIECE_API.md before changing anything.
//
// Keep everything inside this (() => { ... })() wrapper: both sides' files share
// one page, so top-level variables would collide with the other player's file.
(() => {
  // Destroys every piece (friend or foe, itself included) in the 3x3 around (cx, cy).
  function blast(g, kamikaze, cx, cy) {
    g.effect('burst', { x: cx, y: cy, radius: 1, icon: 'ðŸ’¥', color: 'orange' });
    const victims = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const v = g.inBounds(cx + dx, cy + dy) && g.at(cx + dx, cy + dy);
        if (v && v.id !== kamikaze.id) victims.push(v);
      }
    }
    for (const v of victims) g.capture(v, null);
    g.capture(kamikaze, null);
  }

  // Every square the Calvary can end on: up to 5 orthogonal single-square steps,
  // never revisiting a square. Path squares must be empty; only the last may hold an enemy.
  function calvaryTargets(p, g) {
    const ends = new Map();
    const visited = new Set([`${p.x},${p.y}`]);
    const walk = (x, y, stepsLeft) => {
      if (stepsLeft === 0) return;
      for (const [dx, dy] of g.DIRS.ORTHO) {
        const nx = x + dx, ny = y + dy;
        const key = `${nx},${ny}`;
        if (!g.inBounds(nx, ny) || visited.has(key)) continue;
        const occupant = g.at(nx, ny);
        if (occupant) {
          if (g.isEnemy(p, occupant)) ends.set(key, { x: nx, y: ny });
          continue;
        }
        ends.set(key, { x: nx, y: ny });
        visited.add(key);
        walk(nx, ny, stepsLeft - 1);
        visited.delete(key);
      }
    };
    walk(p.x, p.y, 5);
    return [...ends.values()];
  }

  // Stationary strikes on every enemy within `reach` squares (Chebyshev), over anything between.
  function strikes(p, g, reach, label) {
    return g.pieces((t) => g.isEnemy(p, t)
      && Math.max(Math.abs(t.x - p.x), Math.abs(t.y - p.y)) <= reach).map((t) => ({
      x: t.x, y: t.y, label,
      action(p, g) {
        g.effect('projectile', { from: [p.x, p.y], to: [t.x, t.y], icon: 'ðŸ’¢' });
        g.capture(t, p);
      },
    }));
  }

  WackyChess.defineSide('black', {
    name: 'Black',

    pieces: {
      king: {
        name: 'King',
        icon: 'â™š',
        royal: true,
        description: 'Moves one square in any direction. Lose all your royal pieces and you lose.',
        moves: (p, g) => g.leap(p, g.DIRS.ALL),
      },
      queen: {
        name: 'Queen',
        icon: 'â™›',
        royal: true,
        description: 'Slides any distance in any direction. Royal: lose all your royal pieces and you lose.',
        moves: (p, g) => g.slide(p, g.DIRS.ALL),
      },

      rook: {
        name: 'Archer',
        icon: 'ðŸ¹',
        description: 'Steps one square in any direction (capturing as it goes). Or shoots any enemy piece on the board, '
          + 'no line of sight needed, every turn with no cooldown. The arrow has a 75% chance to drift one square '
          + 'in a random one of the 8 directions (possibly off the board). It destroys whatever piece it ends on, '
          + 'friend or foe. Otherwise it lands on the target.',
        moves: (p, g) => [
          ...g.leap(p, g.DIRS.ALL),
          ...g.pieces((t) => g.isEnemy(p, t)).map((t) => ({
            x: t.x, y: t.y, label: 'Shoot ðŸ¹',
            action(p, g) {
              let tx = t.x, ty = t.y;
              if (g.random() < 0.75) {
                const [dx, dy] = g.pick(g.DIRS.ALL);
                tx += dx; ty += dy;
              }
              if (g.inBounds(tx, ty)) {
                g.effect('projectile', { from: [p.x, p.y], to: [tx, ty], icon: 'ðŸ¹' });
                const hit = g.at(tx, ty);
                if (hit) g.capture(hit, null);
                else g.log(`The arrow lands harmlessly on ${g.square(tx, ty)}`);
              } else {
                g.effect('projectile', { from: [p.x, p.y], to: [t.x, t.y], icon: 'ðŸ¹' });
                g.log('The arrow flies off the board!');
              }
            },
          })),
        ],
      },

      bishop: {
        name: 'Kamikaze',
        icon: 'ðŸ›©ï¸',
        description: 'Moves like a queen in all 8 directions but flies over any pieces in the way. Landing on an enemy '
          + 'makes it blow up, destroying every piece in the 3x3 area around that square, friends and itself included. '
          + 'It can also detonate in place instead of moving. One use only. Indestructible Castles survive and '
          + 'Doors take one hit.',
        moves(p, g) {
          const out = [];
          for (const [dx, dy] of g.DIRS.ALL) {
            for (let x = p.x + dx, y = p.y + dy; g.inBounds(x, y); x += dx, y += dy) {
              const occupant = g.at(x, y);
              if (!occupant) out.push({ x, y });
              else if (g.isEnemy(p, occupant)) {
                out.push({
                  x, y, label: 'Strike ðŸ’¥',
                  action(p, g) {
                    g.effect('move', { from: [p.x, p.y], to: [x, y] });
                    blast(g, p, x, y);
                  },
                });
              }
            }
          }
          out.push({
            x: p.x, y: p.y, label: 'Detonate ðŸ’¥',
            action: (p, g) => blast(g, p, p.x, p.y),
          });
          return out;
        },
      },

      knight: {
        name: 'Calvary',
        icon: 'â™ž',
        description: 'Travels up to 5 squares along a path of up, down, left or right steps (turning as often as it likes, '
          + 'never crossing a square twice). Every square on the path must be empty. It captures an enemy on the '
          + 'last square of the path, by moving onto it.',
        moves: (p, g) => calvaryTargets(p, g),
      },

      pawn: {
        name: 'Castle',
        icon: 'ðŸ°',
        description: 'Cannot move and cannot be destroyed by anything. A wall.',
        moves: () => [],
        onCaptured: () => false,
      },

      door: {
        name: 'Door',
        icon: 'ðŸšª',
        description: 'Cannot move. Takes two hits before it is destroyed. The first time an enemy hits it up close '
          + '(from an adjacent square), that attacker is shoved to the square in front of the Door (toward the enemy). '
          + 'If that square is blocked or off the board, the attacker stays where it was. Arrows and explosions also '
          + 'count as a hit but push nobody. The second hit destroys it, and a melee attacker takes its square.',
        moves: () => [],
        badge: (p) => 2 - (p.data.hits || 0),
        onCaptured(p, g, attacker) {
          p.data.hits = (p.data.hits || 0) + 1;
          if (p.data.hits >= 2) return true;
          g.log(`ðŸšª ${g.nameOf(p)} holds (1 hit left)`);
          const melee = attacker && Math.max(Math.abs(attacker.x - p.x), Math.abs(attacker.y - p.y)) === 1;
          if (melee) {
            const [fx, fy] = g.rel(p, 0, 1);
            if (g.isEmpty(fx, fy)) g.moveTo(attacker, fx, fy);
          }
          return false;
        },
      },

      barbarians: {
        name: 'Barbarians',
        icon: 'âš”ï¸',
        description: 'Steps one square up, down, left or right (capturing an enemy it steps onto). It can also kill any '
          + 'enemy in the 8 squares around it without moving, every turn, with no cooldown.',
        moves: (p, g) => [
          ...g.leap(p, g.DIRS.ORTHO),
          ...strikes(p, g, 1, 'Strike âš”ï¸'),
        ],
      },

      spear: {
        name: 'Spear',
        icon: 'sides/black/assets/spear.svg',
        description: 'Steps one square in any direction (capturing as it goes). It can also kill any enemy within 2 squares '
          + '(the whole 5x5 area around it), over anything in between, without moving, every turn with no cooldown.',
        customArt: { description: 'A spear with a wooden handle and an iron head.' },
        moves: (p, g) => [
          ...g.leap(p, g.DIRS.ALL),
          ...strikes(p, g, 2, 'Strike ðŸ—¡ï¸'),
        ],
      },
    },

    // Read from your own seat: first row is your back rank, listed left to right.
    setup: [
      ['barbarians', 'barbarians', 'barbarians', 'spear', 'spear', 'pawn', 'king', 'queen'],
      ['pawn', 'door', 'pawn', 'pawn', 'rook', 'rook', 'rook', 'rook'],
      ['bishop', 'knight', 'bishop', 'pawn', 'pawn', 'pawn', 'pawn', 'pawn'],
    ],
  });
})();

