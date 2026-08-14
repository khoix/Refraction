# Refraction

A perspective-shifting falling-block puzzle game with real depth and colour.

Pieces fall into a vertical playfield and completing horizontal lines clears
them. But the board has **depth** — it is an 8 × 18 × 8 voxel structure, and
every few cleared lines the whole thing turns 90° around its vertical axis to
reveal another face of the same object.

Rotation never rearranges anything. It only changes which horizontal axis you
are playing. A gap that looks unreachable may be trivial after a turn; a line
you could not complete from the front may already be complete from the side.

The board presents as flat 2D. Only while it turns do the tiles become visibly
cubes — depth is something the rotation reveals, not something the still frame
gives away.

Depth is communicated through the visible spectrum — **red is near, violet is
far** — and through nothing else. A cube eight lanes back is exactly the same
size on screen as one at the front. The projection is orthographic throughout,
so distance never shrinks anything; the same cube simply reads red from one face
and violet from the opposite one without ever moving.

> **Position is absolute. Colour is relative.**

## Status

**M5 — Progression.** The game is playable, the reveal is visible, it has sound
and weight, and it now has an arc: lines that exist only along the hidden axis
glow through the whole rotation and clear on arrival, closing a four-face chain
blooms the board toward white, and a run climbs a seven-stage arc and on into an
endless tail. Modes, persistence and the comprehension tools come next.

Stages are numbered, not named, and the interface carries no hue at all: on this
screen a colour is a claim about depth, so nothing else is allowed to make one.

Controls: arrows or WASD to move, `Z`/`X` to rotate, `Space` to hard drop,
`C` to hold, `←`/`→` to choose a face when the Shift meter fills, `M` to mute.

See [`release_notes.md`](release_notes.md) for the milestone log and
[`docs/PLAN.md`](docs/PLAN.md) for the roadmap.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
```

## Commands

| Command                 | What it does                   |
| ----------------------- | ------------------------------ |
| `npm run dev`           | Dev server with hot reload     |
| `npm run build`         | Production bundle into `dist/` |
| `npm run preview`       | Serve the production bundle    |
| `npm run verify`        | typecheck → lint → unit tests  |
| `npm run verify:full`   | `verify` → build → e2e tests   |
| `npm test`              | Unit tests                     |
| `npm run test:e2e`      | End-to-end tests               |
| `npm run test:coverage` | Coverage against `src/core`    |

`npm run verify:full` is the gate every milestone push has to clear.

## Documentation

| Document                                       | Contents                                                                                                                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`docs/DESIGN.md`](docs/DESIGN.md)             | The implementation spec. Board, projection, pieces, scoring, progression, accessibility. Gaps in the original proposal are marked **[GAP]** with the reasoning. |
| [`docs/PLAN.md`](docs/PLAN.md)                 | Ten milestones, M0–M9.                                                                                                                                          |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Module layout and the pure-core decision.                                                                                                                       |
| [`docs/TESTING.md`](docs/TESTING.md)           | Test strategy, layers, conventions.                                                                                                                             |
| [`release_notes.md`](release_notes.md)         | Milestone log, newest first.                                                                                                                                    |

## How it is built

The game engine in `src/core/` is pure TypeScript — no DOM, no WebGL, no
globals, no clock of its own. A run is fully determined by `(seed, input log)`,
which means the entire rule set is testable headlessly in milliseconds and any
run is exactly reproducible.

That isolation is what makes the game's central promise cheap to keep: turning
the board must always reveal exactly what the structure should produce. That is
a property of pure functions over integer coordinates, and it is proven by test
rather than checked by eye.

Rendering is Three.js on top, reading core state and never writing it.
