# Refraction — Architecture

## The one structural decision

**The game engine never touches the DOM, WebGL, or `window`.**

`src/core/` is pure TypeScript: given a seed and a list of inputs, it produces a
game. It has no clock of its own — time is passed in. It has no renderer — it
exposes state to be read.

Everything else follows from that:

- The full rule set is unit-testable in milliseconds, headlessly, with no
  browser and no canvas.
- A run is reproducible from `(seed, input log)`, so a bug report is a file.
- The renderer can be rewritten, or a second one added, without risking a single
  gameplay rule.
- Rendering can drop frames without the simulation drifting.

This matters more here than in most games. The proposal's central constraint is
that the geometry must be completely trustworthy — that a turn always reveals
exactly what the structure should produce. That is a property of pure functions
over integer coordinates, and it is only cheap to prove if those functions are
isolated from everything else.

## Layout

```
src/
  core/                 pure simulation — no DOM, no WebGL, no globals
    constants.ts        board dimensions, compile-time square-footprint guard
    types.ts            Cell, ViewCell, Face, TurnDirection
    projection.ts       THE projection contract — faces, turns, lines
    spectrum.ts         OKLCH depth ramp, gamut mapping, apparent size
    rng.ts              seeded deterministic RNG
    board.ts            voxel occupancy, per-column gravity, line clearing
    pieces.ts           tetracube catalogue, rotation, orientations
    dealer.ts           seeded piece bag and Lane Dealer
    stages.ts           the Red -> Violet -> Ultraviolet curve
    scoring.ts          line values, chain and cascade multipliers
    game.ts             state machine, turn sequence, game over
    ascii.ts            text rendering of any face, for tests
  render/               Three.js — reads core state, never writes it
    scene.ts            camera, lights, the well
    voxels.ts           instanced cubes, per-frame colour and size
    game-renderer.ts    per-frame update and the turn camera
  ui/hud.ts             HUD
  input.ts              keyboard, DAS/ARR
  audio/                (M4) WebAudio
  main.ts               composition root, fixed-timestep loop
tests/
  unit/                 Vitest, against src/core
  e2e/                  Playwright, against the built bundle
docs/
```

## Data flow

```
input events ──▶ InputMap ──▶ intents ──▶ core/game.ts ──▶ GameState
                                                              │
                                    ┌─────────────────────────┤
                                    ▼                         ▼
                              render/ (reads)            ui/ (reads)
```

State flows one way. The renderer and HUD are pure readers. Nothing outside
`core/` mutates game state.

## The projection contract

`src/core/projection.ts` is the module every other module defers to. It owns:

- which world axis is on-screen horizontal, per face
- which world axis is depth, per face
- the sign conventions that make opposite faces mirror
- the turn ring and its camera yaw deltas
- the continuous depth function used mid-turn

Two properties keep the geometry honest, and both are tested:

1. `toView` and `fromView` are exact inverses on every cell of every face.
2. `depthParameterAtYaw` evaluated at a face's exact yaw reproduces that face's
   discrete lane index — so the colour a cube has _during_ a turn converges
   exactly on the colour it has when the turn snaps. No pop, no fudge.

The renderer's camera is driven from `FACE_YAW`, not from its own constants.
There is no second copy of this geometry anywhere in the codebase.

## Time

Fixed-timestep simulation at 60 Hz with an accumulator; rendering interpolates
between the last two states. The simulation never sees wall-clock time, only the
fixed step, which is what makes replays exact.

## Rendering

One `InstancedMesh` for every cube on the board, with per-instance colour and
scale attributes. At 8 × 18 × 8 the worst case is 1152 instances — one draw
call, trivially within budget, leaving headroom for effects.

Depth is read through four redundant channels (colour, apparent size, rim light,
floor grid) so no single one carries the whole load. See §9 and §10 of the
design spec.

Colour is computed from live camera distance every frame rather than from the
snapped face, which is what makes the turn animation continuous instead of a
crossfade between two palettes.

## Determinism

Two independent seeded streams, forked from the run seed: one for the piece bag,
one for the lane bag. Cosmetic randomness draws from a third fork so that
changing a particle effect can never alter gameplay.
