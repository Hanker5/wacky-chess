/* Browser UI for Wacky Chess: hot-seat play on one screen. */
(function () {
  'use strict';

  document.getElementById('boot').remove();

  const W = window.WackyChess;
  const $ = (id) => document.getElementById(id);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  let game = null;
  let selectedId = null;
  let flipped = false;
  let autoFlip = false;
  let alertText = '';
  let animating = false;

  try {
    autoFlip = localStorage.getItem('wacky-chess:auto-flip') === '1';
  } catch (e) { /* storage unavailable: keep the default */ }

  function showFatal(lines) {
    document.querySelector('main').hidden = true;
    document.querySelector('.guide').hidden = true;
    const box = $('fatal');
    box.hidden = false;
    box.textContent = `The game couldn't start:\n\n${lines.join('\n\n')}\n\nRun "node tools/check.js" for details.`;
    document.querySelector('header').after(box);
  }

  function newGame() {
    try {
      game = new W.Game();
    } catch (err) {
      showFatal([err.message]);
      return;
    }
    selectedId = null;
    alertText = '';
    flipped = autoFlip && game.turn === 'black';
    renderGuide();
    render();
  }

  // Board square (x, y) for display cell (row, col).
  function cellToSquare(row, col) {
    return flipped ? [7 - col, row] : [col, 7 - row];
  }

  function makeToken(piece, small) {
    const def = game.def(piece);
    const token = el('div', `token ${piece.side}${def.royal ? ' royal' : ''}${small ? ' small' : ''}`);
    if (W.isImageIcon(def.icon)) {
      const img = el('img');
      img.src = def.icon;
      img.alt = def.name || game.kind(piece);
      token.append(img);
    } else {
      // Chess glyphs (♔-♟) render as text so they take the token's color; emoji keep theirs.
      token.append(el('span', /^[\u2654-\u265F]$/.test(def.icon) ? 'glyph' : '', def.icon));
    }
    if (!small && def.badge) {
      let badge;
      try {
        badge = def.badge(piece, game);
      } catch (e) {
        badge = '!';
      }
      if (badge !== undefined && badge !== null && badge !== '') token.append(el('span', 'badge', String(badge)));
    }
    token.title = game.nameOf(piece);
    return token;
  }

  function movesOf(piece) {
    try {
      return piece.side === game.turn ? game.legalMoves(piece) : game.movesFor(piece);
    } catch (err) {
      alertText = `⚠ ${err.message}`;
      return [];
    }
  }

  function render() {
    const selected = selectedId !== null ? game.get(selectedId) : null;
    if (!selected) selectedId = null;
    const isPreview = selected && (selected.side !== game.turn || game.winner);
    const moves = selected ? movesOf(selected) : [];
    const last = game.state.lastMove;

    const board = $('board');
    board.replaceChildren();
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const [x, y] = cellToSquare(row, col);
        const sq = el('button', `sq ${(x + y) % 2 ? 'light' : 'dark'}`);
        sq.type = 'button';
        sq.dataset.x = x;
        sq.dataset.y = y;
        sq.setAttribute('aria-label', W.square(x, y));

        const tile = game.peekTile(x, y);
        if (tile && tile.color) sq.style.background = tile.color;
        if (tile && tile.label) sq.title = tile.label;
        if (last && ((last.from.x === x && last.from.y === y) || (last.to.x === x && last.to.y === y))) sq.classList.add('last');
        if (selected && selected.x === x && selected.y === y) sq.classList.add('selected');
        sq.append(el('span', 'tint'));
        if (tile && tile.icon) sq.append(el('span', 'tile-icon', tile.icon));

        if (col === 0) sq.append(el('span', 'coord rank', String(y + 1)));
        if (row === 7) sq.append(el('span', 'coord file', W.FILES[x]));

        const piece = game.at(x, y);
        if (piece) sq.append(makeToken(piece));

        const here = moves.filter((m) => m.x === x && m.y === y);
        if (here.length) {
          const special = here.some((m) => m.action);
          const enemy = piece && piece.side !== selected.side;
          const kind = isPreview ? `preview${enemy ? ' capture' : ''}` : special ? 'special' : enemy ? 'capture' : 'move';
          sq.append(el('span', `hint ${kind}`));
        }
        board.append(sq);
      }
    }

    renderStatus();
    renderInfo(selected);
    renderCaptured();
    renderLog();
    $('undo').disabled = game.history.length === 0;
    $('auto-flip').checked = autoFlip;

    const alert = $('alert');
    alert.hidden = !alertText;
    alert.textContent = alertText;

    const oldBanner = document.querySelector('.banner');
    if (oldBanner) oldBanner.remove();
    if (game.winner) {
      const banner = el('div', 'banner');
      banner.append(el('strong', '', game.winner === 'draw' ? 'Draw!' : `${game.sideName(game.winner)} wins!`));
      banner.append(el('div', '', game.result));
      const again = el('button', '', 'Play again');
      again.type = 'button';
      again.addEventListener('click', newGame);
      const look = el('button', '', 'Look at the board');
      look.type = 'button';
      look.addEventListener('click', () => banner.remove());
      const row = el('div', 'controls');
      row.style.justifyContent = 'center';
      row.style.marginTop = '12px';
      row.append(again, look);
      banner.append(row);
      $('board').parentElement.append(banner);
    }
  }

  function renderStatus() {
    const status = $('status');
    status.replaceChildren();
    if (game.winner) {
      status.textContent = game.result;
      return;
    }
    status.append(el('span', `dot ${game.turn}`), `${game.sideName(game.turn)} to move`);
    status.append(el('span', 'meta', `  · move ${game.turnNumber}`));
  }

  function renderInfo(piece) {
    const info = $('info');
    info.replaceChildren();
    if (!piece) {
      info.append(el('div', 'empty', 'Click a piece to see what it does. Click an enemy piece to preview where it can go.'));
      return;
    }
    const def = game.def(piece);
    const head = el('div', 'head');
    head.append(makeToken(piece, true));
    const titles = el('div');
    titles.append(el('div', 'title', `${def.name || game.kind(piece)}${def.royal ? ' 👑' : ''}`));
    titles.append(el('div', 'meta', `${game.sideName(piece.side)} · ${W.square(piece.x, piece.y)} · moved ${piece.moveCount}×`));
    head.append(titles);
    info.append(head);
    if (def.description) info.append(el('p', '', def.description));
    const tile = game.peekTile(piece.x, piece.y);
    if (tile && tile.label) info.append(el('p', 'meta', `Standing on: ${tile.label}`));
  }

  function renderCaptured() {
    for (const side of W.SIDES) {
      const row = $(`captured-${side}`);
      row.replaceChildren();
      for (const piece of game.state.captured.filter((p) => p.side === side)) {
        // Captured pieces may have been transformed into types that still exist; skip any that don't.
        if (game.def(piece)) row.append(makeToken(piece, true));
      }
    }
  }

  function renderLog() {
    const log = $('log');
    log.replaceChildren();
    for (const entry of game.state.log) {
      log.append(el('li', entry.side, entry.text));
    }
    log.scrollTop = log.scrollHeight;
  }

  function renderGuide() {
    const guide = $('guide');
    guide.replaceChildren();
    for (const side of W.SIDES) {
      const col = el('div');
      col.append(el('h3', '', `${game.sideName(side)} (${side})`));
      for (const [key, def] of Object.entries(game.sides[side].pieces)) {
        const row = el('div', 'guide-piece');
        row.append(makeToken({ id: -1, side, type: `${side}:${key}`, x: 0, y: 0, moveCount: 0, data: {} }, true));
        const text = el('div');
        text.append(el('div', 'name', `${def.name || key}${def.royal ? ' 👑' : ''}`));
        text.append(el('div', 'desc', def.description || '(no description)'));
        row.append(text);
        col.append(row);
      }
      guide.append(col);
    }
  }

  function closePicker() {
    $('picker').hidden = true;
  }

  function openPicker(piece, moves, sqEl) {
    const picker = $('picker');
    picker.replaceChildren();
    for (const move of moves) {
      const btn = el('button', '', move.label || 'Move');
      btn.type = 'button';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        closePicker();
        doPlay(piece, move);
      });
      picker.append(btn);
    }
    const cancel = el('button', '', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', (e) => {
      e.stopPropagation();
      closePicker();
    });
    picker.append(cancel);
    picker.hidden = false;
    const wrap = $('board').parentElement.getBoundingClientRect();
    const rect = sqEl.getBoundingClientRect();
    picker.style.left = `${Math.min(rect.left - wrap.left, wrap.width - 170)}px`;
    picker.style.top = `${rect.bottom - wrap.top}px`;
  }

  // ------------------------------------------------------------ effects

  const reducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Center and size of a square, relative to the board wrapper the effects layer covers.
  function squareBox(x, y) {
    const sq = $('board').querySelector(`.sq[data-x="${x}"][data-y="${y}"]`);
    const wrap = $('board').parentElement.getBoundingClientRect();
    const r = sq.getBoundingClientRect();
    return { cx: r.left - wrap.left + r.width / 2, cy: r.top - wrap.top + r.height / 2, size: r.width };
  }

  function fxIcon(icon) {
    if (W.isImageIcon(icon)) {
      const img = el('img');
      img.src = icon;
      return img;
    }
    return el('span', '', icon);
  }

  function playProjectile(layer, fx) {
    const a = squareBox(fx.from[0], fx.from[1]);
    const b = squareBox(fx.to[0], fx.to[1]);
    const node = el('div', 'fx-projectile');
    node.append(fxIcon(fx.icon || '●'));
    node.style.width = node.style.height = `${a.size * 0.6}px`;
    node.style.left = `${a.cx}px`;
    node.style.top = `${a.cy}px`;
    if (fx.color) node.style.color = fx.color;
    layer.append(node);
    const squares = Math.max(Math.abs(fx.to[0] - fx.from[0]), Math.abs(fx.to[1] - fx.from[1]));
    const anim = node.animate([
      { transform: 'translate(-50%, -50%) scale(0.6)' },
      { transform: `translate(calc(-50% + ${b.cx - a.cx}px), calc(-50% + ${b.cy - a.cy}px)) scale(1.1)` },
    ], { duration: Math.min(650, 200 + squares * 90), easing: 'ease-in' });
    return anim.finished.then(() => node.remove());
  }

  function playBurst(layer, fx) {
    const c = squareBox(fx.x, fx.y);
    const size = c.size * (2 * fx.radius + 1);
    const node = el('div', 'fx-burst');
    node.style.width = node.style.height = `${size}px`;
    node.style.left = `${c.cx}px`;
    node.style.top = `${c.cy}px`;
    node.style.setProperty('--fx-color', fx.color || 'rgba(255, 140, 0, 0.85)');
    if (fx.icon) {
      const icon = fxIcon(fx.icon);
      icon.style.fontSize = `${c.size * 0.8}px`;
      node.append(icon);
    }
    layer.append(node);
    const anim = node.animate([
      { transform: 'translate(-50%, -50%) scale(0.15)', opacity: 1 },
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.55 },
      { transform: 'translate(-50%, -50%) scale(1.1)', opacity: 0 },
    ], { duration: 550, easing: 'ease-out' });
    return anim.finished.then(() => node.remove());
  }

  // Slide the token shown on `from` to `to`. Whatever token is shown on `to` vanishes when it
  // arrives. `shown` tracks where tokens appear after earlier slides in the same move.
  function playMove(layer, shown, fx) {
    const shownAt = ([x, y]) => {
      const key = `${x},${y}`;
      if (shown.has(key)) return shown.get(key);
      return $('board').querySelector(`.sq[data-x="${x}"][data-y="${y}"] > .token`);
    };
    let node = shownAt(fx.from);
    if (!node) return Promise.resolve();
    const a = squareBox(fx.from[0], fx.from[1]);
    const b = squareBox(fx.to[0], fx.to[1]);
    if (!node.classList.contains('fx-move')) {
      const token = node;
      node = el('div', 'fx-move');
      node.append(token.cloneNode(true));
      node.style.width = node.style.height = `${a.size}px`;
      node.style.left = `${a.cx}px`;
      node.style.top = `${a.cy}px`;
      token.style.visibility = 'hidden';
      layer.append(node);
    }
    const squares = Math.max(Math.abs(fx.to[0] - fx.from[0]), Math.abs(fx.to[1] - fx.from[1]));
    const anim = node.animate([
      { transform: 'translate(-50%, -50%)' },
      { transform: `translate(calc(-50% + ${b.cx - a.cx}px), calc(-50% + ${b.cy - a.cy}px))` },
    ], { duration: Math.min(900, 60 + squares * 110), easing: 'linear' });
    return anim.finished.then(() => {
      node.style.left = `${b.cx}px`;
      node.style.top = `${b.cy}px`;
      anim.cancel();
      const under = shownAt(fx.to);
      if (under && under !== node) {
        if (under.classList.contains('fx-move')) under.remove();
        else under.style.visibility = 'hidden';
      }
      shown.set(`${fx.from[0]},${fx.from[1]}`, null);
      shown.set(`${fx.to[0]},${fx.to[1]}`, node);
    });
  }

  // Play the move's effects one after another over the board as it was before the move.
  async function playEffects(effects) {
    const board = $('board');
    board.querySelectorAll('.hint').forEach((n) => n.remove());
    board.querySelectorAll('.selected').forEach((n) => n.classList.remove('selected'));
    const layer = el('div', 'fx-layer');
    board.parentElement.append(layer);
    const shown = new Map();
    try {
      for (const fx of effects) {
        if (fx.kind === 'move') await playMove(layer, shown, fx);
        else await (fx.kind === 'projectile' ? playProjectile(layer, fx) : playBurst(layer, fx));
      }
    } finally {
      layer.remove();
    }
  }

  async function doPlay(piece, move) {
    let ok = false;
    try {
      game.play(piece, move);
      alertText = '';
      ok = true;
    } catch (err) {
      alertText = `⚠ Move cancelled — ${err.message}`;
      console.error(err);
    }
    selectedId = null;
    if (ok && game.effects.length && !reducedMotion() && Element.prototype.animate) {
      animating = true;
      try {
        await playEffects(game.effects);
      } catch (err) {
        console.error(err);
      } finally {
        animating = false;
      }
    }
    if (autoFlip) flipped = game.turn === 'black';
    render();
  }

  function onSquareClick(sqEl) {
    closePicker();
    const x = Number(sqEl.dataset.x);
    const y = Number(sqEl.dataset.y);
    const selected = selectedId !== null ? game.get(selectedId) : null;

    if (selected && selected.side === game.turn && !game.winner) {
      const here = movesOf(selected).filter((m) => m.x === x && m.y === y);
      if (here.length === 1) return doPlay(selected, here[0]);
      if (here.length > 1) return openPicker(selected, here, sqEl);
    }

    const piece = game.at(x, y);
    selectedId = piece && piece.id !== selectedId ? piece.id : null;
    render();
  }

  $('board').addEventListener('click', (e) => {
    if (animating) return;
    const sq = e.target.closest('.sq');
    if (sq) onSquareClick(sq);
  });
  $('undo').addEventListener('click', () => {
    if (animating) return;
    closePicker();
    game.undo();
    selectedId = null;
    alertText = '';
    if (autoFlip) flipped = game.turn === 'black';
    render();
  });
  $('new-game').addEventListener('click', () => {
    if (animating) return;
    closePicker();
    if (game.history.length === 0 || game.winner || window.confirm('Start a new game?')) newGame();
  });
  $('flip').addEventListener('click', () => {
    if (animating) return;
    closePicker();
    flipped = !flipped;
    render();
  });
  $('auto-flip').addEventListener('change', (e) => {
    autoFlip = e.target.checked;
    try {
      localStorage.setItem('wacky-chess:auto-flip', autoFlip ? '1' : '0');
    } catch (err) { /* storage unavailable */ }
    flipped = autoFlip && game.turn === 'black';
    render();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !animating) {
      closePicker();
      selectedId = null;
      render();
    }
  });

  const problems = W.loadErrors.slice();
  for (const side of W.SIDES) {
    if (!W.registry[side]) problems.push(`sides/${side}/pieces.js didn't set up the ${side} side.`);
  }
  if (problems.length) showFatal(problems);
  else newGame();
})();
