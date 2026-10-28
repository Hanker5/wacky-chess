// Black's pieces. This whole folder belongs to the Black player.
// Read AGENTS.md and docs/PIECE_API.md before changing anything.
//
// Keep everything inside this (() => { ... })() wrapper: both sides' files share
// one page, so top-level variables would collide with the other player's file.
(() => {
  // Abilities are unavailable for the owner's next COOLDOWN turns after use. The stored
  // counter starts one higher because it ticks at the start of each of the owner's turns.
  const COOLDOWN = 3;
  const startCooldown = (p, key) => { p.data[key] = COOLDOWN + 1; };
  const tickCooldowns = (p, g, keys) => {
    if (g.turn !== p.side) return;
    for (const key of keys) if (p.data[key] > 0) p.data[key]--;
  };
  // Turns still blocked, counting the current turn if it's the owner's.
  const turnsLeft = (p, g, key) => {
    const cd = p.data[key] || 0;
    return g.turn === p.side ? cd : Math.max(cd - 1, 0);
  };

  const isOwnRoyal = (p, g, t) => t && t.side === p.side && g.def(t).royal;

  // ---- Pawn moves, shared by the real Pawn and the Ninjas so they look identical.
  const pawnMoves = (p, g) => [
    ...g.slide(p, [[0, 1]], { max: p.moveCount === 0 ? 2 : 1, capture: false }),
    ...g.leap(p, [[-1, 1], [1, 1]], { capture: 'only' }),
  ];
  function promote(p, g) {
    if (g.rank(p) === 8) {
      g.transform(p, 'queen');
      g.log(`${g.nameOf(p)} promoted!`);
    }
  }

  // Secret abilities ride along on the piece's normal move squares, so an enemy's move
  // preview looks exactly like a plain piece's. Falls back to the piece's own square.
  function hideOnSquares(p, normalMoves, secret) {
    const spots = normalMoves.length ? normalMoves : [{ x: p.x, y: p.y }];
    return spots.map(({ x, y }) => ({ ...secret, x, y }));
  }

  // ---- 2009 Toyota Corolla
  function corollaMoves(p, g) {
    const out = g.slide(p, g.DIRS.ORTHO);
    if (p.data.chargeCd) return out;
    for (const [dx, dy] of g.DIRS.ORTHO) {
      let passedSomething = false;
      for (let k = 1; ; k++) {
        const [x, y] = g.rel(p, dx * k, dy * k);
        if (!g.inBounds(x, y)) break;
        const t = g.at(x, y);
        if (isOwnRoyal(p, g, t)) break; // never run over your own King
        // Plain rook moves already cover a clear road ending on an empty or enemy square.
        if (passedSomething || (t && t.side === p.side)) {
          out.push({ x, y, label: 'Charge 🚗💨', action: (p, g) => charge(p, g, dx, dy, k) });
        }
        if (t) passedSomething = true;
      }
    }
    return out;
  }
  function charge(p, g, dx, dy, k) {
    const road = [];
    for (let i = 1; i <= k; i++) road.push(g.rel(p, dx * i, dy * i));
    g.effect('projectile', { from: [p.x, p.y], to: road[road.length - 1], icon: '🚗' });
    let stop = null;
    for (const [x, y] of road) {
      const victim = g.at(x, y);
      if (victim) {
        g.effect('burst', { x, y, radius: 0, icon: '💥' });
        g.capture(victim, p);
        if (!g.isOnBoard(p)) return;
      }
      if (g.isEmpty(x, y)) stop = [x, y];
    }
    startCooldown(p, 'chargeCd');
    if (stop) g.moveTo(p, ...stop);
  }

  // ---- Wizard
  function wizardMoves(p, g) {
    const out = g.leap(p, g.DIRS.ALL);
    if (!p.data.fireCd) {
      for (const [dx, dy] of g.DIRS.ALL) {
        for (let k = 1; k <= 3; k++) {
          const [x, y] = g.rel(p, dx * k, dy * k);
          if (!g.inBounds(x, y)) break;
          const target = g.at(x, y);
          if (!target) continue;
          if (!isOwnRoyal(p, g, target)) {
            out.push({ x, y, label: 'Fireball 🔥', action(p, g) {
              g.effect('projectile', { from: [p.x, p.y], to: [x, y], icon: '🔥' });
              g.effect('burst', { x, y, radius: 0, icon: '💥', color: 'orangered' });
              startCooldown(p, 'fireCd');
              g.capture(target, p);
            } });
          }
          break;
        }
      }
    }
    if (!p.data.tpCd) {
      for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) {
        const t = g.at(x, y);
        const adjacent = Math.max(Math.abs(x - p.x), Math.abs(y - p.y)) <= 1;
        if (!t && !adjacent) {
          out.push({ x, y, label: 'Teleport ✨', action(p, g) {
            g.effect('burst', { x: p.x, y: p.y, radius: 0, icon: '✨', color: 'violet' });
            g.effect('burst', { x, y, radius: 0, icon: '✨', color: 'violet' });
            startCooldown(p, 'tpCd');
            g.moveTo(p, x, y);
          } });
        } else if (t && t !== p && t.side === p.side) {
          out.push({ x, y, label: 'Swap places ✨', action(p, g) {
            g.effect('burst', { x: p.x, y: p.y, radius: 0, icon: '✨', color: 'violet' });
            g.effect('burst', { x, y, radius: 0, icon: '✨', color: 'violet' });
            startCooldown(p, 'tpCd');
            g.swap(p, t);
          } });
        }
      }
    }
    return out;
  }
  function wizardBadge(p, g) {
    const fire = turnsLeft(p, g, 'fireCd');
    const tp = turnsLeft(p, g, 'tpCd');
    return [fire && `🔥${fire}`, tp && `✨${tp}`].filter(Boolean).join(' ');
  }

  // ---- Kamikaze-Knight
  function kamikazeMoves(p, g) {
    const jumps = g.leap(p, g.DIRS.KNIGHT);
    return [...jumps, ...hideOnSquares(p, jumps, { label: 'Self-destruct 💥', action: explode })];
  }
  function explode(p, g) {
    g.log('💥 Surprise! That Knight was a Kamikaze-Knight!');
    g.effect('burst', { x: p.x, y: p.y, radius: 1, icon: '💥', color: 'orangered' });
    for (const [dx, dy] of g.DIRS.ALL) {
      const [x, y] = g.rel(p, dx, dy);
      const victim = g.inBounds(x, y) && g.at(x, y);
      if (victim) g.capture(victim, null);
    }
    g.capture(p, null);
  }

  // ---- Ninjas: Pawns until they reveal their true form.
  function ninja(trueType, trueName, powers) {
    return {
      name: 'Pawn',
      icon: '♟',
      description: `Looks and moves exactly like a Pawn: 1 forward (2 on its first move), captures diagonally forward, and becomes a Queen on the far rank. Secretly a ${trueName}! On any turn it can throw a smoke bomb and Reveal 💨, turning into a ${trueName} (${powers}). Revealing is free: you then take another turn with any piece.`,
      moves(p, g) {
        const steps = pawnMoves(p, g);
        return [...steps, ...hideOnSquares(p, steps, { label: 'Reveal 💨', action(p, g) {
          g.effect('burst', { x: p.x, y: p.y, radius: 0, icon: '💨', color: 'gray' });
          g.transform(p, trueType);
          g.log(`💨 Smoke bomb! That Pawn was a ${trueName}!`);
          g.extraTurn();
        } })];
      },
      onMove: promote,
    };
  }

  WackyChess.defineSide('black', {
    name: 'Black',

    pieces: {
      king: {
        name: 'King',
        icon: '♚',
        royal: true,
        description: 'Moves one square in any direction. Lose all your royal pieces and you lose.',
        moves: (p, g) => g.leap(p, g.DIRS.ALL),
      },
      queen: {
        name: 'Queen',
        icon: '♛',
        description: 'Slides any distance in any direction.',
        moves: (p, g) => g.slide(p, g.DIRS.ALL),
      },
      rook: {
        name: '2009 Toyota Corolla',
        icon: '🚗',
        description: 'Moves like a Rook. Or CHARGE 🚗💨: drive any distance in a straight line (up, down, left or right) right through other pieces, running over every piece it passes and the one it lands on: friend or foe, the enemy King included. It can\'t charge through your own King. After a charge it can only make normal Rook moves for your next 3 turns (the badge counts down). If a piece survives being hit, the car drives over it; if the piece on the final square survives, the car stops on the last empty square before it.',
        moves: corollaMoves,
        badge: (p, g) => turnsLeft(p, g, 'chargeCd') || '',
        onTurnStart: (p, g) => tickCooldowns(p, g, ['chargeCd']),
      },
      bishop: {
        name: 'Wizard',
        icon: '🧙‍♂️',
        description: 'Each turn, pick one: STEP 1 square in any direction, capturing an enemy there. FIREBALL 🔥: blast the first piece within 3 squares in any of the 8 directions, friend or foe (never your own King), destroying it while the Wizard stays put. TELEPORT ✨: jump to any empty square, or swap places with one of your own pieces (never onto an enemy). Fireball and Teleport each have their own cooldown: after use, that ability is unavailable for your next 3 turns (the badge shows 🔥/✨ and turns left).',
        moves: wizardMoves,
        badge: wizardBadge,
        onTurnStart: (p, g) => tickCooldowns(p, g, ['fireCd', 'tpCd']),
      },
      knight: {
        name: 'Knight',
        icon: '♞',
        description: 'Looks and moves exactly like a Knight (jumps in an L shape, over anything in the way). Secretly a Kamikaze-Knight! On any turn, instead of moving, it can Self-destruct 💥: it and every piece in the 3×3 square around it are destroyed, friend or foe, Kings included. (If both Kings go, it\'s a draw.) Being captured does not set it off.',
        moves: kamikazeMoves,
      },
      pawn: {
        name: 'Pawn',
        icon: '♟',
        description: 'Moves 1 forward (2 on its first move) and captures diagonally forward. Becomes a Queen on the far rank.',
        moves: pawnMoves,
        onMove: promote,
      },
      ninja_wizard: ninja('bishop', 'Wizard', 'step, fireball and teleport, both ready to use'),
      ninja_kamikaze_knight: ninja('knight', 'Kamikaze-Knight', 'knight jumps and self-destruct'),
      ninja_2009_toyota_corolla: ninja('rook', '2009 Toyota Corolla', 'rook moves and charge, ready to use'),
    },

    // Read from your own seat: first row is your back rank, listed left to right.
    setup: [
      ['rook', 'knight', 'bishop', 'king', 'queen', 'bishop', 'knight', 'rook'],
      ['pawn', 'ninja_wizard', 'pawn', 'pawn', 'ninja_2009_toyota_corolla', 'pawn', 'pawn', 'ninja_kamikaze_knight'],
    ],
  });
})();
