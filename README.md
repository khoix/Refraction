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

**M9 — Modes and Meta.** A complete game: title, six modes, pause, settings,
seeded challenges, and scores that survive a reload. The board floats in a dark
room made of light — grey shafts, white dust, wireframe at distance — which
answers play by getting brighter, never by changing colour. The comprehension
tools come next.

| Mode               | What it is                                          |
| ------------------ | --------------------------------------------------- |
| **Ascent**         | The full arc. Starts flat and teaches itself.       |
| **Endless**        | Everything unlocked, accelerating without end.      |
| **Prism**          | The board turns constantly. Chains are everything.  |
| **Flatland**       | Flat pieces only. The board still turns.            |
| **Blind Spectrum** | No depth colour. Unlocked by reaching stage 5.      |
| **Zen**            | No failure. Build and turn for as long as you like. |

A challenge code is seven characters naming a mode and a seed. Two people
entering the same one get bit-identical runs; the daily code is derived from the
UTC date by every copy of the game independently.

Stages are numbered, not named, and the only hue on screen belongs to a cube.
The room is light and the HUD is ink; neither makes a colour claim, so any
colour you see is a depth claim and can be trusted as one.

Controls: arrows or WASD to move, `Z`/`X` to rotate, `Space` to hard drop,
`C` to hold, `←`/`→` to choose a face when the Shift meter fills, `Esc` to
pause, `M` to mute, `Enter` to restart after a game over.

Flags: `?mode=prism` and `?challenge=CODE` open a run directly, both still
respecting the unlock; `?pieces=experimental` deals the M6.5 playtest vocabulary (screws from
stage 1, a tricube, non-planar pentacubes); `?reducedMotion=1` forces the
reduced-motion and photosensitivity guards.

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
| [`docs/PLAN.md`](docs/PLAN.md)                 | Thirteen milestones, M0–M12.                                                                                                                                    |
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
