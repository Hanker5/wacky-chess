// White's pieces. This whole folder belongs to the White player.
// Read AGENTS.md and docs/PIECE_API.md before changing anything.
//
// Keep everything inside this (() => { ... })() wrapper: both sides' files share
// one page, so top-level variables would collide with the other player's file.
(() => {
  // Own-turn cooldowns: an ability is unavailable for the owner's next N turns after use.
  // The stored counter starts one higher because it ticks at the start of each of the
  // owner's turns.
  const startCooldown = (p, key, turns) => { p.data[key] = turns + 1; };
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
  const neighbors = (g, x, y) => g.DIRS.ALL
    .map(([dx, dy]) => [x + dx, y + dy])
    .filter(([nx, ny]) => g.inBounds(nx, ny));
  const distance = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

  // Effects queued in onTurnStart play over the board as it was before the last move, and
  // an ordinary move has no animation of its own. Call this before such effects: it slides
  // the piece that just moved first, so it isn't still shown on its old square.
  function showLastMove(g) {
    const last = g.state.lastMove;
    if (!last) return;
    const { from, to } = last;
    if (!g.at(to.x, to.y) || g.at(from.x, from.y)) return; // nothing slid from `from` to `to`
    if (g.effects.some((fx) => fx.kind === 'move' && fx.to[0] === to.x && fx.to[1] === to.y)) return;
    g.effect('move', { from: [from.x, from.y], to: [to.x, to.y] });
  }

  // ---- Wizard-King
  const FIREBALL_RANGE = 3;
  const FIREBALL_COOLDOWN = 3;
  function wizardKingMoves(p, g) {
    const out = g.leap(p, g.DIRS.ALL);
    if (p.data.fireCd) return out;
    for (const [dx, dy] of g.DIRS.ALL) {
      for (let k = 1; k <= FIREBALL_RANGE; k++) {
        const [x, y] = g.rel(p, dx * k, dy * k);
        if (!g.inBounds(x, y)) break;
        const target = g.at(x, y);
        if (!target) continue;
        if (!isOwnRoyal(p, g, target)) {
          out.push({ x, y, label: 'Fireball 🔥', action(p, g) {
            g.effect('projectile', { from: [p.x, p.y], to: [x, y], icon: '🔥' });
            g.effect('burst', { x, y, radius: 0, icon: '💥', color: 'orangered' });
            startCooldown(p, 'fireCd', FIREBALL_COOLDOWN);
            g.capture(target, p);
          } });
        }
        break;
      }
    }
    return out;
  }

  // ---- Heavy Artillery
  const SHELL_MIN = 2;
  const SHELL_MAX = 5;
  const RELOAD = 5; // counted in turns of both players
  function artilleryMoves(p, g) {
    const out = g.leap(p, g.DIRS.ALL);
    if (p.data.reload) return out;
    for (const [dx, dy] of g.DIRS.ALL) {
      for (let k = SHELL_MIN; k <= SHELL_MAX; k++) {
        const [x, y] = g.rel(p, dx * k, dy * k);
        if (!g.inBounds(x, y)) break;
        out.push({ x, y, label: 'Fire shell 💣', action: (p, g) => fireShell(p, g, x, y) });
      }
    }
    return out;
  }
  function fireShell(p, g, x, y) {
    g.effect('projectile', { from: [p.x, p.y], to: [x, y], icon: '💣' });
    g.effect('burst', { x, y, radius: 1, icon: '💥', color: 'orangered' });
    g.log(`💣 Heavy Artillery shells ${g.square(x, y)}!`);
    p.data.reload = RELOAD;
    for (const [bx, by] of [[x, y], ...neighbors(g, x, y)]) {
      const victim = g.at(bx, by);
      if (victim) g.capture(victim, null);
    }
  }

  // ---- 2009 Toyota Corolla (same as Black's from the 2026-10-28 match)
  const CHARGE_COOLDOWN = 3;
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
    // The car itself drives down the road, crashing into each victim as it reaches it.
    let shownAt = [p.x, p.y];
    const driveTo = (sq) => {
      if (sq[0] === shownAt[0] && sq[1] === shownAt[1]) return;
      g.effect('move', { from: shownAt, to: sq });
      shownAt = sq;
    };
    let stop = null;
    for (const [x, y] of road) {
      const victim = g.at(x, y);
      if (victim) {
        driveTo([x, y]);
        g.effect('burst', { x, y, radius: 0, icon: '💥' });
        g.capture(victim, p);
        if (!g.isOnBoard(p)) return;
      }
      if (g.isEmpty(x, y)) stop = [x, y];
    }
    startCooldown(p, 'chargeCd', CHARGE_COOLDOWN);
    if (stop) {
      driveTo(stop);
      g.moveTo(p, ...stop);
    }
  }

  // ---- Hypnotist
  const HYPNOSIS_COOLDOWN = 3;
  const HYPNOSIS_TURNS = 3; // how many of the hypnotizer's turns the victim serves
  function hypnotistMoves(p, g) {
    const out = g.leap(p, g.DIRS.ALL);
    if (p.data.hypnoCd) return out;
    for (const [x, y] of neighbors(g, p.x, p.y)) {
      const t = g.at(x, y);
      if (t && g.isEnemy(p, t) && !g.def(t).royal) {
        out.push({ x, y, label: 'Hypnotize 🌀', action: (p, g) => hypnotize(p, g, t) });
      }
    }
    return out;
  }
  function hypnotize(p, g, t) {
    g.effect('projectile', { from: [p.x, p.y], to: [t.x, t.y], icon: '🌀' });
    g.effect('burst', { x: t.x, y: t.y, radius: 0, icon: '😵‍💫', color: 'violet' });
    startCooldown(p, 'hypnoCd', HYPNOSIS_COOLDOWN);
    g.convert(t, p.side);
    if (t.type.startsWith(`${p.side}:`)) {
      // One of our own pieces that the enemy had taken: it comes home for good.
      delete t.data.hypnosis;
      g.log(`🌀 ${g.nameOf(t)} snaps out of it and rejoins for good!`);
      return;
    }
    t.data.hypnosis = { side: p.side, left: HYPNOSIS_TURNS, tick: g.turnNumber };
    g.log(`🌀 ${g.nameOf(t)} is hypnotized for ${HYPNOSIS_TURNS} turns!`);
  }
  // Hypnotized pieces are the enemy's types, so their timers are run from our pieces'
  // onTurnStart. Every one of our pieces calls this; `tick` makes it count once per turn.
  function tickHypnosis(g) {
    const hypnotized = g.pieces((q) => q.data && q.data.hypnosis && q.data.hypnosis.tick !== g.turnNumber);
    for (const q of hypnotized) {
      const h = q.data.hypnosis;
      h.tick = g.turnNumber;
      if (q.side !== h.side) { delete q.data.hypnosis; continue; } // converted back some other way
      if (g.turn === h.side) {
        h.left--;
      } else if (h.left <= 0) {
        delete q.data.hypnosis;
        g.convert(q, q.type.split(':')[0]);
        showLastMove(g);
        g.effect('burst', { x: q.x, y: q.y, radius: 0, icon: '💫', color: 'violet' });
        g.log(`💫 ${g.nameOf(q)} wakes up from its hypnosis!`);
      }
    }
  }

  // ---- Gardener and Plant
  const PLANT_COOLDOWN = 1;
  const BLOOMS = ['queen', 'rook', 'bishop', 'knight', 'zombie'];
  function gardenerMoves(p, g) {
    const out = g.leap(p, g.DIRS.KNIGHT);
    if (p.data.plantCd) return out;
    for (const [x, y] of neighbors(g, p.x, p.y)) {
      if (!g.isEmpty(x, y)) continue;
      out.push({ x, y, label: 'Plant 🌱', action(p, g) {
        g.effect('burst', { x, y, radius: 0, icon: '🌱', color: 'green' });
        g.spawn(p.side, 'white:plant', x, y);
        startCooldown(p, 'plantCd', PLANT_COOLDOWN);
      } });
    }
    return out;
  }
  const PLANT_DESCRIPTION = 'Can\'t move or do anything, but it can be captured. Grows at the start of each of your turns: 🌱 → ☘️ → 🍀, and on your 3rd turn after being planted it becomes a random White piece (Heavy Artillery, 2009 Toyota Corolla, Hypnotist, Gardener or Zombie), which can act that same turn.';
  function plant(icon, stage, next) {
    return {
      name: 'Plant',
      icon,
      description: `${PLANT_DESCRIPTION} (This is stage ${stage} of 3.)`,
      moves: () => [],
      onTurnStart(p, g) {
        if (g.turn !== p.side) return;
        if (next) {
          g.transform(p, `white:${next}`);
          return;
        }
        const bloom = g.pick(BLOOMS);
        g.transform(p, `white:${bloom}`);
        showLastMove(g);
        g.effect('burst', { x: p.x, y: p.y, radius: 0, icon: '🌸', color: 'hotpink' });
        g.log(`🌸 A Plant on ${g.square(p.x, p.y)} grew into a ${g.def(p).name}!`);
      },
    };
  }

  // ---- Checker
  // Every chain of jumps the piece could make: each hop goes diagonally over an adjacent
  // enemy to the empty square beyond. Every prefix is a legal stopping point. An uncrowned
  // checker's chain ends when it reaches the far rank (it gets crowned there).
  function checkerJumps(p, g, dirs, crowned) {
    const chains = [];
    const farRow = p.side === 'white' ? 7 : 0;
    const walk = (x, y, path, jumped) => {
      for (const [dx, dy] of dirs) {
        const [mx, my, lx, ly] = [x + dx, y + dy, x + 2 * dx, y + 2 * dy];
        if (!g.inBounds(lx, ly)) continue;
        const mid = g.at(mx, my);
        if (!g.isEnemy(p, mid) || jumped.some(([jx, jy]) => jx === mx && jy === my)) continue;
        const land = g.at(lx, ly);
        if (land && land !== p) continue;
        const chain = { path: [...path, [lx, ly]], jumped: [...jumped, [mx, my]] };
        chains.push(chain);
        if (crowned || ly !== farRow) walk(lx, ly, chain.path, chain.jumped);
      }
    };
    walk(p.x, p.y, [], []);
    return chains.map(({ path, jumped }) => {
      const [x, y] = path[path.length - 1];
      const label = path.length === 1 ? 'Jump' : `Jump ×${path.length} (${path.map((sq) => g.square(...sq)).join('→')})`;
      return { x, y, label, action: (p, g) => jump(p, g, path, jumped) };
    });
  }
  function jump(p, g, path, jumped) {
    for (let i = 0; i < path.length; i++) {
      const [mx, my] = jumped[i];
      const [lx, ly] = path[i];
      if (!g.isEmpty(lx, ly)) return; // something appeared on the landing square
      g.effect('move', { from: [p.x, p.y], to: [lx, ly] });
      g.effect('burst', { x: mx, y: my, radius: 0, icon: '💥' });
      const victim = g.at(mx, my);
      if (victim) g.capture(victim, p);
      if (!g.isOnBoard(p) || !g.isEmpty(lx, ly)) return;
      g.moveTo(p, lx, ly);
    }
  }
  const forwardDiags = (p, g) => [[-1, g.forward(p.side)], [1, g.forward(p.side)]];

  // ---- Zombie
  function shamble(p, g) {
    if (g.turn !== p.side) return;
    const enemies = g.pieces((q) => g.isEnemy(p, q));
    if (!enemies.length) return;
    const nearest = (x, y) => Math.min(...enemies.map((e) => distance({ x, y }, e)));
    const bites = enemies.filter((e) => distance(p, e) === 1);
    let target;
    if (bites.length) {
      target = g.pick(bites);
    } else {
      const here = nearest(p.x, p.y);
      const steps = neighbors(g, p.x, p.y).filter(([x, y]) => g.isEmpty(x, y));
      const best = Math.min(...steps.map(([x, y]) => nearest(x, y)));
      if (!(best < here)) return;
      const [x, y] = g.pick(steps.filter(([sx, sy]) => nearest(sx, sy) === best));
      target = { x, y };
    }
    showLastMove(g);
    g.effect('move', { from: [p.x, p.y], to: [target.x, target.y] });
    if (bites.length) {
      g.effect('burst', { x: target.x, y: target.y, radius: 0, icon: '🧠', color: 'darkolivegreen' });
      g.log(`🧟 A Zombie eats ${g.nameOf(target)}!`);
    }
    g.moveTo(p, target.x, target.y);
  }

  const pieces = {
    king: {
      name: 'Wizard-King',
      icon: '♚',
      royal: true,
      description: `Each turn, pick one: STEP 1 square in any direction, capturing an enemy there. Or FIREBALL 🔥: blast the first piece within ${FIREBALL_RANGE} squares in any of the 8 directions, friend or foe (the enemy King too, which wins the game), destroying it while the Wizard-King stays put. After a fireball, it can't fireball again on your next ${FIREBALL_COOLDOWN} turns (the badge counts down). Lose all your royal pieces and you lose.`,
      moves: wizardKingMoves,
      badge: (p, g) => { const n = turnsLeft(p, g, 'fireCd'); return n ? `🔥${n}` : ''; },
      onTurnStart: (p, g) => tickCooldowns(p, g, ['fireCd']),
    },
    queen: {
      name: 'Heavy Artillery',
      icon: 'sides/white/assets/heavy-artillery.svg',
      description: `Each turn, pick one: STEP 1 square in any direction, capturing an enemy there. Or FIRE 💣: lob a shell over anything in the way onto any square ${SHELL_MIN} to ${SHELL_MAX} squares away in one of the 8 directions (empty or not). The shell destroys every piece on that square and the 8 squares around it, friend or foe, Kings included: blowing up the enemy King wins, blowing up your own loses. Reloading takes ${RELOAD} turns, counting both players' turns, so it can fire again on your 3rd turn after firing (the badge counts down every turn).`,
      moves: artilleryMoves,
      badge: (p) => p.data.reload || '',
      onTurnStart(p) { if (p.data.reload > 0) p.data.reload--; },
    },
    rook: {
      name: '2009 Toyota Corolla',
      icon: '🚗',
      description: `Moves like a Rook. Or CHARGE 🚗💨: drive any distance in a straight line (up, down, left or right) right through other pieces, running over every piece it passes and the one it lands on: friend or foe, the enemy King included. It can't charge through your own King. After a charge it can only make normal Rook moves for your next ${CHARGE_COOLDOWN} turns (the badge counts down). If a piece survives being hit, the car drives over it; if the piece on the final square survives, the car stops on the last empty square before it.`,
      moves: corollaMoves,
      badge: (p, g) => turnsLeft(p, g, 'chargeCd') || '',
      onTurnStart: (p, g) => tickCooldowns(p, g, ['chargeCd']),
    },
    bishop: {
      name: 'Hypnotist',
      icon: '🔮',
      description: `Each turn, pick one: STEP 1 square in any direction, capturing an enemy there. Or HYPNOTIZE 🌀 an enemy on one of the 8 squares next to it (not a King or other royal): it joins White, keeping its type and abilities, and you can use it on your next ${HYPNOSIS_TURNS} turns. Right after your ${HYPNOSIS_TURNS}rd turn it turns back to Black. The spell keeps going even if the Hypnotist is captured. A captured White piece that Black has taken over can be hypnotized back, and then it rejoins White for good. After hypnotizing, it can't hypnotize again on your next ${HYPNOSIS_COOLDOWN} turns (the badge counts down).`,
      moves: hypnotistMoves,
      badge: (p, g) => turnsLeft(p, g, 'hypnoCd') || '',
      onTurnStart: (p, g) => tickCooldowns(p, g, ['hypnoCd']),
    },
    knight: {
      name: 'Gardener',
      icon: '🪏',
      description: `Each turn, pick one: JUMP in an L shape like a Knight, over anything in the way, capturing an enemy where it lands. Or PLANT 🌱 a Plant on any empty square next to it (8 directions). After planting, it can't plant again on your next turn (the badge shows when it's waiting), but it can still jump.`,
      moves: gardenerMoves,
      badge: (p, g) => (turnsLeft(p, g, 'plantCd') ? '⏳' : ''),
      onTurnStart: (p, g) => tickCooldowns(p, g, ['plantCd']),
    },
    pawn: {
      name: 'Checker',
      icon: '⚪️',
      description: 'Plays like a checkers piece. Moves 1 square diagonally forward onto an empty square. Or JUMP: hop diagonally forward over an adjacent enemy (the enemy King too, which wins) onto the empty square beyond, capturing it. After a jump it may keep jumping in the same turn (you pick where the chain stops). Reaching the far rank crowns it as a Checker King, and that ends the chain.',
      moves: (p, g) => [
        ...g.leap(p, [[-1, 1], [1, 1]], { capture: false }),
        ...checkerJumps(p, g, forwardDiags(p, g), false),
      ],
      onMove(p, g) {
        if (g.rank(p) === 8) {
          g.transform(p, 'white:checker_king');
          g.log(`👑 ${g.nameOf(p)} is crowned!`);
        }
      },
    },
    checker_king: {
      name: 'Checker King',
      icon: '👑',
      description: 'A crowned Checker (not royal: losing it doesn\'t lose the game). Moves 1 square diagonally in any direction onto an empty square. Or JUMP diagonally in any direction over an adjacent enemy (the enemy King too, which wins) onto the empty square beyond, capturing it, and may keep chaining jumps in the same turn.',
      moves: (p, g) => [
        ...g.leap(p, g.DIRS.DIAG, { capture: false }),
        ...checkerJumps(p, g, g.DIRS.DIAG, true),
      ],
    },
    plant: plant('🌱', 1, 'plant_2'),
    plant_2: plant('☘️', 2, 'plant_3'),
    plant_3: plant('🍀', 3, null),
    zombie: {
      name: 'Zombie',
      icon: '🧟',
      description: 'Moves on its own and can\'t be moved by you. At the start of each of your turns (before you move), it shambles 1 square toward the nearest enemy. If an enemy is right next to it, it eats it instead, the enemy King included (which wins the game). Otherwise it steps to whichever empty neighboring square gets it closest to an enemy, and stays put if no step gets closer. Ties are picked at random.',
      moves: () => [],
      onTurnStart: shamble,
    },
  };

  // Every White piece keeps the hypnosis timers ticking (only the first call each turn counts).
  for (const def of Object.values(pieces)) {
    const own = def.onTurnStart;
    def.onTurnStart = (p, g) => {
      tickHypnosis(g);
      if (own) own(p, g);
    };
  }

  WackyChess.defineSide('white', {
    name: 'White',
    pieces,

    // Read from your own seat: first row is your back rank, listed left to right.
    setup: [
      ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'],
      ['zombie', 'pawn', 'pawn', 'pawn', 'pawn', 'pawn', 'pawn', 'zombie'],
    ],
  });
})();
