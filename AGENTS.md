# Instructions for AI agents

This is **Wacky Chess**, a chess-style game for two friends. Each player uses an AI
agent to design one side's pieces in secret. Then they merge their work and play.

## Your job

You're helping **one** player design **one** side: White or Black. If you don't
know which, **ask before doing anything else**.

Then work with them to invent fun, weird pieces and implement them in
`sides/<color>/pieces.js`. It currently holds plain chess as a starting template.
Rewrite it however you like.

## Branches: check before you edit anything

Every match lives on its own branches, and `main` is only the base template. (See
"Branch rules" in `README.md` for the full picture.)

- `main` is the template. **Never put custom pieces on `main`, and never merge a
  match into `main`.**
- `match/<name>` is one match, with both finished sides merged together.
- `match/<name>-white` / `match/<name>-black` is where each player designs their side.

Before writing any piece code, run `git branch --show-current`:

- **On `match/<name>-<your color>`**: good, work here.
- **On `main`, or anything else**: stop. Ask your player for the match name (the
  default is today's date, like `2026-10-23`), then get onto the right branch:
  ```sh
  git fetch
  # Use the existing match branch if the other player already made it:
  git checkout match/<name> 2>/dev/null || { git checkout main && git pull && git checkout -b match/<name> && git push -u origin match/<name>; }
  git checkout -b match/<name>-<your color>
  git push -u origin match/<name>-<your color>
  ```
- **On the other color's branch, or on `match/<name>` itself**: stop and ask.
  Don't design there.

Commit and push to your player branch as you go. Merging the two player branches
into `match/<name>` happens when both players are done. Do that only when your
player asks.

## Hard rules

1. **Edit only `sides/<your color>/`.** That means `pieces.js` and an optional
   `assets/` folder for images. Don't touch `engine/`, `ui/`, `index.html`, `tools/`,
   `docs/`, or the other color's folder. The two players merge their branches later,
   and edits outside your folder cause conflicts. Changing the rules engine in your
   own favor would also be cheating.
2. **Don't peek at the other side.** Don't check out, diff, or read the other color's
   player branch, and don't read their `sides/` file if it differs from the plain-chess
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
- To play-test, run `npm start` and open http://localhost:8000. Reload after each
  edit. Opening `index.html` from disk fails in sandboxed (Flatpak or Snap) browsers.
- Wacky is the point, but keep the game playable. Avoid pieces that win on turn 1,
  can never be captured, or make the game impossible to finish. Ask your player how
  chaotic they want things.
- **Template changes** (an engine bug fix, or a new engine feature both players agreed
  on) don't belong on a match branch. They go on a separate branch off `main`, through
  a pull request into `main`. A match picks them up with `git merge main`. Only do this
  when your player explicitly asks.
