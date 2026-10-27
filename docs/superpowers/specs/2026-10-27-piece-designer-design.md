# Piece Designer: design doc

Date: 2026-10-27
Branch: `template/piece-designer` (off `main`, merges back to `main` through a PR)

## Why

In the first match, the two players designed their sides by chatting with their AI
agents. That was fun. But it was hard to picture the starting board while designing,
and picking icons meant listing emoji options in chat. A designer page lets each
player sketch their side visually: pieces, emojis, plain-English descriptions, and
where everything starts. Then they hand that sketch to their agent to build.

## What it is

A new page, served by the same `npm start` server as the game, where one player
designs one side. Saving writes a **design file** to `sides/<color>/design.json`. The
player then tells their agent "build my design." The agent reads the file, asks
clarifying questions about each piece, and writes `sides/<color>/pieces.js` (plus any
custom art). The player play-tests in the normal game and asks the agent for changes
in chat.

The designer replaces none of the agent's work. It's a better way to write down
ideas than a chat message.

## Goals

- See your own starting setup on a board while you design.
- Pick any emoji for a piece by searching for it by name. Every standard emoji is
  searchable, not only a short list.
- Write each piece's name and description of what it should do in plain English.
- Mark pieces as royal.
- Ask for custom art when no emoji fits ("have my agent draw this one").
- Save to a file the agent can read, and reopen the designer later to edit it.
- Update `AGENTS.md` so agents know to build from the design file and to ask
  clarifying questions for each piece.

## Non-goals

- **Defining moves in the GUI.** No clicking squares to sketch a knight's jumps.
  Movement and abilities are described in words and implemented by the agent.
- **Generating code from the GUI.** The page never writes `pieces.js`.
- **Play-testing in the designer.** That's what the game page is for.
- **Being the main place to edit after handoff.** Once the agent builds the side,
  changes mostly happen by chatting with the agent. The player *can* reopen the
  designer, which shows the side as built, and save changes (see "Agent workflow").

## Anti-goals (would count as failure even if it technically works)

- The designer reveals anything about the other player's side.
- The designer or its server endpoint can write anywhere except
  `sides/<color>/design.json`.
- The designer needs an install or build step, or an internet connection. The
  project's promise is "all you need is Node."
- It creates merge conflicts between the two players. Each player's saved output
  lives only in their own `sides/<color>/` folder.

## Decided by the player

- **Layout: piece cards first, board as a preview.** (They chose option B from the
  mockups.)
  - Left: a list of **piece cards**. Each card shows the piece's emoji (or custom art
    placeholder), name, description, and a royal toggle. A **"+ New piece"** button
    adds a card. Cards can be deleted.
  - Right: an 8×8 board. Only the player's three starting rows are active. The other
    five rows are dimmed and can't take pieces.
  - **Drag a card onto an active square** to place that piece there. One card can be
    placed on many squares (eight pawns from one pawn card).
  - Pieces already on the board can be dragged to another active square to move them,
    or dragged off the board to remove them.
- **Starting positions only.** The board shows where pieces start, not how they move.
- **Emoji picker searches every emoji.** Clicking a card's emoji opens a picker with
  search by name and keyword across the full standard emoji set.
- **Custom art requests.** Each card has a "have my agent draw this" switch. Turning
  it on shows a text box where the player describes the picture ("a rickety wooden
  catapult, green and moldy"). The card's emoji, if one was picked, stands in on the
  designer board. Otherwise a generic placeholder does. The agent draws an SVG into
  `sides/<color>/assets/` and uses it as the piece's icon, like White's catapult
  from the 2026-10-26 match.
- **Design file in the side's folder.** Saving writes `sides/<color>/design.json`.
- **The agent asks clarifying questions for each piece** before implementing it.
  This instruction goes in `AGENTS.md`.
- **After building**, the player play-tests in the game and asks the agent for
  changes in chat.
- **`design.json` mirrors what was built.** After building, and after every later
  change, the agent updates `design.json` to match the real side. That includes
  descriptions sharpened by the clarifying questions, drawn art paths, and setup
  changes. Reopening the designer shows the side as it really is, not the original
  sketch.

## Decided by Claude (the player can push back)

- **It's a template change.** The designer page, the server endpoint, the emoji data,
  and the doc updates all go on `template/piece-designer` off `main`, merged through
  a PR. Matches pick it up with `git merge main`. `design.json` files appear only on
  player branches.
- **Page location:** `designer.html` at the repo root, with its code in `ui/`. The
  game's header gets a "Design a side" link to it, and the designer links back to the
  game.
- **Choosing a color:** the designer asks which color you're designing (White or
  Black) and puts it in the URL, like `designer.html?side=black`. It loads and saves
  **only** that color's files. It never fetches the other color's `design.json` or
  `pieces.js`.
- **Branch awareness:** the server exposes the current git branch (read from
  `.git/HEAD` with Node built-ins, for example `GET /api/branch`. Report "unknown"
  if it can't tell, such as in a worktree or a detached HEAD). The designer shows the
  branch. If it matches `match/<name>-white` or `match/<name>-black`, that color is
  picked automatically. If the branch doesn't match the chosen color (for example
  `main`, the match branch itself, or the other color's branch), the page shows a
  clear warning that saving here will cause trouble. It **warns but never blocks**
  saving.
- **Save conflict check:** both the designer and the agent write `design.json`, so
  the page remembers a version of the file when it loads (a content hash or mtime)
  and sends it with each save. If the file changed on disk since then, the server
  refuses with 409, and the page tells the player the side was changed (probably by
  their agent). It offers to reload, or to overwrite on purpose. It never silently
  overwrites.
- **Board orientation:** always from the designer's own seat, with your back rank at
  the bottom. That matches how `setup` is written in `pieces.js`, so Black doesn't
  have to think upside down.
- **Side name field:** a text field at the top for the side's display name ("The
  Goblin Horde"). It maps to `name` in `defineSide`.
- **Starting point when no design file exists:** the designer loads the chosen side's
  current `pieces.js` (via `WackyChess.defineSide`, the same way the game does) and
  turns its pieces and setup into cards and board placements. On a fresh player
  branch that's plain chess, so the player starts from chess and edits from there. If
  that load fails, start empty.
- **Pieces don't have to be on the starting board.** A card can exist without being
  placed. Last match, White's undead pieces only appeared mid-game. The card list
  marks unplaced cards (for example "not in starting setup") so it's clearly
  deliberate.
- **Saving:** `tools/serve.js` gets one endpoint, `POST /api/design/<color>`, where
  `<color>` must be exactly `white` or `black`. The body is the design as JSON. The
  server checks that it parses, caps the size (something like 1 MB), and writes it as
  pretty-printed JSON to `sides/<color>/design.json`. Anything else gets a 4xx. The
  server already listens only on 127.0.0.1. The page shows clearly when a save
  worked or failed, and warns before you leave the page with unsaved changes.
- **Opening `designer.html` from disk** (without the server) shows the same kind of
  "run `npm start`" message the game shows, since saving can't work without the
  server.
- **Emoji data is vendored.** A full emoji dataset (each emoji with its name and
  search keywords) is committed as a static file under `ui/`. It's generated from a
  permissively licensed source such as Unicode's `emoji-test.txt` or `emojibase-data`,
  with the source and license noted next to the file. If a generator script is used,
  it goes in `tools/` and is run once by hand, not at startup. Whether to include
  skin-tone variants is the builder's call. Base emojis are enough.
- **Light validation in the designer, as warnings only, never blocking save:** no
  royal piece (point to the "lose when every piece is gone" rule), duplicate piece
  names, a card with an empty description.

## Design file format

`sides/<color>/design.json`:

```json
{
  "version": 1,
  "side": "black",
  "name": "The Goblin Horde",
  "pieces": [
    {
      "key": "goblin_king",
      "name": "Goblin King",
      "icon": "🧌",
      "royal": true,
      "description": "Moves 1 square. Once per game can swap places with any goblin.",
      "customArt": null
    },
    {
      "key": "catapult",
      "name": "Catapult",
      "icon": "🏹",
      "royal": false,
      "description": "Can't move and capture in the same turn. Flings rocks 3 squares.",
      "customArt": { "description": "A rickety wooden catapult, green and moldy." }
    }
  ],
  "setup": [
    [null, null, null, "goblin_king", null, null, null, null],
    ["goblin", "goblin", "goblin", "goblin", "goblin", "goblin", "goblin", "goblin"],
    [null, null, null, null, null, null, null, null]
  ]
}
```

- `key` is a stable identifier made from the name when the card is created (lower
  case, underscores, unique within the side). It doesn't change if the name is
  edited later, so `setup` references stay valid. It becomes the piece's key in
  `pieces.js`.
- `icon` is an emoji string, or `""` if none was picked.
- `customArt` is `null`, or an object holding the player's description of the art.
- `setup` uses the same shape and orientation as `pieces.js`: always three rows of 8,
  first row = the player's back rank, left to right from their seat, `null` for
  empty.
- When the designer loads a design built from an existing `pieces.js`, an icon that is
  an image path (like `sides/white/assets/catapult.svg`) is kept as-is and shown as
  an image on the card and board. The emoji picker can replace it.

## Agent workflow (changes to `AGENTS.md`)

Add a section along these lines, with the wording left to the builder:

- If `sides/<your color>/design.json` exists, the player probably made it in the
  designer. When they ask you to build it (or at the start of a session, if
  `pieces.js` doesn't match it yet), read it first.
- **Before writing code for each piece, ask the player clarifying questions about
  it.** Go one piece at a time. Cover edge cases the description leaves open: what
  happens at the board edge, whether it can capture with its special move, how
  cooldowns count, what happens when it's captured, and so on. Fold the answers into
  the piece's `description` so the opponent learns the real rules.
- For each piece with `customArt`, draw an SVG in `sides/<your color>/assets/` and
  use its path as the `icon`, in both `pieces.js` and `design.json`. Keep the
  `customArt` description as a record. A piece whose `icon` is already an asset path
  is drawn. Redraw it only if the player changes the `customArt` description or asks.
- Use the design's `name`, piece keys, names, `royal` flags, and `setup` as given.
- **Keep `design.json` in sync with what you built.** After the first build and
  after every later change (from chat or from a re-save), rewrite `design.json` so
  its names, icons, descriptions (including the details settled by your questions),
  royal flags, and setup match `pieces.js`. Commit it alongside `pieces.js`.
- **Finding what the player changed.** Because `design.json` is committed in sync
  after each build, `git diff sides/<your color>/design.json` shows exactly what
  the player edited in the designer since then. Implement those changes, asking
  clarifying questions about new or changed pieces as before.
- `design.json` lives in your own folder like everything else, so the existing hard
  rules (edit only your folder, don't peek) cover it.

Also update:

- `README.md`: mention the designer under "Playing a match," step 3 (design in
  secret).
- `docs/PIECE_API.md`: a short note that `design.json` may exist and is a design
  input, not something the engine reads.

## Constraints

- No dependencies, no build step, nothing to install. Plain HTML, CSS, and JS, the
  same style as `ui/ui.js`. The server stays Node built-ins only.
- Must work in the sandboxed Flatpak and Snap browsers the README mentions (served
  over `http://localhost`, not `file://`).
- The engine and game UI behave exactly as before. `node --test` and
  `node tools/check.js <color>` keep passing.
- Desktop mouse drag-and-drop is required. Touch support is welcome, not required.

## Left to the builder

- Visual styling. Match the game's existing look in `ui/style.css` where reasonable.
- How the emoji picker looks (popover or modal, grid size, categories or none).
- How the drag-and-drop is implemented (HTML5 drag events or pointer events).
- Whether the save endpoint gets a test, and what kind. The existing tests use
  `node --test`.
- Exact `AGENTS.md`, `README.md`, and `PIECE_API.md` wording.
