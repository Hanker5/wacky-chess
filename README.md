# Wacky Chess

A chess-style game where each player invents their own ridiculous pieces.

The board, turns, and captures work like chess. Everything else is up to you. White's
pieces are designed by one player and Black's by the other, each with their own AI
agent, in secret. Then you merge and find out what the other person made.

## Play

Open `index.html` in a browser. You don't need to install or build anything. It's
hot-seat play on one screen.

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

## How the split works

1. Both players clone this repo.
2. Each player makes a branch (`white-pieces` or `black-pieces`) and tells their AI
   agent which color they are. The agent reads `AGENTS.md` and `docs/PIECE_API.md`.
3. The agent designs pieces with you in `sides/<color>/pieces.js` and only touches
   that folder.
4. Check your work with `node tools/check.js <color>` (it fuzzes random games looking
   for crashes) and play-test by opening `index.html`.
5. When you're both done, merge both branches into `main`. The folders don't overlap,
   so the merge is clean. Then play!

## Layout

```
index.html              the game page
engine/engine.js        rules engine (shared — don't edit while split)
ui/                     board UI
sides/white/pieces.js   White's pieces  ← player 1
sides/black/pieces.js   Black's pieces  ← player 2
docs/PIECE_API.md       how to define pieces, with examples
tools/check.js          validate + fuzz the side files
test/                   engine tests (node --test)
```
