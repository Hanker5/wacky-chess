// Black's pieces. This whole folder belongs to the Black player.
// Read AGENTS.md and docs/PIECE_API.md before changing anything.
//
// Most pieces come from the catalogue of past matches (see each piece's `from` in
// design.json), adapted to Black's seat. The Mystery Piece is new: it rolls into a random
// piece from POOL.
//
// Keep everything inside this (() => { ... })() wrapper: both sides' files share
// one page, so top-level variables would collide with the other player's file.
(() => {
  const SIDE = 'black';
  const Q = (key) => `${SIDE}:${key}`;

  // ------------------------------------------------------------ shared helpers

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
  // Counts a plain `cooldown` down at the start of the owner's own turns.
  const tick = (p, g) => {
    if (g.turn === p.side && p.data.cooldown) p.data.cooldown--;
  };
  const cooldownBadge = (p) => p.data.cooldown || '';

  const isOwnRoyal = (p, g, t) => t && t.side === p.side && g.def(t).royal;
  const neighbors = (g, x, y) => g.DIRS.ALL
    .map(([dx, dy]) => [x + dx, y + dy])
    .filter(([nx, ny]) => g.inBounds(nx, ny));
  const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

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

  // A piece of ours was put on a new square by something other than its own move (thrown,
  // flung, swapped, sent through a portal). Checkers still get crowned and Wayfinders still win.
  function landed(q, g) {
    if (!g.isOnBoard(q) || q.side !== SIDE || g.rank(q) !== 8) return;
    if (q.type === Q('pawn')) {
      g.transform(q, Q('checker_king'));
      g.log(`👑 ${g.nameOf(q)} is crowned!`);
    } else if (q.type === Q('wayfinder')) {
      g.win(SIDE, `${g.nameOf(q)} reached the far side of the board!`);
    }
  }

  // ------------------------------------------------------------ Mystery Piece
  // Everything a Mystery Piece (or a fully grown Plant) can turn into: the main pieces,
  // minus Kings, the Mystery Piece itself, the Light, and helper pieces.
  const POOL = [
    'queen', 'bishop', 'knight', 'pawn', 'zombie', 'rook', 'bishop_2', 'pawn_2', 'barbarians',
    'spear', 'queen_2', 'rook_2', 'bishop_3', 'necromancer', 'rook_3', 'bishop_4', 'catapult',
    'necromancer_2', 'wizard', 'wayfinder', 'creeper', 'swapper', 'teleporter',
  ];
  const ACTIVATE = 'Activate ❓';
  function activate(p, g) {
    const key = g.pick(POOL);
    g.effect('burst', { x: p.x, y: p.y, radius: 0, icon: '❓', color: 'gold' });
    g.transform(p, Q(key));
    p.moveCount = -1; // the engine counts this action as a move; the new piece starts fresh
    g.log(`❓ The Mystery Piece on ${g.square(p.x, p.y)} becomes a ${g.def(p).name}!`);
  }

  // ------------------------------------------------------------ Heavy Artillery
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

  // ------------------------------------------------------------ 2009 Toyota Corolla
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

  // ------------------------------------------------------------ Hypnotist
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
  // onTurnStart (see everyTurn). `tick` makes it count once per turn.
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

  // ------------------------------------------------------------ Gardener and Plant
  const PLANT_COOLDOWN = 1;
  function gardenerMoves(p, g) {
    const out = g.leap(p, g.DIRS.KNIGHT);
    if (p.data.plantCd) return out;
    for (const [x, y] of neighbors(g, p.x, p.y)) {
      if (!g.isEmpty(x, y)) continue;
      out.push({ x, y, label: 'Plant 🌱', action(p, g) {
        g.effect('burst', { x, y, radius: 0, icon: '🌱', color: 'green' });
        g.spawn(p.side, Q('plant'), x, y);
        startCooldown(p, 'plantCd', PLANT_COOLDOWN);
      } });
    }
    return out;
  }
  const PLANT_DESCRIPTION = 'Can\'t move or do anything, but it can be captured. Grows at the start of each of your turns: 🌱 → ☘️ → 🍀, and on your 3rd turn after being planted it becomes a random Black piece (from the same list a Mystery Piece rolls from), which can act that same turn.';
  function plant(icon, stage, next) {
    return {
      name: 'Plant',
      icon,
      description: `${PLANT_DESCRIPTION} (This is stage ${stage} of 3.)`,
      moves: () => [],
      onTurnStart(p, g) {
        if (g.turn !== p.side) return;
        if (next) {
          g.transform(p, Q(next));
          return;
        }
        g.transform(p, Q(g.pick(POOL)));
        showLastMove(g);
        g.effect('burst', { x: p.x, y: p.y, radius: 0, icon: '🌸', color: 'hotpink' });
        g.log(`🌸 A Plant on ${g.square(p.x, p.y)} grew into a ${g.def(p).name}!`);
      },
    };
  }

  // ------------------------------------------------------------ Checker
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
  // Raw diagonal-forward offsets (checkerJumps works in board coordinates, not seat-relative).
  const forwardDiags = (p, g) => [[-1, g.forward(p.side)], [1, g.forward(p.side)]];

  // ------------------------------------------------------------ Zombie
  function shamble(p, g) {
    if (g.turn !== p.side) return;
    const enemies = g.pieces((q) => g.isEnemy(p, q));
    if (!enemies.length) return;
    const nearest = (x, y) => Math.min(...enemies.map((e) => cheb({ x, y }, e)));
    const bites = enemies.filter((e) => cheb(p, e) === 1);
    let target;
    if (bites.length) {
      target = g.pick(bites);
    } else {
      const here = nearest(p.x, p.y);
      const steps = neighbors(g, p.x, p.y).filter(([x, y]) => g.isEmpty(x, y));
      if (!steps.length) return;
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

  // ------------------------------------------------------------ Kamikaze, Barbarians, Spear
  // Destroys every piece (friend or foe, itself included) in the 3x3 around (cx, cy).
  function blast(g, kamikaze, cx, cy) {
    g.effect('burst', { x: cx, y: cy, radius: 1, icon: '💥', color: 'orange' });
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

  // Stationary strikes on every enemy within `reach` squares (Chebyshev), over anything between.
  function strikes(p, g, reach, label) {
    return g.pieces((t) => g.isEnemy(p, t) && cheb(t, p) <= reach).map((t) => ({
      x: t.x, y: t.y, label,
      action(p, g) {
        g.effect('projectile', { from: [p.x, p.y], to: [t.x, t.y], icon: '💢' });
        g.capture(t, p);
      },
    }));
  }

  // ------------------------------------------------------------ Flash, Grenade Launcher
  // The 8 directions in order around a circle, so +-1 is a 45 degree turn and +-2 is 90.
  const RING = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
  const TURNS = [-2, -1, 1, 2];

  function flashMoves(p, g) {
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
  }

  // ------------------------------------------------------------ Wizard (Black's, 2026-10-28)
  const WIZARD_COOLDOWN = 3;
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
              startCooldown(p, 'fireCd', WIZARD_COOLDOWN);
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
            startCooldown(p, 'tpCd', WIZARD_COOLDOWN);
            g.moveTo(p, x, y);
          } });
        } else if (t && t !== p && t.side === p.side) {
          out.push({ x, y, label: 'Swap places ✨', action(p, g) {
            g.effect('burst', { x: p.x, y: p.y, radius: 0, icon: '✨', color: 'violet' });
            g.effect('burst', { x, y, radius: 0, icon: '✨', color: 'violet' });
            startCooldown(p, 'tpCd', WIZARD_COOLDOWN);
            g.swap(p, t);
            landed(t, g);
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

  // ------------------------------------------------------------ Portal Wizard (White's, 2026-10-26)
  const FIREBALL_RANGE = 3;
  const FIREBALL_COOLDOWN = 3;
  const PORTAL_COLORS = ['rgba(70, 140, 255, 0.55)', 'rgba(190, 90, 255, 0.55)'];
  const PORTAL_WIZARDS = [Q('wizard'), Q('undead_wizard')];

  // A wizard halfway through Open Portal (portal A placed, portal B not yet). Its bonus
  // action is reserved for portal B, so no other piece of ours may move, and per-turn
  // effects (cooldowns, timers, zombies) don't run for that bonus turn.
  const casting = (g) => g.pieces((q) => q.side === SIDE && PORTAL_WIZARDS.includes(q.type) && q.data.casting).length > 0;

  // Portals share the tile map with the other side's tiles, so only use clean squares.
  const portalFree = (g, x, y) => {
    const t = g.peekTile(x, y);
    return g.isEmpty(x, y) && (!t || Object.keys(t).length === 0);
  };
  const myPortals = (p, g) => {
    const out = [];
    for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) {
      const t = g.peekTile(x, y);
      if (t && t.portal && t.portal.wizard === p.id) out.push({ x, y, t });
    }
    return out;
  };
  const clearPortal = (g, x, y) => {
    const t = g.peekTile(x, y);
    if (!t) return;
    delete t.portal; delete t.icon; delete t.color; delete t.label;
    if (Object.keys(t).length === 0) g.clearTile(x, y);
  };
  const closePortals = (p, g) => {
    for (const { x, y } of myPortals(p, g)) clearPortal(g, x, y);
  };
  const portalLabel = (to) =>
    `Portal to ${to}. Any piece that ends a move here is sent to ${to}, and whatever stands there is destroyed.`;

  // Send any piece that has just arrived on one of this wizard's portals to the other end.
  const runPortals = (p, g) => {
    const ends = myPortals(p, g).filter(({ t }) => t.portal.to);
    for (const { x, y, t } of ends) {
      if (!t.portal) continue; // collapsed earlier in this loop
      const traveler = g.at(x, y);
      if (!traveler) { t.portal.settled = null; continue; }
      if (traveler.id === t.portal.settled) continue; // came out here, or is stuck waiting
      const [ox, oy] = t.portal.to;
      const exit = g.peekTile(ox, oy);
      const blocker = g.at(ox, oy);
      g.effect('burst', { x, y, radius: 0, icon: '🌀', color: 'rgba(120, 90, 255, 0.85)' });
      g.effect('burst', { x: ox, y: oy, radius: 0, icon: blocker ? '💥' : '🌀', color: 'rgba(120, 90, 255, 0.85)' });
      if (blocker) {
        g.log(`🌀 ${g.nameOf(traveler)} telefrags ${g.nameOf(blocker)} on ${g.square(ox, oy)}!`);
        g.capture(blocker, null);
        if (!t.portal) continue; // telefragged the portal's own wizard: the portals collapse
      }
      if (g.at(ox, oy)) { t.portal.settled = traveler.id; continue; } // blocker survived
      g.moveTo(traveler, ox, oy);
      g.log(`🌀 ${g.nameOf(traveler)} steps through the portal to ${g.square(ox, oy)}.`);
      t.portal.settled = null;
      if (exit && exit.portal) exit.portal.settled = traveler.id;
      landed(traveler, g);
    }
  };

  function portalWizardMoves(p, g) {
    const out = [];
    const free = [];
    for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) if (portalFree(g, x, y)) free.push([x, y]);

    if (p.data.casting) {
      const a = p.data.casting;
      return free.map(([x, y]) => ({ x, y, label: 'Portal B 🌀', action(p, g, m) {
        p.data.casting = null;
        const first = g.peekTile(a.x, a.y);
        if (!first || !first.portal) return; // portal A was wiped out before B was placed
        const color = PORTAL_COLORS[p.id % 2];
        first.label = portalLabel(g.square(m.x, m.y));
        first.portal.to = [m.x, m.y];
        Object.assign(g.tile(m.x, m.y), {
          icon: '🌀', color, label: portalLabel(g.square(a.x, a.y)),
          portal: { wizard: p.id, to: [a.x, a.y], settled: null },
        });
      } }));
    }

    if (casting(g)) return out; // the other wizard is mid-spell

    out.push(...g.leap(p, g.DIRS.ALL));

    if (!p.data.cooldown) {
      for (const [dx, dy] of g.DIRS.ALL) {
        for (let d = 1; d <= FIREBALL_RANGE; d++) {
          const [x, y] = g.rel(p, dx * d, dy * d);
          if (!g.inBounds(x, y)) break;
          const target = g.at(x, y);
          if (!target) continue;
          if (g.isEnemy(p, target) && !g.def(target).royal) {
            out.push({ x, y, label: 'Fireball 🔥', action(p, g) {
              g.effect('projectile', { from: [p.x, p.y], to: [x, y], icon: '🔥' });
              g.effect('burst', { x, y, radius: 0, icon: '💥' });
              g.log(`🔥 ${g.nameOf(p)} hurls a fireball at ${g.nameOf(target)}!`);
              g.capture(target, p);
              p.data.cooldown = FIREBALL_COOLDOWN;
            } });
          }
          break;
        }
      }
    }

    // A portal pair needs two free squares.
    if (free.length >= 2) {
      for (const [x, y] of free) {
        out.push({ x, y, label: 'Portal A 🌀', action(p, g, m) {
          closePortals(p, g);
          Object.assign(g.tile(m.x, m.y), {
            icon: '🌀', color: PORTAL_COLORS[p.id % 2], label: 'Portal (opening…)',
            portal: { wizard: p.id, to: null, settled: null },
          });
          p.data.casting = { x: m.x, y: m.y, turn: g.turnNumber };
          g.log(`🌀 ${g.nameOf(p)} opens a portal. Choose where the other end goes.`);
          g.extraTurn();
        } });
      }
    }
    return out;
  }
  function portalWizardTurnStart(p, g) {
    // A spell that wasn't finished on the very next turn fizzles.
    if (p.data.casting && g.turnNumber !== p.data.casting.turn + 1) {
      closePortals(p, g);
      p.data.casting = null;
      g.log(`🌀 ${g.nameOf(p)}'s portal fizzles.`);
    }
    if (g.turn === p.side && !casting(g) && p.data.cooldown) p.data.cooldown--;
    // Portals whose wizard vanished without being captured close too.
    for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) {
      const t = g.peekTile(x, y);
      if (t && t.portal && !g.get(t.portal.wizard)) clearPortal(g, x, y);
    }
    runPortals(p, g);
  }
  function portalWizardCaptured(p, g) {
    if (myPortals(p, g).length) g.log(`🌀 ${g.nameOf(p)}'s portals collapse.`);
    closePortals(p, g);
    p.data.casting = null;
    return true;
  }

  // ------------------------------------------------------------ Catapult
  const FLING_RANGE = 4;
  function catapultMoves(p, g) {
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
          if (g.moveTo(ammo, x, y)) landed(ammo, g);
        } });
      }
    }
    return out;
  }

  // ------------------------------------------------------------ Undead (Necromancer 💀)
  const RAISE_COOLDOWN = 4;
  const UNDEAD_LIFE = 3;
  const UNDEAD_GREEN = 'rgba(90, 220, 90, 0.55)';
  const NOT_RAISABLE = ['plant', 'plant_2', 'plant_3', 'dead'];
  // Kinds with their own Undead art. Everything else comes back as itself.
  const UNDEAD_TYPE = { wizard: 'undead_wizard', catapult: 'undead_catapult' };

  function raiseMoves(p, g) {
    const out = g.slide(p, g.DIRS.ALL);
    if (p.data.cooldown) return out;
    // One corpse per kind is enough for the menu; any of them will do.
    const corpses = new Map();
    for (const c of g.state.captured) {
      const [side, kind] = c.type.split(':');
      if (c.side !== SIDE || side !== SIDE || !pieces[kind] || pieces[kind].royal) continue;
      if (NOT_RAISABLE.includes(kind) || kind.startsWith('undead_')) continue;
      if (c.data && (c.data.undead || c.data.raised)) continue; // once dead, they stay dead
      if (!corpses.has(kind)) corpses.set(kind, c.id);
    }
    for (const [dx, dy] of g.DIRS.ALL) {
      const [x, y] = g.rel(p, dx, dy);
      if (!g.isEmpty(x, y)) continue;
      for (const [kind, corpseId] of corpses) {
        out.push({ x, y, label: `Raise ${pieces[kind].name} ☠️`, action(p, g) {
          const corpse = g.state.captured.find((c) => c.id === corpseId);
          if (corpse) corpse.data.raised = true;
          const risen = g.spawn(p.side, Q(UNDEAD_TYPE[kind] || kind), x, y,
            { undead: { life: UNDEAD_LIFE, fresh: true, tick: g.turnNumber } });
          p.data.cooldown = RAISE_COOLDOWN;
          g.effect('burst', { x, y, radius: 0, icon: '☠️', color: UNDEAD_GREEN });
          g.log(`☠️ ${g.nameOf(p)} raises ${g.nameOf(risen)} on ${g.square(x, y)}!`);
        } });
      }
    }
    return out;
  }

  // Undead timers live in the piece's data, so they survive transforms (a crowned Checker,
  // a Mystery Piece that activates). They count down on our own turns.
  function tickUndead(g, bonus) {
    for (const q of g.pieces((q) => q.data && q.data.undead && q.data.undead.tick !== g.turnNumber)) {
      const u = q.data.undead;
      u.tick = g.turnNumber;
      if (g.turn !== SIDE || bonus) continue;
      if (u.fresh) { u.fresh = false; continue; }
      u.life--;
      if (u.life > 0) continue;
      showLastMove(g);
      g.effect('burst', { x: q.x, y: q.y, radius: 0, icon: '🦴', color: UNDEAD_GREEN });
      g.log(`🦴 ${g.nameOf(q)} crumbles to dust.`);
      closePortals(q, g); // an undead wizard's portals go with it
      g.remove(q);
    }
  }

  // ------------------------------------------------------------ square marks
  // Badges come from a piece's own definition, so hypnotized enemy pieces get their
  // countdown drawn as a tile instead, and Undead pieces get a green square. Redrawn
  // every turn so the marks follow the pieces.
  function refreshMarks(g) {
    for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) {
      const t = g.peekTile(x, y);
      if (!t || !t.blackMark) continue;
      delete t.blackMark; delete t.icon; delete t.color; delete t.label;
      if (!Object.keys(t).length) g.clearTile(x, y);
    }
    for (const q of g.pieces((q) => q.data && (q.data.hypnosis || q.data.undead))) {
      const h = q.data.hypnosis;
      let mark = null;
      if (h && q.side === h.side) {
        const left = g.turn === h.side ? h.left + 1 : h.left;
        // The piece covers most of the square, so the corner only fits one keycap digit.
        mark = {
          icon: `${left}️⃣`,
          color: '#a77bd6',
          label: `Hypnotized: fights for ${g.sideName(h.side)} for ${left} more of its turn${left === 1 ? '' : 's'}`,
        };
      } else if (q.data.undead) {
        const n = q.data.undead.life;
        mark = {
          color: UNDEAD_GREEN,
          label: `Undead: crumbles to dust after ${n} more of Black's turn${n === 1 ? '' : 's'}`,
        };
      }
      if (!mark) continue;
      const existing = g.peekTile(q.x, q.y);
      if (existing && (existing.icon || existing.color)) continue; // don't cover someone else's tile
      Object.assign(g.tile(q.x, q.y), mark, { blackMark: true });
    }
  }

  // Runs at the start of every turn, from each of our pieces (only the first call per turn
  // changes anything): hypnosis and undead timers, Wayfinders that got carried home, marks.
  function everyTurn(g) {
    const bonus = casting(g);
    if (!bonus) tickHypnosis(g);
    tickUndead(g, bonus);
    if (!g.state.winner) {
      const home = g.pieces((q) => q.type === Q('wayfinder') && q.side === SIDE && g.rank(q) === 8)[0];
      if (home) g.win(SIDE, `${g.nameOf(home)} reached the far side of the board!`);
    }
    refreshMarks(g);
  }

  // ------------------------------------------------------------ the pieces
  const pieces = {
    king: {
      name: 'King',
      icon: '♚',
      royal: true,
      description: 'Moves one square in any direction. You start with two Kings: lose both and you lose.',
      moves: (p, g) => g.leap(p, g.DIRS.ALL),
    },

    mystery_piece: {
      name: 'Mystery Piece',
      icon: '❓️',
      description: '', // filled in below, once the pool's names are known
      moves: (p) => [{ x: p.x, y: p.y, label: ACTIVATE, action: activate }],
    },

    queen: {
      name: 'Heavy Artillery',
      icon: 'sides/black/assets/heavy-artillery.svg',
      description: `Each turn, pick one: STEP 1 square in any direction, capturing an enemy there. Or FIRE 💣: lob a shell over anything in the way onto any square ${SHELL_MIN} to ${SHELL_MAX} squares away in one of the 8 directions (empty or not). The shell destroys every piece on that square and the 8 squares around it, friend or foe, Kings included: blowing up the enemy King wins, blowing up your own last King loses. Reloading takes ${RELOAD} turns, counting both players' turns, so it can fire again on your 3rd turn after firing (the badge counts down every turn).`,
      moves: artilleryMoves,
      badge: (p) => p.data.reload || '',
      onTurnStart(p) { if (p.data.reload > 0) p.data.reload--; },
    },

    bishop: {
      name: 'Hypnotist',
      icon: '🔮',
      description: `Each turn, pick one: STEP 1 square in any direction, capturing an enemy there. Or HYPNOTIZE 🌀 an enemy on one of the 8 squares next to it (not a King or other royal): it joins Black, keeping its type and abilities, and you can use it on your next ${HYPNOSIS_TURNS} turns. Right after your ${HYPNOSIS_TURNS}rd turn it turns back to White. While hypnotized, its square is tinted violet, with a counter in the corner showing how many of your turns are left. The spell keeps going even if the Hypnotist is captured. A Black piece that White has taken over can be hypnotized back, and then it rejoins Black for good. After hypnotizing, it can't hypnotize again on your next ${HYPNOSIS_COOLDOWN} turns (the badge counts down).`,
      moves: hypnotistMoves,
      badge: (p, g) => turnsLeft(p, g, 'hypnoCd') || '',
      onTurnStart: (p, g) => tickCooldowns(p, g, ['hypnoCd']),
    },

    knight: {
      name: 'Gardener',
      icon: '🪏',
      description: 'Each turn, pick one: JUMP in an L shape like a Knight, over anything in the way, capturing an enemy where it lands. Or PLANT 🌱 a Plant on any empty square next to it (8 directions). After planting, it can\'t plant again on your next turn (the badge shows when it\'s waiting), but it can still jump.',
      moves: gardenerMoves,
      badge: (p, g) => (turnsLeft(p, g, 'plantCd') ? '⏳' : ''),
      onTurnStart: (p, g) => tickCooldowns(p, g, ['plantCd']),
    },
    plant: plant('🌱', 1, 'plant_2'),
    plant_2: plant('☘️', 2, 'plant_3'),
    plant_3: plant('🍀', 3, null),

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
          g.transform(p, Q('checker_king'));
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

    zombie: {
      name: 'Zombie',
      icon: '🧟',
      description: 'Moves on its own and can\'t be moved by you. At the start of each of your turns (before you move), it shambles 1 square toward the nearest enemy. If an enemy is right next to it, it eats it instead, the enemy King included (which wins the game). Otherwise it steps to whichever empty neighboring square gets it closest to an enemy, and stays put if no step gets closer. Ties are picked at random.',
      moves: () => [],
      onTurnStart: shamble,
    },

    rook: {
      name: 'Archer',
      icon: '🏹',
      description: 'Steps one square in any direction (capturing as it goes). Or shoots any enemy piece on the board, '
        + 'no line of sight needed, every turn with no cooldown. The arrow has a 75% chance to drift one square '
        + 'in a random one of the 8 directions (possibly off the board). It destroys whatever piece it ends on, '
        + 'friend or foe. Otherwise it lands on the target.',
      moves: (p, g) => [
        ...g.leap(p, g.DIRS.ALL),
        ...g.pieces((t) => g.isEnemy(p, t)).map((t) => ({
          x: t.x, y: t.y, label: 'Shoot 🏹',
          action(p, g) {
            let tx = t.x, ty = t.y;
            if (g.random() < 0.75) {
              const [dx, dy] = g.pick(g.DIRS.ALL);
              tx += dx; ty += dy;
            }
            if (g.inBounds(tx, ty)) {
              g.effect('projectile', { from: [p.x, p.y], to: [tx, ty], icon: '🏹' });
              const hit = g.at(tx, ty);
              if (hit) g.capture(hit, null);
              else g.log(`The arrow lands harmlessly on ${g.square(tx, ty)}`);
            } else {
              g.effect('projectile', { from: [p.x, p.y], to: [t.x, t.y], icon: '🏹' });
              g.log('The arrow flies off the board!');
            }
          },
        })),
      ],
    },

    bishop_2: {
      name: 'Kamikaze',
      icon: '🛩️',
      description: 'Moves like a queen in all 8 directions but flies over any pieces in the way. Landing on an enemy '
        + 'makes it blow up, destroying every piece in the 3x3 area around that square, friends and itself included. '
        + 'It can also detonate in place instead of moving. One use only. Indestructible Castles survive.',
      moves(p, g) {
        const out = [];
        for (const [dx, dy] of g.DIRS.ALL) {
          for (let x = p.x + dx, y = p.y + dy; g.inBounds(x, y); x += dx, y += dy) {
            const occupant = g.at(x, y);
            if (!occupant) out.push({ x, y });
            else if (g.isEnemy(p, occupant)) {
              out.push({
                x, y, label: 'Strike 💥',
                action(p, g) {
                  g.effect('move', { from: [p.x, p.y], to: [x, y] });
                  blast(g, p, x, y);
                },
              });
            }
          }
        }
        out.push({
          x: p.x, y: p.y, label: 'Detonate 💥',
          action: (p, g) => blast(g, p, p.x, p.y),
        });
        return out;
      },
    },

    pawn_2: {
      name: 'Castle',
      icon: '🏰',
      description: 'Cannot move and cannot be destroyed by anything. A wall.',
      moves: () => [],
      onCaptured: () => false,
    },

    barbarians: {
      name: 'Barbarians',
      icon: '⚔️',
      description: 'Steps one square up, down, left or right (capturing an enemy it steps onto). It can also kill any '
        + 'enemy in the 8 squares around it without moving, every turn, with no cooldown.',
      moves: (p, g) => [
        ...g.leap(p, g.DIRS.ORTHO),
        ...strikes(p, g, 1, 'Strike ⚔️'),
      ],
    },

    spear: {
      name: 'Spear',
      icon: 'sides/black/assets/spear.svg',
      description: 'Steps one square in any direction (capturing as it goes). It can also kill any enemy within 2 squares '
        + '(the whole 5x5 area around it), over anything in between, without moving, every turn with no cooldown.',
      moves: (p, g) => [
        ...g.leap(p, g.DIRS.ALL),
        ...strikes(p, g, 2, 'Strike 🗡️'),
      ],
    },

    queen_2: {
      name: 'Flash',
      icon: '⚡️',
      description: 'Slides any distance in any direction, and may make one 45° or 90° turn partway through the move. It cannot move through pieces, and captures only on the square where its path ends.',
      moves: flashMoves,
    },

    rook_2: {
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
            g.log('💥 The Tank smashes the ground!');
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
                landed(q, g);
              } });
            }
          }
        }
        return out;
      },
      onTurnStart: tick,
    },

    bishop_3: {
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

    knight_2: {
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
                if (g.isEmpty(x, y)) g.spawn(p.side, Q('dead'), x, y);
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

    rook_3: {
      name: '2009 Toyota Corolla',
      icon: '🚗',
      description: `Moves like a Rook. Or CHARGE 🚗💨: drive any distance in a straight line (up, down, left or right) right through other pieces, running over every piece it passes and the one it lands on: friend or foe, the enemy King included. It can't charge through your own King. After a charge it can only make normal Rook moves for your next ${CHARGE_COOLDOWN} turns (the badge counts down). If a piece survives being hit, the car drives over it; if the piece on the final square survives, the car stops on the last empty square before it.`,
      moves: corollaMoves,
      badge: (p, g) => turnsLeft(p, g, 'chargeCd') || '',
      onTurnStart: (p, g) => tickCooldowns(p, g, ['chargeCd']),
    },

    bishop_4: {
      name: 'Wizard',
      icon: '🧙‍♂️',
      description: 'Each turn, pick one: STEP 1 square in any direction, capturing an enemy there. FIREBALL 🔥: blast the first piece within 3 squares in any of the 8 directions, friend or foe (never your own King), destroying it while the Wizard stays put. TELEPORT ✨: jump to any empty square, or swap places with one of your own pieces (never onto an enemy). Fireball and Teleport each have their own cooldown: after use, that ability is unavailable for your next 3 turns (the badge shows 🔥/✨ and turns left).',
      moves: wizardMoves,
      badge: wizardBadge,
      onTurnStart: (p, g) => tickCooldowns(p, g, ['fireCd', 'tpCd']),
    },

    catapult: {
      name: 'Catapult',
      icon: 'sides/black/assets/catapult.svg',
      description:
        'Slides any distance in a straight line, like a rook. '
        + 'FLING: instead of moving, it launches any piece (either side) on one of the 8 squares around it. '
        + `The piece flies straight away from the catapult, over anything in between, and lands 1 to ${FLING_RANGE} squares further on. `
        + "It can land on an empty square or crush one of the Catapult's enemies there, kings included, but never on a friend of the Catapult. "
        + 'If the crushed piece survives, the flung piece stays where it was.',
      moves: catapultMoves,
    },

    necromancer_2: {
      name: 'Necromancer',
      icon: '💀',
      description:
        'Slides any distance in any direction, like a queen. '
        + 'RAISE DEAD: instead of moving, she brings back one of your captured pieces (not a King, Plant or Dead Body) on an empty square next to her, '
        + `with all its real abilities. Then she needs ${RAISE_COOLDOWN} turns to recharge (the badge counts down). `
        + `Raised pieces are Undead: their square is tinted green, they crumble to dust after ${UNDEAD_LIFE} of your turns (the ☠ badge counts down), and once dead they stay dead. `
        + 'A raised Wizard 🧙 or Catapult comes back as its Undead version.',
      badge: (p) => p.data.cooldown || '',
      moves: raiseMoves,
      onTurnStart(p, g) {
        if (g.turn === p.side && p.data.cooldown) p.data.cooldown--;
      },
    },

    wizard: {
      name: 'Wizard',
      icon: '🧙',
      description:
        'Each turn, picks one spell. '
        + 'STEP: moves 1 square in any direction, capturing normally. '
        + `FIREBALL 🔥: destroys the first enemy in any straight or diagonal line within ${FIREBALL_RANGE} squares (not kings or other royals), then needs ${FIREBALL_COOLDOWN} turns to recharge (the badge counts down). `
        + 'OPEN PORTAL 🌀: places a pair of linked portals on any two empty squares (two clicks, one turn). '
        + 'Any piece, from either side, that ends a move on a portal is sent to the other one, and whatever is standing there is destroyed (telefrag), friend or foe, even a king. '
        + 'Each wizard has one pair; opening a new pair closes the old one, and its portals vanish if the wizard dies.',
      badge: (p) => (p.data.casting ? '🌀' : p.data.cooldown || ''),
      moves: portalWizardMoves,
      onTurnStart: portalWizardTurnStart,
      onCaptured: portalWizardCaptured,
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
      badge: (p) => (p.data.fuse ? `${Math.ceil(p.data.fuse / 2)}💣` : ''),
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
        const victims = g.pieces((v) => cheb(v, p) <= 1);
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
              landed(target, game);
            },
          });
        }
        return out;
      },
    },

    teleporter: {
      name: 'Teleporter',
      icon: '🌀',
      description: 'Moves 1 square in any direction, or teleports to any empty square, or teleports onto any enemy piece anywhere on the board and captures it, except Kings and other royal pieces (it can only take those by stepping 1 square).',
      moves(p, g) {
        const out = g.leap(p, g.DIRS.ALL);
        const zap = (piece, game, move) => {
          game.effect('projectile', { from: [piece.x, piece.y], to: [move.x, move.y], icon: '🌀' });
          game.moveTo(piece, move.x, move.y);
        };
        for (const target of g.pieces()) {
          if (target.side === p.side || g.def(target).royal) continue;
          out.push({ x: target.x, y: target.y, label: `Teleport and capture ${g.nameOf(target)} 🌀`, action: zap });
        }
        for (let x = 0; x < 8; x++) {
          for (let y = 0; y < 8; y++) {
            if (g.isEmpty(x, y)) out.push({ x, y, label: 'Teleport 🌀', action: zap });
          }
        }
        return out;
      },
    },
  };

  pieces.undead_wizard = {
    ...pieces.wizard,
    name: 'Undead Wizard',
    icon: 'sides/black/assets/undead_wizard.svg',
    description: `Raised by the Necromancer. ${pieces.wizard.description} Crumbles to dust after ${UNDEAD_LIFE} turns (the ☠ badge counts down), and can't be raised again.`,
  };
  pieces.undead_catapult = {
    ...pieces.catapult,
    name: 'Undead Catapult',
    icon: 'sides/black/assets/undead_catapult.svg',
    description: `Raised by the Necromancer. ${pieces.catapult.description} Crumbles to dust after ${UNDEAD_LIFE} turns (the ☠ badge counts down), and can't be raised again.`,
  };

  // Name the Mystery Piece's pool, telling apart the two Necromancers and two Wizards by icon.
  const poolNames = POOL.map((key) => {
    const { name, icon } = pieces[key];
    const twin = POOL.some((k) => k !== key && pieces[k].name === name);
    return twin ? `${name} ${icon}` : name;
  });
  pieces.mystery_piece.description = `Can't move. On your turn, click it and then click it again to ACTIVATE ❓: it turns into a random one of these ${POOL.length} pieces, each equally likely: ${poolNames.join(', ')}. Activating uses your turn; the new piece can act from your next turn. Until then it can be captured like any piece.`;

  // Wrap every piece so the side-wide rules apply to all of them:
  // - while a portal Wizard is mid-spell, only it may act (its bonus action is for portal B),
  //   and per-turn effects skip that bonus turn;
  // - hypnosis and undead timers, carried-home Wayfinders, and square marks update each turn;
  // - activating a Mystery Piece doesn't count as the new piece's own move (no Creeper fuse);
  // - Undead pieces show their ☠ countdown.
  for (const [key, def] of Object.entries(pieces)) {
    const portal = key === 'wizard' || key === 'undead_wizard';
    const { moves, onTurnStart, onMove, badge } = def;
    if (!portal) def.moves = (p, g) => (casting(g) ? [] : moves(p, g));
    def.onTurnStart = (p, g) => {
      everyTurn(g);
      if (onTurnStart && g.isOnBoard(p) && (portal || !casting(g))) onTurnStart(p, g);
      refreshMarks(g);
    };
    if (onMove) {
      def.onMove = (p, g, info) => {
        if (info && info.move && info.move.label === ACTIVATE) return;
        onMove(p, g, info);
      };
    }
    def.badge = (p, g) => {
      const own = badge ? badge(p, g) : '';
      const u = p.data && p.data.undead;
      return [u && `☠${u.life}`, own].filter(Boolean).join(' ');
    };
  }

  WackyChess.defineSide('black', {
    name: 'Black',
    pieces,

    // Read from your own seat: first row is your back rank, listed left to right.
    setup: [
      ['rook_3', 'knight', 'knight', 'king', 'king', 'knight', 'knight', 'rook_3'],
      Array(8).fill('mystery_piece'),
      Array(8).fill(null),
    ],
  });
})();
