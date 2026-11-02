# Piece Catalogue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `catalogue/` library of every piece from past matches, a tool that adds a
finished match to it, and a "📚 From catalogue" drawer in the piece designer that adds a
past piece to your side as an editable card.

**Architecture:**
- **Tool:** `tools/catalogue.js` (a CLI plus exported pure functions) reads a match branch
  with `git show`, snapshots both side files and their assets into
  `catalogue/<match>/<side>/`, and drafts entries into `catalogue/catalogue.json`.
- **Designer:** it fetches that JSON as a static file. The new model functions in
  `ui/designer-model.js` turn an entry into cards, and `ui/designer.js` draws the drawer.
- **Agents:** an `AGENTS.md` section tells them how to build a piece with a `from` field
  and how to add a finished match.

**Tech Stack:** Node (no dependencies), `node:test`, `node:vm`, plain browser JS/CSS, git.

**Spec:** `docs/superpowers/specs/2026-11-02-piece-catalogue-design.md`

## Global Constraints

- No dependencies, no build step: "All you need is Node."
- The engine never loads `catalogue/`. `sides/` on `main` stays plain chess.
- Snapshots (`catalogue/<match>/<side>/pieces.js` and `assets/`) are byte-exact copies and
  are never patched. Only `icon` values in `catalogue.json` are rewritten.
- Entry `id` is `<match>/<side>/<key>`. A companion's `from` is `<parent id>#<companion key>`.
- `catalogue.json` shape: `{ "version": 1, "entries": [ { id, match, side, sideName, key,
  name, icon, royal, description, customArt, companions } ] }`. Companions have `key, name,
  icon, royal, description, customArt`.
- Entry order: newest match first, then `white` before `black`, then side-file piece order.
- Art paths are rewritten from `sides/<side>/assets/<file>` to
  `catalogue/<match>/<side>/assets/<file>`.
- Designer copy: the button says `📚 From catalogue`, the drawer title is
  `📚 Piece catalogue`, the empty state says `No catalogue yet`, the add button says `Add`,
  the confirmation says `Added ✓`, and the card tag reads like `from 10-28 · Black`.
- The secrecy guard refuses a match whose `origin/match/<name>-white` or `-black` exists
  and is not an ancestor of `origin/match/<name>`.
- Code style matches the surrounding files: `'use strict'`, 2-space indent, single quotes,
  sparse comments that explain *why*.

## Review Focus

1. **Adding a catalogue piece whose key the design already uses** (a second `rook`, or a
   `plant` next to an existing `plant`). Every added key must be unique, while existing
   cards keep their keys. (Test in Task 1.)
2. **A `catalogue.json` that is missing, empty, or malformed when the designer opens.**
   The drawer must show `No catalogue yet` and every other designer feature must keep
   working. (Manual check in Task 4.)
3. **Re-running `add` for a match that's already in the catalogue.** That match's old
   entries must be replaced, not duplicated, and other matches must stay untouched.
   (Test in Task 2.)
4. **A saved design with a `from` field going through load → edit → save.** `from` must
   survive `normalizeDesign`, and a non-string `from` must be dropped. (Test in Task 1.)
5. **A side file whose art lives in a subfolder, or a piece with an emoji icon that merely
   contains `sides/`.** Only real `sides/<side>/assets/...` image paths get rewritten.
   (Test in Task 2.)

---

### Task 1: Designer model: catalogue entries become cards

**Files:**
- Modify: `ui/designer-model.js` (`normalizeDesign`, the `api` export, new functions)
- Test: `test/designer-model.test.js`

**Interfaces:**
- Produces (on `WackyDesigner` / `module.exports`):
  - `addFromCatalogue(design, entry) -> string[]`: the new keys, parent first, then its
    companions in order.
  - `filterCatalogue(entries, { query = '', match = null }) -> entry[]`: `query` matches
    `name` and `description`, ignoring case, and every whitespace-separated term must
    appear. `match` of `null` means all matches.
  - `catalogueMatches(entries) -> string[]`: distinct `match` values, newest first.
  - `fromLabel(from) -> string`: `'2026-10-28/black/rook#ninja'` gives
    `'from 10-28 · Black'`. A non-string gives `''`.
- `normalizeDesign` keeps `from` only when it's a string. The key is omitted otherwise, so
  existing `deepEqual` tests on pieces still pass.

- [ ] **Step 1: Write the failing tests** in `test/designer-model.test.js`:

```js
const entry = {
  id: '2026-10-30/white/knight', match: '2026-10-30', side: 'white', sideName: 'White', key: 'knight',
  name: 'Gardener', icon: '🪏', royal: false, description: 'Jumps or plants.', customArt: null,
  companions: [
    { key: 'plant', name: 'Plant', icon: '🌱', royal: false, description: 'Grows.', customArt: null },
    { key: 'plant_2', name: 'Plant', icon: '☘️', royal: false, description: 'Grows more.', customArt: { description: 'a clover' } },
  ],
};

test('addFromCatalogue adds the piece and its companions as normal cards with from', () => {
  const d = D.emptyDesign('black');
  d.pieces.push(piece('knight'), piece('plant'));
  const before = JSON.stringify(d.setup);
  assert.deepEqual(D.addFromCatalogue(d, entry), ['knight_2', 'plant_2', 'plant_2_2']);
  assert.deepEqual(d.pieces.slice(0, 2).map((p) => p.key), ['knight', 'plant']);
  assert.deepEqual(d.pieces[2], { key: 'knight_2', name: 'Gardener', icon: '🪏', royal: false,
    description: 'Jumps or plants.', customArt: null, from: '2026-10-30/white/knight' });
  assert.equal(d.pieces[4].from, '2026-10-30/white/knight#plant_2');
  assert.deepEqual(d.pieces[4].customArt, { description: 'a clover' });
  assert.notEqual(d.pieces[4].customArt, entry.companions[1].customArt); // copied, not shared
  assert.equal(JSON.stringify(d.setup), before);
  D.addFromCatalogue(d, entry); // twice = two independent copies
  assert.equal(d.pieces.length, 8);
});

test('normalizeDesign keeps a string from and drops anything else', () => {
  const d = D.normalizeDesign('white', { pieces: [piece('a', { from: '2026-10-28/black/rook' }), piece('b', { from: 7 })] });
  assert.equal(d.pieces[0].from, '2026-10-28/black/rook');
  assert.equal('from' in d.pieces[1], false);
});

test('filterCatalogue searches name and description and filters by match', () => {
  const list = [
    { ...entry, name: 'Zombie', description: 'Shambles toward enemies.', match: '2026-10-30' },
    { ...entry, name: 'Corolla', description: 'CHARGE through pieces.', match: '2026-10-28' },
  ];
  assert.deepEqual(D.filterCatalogue(list, { query: 'charge' }).map((e) => e.name), ['Corolla']);
  assert.deepEqual(D.filterCatalogue(list, { query: 'toward ZOMBIE' }).map((e) => e.name), ['Zombie']);
  assert.deepEqual(D.filterCatalogue(list, { match: '2026-10-30' }).map((e) => e.name), ['Zombie']);
  assert.equal(D.filterCatalogue(list, {}).length, 2);
  assert.deepEqual(D.catalogueMatches([...list, list[0]]), ['2026-10-30', '2026-10-28']);
});

test('fromLabel names the match and side', () => {
  assert.equal(D.fromLabel('2026-10-28/black/rook'), 'from 10-28 · Black');
  assert.equal(D.fromLabel('2026-10-30/white/knight#plant_2'), 'from 10-30 · White');
  assert.equal(D.fromLabel(undefined), '');
});
```

- [ ] **Step 2: Run** `node --test test/designer-model.test.js`. Expected: the 4 new tests
  FAIL (`D.addFromCatalogue is not a function`, and so on). The old tests pass.

- [ ] **Step 3: Implement** the four functions and the `normalizeDesign` change in
  `ui/designer-model.js`, and add them to `api`.
  - `addFromCatalogue` builds each piece with the existing `slugKey(sourceKey, takenKeys)`,
    adding each new key to the taken set before the next one.
  - `fromLabel` drops the year: it takes the match name's text after the first `-`, so
    `2026-10-28` becomes `10-28`. A match name with no `-` is shown whole. The side is
    capitalized.

- [ ] **Step 4: Run** `node --test test/designer-model.test.js`. Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/designer-model.js test/designer-model.test.js
git commit -m "Designer model: add pieces from catalogue entries"
```

---

### Task 2: Catalogue tool: pure functions

**Files:**
- Create: `tools/catalogue.js` (pure functions only in this task, exported via `module.exports`)
- Create: `test/catalogue.test.js`

**Interfaces:**
- Produces:
  - `loadSides(engineSrc: string, sideSrcs: {white?: string, black?: string}) -> registry`.
    It runs the engine and then each side source in one fresh `vm` context and returns
    that context's `WackyChess.registry`. Errors propagate.
  - `rewriteIcon(icon, match, side) -> string`: `sides/<side>/assets/<rest>` becomes
    `catalogue/<match>/<side>/assets/<rest>` only when `icon` starts with exactly that
    prefix. Anything else is returned unchanged.
  - `isStock(def, templatePieces) -> boolean`: true when some template piece has the
    same `icon` and `description`.
  - `draftEntries({ match, side, sideDef, design, templatePieces }) -> entry[]`: one entry
    per non-stock piece, in `sideDef.pieces` order. `customArt` comes from the
    `design.json` piece with the same key, else `null`. `companions` is `[]`. `royal` is
    `!!def.royal` and `name` is `def.name || key`.
  - `findDuplicates(entries, existing) -> [{ id, duplicateOf }]`: an entry duplicates an
    existing one when their `name` and `description` are equal. Companions of existing
    entries count too, reported as `<parent id>#<key>`.
  - `mergeEntries(catalogue, match, entries) -> catalogue`: returns a new catalogue. It
    removes that match's old entries, adds the new ones, and sorts by the Global
    Constraints order, keeping each side's piece order. `version` is `1`.
  - `makeCompanion(catalogue, parentId, childId) -> catalogue`: moves the child entry into
    `parent.companions` as `{ key, name, icon, royal, description, customArt }`. It throws
    if either id is missing or the two are from different match/side snapshots.
  - `dropEntry(catalogue, id) -> catalogue`: throws if `id` is missing.

- [ ] **Step 1: Write the failing tests** in `test/catalogue.test.js`.
  - `engineSrc` is the real `engine/engine.js` text.
  - `fixtureBlack` is an inline side source calling
    `WackyChess.defineSide('black', { name: 'Goblins', ... })`. It has these pieces:
    - `king`: icon `'♚'`, royal, and the template King's exact description;
    - `zombie`: icon `'🧟'`, description `'Shambles.'`;
    - `art`: icon `'sides/black/assets/art.svg'`, description `'Has art.'`.
  - `fixtureDesign` is
    `{ pieces: [{ key: 'art', customArt: { description: 'a goblin' } }] }`.
  - `templatePieces` is `loadSides(engineSrc, { white: <main's sides/white/pieces.js text> }).white.pieces`.

```js
test('loadSides runs side code in a fresh context', () => {
  const reg = C.loadSides(engineSrc, { black: fixtureBlack });
  assert.deepEqual(Object.keys(reg.black.pieces), ['king', 'zombie', 'art']);
  assert.equal(globalThis.WackyChess?.registry?.black?.pieces?.art, undefined); // no leak
});

test('rewriteIcon only rewrites real side asset paths', () => {
  assert.equal(C.rewriteIcon('sides/black/assets/a/b.svg', '2026-10-30', 'black'), 'catalogue/2026-10-30/black/assets/a/b.svg');
  assert.equal(C.rewriteIcon('sides/white/assets/x.svg', '2026-10-30', 'black'), 'sides/white/assets/x.svg');
  assert.equal(C.rewriteIcon('🚗', '2026-10-30', 'black'), '🚗');
});

test('draftEntries skips stock pieces and fills every field', () => {
  // fixture: king identical to the template king; zombie custom; art with an svg icon and a design.json customArt
  const out = C.draftEntries({ match: '2026-10-30', side: 'black', sideDef: reg.black, design: fixtureDesign, templatePieces });
  assert.deepEqual(out.map((e) => e.id), ['2026-10-30/black/zombie', '2026-10-30/black/art']);
  assert.deepEqual(out[1], { id: '2026-10-30/black/art', match: '2026-10-30', side: 'black', sideName: 'Goblins',
    key: 'art', name: 'Art', icon: 'catalogue/2026-10-30/black/assets/art.svg', royal: false,
    description: 'Has art.', customArt: { description: 'a goblin' }, companions: [] });
});

const e = (id, extra = {}) => { const [match, side, key] = id.split('/');
  return { id, match, side, sideName: side, key, name: key, icon: '?', royal: false, description: key, customArt: null, companions: [], ...extra }; };

test('mergeEntries replaces a re-added match and keeps the order', () => {
  let cat = { version: 1, entries: [e('2026-10-26/black/y'), e('2026-10-28/white/x')] };
  cat = C.mergeEntries(cat, '2026-10-30', [e('2026-10-30/black/a'), e('2026-10-30/white/w')]);
  cat = C.mergeEntries(cat, '2026-10-30', [e('2026-10-30/black/b'), e('2026-10-30/black/c')]);
  assert.deepEqual(cat.entries.map((x) => x.id),
    ['2026-10-30/black/b', '2026-10-30/black/c', '2026-10-28/white/x', '2026-10-26/black/y']);
});

test('findDuplicates matches on name and description, including companions', () => {
  const existing = [e('2026-10-28/black/rook', { name: 'Corolla', description: 'Vroom.',
    companions: [{ key: 'ninja', name: 'Pawn', icon: '♟', royal: false, description: 'Sneaky.', customArt: null }] })];
  const fresh = [e('2026-10-30/white/rook', { name: 'Corolla', description: 'Vroom.' }),
    e('2026-10-30/white/p', { name: 'Pawn', description: 'Sneaky.' }),
    e('2026-10-30/white/q', { name: 'Corolla', description: 'Different.' })];
  assert.deepEqual(C.findDuplicates(fresh, existing), [
    { id: '2026-10-30/white/rook', duplicateOf: '2026-10-28/black/rook' },
    { id: '2026-10-30/white/p', duplicateOf: '2026-10-28/black/rook#ninja' }]);
});

test('makeCompanion and dropEntry reshape the catalogue and refuse bad ids', () => {
  const cat = { version: 1, entries: [e('2026-10-30/white/knight'), e('2026-10-30/white/plant'), e('2026-10-30/black/door')] };
  const out = C.makeCompanion(cat, '2026-10-30/white/knight', '2026-10-30/white/plant');
  assert.deepEqual(out.entries.map((x) => x.id), ['2026-10-30/white/knight', '2026-10-30/black/door']);
  assert.deepEqual(out.entries[0].companions,
    [{ key: 'plant', name: 'plant', icon: '?', royal: false, description: 'plant', customArt: null }]);
  assert.equal(cat.entries.length, 3); // input untouched
  assert.throws(() => C.makeCompanion(cat, '2026-10-30/white/knight', '2026-10-30/black/door'), /same match and side/);
  assert.throws(() => C.makeCompanion(cat, 'nope', '2026-10-30/white/plant'), /nope/);
  assert.deepEqual(C.dropEntry(cat, '2026-10-30/black/door').entries.length, 2);
  assert.throws(() => C.dropEntry(cat, 'nope'), /nope/);
});
```

- [ ] **Step 2: Run** `node --test test/catalogue.test.js`. Expected: FAIL, because
  `Cannot find module '../tools/catalogue.js'`.

- [ ] **Step 3: Implement** the exported functions in `tools/catalogue.js`, with a header
  comment in the style of `tools/check.js`. `loadSides`: create a context with
  `vm.createContext({})` and run the engine with `vm.runInContext`. The engine sets
  `globalThis.WackyChess` on the context. Then run each side source in the same context.

- [ ] **Step 4: Run** `node --test test/catalogue.test.js`. Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/catalogue.js test/catalogue.test.js
git commit -m "Catalogue tool: drafting and editing entries"
```

---

### Task 3: Catalogue tool: CLI, git, secrecy guard, integrity test

**Files:**
- Modify: `tools/catalogue.js` (add the CLI under `if (require.main === module)`)
- Modify: `test/catalogue.test.js`

**Interfaces:**
- Consumes: everything from Task 2.
- Produces:
  - `checkSecrecy(match, git) -> null | string`: returns an error message when a player
    branch is unmerged. `git(args: string[]) -> { ok: boolean, out: Buffer }` is injected.
  - `snapshotMatch(match, git, root) -> { catalogue, report }`. It does the following:
    - reads `origin/match/<match>`, either side's files, and `origin/main`'s template sides;
    - writes snapshots under `root/catalogue/<match>/`;
    - reads and merges `root/catalogue/catalogue.json`, creating it if missing;
    - writes it back with 2-space JSON and a trailing newline.

    `report` is a list of lines.
  - The CLI is `node tools/catalogue.js add <match>`, `companion <parentId> <childId>` or
    `drop <id>`. Usage is printed and the exit code is 1 on a bad command. `add` runs
    `git fetch --prune` first and then `checkSecrecy`. On refusal it prints the message and
    exits with 1.
- The report, one line per drafted entry: `<id>  <name>`, plus these flags where they apply:
  - `⚠ possible duplicate of <id>`;
  - `· not in starting setup (helper?)`, when the key isn't in the side's `setup`.

  After the entries come lines listing the stock pieces left out.

- [ ] **Step 1: Write the failing tests:**
  - `checkSecrecy` with a fake `git`:
    - no player branches gives `null`;
    - a `-white` branch that is an ancestor gives `null`;
    - a `-black` branch that isn't an ancestor gives a message containing
      `match/<name>-black`.

    `rev-parse --verify` decides whether a branch exists, and `merge-base --is-ancestor`
    decides whether it's merged. The fake answers by args.
  - **Integrity**, with the test skipped when `catalogue/catalogue.json` doesn't exist:
    - hard asserts:
      - the JSON parses and has `version: 1`;
      - every entry has all the Global Constraints fields;
      - ids are unique;
      - the snapshot file `catalogue/<match>/<side>/pieces.js` exists;
      - every `catalogue/...` icon (entries and companions) exists on disk.
    - then, per snapshot: `loadSides(currentEngineSrc, { [side]: snapshotSrc })` inside
      try/catch. On an error, call `t.todo(\`<match>/<side> no longer loads on the current
      engine: <message>\`)`. Otherwise assert that every entry key and companion key is in
      `registry[side].pieces`.

- [ ] **Step 2: Run** `node --test test/catalogue.test.js`. Expected: the `checkSecrecy`
  tests FAIL (not a function). The integrity test is skipped, because there's no
  catalogue yet.

- [ ] **Step 3: Implement** `checkSecrecy`, `snapshotMatch` and the CLI.
  - Real `git`: `child_process.spawnSync('git', args)`, returning
    `{ ok: status === 0, out: stdout }`.
  - Asset list: `git ls-tree -r --name-only origin/match/<m> -- sides/<side>/assets/`.
  - Write asset bytes from the `git show` Buffer unchanged.
  - `design.json` is optional: a missing file means every `customArt` is `null`.

- [ ] **Step 4: Run** `node --test`. Expected: all PASS, with the integrity test skipped.
  Then a smoke run on a scratch copy:
  `git worktree add "$SCRATCH/wc" HEAD && cd "$SCRATCH/wc" && node tools/catalogue.js add 2026-10-28`.
  Expected output:
  - a line `2026-10-28/black/rook  2009 Toyota Corolla`;
  - the Ninja Pawns unflagged, since they're in Black's setup;
  - `2026-10-28/white/dead` flagged `· not in starting setup (helper?)`;
  - stock pieces like the Black `queen` listed as left out.

  Remove the worktree afterward with `git worktree remove --force "$SCRATCH/wc"`.

- [ ] **Step 5: Commit**

```bash
git add tools/catalogue.js test/catalogue.test.js
git commit -m "Catalogue tool: add matches from git, with a secrecy guard"
```

---

### Task 4: Designer drawer

**Files:**
- Modify: `designer.html` (button next to `#add-piece`)
- Modify: `ui/designer.js` (drawer, card tag)
- Modify: `ui/designer.css` (drawer, card tag)

**Interfaces:**
- Consumes: `D.addFromCatalogue`, `D.filterCatalogue`, `D.catalogueMatches` and
  `D.fromLabel` from Task 1. Also consumes `catalogue/catalogue.json`, served as a static
  file by `tools/serve.js` (no server change).
- The button is `<button id="from-catalogue" type="button">📚 From catalogue</button>`,
  placed right after `#add-piece`.

- [ ] **Step 1: Implement the drawer** in `ui/designer.js`, as a new
  `// ---- catalogue drawer` section next to the emoji picker:
  - `openCatalogue()` fetches `catalogue/catalogue.json` once per page load and caches
    the result. A failed fetch, invalid JSON, or a missing `entries` array shows
    `No catalogue yet`.
  - The drawer is an `aside.catalogue-drawer` appended to `body`. It holds:
    - a header with `📚 Piece catalogue` and a ✕ button;
    - a search `input`;
    - chips: `All`, then one per `catalogueMatches`, each showing the match name without
      the year;
    - the list.
  - Each list entry shows:
    - `iconNode(entry)` (reused as is: image icons display from the `catalogue/` path);
    - the name;
    - `10-28 · Black`, plus `· +N <first companion name>` when there are companions, for
      example `· +3 Plant`;
    - the first line of the description.

    Clicking the entry text toggles the full description in place. The `Add` button
    calls `D.addFromCatalogue(design, entry)`, then `markDirty()` and `renderAll()`.
    The drawer stays open, and the button reads `Added ✓` for 1.5 s. Added keys are
    **not** put in `freshKeys`, so a catalogue piece keeps its key when renamed.
  - Escape, ✕, and a click outside both the drawer and the button close it.
  - In `card(piece)`, when `piece.from` is set, append
    `el('div', 'from-note', D.fromLabel(piece.from))` under the description.

- [ ] **Step 2: Style it** in `ui/designer.css`:
  - `.catalogue-drawer`: fixed to the right, full height, `width: min(420px, 100vw)`,
    `z-index: 30`, panel background, left border in `var(--accent)`, the same shadow as
    `.emoji-picker`, and a scrolling list.
  - Chips are styled like small pill buttons, with the active chip in `var(--accent)`.
  - `.from-note`: `var(--muted)`, `0.85rem`.
  - At phone width the drawer is full width.

- [ ] **Step 3: Verify by hand.** Run `npm start` on this branch after Task 5 has added
  the catalogue, or temporarily copy a hand-made two-entry `catalogue/catalogue.json`
  for testing, and open `http://localhost:8000/designer.html?side=white`. Check:
  - the drawer opens, search and chips filter, and Escape and outside clicks close it;
  - `Add` on an entry with companions adds all its cards, with the `from 10-30 · White`
    tag;
  - an art entry (Catapult) displays its SVG;
  - Save writes `from` into `sides/white/design.json`. Then
    `git checkout sides/white/design.json`, or delete it if it was new.
  - Renaming `catalogue/catalogue.json` makes the drawer say `No catalogue yet` while the
    rest of the designer still works.

  Take a headless screenshot of the open drawer for the PR, like the earlier mockup.

- [ ] **Step 4: Run** `node --test`. Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add designer.html ui/designer.js ui/designer.css
git commit -m "Designer: browse the piece catalogue and add past pieces"
```

---

### Task 5: Backfill 2026-10-26, 2026-10-28 and 2026-10-30

**Files:**
- Create: `catalogue/catalogue.json` and `catalogue/<match>/<side>/...` for the three matches.

**Interfaces:**
- Consumes: the CLI from Task 3.

- [ ] **Step 1: Run** `node tools/catalogue.js add 2026-10-26`, then `add 2026-10-28`, then
  `add 2026-10-30`, oldest first, so the duplicate flags point at the earlier match.

- [ ] **Step 2: Review with `companion` and `drop`** until the entries match this list.
  Each line is `match/side`: entries, with companions in brackets.
  - `2026-10-26/white`: catapult, necromancer [undead_pawn, undead_knight, undead_wizard,
    undead_catapult, undead_queen], wizard
  - `2026-10-26/black`: wayfinder, creeper, swapper, teleporter. Drop the near-stock
    `king` and `pawn`.
  - `2026-10-28/white`: queen (Flash), rook (Tank), bishop (Grenade Launcher), knight
    (Light), pawn (custom: captures forward), necromancer [dead]
  - `2026-10-28/black`: rook (Corolla) [ninja_2009_toyota_corolla], bishop (Wizard)
    [ninja_wizard], knight (Kamikaze-Knight) [ninja_kamikaze_knight]
  - `2026-10-30/white`: king (Wizard-King), queen (Heavy Artillery), bishop (Hypnotist),
    knight (Gardener) [plant, plant_2, plant_3], pawn (Checker) [checker_king], zombie.
    Drop the rook, which duplicates `2026-10-28/black/rook`.
  - `2026-10-30/black`: queen (royal Queen), rook (Archer), bishop (Kamikaze), knight
    (Calvary), pawn (Castle), door, barbarians, spear

  Any stock piece the tool didn't already leave out gets dropped. Read each remaining
  description in full to confirm that it says what the piece does.

- [ ] **Step 3: Run** `node --test`. Expected: all PASS, with the integrity test now
  running: no `todo`s, and every key resolves.

- [ ] **Step 4: Commit**

```bash
git add catalogue/
git commit -m "Catalogue: backfill the 2026-10-26, 10-28 and 10-30 matches"
```

---

### Task 6: Docs and housekeeping

**Files:**
- Modify: `AGENTS.md`, `README.md`, `docs/PIECE_API.md`, `.gitignore`

- [ ] **Step 1: Write the docs**, following the spec's "Agent workflow" section:
  - **`AGENTS.md`:**
    - Add a bullet to "Building from a design" for pieces with `from`, covering the five
      build steps.
    - Add a new section, "When a match ends: add it to the catalogue", with steps 1–5.
      These run only when the player asks.
    - In "Hard rules", note that reading `catalogue/` is always allowed.
    - In "Keep `design.json` in sync", say to keep each piece's `from`.
  - **`README.md`:**
    - In the "Branch rules" table and intro, `main` now also holds `catalogue/`, and
      `sides/` stays plain chess.
    - Add step 7 to "Playing a match": add the finished match to the catalogue.
    - Add `catalogue/` and `tools/catalogue.js` to "Layout".
  - **`docs/PIECE_API.md`:** one paragraph near "Examples of wacky pieces" pointing at
    `catalogue/` as a source of real, played examples.
  - **`.gitignore`:** add `.superpowers/`.

- [ ] **Step 2: Run** `node --test`. Expected: all PASS. Then run
  `git diff --stat main -- sides/`. Expected: empty.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md README.md docs/PIECE_API.md .gitignore
git commit -m "Docs: the piece catalogue and how agents use it"
```

- [ ] **Step 4: Hand off.** Push `template/piece-catalogue`. **Ask the player** before
  opening the pull request into `main`. The PR body should summarize the feature,
  include the drawer screenshot, and say that existing match branches get the catalogue
  with `git merge main`.
