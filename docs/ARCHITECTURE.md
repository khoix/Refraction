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
    board.ts            voxel occupancy (dense Uint8Array), per-column gravity,
                        line clearing
    pieces.ts           polycube catalogues (standard and experimental),
                        rotation, orientations
    dealer.ts           seeded piece bag, lane draw with starvation floor,
                        tier-4 spawn orientations
    stages.ts           seven numbered stages, then the endless tail
    scoring.ts          line values, chain and cascade multipliers
    game.ts             state machine, turn sequence, first contact, game over
    ascii.ts            text rendering of any face, for tests
  render/               Three.js — reads core state, never writes it
    scene.ts            camera, lights, the well
    voxels.ts           instanced cube layers, per-frame colour
    environment.ts      reactive achromatic backdrop, clear debris
    game-renderer.ts    per-frame update, the turn camera, selective bloom
  ui/hud.ts             HUD
  input.ts              keyboard, DAS/ARR
  audio/
    tones.ts            what to play, as pure data -- tested
    audio.ts            WebAudio plumbing, deliberately thin
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

Fixed-timestep simulation at 60 Hz with an accumulator. The renderer draws the
latest state each animation frame and drives its own presentational timers
(camera turn, flashes, environment) from the frame delta. The simulation never
sees wall-clock time, only the fixed step, which is what makes replays exact.

## Rendering

Every cube layer is an `InstancedMesh` over one shared rounded-box geometry:
the settled board, the active piece, the ghost, the clear glow, the occluded
silhouettes of the active piece and ghost (drawn only where the depth test
fails), the first-contact X-ray shell and core, and the lock flash. At
8 × 18 × 8 the settled board's worst case is 1152 instances; the other layers
are 8 instances each. A handful of draw calls, trivially within budget.

Depth is communicated by colour and by nothing else — apparent size, distance
haze and every other familiar cue is deliberately withheld. See §2.1 of the
design spec. Colour is computed from live camera distance every frame rather
than from the snapped face, which is what makes the turn animation continuous
instead of a crossfade between two palettes.

Bloom is a real post-process pass, thresholded so only the clear glow and the
Prism whiteout can reach it, and the composer runs only while such a pixel can
exist; ordinary play renders without it.

The environment renders in the opaque pass with a negative render order, no
depth writes, and additive brightness in place of opacity, so board pixels
always paint over it — it is strictly a backdrop and can never sit between
the player and a cube.

## Determinism

Three independent seeded streams, forked from the run seed: the piece bag, the
lane draw, and tier-4 spawn orientations. Cosmetic randomness lives entirely
outside `src/core/` in the render layer, where it cannot alter gameplay.
