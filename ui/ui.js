/* Browser UI for Wacky Chess: hot-seat play on one screen. */
(function () {
  'use strict';

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
      token.append(el('span', '', def.icon));
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

  function doPlay(piece, move) {
    try {
      game.play(piece, move);
      alertText = '';
    } catch (err) {
      alertText = `⚠ Move cancelled — ${err.message}`;
      console.error(err);
    }
    selectedId = null;
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
    const sq = e.target.closest('.sq');
    if (sq) onSquareClick(sq);
  });
  $('undo').addEventListener('click', () => {
    closePicker();
    game.undo();
    selectedId = null;
    alertText = '';
    if (autoFlip) flipped = game.turn === 'black';
    render();
  });
  $('new-game').addEventListener('click', () => {
    closePicker();
    if (game.history.length === 0 || game.winner || window.confirm('Start a new game?')) newGame();
  });
  $('flip').addEventListener('click', () => {
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
    if (e.key === 'Escape') {
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
