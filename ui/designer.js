/* Browser UI for the piece designer: sketch one side and save it to sides/<color>/design.json. */
(function () {
  'use strict';

  const W = window.WackyChess;
  const D = window.WackyDesigner;
  const $ = (id) => document.getElementById(id);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  let side = null;
  let design = null;
  let version = null;
  let dirty = false;
  let freshKeys = new Set(); // pieces added since the last load/save: their key follows their name
  let dragging = null; // { key } from a card, or { key, row, col } from the board
  let statusTimer = null;

  const api = async (url, options) => {
    const res = await fetch(url, options);
    return { status: res.status, body: await res.json() };
  };

  function banner(kind, text, buttons = []) {
    const box = el('div', `notice ${kind}`);
    box.append(el('span', '', text));
    for (const [label, onClick] of buttons) {
      const b = el('button', '', label);
      b.type = 'button';
      b.addEventListener('click', onClick);
      box.append(b);
    }
    $('banners').append(box);
    return box;
  }

  function setStatus(text, sticky) {
    clearTimeout(statusTimer);
    $('save-status').textContent = text;
    if (!sticky) statusTimer = setTimeout(() => { $('save-status').textContent = ''; }, 3000);
  }

  function markDirty() {
    dirty = true;
    setStatus('Unsaved changes', true);
  }

  // ------------------------------------------------------------- icons

  function iconNode(piece) {
    if (piece.icon && W.isImageIcon(piece.icon)) {
      const img = el('img');
      img.src = piece.icon;
      img.alt = piece.name;
      return img;
    }
    if (piece.icon) return el('span', /^[♔-♟]$/.test(piece.icon) ? 'glyph' : '', piece.icon);
    return el('span', 'placeholder', piece.customArt ? '🎨' : '?');
  }

  function token(piece) {
    const t = el('div', `token ${side}${piece.royal ? ' royal' : ''}`);
    t.append(iconNode(piece));
    t.title = piece.name || '(unnamed)';
    return t;
  }

  const pieceByKey = (key) => design.pieces.find((p) => p.key === key);

  // Replaced by the real picker in the emoji picker task.
  function openEmojiPicker(anchor, onPick) {}

  // ------------------------------------------------------------- cards

  function renderCards() {
    const cards = $('cards');
    cards.replaceChildren();
    for (const piece of design.pieces) cards.append(card(piece));
    renderPlacedNotes();
  }

  function card(piece) {
    const box = el('div', 'card');
    box.dataset.key = piece.key;

    const top = el('div', 'card-top');
    const handle = token(piece);
    handle.classList.add('handle');
    handle.draggable = true;
    handle.tabIndex = 0;
    handle.setAttribute('role', 'button');
    handle.title = 'Click to pick an emoji. Drag onto the board to place.';
    const pick = () => openEmojiPicker(handle, (emoji) => {
      piece.icon = emoji;
      markDirty();
      renderAll();
    });
    handle.addEventListener('click', pick);
    handle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        pick();
      }
    });
    handle.addEventListener('dragstart', (e) => {
      dragging = { key: piece.key };
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', piece.key);
    });
    handle.addEventListener('dragend', () => { dragging = null; clearDropHover(); });

    const name = el('input', 'name');
    name.type = 'text';
    name.value = piece.name;
    name.placeholder = 'Piece name';
    name.setAttribute('aria-label', 'Piece name');
    name.addEventListener('input', () => {
      piece.name = name.value;
      if (freshKeys.has(piece.key)) {
        freshKeys.delete(piece.key);
        piece.key = D.rekeyPiece(design, piece.key, name.value || 'New piece');
        freshKeys.add(piece.key);
        box.dataset.key = piece.key;
      }
      markDirty();
      renderBoard();
      renderWarnings();
    });

    const del = el('button', 'delete', 'Delete');
    del.type = 'button';
    del.addEventListener('click', () => {
      D.removePiece(design, piece.key);
      markDirty();
      renderAll();
    });
    top.append(handle, name, del);

    const desc = textarea(piece.description, 'What does it do? Moves, captures, special powers…', (v) => {
      piece.description = v;
      renderWarnings();
    });

    const flags = el('div', 'flags');
    const royal = checkbox('Royal 👑', piece.royal, (on) => {
      piece.royal = on;
      renderAll();
    });
    const art = checkbox('Have my agent draw this', !!piece.customArt, (on) => {
      piece.customArt = on ? { description: '' } : null;
      renderAll();
    });
    flags.append(royal, art, el('span', 'placed-note'));

    box.append(top, desc, flags);
    if (piece.customArt) {
      box.append(textarea(piece.customArt.description, 'Describe the picture, e.g. "a rickety wooden catapult, green and moldy"', (v) => {
        piece.customArt.description = v;
      }, 'art'));
    }
    return box;
  }

  function textarea(value, placeholder, onInput, className = '') {
    const t = el('textarea', className);
    t.value = value;
    t.placeholder = placeholder;
    t.rows = 3;
    t.addEventListener('input', () => {
      onInput(t.value);
      markDirty();
    });
    return t;
  }

  function checkbox(label, checked, onChange) {
    const wrap = el('label', 'toggle');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = checked;
    box.addEventListener('change', () => {
      onChange(box.checked);
      markDirty();
    });
    wrap.append(box, ` ${label}`);
    return wrap;
  }

  function renderPlacedNotes() {
    for (const box of $('cards').children) {
      const count = design.setup.flat().filter((k) => k === box.dataset.key).length;
      box.querySelector('.placed-note').textContent = count ? `On the board ×${count}` : 'Not in starting setup';
      box.classList.toggle('unplaced', !count);
    }
  }

  function renderWarnings() {
    $('warnings').replaceChildren(...D.warnings(design).map((w) => el('li', '', w)));
  }

  // ------------------------------------------------------------- board

  // Display row 0 is the top of the board; setup row 0 (the back rank) is at the bottom.
  function renderBoard() {
    const board = $('board');
    board.replaceChildren();
    for (let r = 0; r < 8; r++) {
      const row = 7 - r;
      for (let col = 0; col < 8; col++) {
        const sq = el('div', `sq ${(r + col) % 2 ? 'dark' : 'light'}`);
        if (row >= D.ROWS) {
          sq.classList.add('off');
          board.append(sq);
          continue;
        }
        sq.classList.add('active');
        sq.dataset.row = row;
        sq.dataset.col = col;
        const piece = pieceByKey(design.setup[row][col]);
        if (piece) {
          const t = token(piece);
          t.draggable = true;
          t.addEventListener('dragstart', (e) => {
            dragging = { key: piece.key, row, col };
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', piece.key);
          });
          t.addEventListener('dragend', () => { dragging = null; clearDropHover(); });
          sq.append(t);
        }
        board.append(sq);
      }
    }
  }

  function clearDropHover() {
    for (const sq of document.querySelectorAll('.sq.drop-hover')) sq.classList.remove('drop-hover');
  }

  const activeSquare = (e) => e.target.closest && e.target.closest('.sq.active');

  $('board').addEventListener('dragover', (e) => {
    const sq = activeSquare(e);
    if (!sq || !dragging) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = dragging.row === undefined ? 'copy' : 'move';
    clearDropHover();
    sq.classList.add('drop-hover');
  });
  $('board').addEventListener('dragleave', (e) => {
    const sq = activeSquare(e);
    if (sq && !sq.contains(e.relatedTarget)) sq.classList.remove('drop-hover');
  });
  $('board').addEventListener('drop', (e) => {
    const sq = activeSquare(e);
    if (!sq || !dragging) return;
    e.preventDefault();
    const row = Number(sq.dataset.row);
    const col = Number(sq.dataset.col);
    if (dragging.row !== undefined) D.setCell(design, dragging.row, dragging.col, null);
    D.setCell(design, row, col, dragging.key);
    dragging = null;
    markDirty();
    renderBoard();
    renderPlacedNotes();
  });

  // A board piece dropped anywhere that isn't an active square comes off the board.
  // (A cancelled drag, e.g. Escape, drops nowhere and leaves it alone.)
  const fromBoard = (e) => dragging && dragging.row !== undefined && !activeSquare(e);
  document.addEventListener('dragover', (e) => {
    if (!fromBoard(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearDropHover();
  });
  document.addEventListener('drop', (e) => {
    if (!fromBoard(e)) return;
    e.preventDefault();
    D.setCell(design, dragging.row, dragging.col, null);
    dragging = null;
    markDirty();
    renderBoard();
    renderPlacedNotes();
  });

  function renderAll() {
    $('side-name').value = design.name;
    renderCards();
    renderBoard();
    renderWarnings();
  }

  // ------------------------------------------------------------- load and save

  function loadFromPieces() {
    return new Promise((resolve) => {
      const script = el('script');
      script.src = `sides/${side}/pieces.js`;
      const done = () => {
        const def = W.registry[side];
        resolve(def ? D.designFromSide(side, def) : D.emptyDesign(side));
      };
      script.addEventListener('load', done);
      script.addEventListener('error', done);
      document.body.append(script);
    });
  }

  async function load() {
    const { body } = await api(`/api/design/${side}`);
    if (body.error) banner('warn', `sides/${side}/design.json couldn't be read (${body.error}). Starting from pieces.js instead. Saving will replace the file.`);
    design = body.design ? D.normalizeDesign(side, body.design) : await loadFromPieces();
    version = body.version;
    freshKeys = new Set();
    dirty = false;
    setStatus('');
    renderAll();
  }

  async function save(force) {
    let res;
    try {
      res = await api(`/api/design/${side}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: version, force: !!force, design }),
      });
    } catch (err) {
      setStatus("Couldn't reach the server. Is npm start still running?", true);
      return;
    }
    if (res.status === 200) {
      version = res.body.version;
      freshKeys = new Set();
      dirty = false;
      setStatus(`Saved to sides/${side}/design.json`);
    } else if (res.status === 409) {
      const box = banner('error', 'This design changed on disk since you opened it, probably by your agent.', [
        ['Reload', () => { box.remove(); load(); }],
        ['Overwrite', () => { box.remove(); save(true); }],
      ]);
      setStatus('Not saved', true);
    } else {
      setStatus(`Not saved: ${res.body.error || `error ${res.status}`}`, true);
    }
  }

  $('side-name').addEventListener('input', () => {
    design.name = $('side-name').value;
    markDirty();
  });
  $('add-piece').addEventListener('click', () => {
    freshKeys.add(D.addPiece(design));
    markDirty();
    renderAll();
    const last = $('cards').lastElementChild;
    if (last) last.querySelector('.name').select();
  });
  $('save').addEventListener('click', () => save());
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's' && design) {
      e.preventDefault();
      save();
    }
  });
  window.addEventListener('beforeunload', (e) => {
    if (dirty) e.preventDefault();
  });
  for (const b of document.querySelectorAll('#choose button')) {
    b.addEventListener('click', () => { location.search = `?side=${b.dataset.side}`; });
  }

  // ------------------------------------------------------------- start

  async function start() {
    let branchInfo;
    try {
      branchInfo = (await api('/api/branch')).body;
    } catch (err) {
      return; // No server (e.g. opened from disk): leave the boot message up.
    }
    $('boot').remove();
    const params = new URLSearchParams(location.search);
    side = W.SIDES.includes(params.get('side')) ? params.get('side') : branchInfo.color;
    $('branch').textContent = `Branch: ${branchInfo.branch || 'unknown'}`;
    if (!side) {
      $('choose').hidden = false;
      return;
    }
    if (!params.get('side')) history.replaceState(null, '', `?side=${side}`);
    if (branchInfo.color !== side) {
      banner('warn', `You're on "${branchInfo.branch || 'unknown'}". Design on match/<name>-${side} so your design lands on your own branch.`);
    }
    const label = $('side-label');
    label.replaceChildren(el('span', `dot ${side}`), `Designing ${side === 'white' ? 'White' : 'Black'}`);
    document.title = `Designing ${side} · Wacky Chess`;
    $('workspace').hidden = false;
    $('save').hidden = false;
    await load();
  }

  start();
})();
