# Engine requests (White)

## Hide the board from a blinded side

White's Light piece (💡) can blind the opponent for two of their turns: "they cannot
see the pieces on the board". The rules side is done in `pieces.js`, but the engine and
UI have no way to hide pieces, and sides can't touch `ui/`.

**Current state:** while the opponent is blinded, a Light piece of White has
`data.blind === true` (set at the start of the blinded side's turns, and `false`
otherwise). The game log also says "blinded". Nothing is hidden on screen yet.

**Request:** in `ui/ui.js`, while it is the turn of side S and any piece of the *other*
side has `data.blind === true`, draw the board without piece tokens (squares, tiles and
move hints can still show) for that turn. A generic version: any piece with
`data.blind === true` blinds the side that is not its owner.
