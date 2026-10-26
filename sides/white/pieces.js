// White's pieces. This whole folder belongs to the White player.
// Read AGENTS.md and docs/PIECE_API.md before changing anything.
//
// Keep everything inside this (() => { ... })() wrapper: both sides' files share
// one page, so top-level variables would collide with the other player's file.
(() => {
  const FIREBALL_RANGE = 3;
  const FIREBALL_COOLDOWN = 3;
  const PORTAL_COLORS = ['rgba(70, 140, 255, 0.55)', 'rgba(190, 90, 255, 0.55)'];
  const FLING_RANGE = 4;
  const RAISE_COOLDOWN = 4;
  const UNDEAD_LIFE = 3;
  const RAISABLE = ['pawn', 'knight', 'wizard', 'catapult', 'queen'];
  const UNDEAD_GREEN = 'rgba(90, 220, 90, 0.85)';

  // A wizard halfway through Open Portal (portal A placed, portal B not yet).
  const casting = (side, g) =>
    g.pieces((q) => q.side === side && (q.type === 'white:wizard' || q.type === 'white:undead_wizard') && q.data.casting).length > 0;

  // While a wizard is mid-spell, its bonus action is reserved for portal B.
  const unlessCasting = (moves) => (p, g) => (casting(p.side, g) ? [] : moves(p, g));

  // The start of one of this piece's own turns (not the bonus action of a portal spell).
  const ownTurn = (p, g) => g.turn === p.side && !casting(p.side, g);

  // Pawns (living or undead) promote on the far rank, however they got there.
  const promote = (p, g) => {
    if (g.rank(p) !== 8 || (p.type !== 'white:pawn' && p.type !== 'white:undead_pawn')) return;
    g.transform(p, p.type === 'white:undead_pawn' ? 'undead_queen' : 'queen');
    g.log(`${g.nameOf(p)} promoted!`);
  };

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
    }
  };

  const pieces = {
    king: {
      name: 'King',
      icon: '♚',
      royal: true,
      description: 'Moves one square in any direction. Lose all your royal pieces and you lose.',
      moves: unlessCasting((p, g) => g.leap(p, g.DIRS.ALL)),
    },
    queen: {
      name: 'Queen',
      icon: '♛',
      description: 'Slides any distance in any direction.',
      moves: unlessCasting((p, g) => g.slide(p, g.DIRS.ALL)),
    },
    catapult: {
      name: 'Catapult',
      icon: 'sides/white/assets/catapult.svg',
      description:
        'Slides any distance in a straight line, like a rook. ' +
        `FLING: instead of moving, it launches any piece (either side) on one of the 8 squares around it. ` +
        `The piece flies straight away from the catapult, over anything in between, and lands 1 to ${FLING_RANGE} squares further on. ` +
        "It can land on an empty square or crush one of the Catapult's enemies there, kings included, but never on a friend of the Catapult. " +
        'If the crushed piece survives, the flung piece stays where it was.',
      moves: unlessCasting((p, g) => {
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
              if (g.moveTo(ammo, x, y)) promote(ammo, g);
            } });
          }
        }
        return out;
      }),
    },
    necromancer: {
      name: 'Necromancer',
      icon: '💀',
      description:
        'Slides any distance in any direction, like a queen. ' +
        'RAISE DEAD: instead of moving, she brings back one of her captured pieces (never a king) on an empty square next to her, ' +
        `with all its real abilities. Then she needs ${RAISE_COOLDOWN} turns to recharge (the badge counts down). ` +
        `Raised pieces are Undead (green): they crumble to dust after ${UNDEAD_LIFE} turns, and once dead they stay dead.`,
      badge: (p) => p.data.cooldown || '',
      moves: unlessCasting((p, g) => {
        const out = g.slide(p, g.DIRS.ALL);
        if (p.data.cooldown) return out;
        // One corpse per kind is enough for the menu; any of them will do.
        const used = p.data.raised || [];
        const corpses = new Map();
        for (const c of g.state.captured) {
          const [side, kind] = c.type.split(':');
          if (c.side !== p.side || side !== 'white' || !RAISABLE.includes(kind) || used.includes(c.id)) continue;
          if (!corpses.has(kind)) corpses.set(kind, c);
        }
        for (const [dx, dy] of g.DIRS.ALL) {
          const [x, y] = g.rel(p, dx, dy);
          if (!g.isEmpty(x, y)) continue;
          for (const [kind, corpse] of corpses) {
            out.push({ x, y, label: `Raise ${pieces[kind].name} ☠️`, action(p, g) {
              const risen = g.spawn(p.side, `white:undead_${kind}`, x, y, { life: UNDEAD_LIFE, fresh: true });
              p.data.raised = [...used, corpse.id];
              p.data.cooldown = RAISE_COOLDOWN;
              g.effect('burst', { x, y, radius: 0, icon: '☠️', color: UNDEAD_GREEN });
              g.log(`☠️ ${g.nameOf(p)} raises ${g.nameOf(risen)} on ${g.square(x, y)}!`);
            } });
          }
        }
        return out;
      }),
      onTurnStart(p, g) {
        if (ownTurn(p, g) && p.data.cooldown) p.data.cooldown--;
      },
    },
    wizard: {
      name: 'Wizard',
      icon: '🧙',
      description:
        'Each turn, picks one spell. ' +
        'STEP: moves 1 square in any direction, capturing normally. ' +
        `FIREBALL 🔥: destroys the first enemy in any straight or diagonal line within ${FIREBALL_RANGE} squares (not kings or other royals), then needs ${FIREBALL_COOLDOWN} turns to recharge (the badge counts down). ` +
        'OPEN PORTAL 🌀: places a pair of linked portals on any two empty squares (two clicks, one turn). ' +
        'Any piece, from either side, that ends a move on a portal is sent to the other one, and whatever is standing there is destroyed (telefrag), friend or foe, even a king. ' +
        'Each wizard has one pair; opening a new pair closes the old one, and its portals vanish if the wizard dies.',
      badge: (p) => (p.data.casting ? '🌀' : p.data.cooldown || ''),
      moves(p, g) {
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

        if (casting(p.side, g)) return out; // the other wizard is mid-spell

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
        return out;
      },
      onTurnStart(p, g) {
        // A spell that wasn't finished on the very next turn fizzles.
        if (p.data.casting && g.turnNumber !== p.data.casting.turn + 1) {
          closePortals(p, g);
          p.data.casting = null;
          g.log(`🌀 ${g.nameOf(p)}'s portal fizzles.`);
        }
        if (ownTurn(p, g) && p.data.cooldown) p.data.cooldown--;
        // Portals whose wizard vanished without being captured close too.
        for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) {
          const t = g.peekTile(x, y);
          if (t && t.portal && !g.get(t.portal.wizard)) clearPortal(g, x, y);
        }
        runPortals(p, g);
      },
      onCaptured(p, g) {
        if (myPortals(p, g).length) g.log(`🌀 ${g.nameOf(p)}'s portals collapse.`);
        closePortals(p, g);
        p.data.casting = null;
        return true;
      },
    },
    knight: {
      name: 'Knight',
      icon: '♞',
      description: 'Jumps in an L shape, over anything in the way.',
      moves: unlessCasting((p, g) => g.leap(p, g.DIRS.KNIGHT)),
    },
    pawn: {
      name: 'Pawn',
      icon: '♟',
      description:
        'Moves 1 forward (2 on its first move) and captures diagonally forward. Becomes a Queen on the far rank. ' +
        'DETONATE 💥: instead of moving, it can blow itself up (click the pawn, then its own square), ' +
        'destroying itself and every piece on the 8 squares around it, from either side, kings included. ' +
        'Pawns caught in a blast do not explode.',
      moves: unlessCasting((p, g) => [
        ...g.slide(p, [[0, 1]], { max: p.moveCount === 0 ? 2 : 1, capture: false }),
        ...g.leap(p, [[-1, 1], [1, 1]], { capture: 'only' }),
        { x: p.x, y: p.y, label: 'Detonate 💥', action(p, g) {
          g.log(`💥 ${g.nameOf(p)} on ${g.square(p.x, p.y)} explodes!`);
          g.effect('burst', { x: p.x, y: p.y, radius: 1, icon: '💥', color: 'rgba(255, 80, 0, 0.9)' });
          for (const [dx, dy] of g.DIRS.ALL) {
            const [x, y] = g.rel(p, dx, dy);
            const victim = g.inBounds(x, y) && g.at(x, y);
            if (victim) g.capture(victim, null);
          }
          g.capture(p, null);
        } },
      ]),
      onMove: promote,
    },
  };

  // Undead copies of the raisable pieces: the real thing, tinted green, on a timer.
  for (const kind of RAISABLE) {
    const base = pieces[kind];
    pieces[`undead_${kind}`] = {
      ...base,
      name: `Undead ${base.name}`,
      icon: `sides/white/assets/undead_${kind}.svg`,
      description:
        `Raised by the Necromancer. ${base.description} ` +
        `Crumbles to dust after ${UNDEAD_LIFE} turns (the ☠ badge counts down), and can't be raised again.`,
      badge(p, g) {
        const extra = base.badge ? base.badge(p, g) : '';
        return `☠${p.data.life}${extra ? ` ${extra}` : ''}`;
      },
      onTurnStart(p, g) {
        if (base.onTurnStart) base.onTurnStart(p, g);
        if (!g.get(p.id) || !ownTurn(p, g)) return;
        if (p.data.fresh) p.data.fresh = false;
        else p.data.life--;
        if (p.data.life > 0) return;
        g.effect('burst', { x: p.x, y: p.y, radius: 0, icon: '🦴', color: UNDEAD_GREEN });
        g.log(`🦴 ${g.nameOf(p)} crumbles to dust.`);
        closePortals(p, g); // an undead wizard's portals go with it
        g.remove(p);
      },
    };
  }

  WackyChess.defineSide('white', {
    name: 'White',
    pieces,

    // Read from your own seat: first row is your back rank, listed left to right.
    setup: [
      ['catapult', 'knight', 'wizard', 'necromancer', 'king', 'wizard', 'knight', 'catapult'],
      ['pawn', 'pawn', 'pawn', 'pawn', 'pawn', 'pawn', 'pawn', 'pawn'],
    ],
  });
})();
