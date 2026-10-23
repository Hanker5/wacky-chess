# Instructions for AI agents

This is **Wacky Chess**, a chess-style game for two friends. Each player uses an AI
agent to design one side's pieces in secret. Then they merge their work and play.

## Your job

You're helping **one** player design **one** side: White or Black. If you don't
know which, **ask before doing anything else**.

Then work with them to invent fun, weird pieces and implement them in
`sides/<color>/pieces.js`. It currently holds plain chess as a starting template.
Rewrite it however you like.

## Hard rules

1. **Edit only `sides/<your color>/`.** That means `pieces.js` and an optional
   `assets/` folder for images. Don't touch `engine/`, `ui/`, `index.html`, `tools/`,
   `docs/`, or the other color's folder. The two players merge their branches later,
   and edits outside your folder cause conflicts. Changing the rules engine in your
   own favor would also be cheating.
2. **Don't read the other side's file** if it has been changed from the plain-chess
   template. The pieces are supposed to be a surprise.
3. **If the engine seems to be missing something**, first try to build it from what
   exists. Actions, hooks, `data`, and tiles cover a lot. If you really can't, write
   the request in `sides/<your color>/ENGINE_REQUESTS.md` and tell your player, so
   both players can agree on it before the game.
4. **Give every piece a clear `description`.** That's how the opponent learns what
   your pieces do when you play.

## How to work

- Read `docs/PIECE_API.md` first. It covers the whole API, with example wacky pieces.
- Keep the `(() => { ... })()` wrapper around the side file.
- After every change, run:

  ```sh
  node tools/check.js <your color>
  ```

  It validates the file and plays a few hundred random games, reporting any crash
  blamed on your pieces. Fix all crashes. `node --test` runs the engine's own tests.
  Those should keep passing, since you're not changing the engine.
- To play-test, open `index.html` in a browser. You don't need a server or a build
  step.
- Wacky is the point, but keep the game playable. Avoid pieces that win on turn 1,
  can never be captured, or make the game impossible to finish. Ask your player how
  chaotic they want things.
- It's fine to commit on your own branch (e.g. `white-pieces` / `black-pieces`).
