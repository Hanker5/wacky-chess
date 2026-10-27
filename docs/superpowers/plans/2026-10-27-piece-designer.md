# Piece Designer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `designer.html` page where a player sketches one side (piece cards with emoji, name, description, royal flag, custom-art request, plus starting placements) and saves it to `sides/<color>/design.json` for their AI agent to build.

**Architecture:** `tools/serve.js` gains a small JSON API (`/api/design/<color>`, `/api/branch`) implemented in a new `tools/design-api.js`. The page is plain browser JS: a pure, Node-testable model (`ui/designer-model.js`, UMD like `engine/engine.js`) and the DOM layer (`ui/designer.js`). Emoji search data is vendored as `ui/emoji-data.js`, generated once by `tools/build-emoji-data.js` from emojibase-data.

**Tech Stack:** Node built-ins only (`node:http`, `node:fs`, `node:crypto`, `node:test`), vanilla browser JS/CSS, no dependencies, no build step.

**Spec:** `docs/superpowers/specs/2026-10-27-piece-designer-design.md`

## Global Constraints

- No dependencies, no build step, nothing to install. Server is Node built-ins only.
- Must work when served over `http://localhost` in sandboxed Flatpak/Snap browsers. Opening `designer.html` from disk shows a "run `npm start`" message.
- The designer loads and saves **only** the chosen color's files. It never requests the other color's `design.json` or `pieces.js`.
- The save endpoint writes **only** `sides/white/design.json` or `sides/black/design.json`. `<color>` must be exactly `white` or `black`.
- Body size cap: 1 MB (`1_000_000` bytes).
- Warnings never block saving. The branch warning never blocks saving.
- The engine and game UI behave exactly as before. `node --test` and `node tools/check.js` keep passing.
- Design file format is exactly the spec's: `{ version: 1, side, name, pieces: [{ key, name, icon, royal, description, customArt }], setup }`. `setup` is always 3 rows × 8, row 0 = back rank, left to right from the player's seat. `customArt` is `null` or `{ description }`.
- Piece keys must match the engine's `/^[A-Za-z_][A-Za-z0-9_-]*$/` and never change after creation.
- Code style matches `ui/ui.js` and `engine/engine.js`: `'use strict'`, IIFE wrappers, small helper functions, sparse comments.
- Desktop mouse drag-and-drop is required. Touch is optional.

## Review Focus

- **A piece name with no ASCII letters or one that starts with a digit** ("🔥🔥", "3 Headed Dog"): the key is still valid for the engine (`piece`, `_3_headed_dog`). Pinned in Task 2 `slugKey` tests.
- **Deleting a card that is placed on the board**: its squares empty out, and `setup` never references a missing key. Pinned in Task 2 `removePiece` test.
- **A hand- or agent-edited `design.json` with short `setup`, missing fields, or setup keys that no longer exist**: the designer loads it, normalized, instead of crashing. Pinned in Task 2 `normalizeDesign` tests.
- **The file was deleted or changed after the page loaded**, then the player saves: 409, not a silent overwrite. And a first save when no file exists succeeds. Pinned in Task 1 tests.
- **`pieces.js` with a 1- or 2-row setup and image-path icons** (like White's catapult): the starting design pads to 3 rows and keeps the path. Pinned in Task 2 `designFromSide` test.

---

### Task 1: Design and branch API in the server

**Files:**
- Create: `tools/design-api.js`
- Modify: `tools/serve.js` (export `createServer(root)`, route `/api/` to the API, only `listen` when run directly)
- Test: `test/serve.test.js`

**Interfaces:**
- Produces (`tools/design-api.js`, CommonJS):
  - `readBranch(root: string) -> string | null`: reads `<root>/.git`. If it's a directory, read `HEAD` inside it. If it's a file containing `gitdir: <path>`, read `HEAD` in that path (resolved against `root`). Returns `<name>` from `ref: refs/heads/<name>`, else `null`. Never throws.
  - `colorFromBranch(branch: string | null) -> 'white' | 'black' | null`: `/^match\/.+-(white|black)$/`.
  - `handleApi(req, res, root) -> void`: handles every `/api/...` request.
- Produces (HTTP, all responses `application/json`, `Cache-Control: no-store`):
  - `GET /api/branch` → `200 { branch, color }`
  - `GET /api/design/<color>` → `200 { version, design }`. `version` = sha1 hex of the file bytes, or `null` if the file doesn't exist. `design` = parsed JSON or `null`. If the file exists but doesn't parse: `200 { version, design: null, error: "design.json is not valid JSON" }`.
  - `POST /api/design/<color>` with body `{ expectedVersion: string|null, force?: boolean, design: object }`:
    - `200 { version }` after writing `JSON.stringify(design, null, 2) + '\n'`
    - `400 { error }`: color not exactly `white`/`black`, body not JSON, `design` not a plain object, or `design.side !== color`
    - `409 { error: "changed", version }`: current file version (or `null` if missing) ≠ `expectedVersion`, and `force` isn't `true`
    - `413 { error }`: body over 1 MB
  - Anything else under `/api/` → `404 { error }`. Wrong method on a known path → `405 { error }`.
- Produces (`tools/serve.js`): `module.exports = { createServer }`, where `createServer(root = ROOT) -> http.Server`. The existing static-file behavior is unchanged. Startup logging and `EADDRINUSE` handling run only under `require.main === module`.

- [ ] **Step 1: Write the failing tests** in `test/serve.test.js`

Each test builds a temp root with `fs.mkdtempSync(path.join(os.tmpdir(), 'wacky-'))` containing `sides/white/`, `sides/black/`, and `.git/HEAD`. Start `createServer(tmp).listen(0, '127.0.0.1')` and use global `fetch`.

```js
test('GET /api/branch reports the branch and its color');
// HEAD "ref: refs/heads/match/2026-10-27-black\n" → { branch: 'match/2026-10-27-black', color: 'black' }
// HEAD "ref: refs/heads/main\n" → { branch: 'main', color: null }
// HEAD "3f2a…" (detached) → { branch: null, color: null }
test('readBranch follows a .git file (worktree)');
// .git is a file "gitdir: wt\n" and wt/HEAD is "ref: refs/heads/match/x-white" → 'match/x-white'
test('GET /api/design/<color> with no file returns nulls');      // { version: null, design: null }
test('first save with expectedVersion null writes the file');
// 200; file content === JSON.stringify(design, null, 2) + '\n'; returned version === sha1 of that content;
// a GET afterwards returns the same version and deepEquals the design
test('save with a stale version is refused with 409');
// save once (v1), save again with expectedVersion v1 → 200 (v2); save with expectedVersion v1 → 409 { error: 'changed', version: v2 }, file unchanged
test('save after the file was deleted is refused with 409');     // expectedVersion v1, file removed → 409, version null
test('force: true overwrites despite a stale version');          // 200
test('bad color, bad JSON, non-object design, and side mismatch are 400');
// POST /api/design/..%2Fsecrets, /api/design/red, body "not json", design: [] , design.side 'white' to /api/design/black
// → each 400, and nothing written anywhere under tmp except existing files
test('body over 1 MB is 413');
test('unknown /api path is 404 and static files still serve');   // GET /api/nope → 404; GET /sides/white/pieces.js (temp file) → 200
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/serve.test.js`
Expected: FAIL (`createServer` is not exported).

- [ ] **Step 3: Implement `tools/design-api.js` and refactor `tools/serve.js`**

Read the POST body in chunks. Stop and send 413 as soon as the total passes 1 MB. Use `crypto.createHash('sha1')` for versions. Build the file path only from the validated color literal (`path.join(root, 'sides', color, 'design.json')`), never from the raw URL.

- [ ] **Step 4: Run all tests**

Run: `node --test`
Expected: PASS, including the existing `test/engine.test.js`.

- [ ] **Step 5: Smoke-test the real server**

Run: `npm start`, then `curl -s localhost:8000/api/branch` and `curl -s localhost:8000/` (game HTML).
Expected: JSON with the current branch, and the game page still served.

- [ ] **Step 6: Commit**

```bash
git add tools/design-api.js tools/serve.js test/serve.test.js
git commit -m "Server: design save/load and branch API for the piece designer"
```

---

### Task 2: Designer model

**Files:**
- Create: `ui/designer-model.js`
- Test: `test/designer-model.test.js`

**Interfaces:**
- Produces: a UMD script like `engine/engine.js` that sets `globalThis.WackyDesigner` and `module.exports`. Functions mutate the design passed in unless noted.
  - `KEY_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/`
  - `slugKey(name: string, taken: Iterable<string>) -> string`: lower-case, non-alphanumerics → `_`, collapse and trim `_`. If empty, use `piece`. If it starts with a digit, prefix `_`. If taken, append `_2`, `_3`, and so on. Always matches `KEY_RE`.
  - `emptyDesign(side) -> Design`: `{ version: 1, side, name: '', pieces: [], setup: 3 rows of 8 null }`
  - `normalizeDesign(side, raw) -> Design` (pure): fills missing fields with defaults; coerces `royal` to boolean; `customArt` to `null` or `{ description: string }`; drops pieces whose key fails `KEY_RE` or repeats; pads or truncates `setup` to 3×8; replaces setup entries naming unknown keys with `null`; forces `side`.
  - `designFromSide(side, def) -> Design` (pure): from a `WackyChess.registry` entry. Pieces in `Object.keys(def.pieces)` order: `{ key, name: p.name || key, icon: p.icon, royal: !!p.royal, description: p.description || '', customArt: null }`. `name: def.name || ''`. `setup` padded to 3 rows.
  - `addPiece(design, name = 'New piece') -> string`: appends a piece with a fresh `slugKey` and empty icon and description; returns the key.
  - `removePiece(design, key) -> void`: removes the piece and nulls every setup cell holding it.
  - `setCell(design, row, col, key | null) -> void`
  - `isPlaced(design, key) -> boolean`
  - `warnings(design) -> string[]`, in this order, with this exact copy:
    - `No royal piece: you'll lose only when every one of your pieces is gone.` (when no piece is royal)
    - `Two pieces are named "${name}".` (once per duplicated name, case-insensitive, trimmed)
    - `"${name || '(unnamed)'}" has no description yet.` (per piece with blank description)
  - `searchEmoji(list, query, limit = 240) -> Entry[]`: `Entry = [emoji, label, tags]`, with `tags` a space-separated string. Every whitespace-separated term of the lower-cased query must be a substring of `label + ' ' + tags`. Entries whose label starts with the first term come first; otherwise keep data order. An empty query returns the first `limit` entries.

- [ ] **Step 1: Write the failing tests** in `test/designer-model.test.js`

```js
test('slugKey makes engine-valid, unique keys', () => {
  assert.equal(slugKey('Goblin King', []), 'goblin_king');
  assert.equal(slugKey('Goblin King', ['goblin_king']), 'goblin_king_2');
  assert.equal(slugKey('Goblin King', ['goblin_king', 'goblin_king_2']), 'goblin_king_3');
  assert.equal(slugKey('🔥🔥', []), 'piece');
  assert.equal(slugKey('3 Headed Dog', []), '_3_headed_dog');
  for (const n of ['', '  ', '!!!', 'Ünïcode Ünit', '3']) assert.match(slugKey(n, []), KEY_RE);
});
test('removePiece clears its placements', () => {
  // design with 'goblin' at setup[1][0..7] and 'king' at [0][3]; removePiece(d, 'goblin')
  // → no piece 'goblin', setup[1] all null, setup[0][3] still 'king'
});
test('normalizeDesign repairs short or stale files', () => {
  // raw { pieces: [{ key: 'a', name: 'A' }, { key: 'a' }, { key: '9bad' }], setup: [['a', 'ghost']] }
  // → pieces keys ['a'], piece a has icon '', royal false, description '', customArt null;
  //   setup is 3 rows of 8; setup[0][0] === 'a', setup[0][1] === null; side forced; version 1
  // normalizeDesign('black', null) deepEquals emptyDesign('black')
});
test('designFromSide pads setup and keeps image icons', () => {
  // def { name: 'Undead', pieces: { king: { icon: '♚', royal: true, description: 'K', moves }, cat: { name: 'Catapult', icon: 'sides/white/assets/catapult.svg', moves } },
  //       setup: [[null,null,null,'king',null,null,null,'cat']] }
  // → name 'Undead'; pieces[1] deepEquals { key: 'cat', name: 'Catapult', icon: 'sides/white/assets/catapult.svg', royal: false, description: '', customArt: null };
  //   setup.length 3, setup[0][7] 'cat', setup[2] all null
});
test('warnings lists royal, duplicate, and description problems in order');
// pieces [{name:'Frog', description:''}, {name:' frog ', description:'x'}] no royal
// → ['No royal piece: ...', 'Two pieces are named "Frog".', '"Frog" has no description yet.']
test('searchEmoji matches every term across label and tags, label-prefix first');
// list [['🍄','mushroom','fungus toadstool'], ['🐸','frog','face'], ['🍄‍🟫','brown mushroom','food fungus']]
// 'mush' → ['🍄', '🍄‍🟫'] in that order; 'fungus brown' → ['🍄‍🟫']; 'toad' → ['🍄']; '' with limit 2 → first two
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/designer-model.test.js`
Expected: FAIL (cannot find module `../ui/designer-model.js`).

- [ ] **Step 3: Implement `ui/designer-model.js`**

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui/designer-model.js test/designer-model.test.js
git commit -m "Designer model: design file shape, keys, normalizing, warnings, emoji search"
```

---

### Task 3: Vendored emoji data

**Files:**
- Create: `tools/build-emoji-data.js`
- Create: `ui/emoji-data.js` (generated, committed)
- Test: `test/emoji-data.test.js`

**Interfaces:**
- Consumes: emojibase-data **16.0.3** `en/data.json` (MIT, by Miles Johnson), downloaded by hand from `https://cdn.jsdelivr.net/npm/emojibase-data@16.0.3/en/data.json`.
- Produces: `ui/emoji-data.js`, a UMD script setting `globalThis.WackyEmoji` (and `module.exports`) to an array of `[emoji, label, tags]` (tags space-separated), in emojibase `order`. It starts with a comment naming the source package, version, URL, MIT license, and the regenerate command.

- [ ] **Step 1: Write the failing test** in `test/emoji-data.test.js`

```js
test('emoji data covers the full set without skin-tone components', () => {
  const list = require('../ui/emoji-data.js');
  assert.ok(list.length > 1800);
  const mushroom = list.find(([e]) => e === '🍄');
  assert.deepEqual(mushroom, ['🍄', 'mushroom', 'fungus toadstool']);
  assert.ok(list.some(([, label]) => label === 'troll'));
  assert.ok(!list.some(([, label]) => /skin tone$/.test(label)));
  for (const entry of list) assert.equal(entry.length, 3);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/emoji-data.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `tools/build-emoji-data.js <path/to/data.json>`**

Keep entries whose `group` is defined and isn't `2` (components). Drop skin-tone variants (only top-level entries, ignore `skins`). Sort by `order`. Write `ui/emoji-data.js`. Header comment usage: `node tools/build-emoji-data.js path/to/emojibase-data/en/data.json`.

- [ ] **Step 4: Generate the data and run the test**

Run: `d=$(mktemp -d) && curl -so "$d/data.json" https://cdn.jsdelivr.net/npm/emojibase-data@16.0.3/en/data.json && node tools/build-emoji-data.js "$d/data.json" && node --test`
Expected: PASS. `ui/emoji-data.js` is roughly 100–200 KB.

- [ ] **Step 5: Commit**

```bash
git add tools/build-emoji-data.js ui/emoji-data.js test/emoji-data.test.js
git commit -m "Vendor emoji search data (emojibase-data 16.0.3, MIT)"
```

---

### Task 4: Designer page: cards, board, load and save

**Files:**
- Create: `designer.html`, `ui/designer.js`, `ui/designer.css`

**Interfaces:**
- Consumes: Task 1 HTTP API; Task 2 `WackyDesigner.*`; `engine/engine.js` (`WackyChess.defineSide`, `registry`, `isImageIcon`, `loadErrors`).
- Produces: `ui/designer.js` exposes `openEmojiPicker(anchorEl, onPick: (emoji: string) => void)` as a no-op stub that Task 5 replaces. The emoji button is already wired to call it.

Page behavior (the spec's "Decided by the player" and "Decided by Claude" sections are the source of truth):

- [ ] **Step 1: Shell and boot.** Create `designer.html`, loading `ui/style.css`, `ui/designer.css`, `engine/engine.js`, `ui/designer-model.js`, `ui/emoji-data.js`, `ui/designer.js`. Include a `#boot` "Loading… run `npm start`" block worded like `index.html`'s, removed by `designer.js`. Also add a link back to the game (`index.html`). If `fetch('/api/branch')` fails (for example on `file://`), replace the boot block with the "run `npm start` and open http://localhost:8000/designer.html" message and stop.

- [ ] **Step 2: Choosing a color.** Read `?side=`. If it's missing and `/api/branch` returned a `color`, use that color and `history.replaceState` it into the URL. If neither, show two buttons ("Design White" / "Design Black") that set `?side=` and reload. The header shows `Branch: <branch or unknown>`. If `color` from the API isn't the chosen side, show a warning banner: `You're on "<branch>". Design on match/<name>-<side> so your design lands on your own branch.` (with `unknown` when branch is null). It never blocks.

- [ ] **Step 3: Loading.** `GET /api/design/<side>`. If `design` is non-null, use `normalizeDesign(side, design)` and remember `version`. Otherwise load only `sides/<side>/pieces.js` by injecting a `<script>`. On load, if `WackyChess.registry[side]` exists, use `designFromSide`. If the script errors or registers nothing, use `emptyDesign`. If the API returned `error`, show it as a warning and start from `pieces.js` as above.

- [ ] **Step 4: Cards (left column).** A "Side name" text input bound to `design.name`. One card per piece, with:
  - an emoji button (shows the icon, an `<img>` if `isImageIcon`, or a placeholder `?` if blank) that calls `openEmojiPicker`
  - a name input (editing it changes only `name`, never `key`)
  - a description textarea
  - a "Royal 👑" checkbox
  - a "Have my agent draw this" checkbox that reveals an art-description textarea bound to `customArt.description` (unchecking sets `customArt` to `null`)
  - a delete button (`removePiece`)
  - a "Not in starting setup" note when `!isPlaced`

  "+ New piece" calls `addPiece`. The warnings from `warnings(design)` are listed under the cards and re-rendered on every change.

- [ ] **Step 5: Board (right column).** An 8×8 board from the player's seat: setup row 0 at the bottom, so display row `r` (top = 0) shows setup row `7 - r` when `7 - r < 3`. Squares for setup rows 0–2 are active; the rest are dimmed and reject drops. Use the game's square colors and token look (`.token` with the side's class, `.royal`). Drag behavior:
  - card → active square sets the cell, replacing whatever was there
  - board piece → another active square moves it
  - board piece → anywhere off the board (or onto a dimmed square) clears its cell

- [ ] **Step 6: Save.** A Save button and Ctrl/Cmd+S `POST` `{ expectedVersion: version, design }`.
  - On 200: store the new `version`, clear the dirty flag, and show "Saved to sides/<side>/design.json" briefly.
  - On 409: show a banner, `This design changed on disk since you opened it, probably by your agent.`, with buttons **Reload** (re-runs Step 3, discarding local edits) and **Overwrite** (re-POSTs with `force: true`).
  - On other errors: show the server's `error` text.

  Every edit sets a dirty flag, and while it's set, `beforeunload` asks before leaving.

- [ ] **Step 7: Verify in the browser.** Run `npm start` on this branch and open `http://localhost:8000/designer.html`. Check:
  - On `template/piece-designer`, the wrong-branch warning shows and the color picker appears.
  - `?side=white` starts from the plain-chess pieces, with a full 2-row setup.
  - Add a card named "Goblin King", place it, rename it, and the placement survives.
  - Delete a placed card and its squares empty.
  - Save, and `sides/white/design.json` matches the format.
  - Edit `design.json` by hand, then save in the page: the 409 banner appears, and Reload shows the hand edit.
  - The network panel shows no request for `sides/black/*`.

  Afterwards, run `git checkout sides/white/` and remove `sides/white/design.json`. Don't commit test designs.

- [ ] **Step 8: Run all tests**

Run: `node --test && node tools/check.js`
Expected: PASS, with no checker failures.

- [ ] **Step 9: Commit**

```bash
git add designer.html ui/designer.js ui/designer.css
git commit -m "Piece designer page: cards, starting board, load/save with conflict check"
```

---

### Task 5: Emoji picker

**Files:**
- Modify: `ui/designer.js` (replace the `openEmojiPicker` stub), `ui/designer.css`

**Interfaces:**
- Consumes: `WackyEmoji` (Task 3), `WackyDesigner.searchEmoji` (Task 2), the `openEmojiPicker(anchorEl, onPick)` call sites from Task 4.

- [ ] **Step 1: Implement the picker.** A popover anchored to the card's emoji button, with:
  - an autofocused search input, filtered through `searchEmoji` as you type
  - a grid of results, where clicking a result calls `onPick(emoji)` and closes the picker
  - a "Type or paste any emoji" fallback, where pressing Enter in the search box with text that isn't a search hit (for example a pasted emoji) uses that text as the icon
  - a hover title showing each emoji's label

  Escape or clicking outside closes it. Picking replaces an image-path icon too.

- [ ] **Step 2: Verify in the browser.**
  - "mush" shows 🍄.
  - "troll" shows 🧌.
  - "fungus brown" narrows to the brown mushroom.
  - Picking updates the card and every board token for that piece.
  - Escape closes the picker.
  - Typing feels instant.

- [ ] **Step 3: Commit**

```bash
git add ui/designer.js ui/designer.css
git commit -m "Designer: searchable picker over the full emoji set"
```

---

### Task 6: Game link and agent docs

**Files:**
- Modify: `index.html` (a "Design a side" link to `designer.html` in the `<header>`), `ui/style.css` (only if the link needs styling)
- Modify: `AGENTS.md`, `README.md`, `docs/PIECE_API.md`

- [ ] **Step 1: `index.html` link.** Add a "Design a side" link to `designer.html` in the header. Check that `npm start` shows it and that it opens the designer.

- [ ] **Step 2: `AGENTS.md`.**
  - Add `designer.html` to Hard rule 1's don't-touch list.
  - Allow `design.json` alongside `pieces.js` and `assets/` in Hard rule 1.
  - Add a "Building from a design" section that carries every bullet of the spec's "Agent workflow" section:
    - Read `design.json` first.
    - Ask clarifying questions, one piece at a time, before coding each piece, and fold the answers into its `description`.
    - Draw SVGs for `customArt` and set the asset path as the icon in both files.
    - Use the given keys, names, royal flags, and setup.
    - Keep `design.json` in sync after every change and commit it with `pieces.js`.
    - Use `git diff sides/<color>/design.json` to see what the player changed after a re-save.

- [ ] **Step 3: `README.md`.** In "Playing a match" step 3, mention opening `http://localhost:8000/designer.html` to sketch the side, then asking the agent to build the design.

- [ ] **Step 4: `docs/PIECE_API.md`.** Add a short note near "The side file": `design.json` may exist in the side folder. It's the player's design input, kept in sync by the agent, and the engine never reads it.

- [ ] **Step 5: Run all tests and commit**

Run: `node --test && node tools/check.js`
Expected: PASS.

```bash
git add index.html ui/style.css AGENTS.md README.md docs/PIECE_API.md
git commit -m "Link the designer from the game and teach agents to build from design.json"
```
