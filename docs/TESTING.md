# Refraction — Testing

Tests ship with every milestone, in the same push as the code they cover.

## Commands

| Command                 | What it runs                                          |
| ----------------------- | ----------------------------------------------------- |
| `npm run verify`        | typecheck → lint → unit tests. The pre-commit gate.   |
| `npm run verify:full`   | `verify` → production build → e2e. The pre-push gate. |
| `npm test`              | Vitest, once.                                         |
| `npm run test:watch`    | Vitest, watching.                                     |
| `npm run test:coverage` | Coverage against `src/core` with thresholds.          |
| `npm run test:e2e`      | Playwright against the built bundle.                  |
| `npm run typecheck`     | `tsc --noEmit`.                                       |
| `npm run lint`          | ESLint.                                               |

**No milestone is pushed until `npm run verify:full` passes.**

## Layers

### Unit — `tests/unit/`, Vitest

Covers `src/core`. No DOM, no WebGL, no timers. Fast enough to run on save.

Coverage thresholds on `src/core`: 85% lines / functions / statements, 80%
branches. The gameplay rules are the thing that has to be right; the renderer is
covered visually instead.

### End-to-end — `tests/e2e/`, Playwright

Runs against the real production build via `npm run build && npm run preview`,
so it catches bundling and asset problems that unit tests cannot.

Uses a pre-provisioned Chromium at `/opt/pw-browsers/chromium` when present, so
`playwright install` is never needed in CI.

**Settings and controls.** Desktop e2e expects `.controls-editor__table` beside
the preferences column; touch-primary contexts hide it and open Controls through
the mobile nav row (`.settings-nav-controls`) into `settings-controls`. Panel
back is the masthead button (`aria-label="Back"`), not a bottom BACK row — tests
that walk keyboard focus or leave Settings should target that control.

### Visual regression — from M2

Playwright screenshots with a 2% perceptual tolerance: each of the four faces,
each stage palette, the turn transition at fixed interpolation points, and each
accessibility ramp. Rendering is GPU-sensitive, hence the tolerance.

### Replay — from M1

The strongest tool available here. Because `src/core` is pure and seeded, a
whole game is `(seed, input log)`. Replays are stored as fixtures and asserted
to produce identical final board state, score, and face. Any accidental change
to a rule breaks them immediately.

## What is worth testing here

The geometry, above everything. The proposal's most important constraint is that
a turn must always reveal exactly what the structure should produce — no fudged
silhouettes, no impossible projections. That is not a thing to verify by eye.

Properties currently proven, and to be extended each milestone:

- `toView` / `fromView` are exact inverses on every cell of every face.
- The footprint maps onto every (column, lane) pair exactly once, per face.
- Opposite faces mirror columns and invert depth lanes.
- A front-facing line reads edge-on from the side.
- The same physical line is playable from the opposite face at the mirrored lane.
- Continuous mid-turn depth converges exactly on the discrete lane index at each
  face's yaw — the colour never pops on snap.
- The spectrum ramp is continuous, in gamut, and passes through all seven bands.
- Seeded streams are reproducible, forkable, and restorable from a snapshot.

## Conventions

- Test names state the behaviour, not the function: _"opposite faces mirror
  columns"_, not _"toView works"_.
- Assert on properties and invariants over hand-computed values where possible.
  Invariants survive refactors; magic numbers do not.
- No `sleep`. Playwright web-assertions auto-retry.
- A test that fails is investigated, not loosened. Two thresholds in the
  spectrum suite were tightened rather than relaxed after they caught a genuine
  gamut-clipping seam in the ramp.
