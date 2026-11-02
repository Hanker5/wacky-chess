# Piece Catalogue: design doc

Date: 2026-11-02
Branch: `template/piece-catalogue` (off `main`, merges back to `main` through a PR)

## Why

Players keep wanting pieces from earlier matches. In the 2026-10-30 match, White's design
said "exactly the same as the 2009 Toyota Corolla in the 2026-10-28 match" and pointed the
Wizard-King at "the wizard in previous matches." That works, but only if the agent can go
dig through old match branches. The player also has to remember which match a piece came
from, and there were two different Wizards with two different fireballs.

A catalogue of every piece from every finished match, browsable in the piece designer,
lets a player find an old piece and add it to their side in one click. The added piece is
a **starting point**: the player can keep it as it was or tweak it.

## What it is

1. A **catalogue** on `main`: a `catalogue/` folder holding every piece from both sides
   of every finished match. It includes each piece's description, icon or art, and the
   original code.
2. A **"📚 From catalogue" drawer** in the piece designer. You browse, search, filter by
   match, and click "Add." The piece lands in your card list as a normal, editable card.
3. **Agent workflow:** when a design has a catalogue piece, the agent builds it from the
   original code instead of from scratch. When a match ends, the agent adds that match's
   pieces to the catalogue through a pull request to `main`.

## Goals

- Every piece from both sides of every finished match is in the catalogue, added when the
  match ends.
- In the designer, a player can browse, search, and filter the catalogue by match, and
  add a piece with one click.
- An added piece is a normal card: name, icon, royal flag and description are filled in,
  and everything stays editable.
- The agent builds a catalogue piece from its original code, then applies only what the
  player changed. It asks clarifying questions only about the changed parts.
- Helper pieces come along with the piece they belong to (see "Companions").
- Custom art comes along too.
- Backfill the matches already played: 2026-10-26, 2026-10-28 and 2026-10-30.

## Non-goals

- **Live-linking to the catalogue.** An added piece is a copy. Later catalogue changes
  never change a side that already used it.
- **Editing the catalogue from the designer.** The designer only reads it. Only the
  end-of-match agent workflow changes it.
- **Running catalogue code directly.** The engine never loads `catalogue/`. Catalogue code
  is reference material that the agent copies into `sides/<color>/pieces.js`.
- **Ratings, favorites, tags, or balance notes.**

## Anti-goals (would count as failure even if it technically works)

- **A secrecy leak.** The catalogue must never hold pieces from a match whose sides are
  still secret. Only a merged match (both sides on `match/<name>`) is added.
- **A merge conflict between the two players.** Adding a catalogue piece still changes
  only the player's own `sides/<color>/` folder.
- **A side that silently depends on `catalogue/`.** Icons and art used by a side must live
  in that side's own `assets/` folder, and its code in its own `pieces.js`.
- **A new install or build step.** "All you need is Node" stays true.
- **Making `main` playable with custom pieces.** `sides/` on `main` stays plain chess. The
  catalogue is a library, not a side.

## Decided by the player

- **It's a library of starting points**, not a set of locked, exact copies.
- **Every piece from both sides of every match** goes in, added when the match ends.
- **Designer layout: option B.** A "📚 From catalogue" button next to "+ New piece" opens
  a drawer over the page, with a search box, a chip for each match, and a list of entries
  (icon, name, match and side, start of the description, "Add").

## Decided by me (the player approved the playback)

- **No stock chess pieces.** The tool leaves out a piece whose icon and description match
  the plain-chess template exactly (an unchanged King, Knight or Pawn). In review, the agent
  also drops pieces that are stock in all but wording. For example, the 10-26 Black "King"
  only rewords "Lose your King and you lose," and its "Pawn" just lacks the promotion
  sentence.
- **No duplicates.** A piece copied unchanged into a later match is listed once, under the
  match where it first appeared. The 2026-10-30 White Corolla is a copy of the 2026-10-28
  Black one.
- **Companions.** Helper pieces travel with their parent:
  - the Gardener brings the three Plant stages;
  - the Necromancer (10-26) brings its five Undead pieces;
  - the Necromancer (10-28) brings the Dead Body;
  - the Checker brings the Checker King.

  Disguise pieces that only exist to stand in for another piece, like the 10-28 Ninja Pawns,
  are listed only as companions of a parent entry. They are never listed as entries of
  their own. Each Ninja Pawn goes under the piece it reveals into: the Wizard (`bishop`),
  the Kamikaze-Knight (`knight`) or the Corolla (`rook`).
- **Snapshots are history.** Snapshots stay byte-exact and are never patched. Only the
  `icon` paths in `catalogue.json` are rewritten to `catalogue/...` paths. The catalogue is
  not a compatibility promise, so an engine change on `main` is never blocked because an
  old snapshot stops loading. The agent adapts old code to the current engine when it
  builds a catalogue piece (build step 3).
- **Secrecy guard.** `tools/catalogue.js add <name>` refuses a match if
  `origin/match/<name>-white` or `-black` still exists and isn't fully merged into
  `match/<name>`.
- **Newer catalogue on an older match.** A match branch only has the catalogue as it was
  when the match was created. To get newer entries, players run `git merge main` on the
  match branch, as with any template change.
- **The card remembers where it came from.** It stores this as a `from` field (see "Data").
- **The agent copies the code and the art** into the side's own folder.
- **Catalogue updates go to `main` through a pull request**, like other template changes.

## Data

### Folder layout

```
catalogue/
  catalogue.json                    the index the designer reads
  2026-10-28/
    black/
      pieces.js                     exact snapshot of that match's sides/black/pieces.js
      assets/...                    snapshot of that side's assets, if any
    white/
      pieces.js
  2026-10-30/ ...
```

The tool snapshots the **whole side file** rather than cutting out single pieces. Pieces
share helper functions and constants (cooldown helpers, Ninja wrappers, the Corolla's
`charge`), and cutting them out automatically would break. The agent reads the snapshot
and copies what the piece needs.

### `catalogue.json`

```json
{
  "version": 1,
  "entries": [
    {
      "id": "2026-10-28/black/rook",
      "match": "2026-10-28",
      "side": "black",
      "sideName": "Black",
      "key": "rook",
      "name": "2009 Toyota Corolla",
      "icon": "🚗",
      "royal": false,
      "description": "Moves like a Rook. Or CHARGE 🚗💨: ...",
      "customArt": null,
      "companions": []
    }
  ]
}
```

- `id` is `<match>/<side>/<key>` and never changes.
- `icon` is an emoji, or for art, a path inside the catalogue, like
  `catalogue/2026-10-26/white/assets/catapult.svg`. That way the drawer can display the art
  as a plain static file. The tool rewrites `sides/<side>/assets/` paths when it snapshots.
- `customArt` is copied from that match's `design.json` when the match had one, else `null`.
- `companions` lists other pieces, with the same fields as an entry except `companions`
  itself (`key`, `name`, `icon`, `royal`, `description`, `customArt`), that come along when
  this entry is added. A companion is never an entry of its own.
- Entries are ordered newest match first, then White before Black, then in the side
  file's piece order.

### Design file: the new `from` field

A piece in `sides/<color>/design.json` can now carry an optional `from`:

```json
{ "key": "rook", "name": "2009 Toyota Corolla", "icon": "🚗", "royal": false,
  "description": "...", "customArt": null, "from": "2026-10-28/black/rook" }
```

- Added companions get `from` as well, pointing at the parent's id plus `#<companion key>`,
  for example `2026-10-30/white/knight#plant_2`.
- `normalizeDesign` keeps `from` when it's a string and drops it otherwise.
- `from` is history, not a lock. It stays on the card when the player edits it, and the
  agent keeps it when it rewrites `design.json`.

## The designer drawer

- **Button:** "📚 From catalogue" next to "+ New piece." It opens a drawer from the right
  over the page, with a ✕ to close. Escape and clicking outside also close it.
- **Data:** a static `GET catalogue/catalogue.json`. No new API. If the file is missing or
  broken, the drawer says "No catalogue yet" and the rest of the designer works as usual.
- **Search** matches name and description, ignoring case.
- **Match chips:** "All" plus one chip per match, newest first.
- **Each entry** shows the icon or art, the name, "10-28 · Black", a note like "+3 Plant"
  when it has companions, and the first line of the description. Clicking an entry opens
  the full description. "Add" adds it.
- **Adding:**
  - The piece and its companions become new cards at the end of the list, with name, icon,
    royal flag, description, customArt and `from` filled in.
  - Keys are made with the existing `slugKey`, starting from the catalogue key. So a
    second `rook` becomes `rook_2`, and companion keys are de-duplicated the same way.
  - Pieces aren't placed on the board.
  - The drawer stays open, so you can add several pieces, and shows a brief "Added ✓".
  - Adding the same entry twice gives two independent copies.
- **Art in the designer:** while the card's icon is still a `catalogue/...` path, the art
  just displays from there.
- **Card tag:** a card with `from` shows a small "from 10-28 · Black" line, so the player
  can see it started from the catalogue.

The model work lives in `ui/designer-model.js`: `addFromCatalogue(design, entry)` returns
the new keys. It has unit tests like the existing model functions. The drawer UI lives in
`ui/designer.js` and `ui/designer.css`.

## Agent workflow (`AGENTS.md` and `README.md` changes)

### Building a catalogue piece

When a design piece has `from`:

1. Open `catalogue/<match>/<side>/pieces.js` and find the piece by its catalogue key, or
   the companion key after `#`. Copy its code and any helpers it uses into the side file,
   inside the wrapper.
2. Compare the card's current description with the catalogue entry's description. If they
   match, ask no rule questions about that piece. Otherwise, ask clarifying questions about
   the differences only, as usual.
3. Fix things that change between seats or matches:
   - type names in `spawn` and `transform`: the piece's key may have changed (`rook_2`),
     and `white:`/`black:` qualifiers may point at the wrong side now;
   - a hard-coded side, like `'black'` or `p.side === 'black'`;
   - text that names the old side, like "your own King" when the King was renamed;
   - engine API changes since that match.
4. Copy any art from `catalogue/.../assets/` into `sides/<color>/assets/`. Then point
   `icon` there in both `pieces.js` and `design.json`.
5. Run `node tools/check.js <color>` as always.

### Adding a finished match to the catalogue

"Finished" means the player says the match is over, or asks to add it. Both sides are
already merged on `match/<name>`, so nothing is secret. Only do this when the player asks.

1. Branch off `main`: `git checkout main && git pull && git checkout -b template/catalogue-<name>`.
2. Run `node tools/catalogue.js add <name>`. It reads `origin/match/<name>` with `git show`
   (no checkout needed) and does the following:
   - snapshots both sides' `pieces.js` and `assets/` into `catalogue/<name>/`;
   - loads each side through the engine from that same branch;
   - writes draft entries for every piece, with art paths rewritten;
   - leaves out stock chess pieces;
   - flags any piece whose name, icon and description match an existing entry as
     "possible duplicate."

   It prints a summary of the draft for the agent to check.
3. The agent reviews the draft. It turns helper pieces into `companions` of their parent,
   drops true duplicates, and checks that every entry's `description` is complete.
4. Run `node --test`. It hard-checks that:
   - `catalogue.json` is valid;
   - every entry's snapshot file exists;
   - every `catalogue/...` icon path exists.

   It also loads each snapshot through the current engine and checks that every entry and
   companion key exists in it. A snapshot that no longer loads after a later engine change
   is reported as a `todo` and doesn't fail the run (see "Snapshots are history").
5. Commit, push, and open a pull request into `main`.

### Rule changes

- `README.md` "Branch rules": `main` now also holds `catalogue/`, the library of past
  pieces. `sides/` on `main` stays plain chess. Match branches still never merge into
  `main`. Only the catalogue tool copies pieces from them, through a PR.
- `AGENTS.md`: the hard rule "edit only `sides/<your color>/`" still holds during design.
  Reading `catalogue/` is always allowed: it only holds finished, public matches.
- `docs/PIECE_API.md`: one paragraph pointing at the catalogue as a source of examples.

## Backfill

The first PR includes the catalogue for 2026-10-26, 2026-10-28 and 2026-10-30, built with
the new tool and reviewed as above. 2026-10-23 was plain chess, so it adds nothing. The
2026-10-30 Black side is snapshotted after its encoding fix, which is already on
`origin/match/2026-10-30`.

The reviewer loaded all three matches' side files on `main`'s current engine and ran 150
random games each, with no crashes. So the backfill works today, and the 10-30 White
Corolla matches the 10-28 Black one, so the duplicate check catches it.

## Testing

- `test/designer-model.test.js`: `addFromCatalogue` adds the piece and its companions,
  fills every field, avoids key clashes, keeps `from`, and leaves setup alone.
  `normalizeDesign` keeps a string `from` and drops a non-string one.
- `test/catalogue.test.js`: the checks in step 4 above, plus a run of the tool's pure
  parts (entry drafting, stock-piece filter, path rewriting) on small fixtures.
- Manual: open the designer, add a piece with companions and art, save, and confirm the
  design file. Then have an agent build it on a scratch match branch and run
  `node tools/check.js`.

## Left to the builder

- Exact drawer styling. It should match the designer's existing look and the option B
  mockup.
- How the drawer shows a long description (expand in place or a popover).
- The tool's exact output format and flags.
- Whether `tools/catalogue.js` shares loading code with `tools/check.js`.
