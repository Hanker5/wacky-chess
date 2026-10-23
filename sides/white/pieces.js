// White's pieces. This whole folder belongs to the White player.
// Read AGENTS.md and docs/PIECE_API.md before changing anything.
//
// Right now this is plain chess so the game is playable out of the box.
// Replace it with your own wacky pieces!
//
// Keep everything inside this (() => { ... })() wrapper: both sides' files share
// one page, so top-level variables would collide with the other player's file.
(() => {
  WackyChess.defineSide('white', {
    name: 'White',

    pieces: {
      king: {
        name: 'King',
        icon: '♚',
        royal: true,
        description: 'Moves one square in any direction. Lose all your royal pieces and you lose.',
        moves: (p, g) => g.leap(p, g.DIRS.ALL),
      },
      queen: {
        name: 'Queen',
        icon: '♛',
        description: 'Slides any distance in any direction.',
        moves: (p, g) => g.slide(p, g.DIRS.ALL),
      },
      rook: {
        name: 'Rook',
        icon: '♜',
        description: 'Slides any distance in a straight line.',
        moves: (p, g) => g.slide(p, g.DIRS.ORTHO),
      },
      bishop: {
        name: 'Bishop',
        icon: '♝',
        description: 'Slides any distance diagonally.',
        moves: (p, g) => g.slide(p, g.DIRS.DIAG),
      },
      knight: {
        name: 'Knight',
        icon: '♞',
        description: 'Jumps in an L shape, over anything in the way.',
        moves: (p, g) => g.leap(p, g.DIRS.KNIGHT),
      },
      pawn: {
        name: 'Pawn',
        icon: '♟',
        description: 'Moves 1 forward (2 on its first move) and captures diagonally forward. Becomes a Queen on the far rank.',
        moves: (p, g) => [
          ...g.slide(p, [[0, 1]], { max: p.moveCount === 0 ? 2 : 1, capture: false }),
          ...g.leap(p, [[-1, 1], [1, 1]], { capture: 'only' }),
        ],
        onMove(p, g) {
          if (g.rank(p) === 8) {
            g.transform(p, 'queen');
            g.log(`${g.nameOf(p)} promoted!`);
          }
        },
      },
    },

    // Read from your own seat: first row is your back rank, listed left to right.
    setup: [
      ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'],
      ['pawn', 'pawn', 'pawn', 'pawn', 'pawn', 'pawn', 'pawn', 'pawn'],
    ],
  });
})();
