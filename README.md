# Wacky Chess

A chess-style game where each player invents their own ridiculous pieces.

The board, turns, and captures work like chess. Everything else is up to you. White's
pieces are designed by one player and Black's by the other, each with their own AI
agent, in secret. Then you merge and find out what the other person made.

## Play

```sh
npm start        # or: node tools/serve.js
```

Then open **http://localhost:8000**. All you need is Node. There's nothing to install
or build. It's hot-seat play on one screen.

> Double-clicking `index.html` also works in some browsers. It **doesn't** work in
> sandboxed Flatpak or Snap browsers (the default on Bazzite, Fedora Silverblue, and
> Ubuntu), which only get that one file and show a "Loading…" message forever. Use
> `npm start`.

- Click your piece to see its moves. Dots mean move, red rings mean capture, and
  dashed purple boxes mean special moves.
- Click an enemy piece to preview where it could go.
- When a square has several possible moves (say, *move* and *explode*), you get a
  menu.
- The **Piece guide** at the bottom explains every piece on both sides.

### Rules

- White moves first. Each turn, you move one piece. Landing on an enemy captures it,
  unless a piece's special rules say otherwise.
- There's no check or checkmate. **You lose when all your royal (👑) pieces are
  captured.** A side with no royal piece types loses when every piece is gone.
- You also lose if you have no legal moves on your turn.
- Anything else is defined by the pieces themselves.

## Branch rules: every match is its own branch

`main` is the **base template**: the engine, the UI, the docs, and two plain-chess
sides. Custom pieces never go on `main`. Each match gets its own branches, so every
game you've ever played stays playable later, with exactly the pieces it had.

| Branch | What's on it |
|---|---|
| `main` | The template. Only engine, UI, docs, and tooling changes, and only when both players agree. Both `sides/` files stay plain chess. |
| `match/<name>` | One match: both players' finished sides, merged together. Play the game from here. |
| `match/<name>-white` | White's work in progress for that match. Only `sides/white/` changes. Deleted once the match starts. |
| `match/<name>-black` | Black's work in progress for that match. Only `sides/black/` changes. Deleted once the match starts. |

`<name>` is the match date, like `match/2026-10-23`. Add a nickname if you want, like
`match/2026-10-23-goblins`.

Never merge a `match/...` branch into `main`. Match branches never merge into each
other either. Each one is a separate game.

### Playing a match

1. **Start the match** (either player, once):
   ```sh
   git checkout main && git pull
   git checkout -b match/2026-10-23
   git push -u origin match/2026-10-23
   ```
2. **Each player branches off the match** for their color:
   ```sh
   git fetch && git checkout match/2026-10-23
   git checkout -b match/2026-10-23-black      # or -white
   git push -u origin match/2026-10-23-black
   ```
3. **Design in secret.** Run `npm start` and open
   **http://localhost:8000/designer.html** to sketch your side: make piece cards, pick
   emojis, describe what each piece does in plain English, ask for custom art, and drag
   pieces onto your starting rows. Saving writes `sides/<color>/design.json`. Then tell
   your AI agent which color you are and ask it to build your design. It reads
   `AGENTS.md` and `docs/PIECE_API.md`, asks you questions about each piece, then works
   only in `sides/<color>/`. (You can also skip the designer and describe pieces in chat.) Check
   the work with `node tools/check.js <color>` (it fuzzes random games looking for
   crashes) and play-test with `npm start`. Commit and push to your player
   branch as you go. Don't look at the other player's branch.
4. **Bring it together.** When you're both done, merge both player branches into
   the match branch (a pull request into `match/2026-10-23` is easiest). The two
   players change different folders, so the merges are clean.
5. **Play** from the match branch: `git checkout match/2026-10-23`, then `npm start`.
6. **Clean up.** Once the match has started, the player branches have done their job.
   Make sure each one is fully merged into the match branch, then delete it locally
   and on GitHub (your agent can do this, see `AGENTS.md`). After that, tweaks to your
   side go straight onto `match/2026-10-23`, still only in your own `sides/` folder.

### Changing the template

Did you find an engine bug, or want a new feature for pieces? Make the change on a
normal branch off `main` and open a pull request into `main` that both players
agree on. To use it in a match that's already running, merge `main` into that
match's branches (`git merge main`). Never go the other way.

## Layout

```
index.html              the game page
engine/engine.js        rules engine (template; changed only on main)
ui/                     board UI
sides/white/pieces.js   White's pieces  ← player 1
sides/black/pieces.js   Black's pieces  ← player 2
docs/PIECE_API.md       how to define pieces, with examples
tools/check.js          validate + fuzz the side files
tools/serve.js          local server for playing (npm start)
test/                   engine tests (node --test)
```
