# Refraction

A perspective-shifting falling-block puzzle game with real depth and colour.

Pieces fall into a vertical playfield and completing horizontal lines clears
them. But the board has **depth** — it is an 8 × 18 × 8 voxel structure, and
every few cleared lines the whole thing turns 90° around its vertical axis to
reveal another face of the same object.

Rotation never rearranges anything. It only changes which horizontal axis you
are playing. A gap that looks unreachable may be trivial after a turn; a line
you could not complete from the front may already be complete from the side.

Depth is communicated through the visible spectrum — **red is near, violet is
far** — so a cube can read red from one face and violet from the opposite one
without ever moving.

> **Position is absolute. Colour is relative.**

## Status

**M0 — Foundation.** Toolchain, geometry contract, and the depth-colour system,
all under test. The playfield arrives in M1–M2.

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
