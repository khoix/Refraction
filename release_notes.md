# Release Notes

Milestone log for **Refraction**. Newest first. One entry per pushed milestone.

Every entry records what shipped, what was tested, and any decision worth
revisiting later. The full milestone roadmap lives in [`docs/PLAN.md`](docs/PLAN.md).

---

## M0 — Foundation

**Pushed:** 2026-08-13 · branch `claude/webapp-game-plan-vtrxqx`

Project skeleton and the geometry contract the rest of the game is built on.
No playfield yet — that is M1 and M2.

### Shipped

**Planning**

- `docs/DESIGN.md` — implementation spec. Resolves the gameplay proposal into
  testable rules and marks every gap that had to be filled with **[GAP]**.
- `docs/PLAN.md` — ten milestones, M0–M9, each a self-contained push.
- `docs/ARCHITECTURE.md` — module layout and the pure-core decision.
- `docs/TESTING.md` — test strategy and commands.

**Core modules**

- `src/core/constants.ts` — board dimensions (8 × 18 × 8) with a compile-time
  guard that width and depth stay equal.
- `src/core/projection.ts` — the projection contract. Faces, turn ring, screen
  and depth axis mapping, line enumeration, continuous mid-turn depth.
- `src/core/spectrum.ts` — OKLCH depth ramp with chroma-reduction gamut mapping,
  seven named bands, banded and continuous modes, apparent-size scaling.
- `src/core/rng.ts` — seeded SplitMix32 with forking and state snapshots.

**Toolchain**

- Vite 8, TypeScript 5.7 strict (`noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`), Vitest 4, Playwright 1.62, ESLint 9, Prettier.
- `npm run verify` (typecheck → lint → unit) and `npm run verify:full`
  (+ build → e2e) as the commit and push gates.
- CI runs the full gate on push and pull request. No deployment step —
  GitHub Pages is deliberately not enabled.

**Boot screen** — a title card that renders the depth ramp from the real
`spectrum.ts`, so the core modules are exercised in a browser from day one.

### Tested

58 unit tests, 5 end-to-end tests, all passing.

- **Projection (21)** — `toView`/`fromView` are exact inverses on every cell of
  every face; the footprint maps onto every (column, lane) pair exactly once;
  opposite faces mirror columns and invert lanes; a front-facing line reads
  edge-on from the side; the same physical line is playable from the opposite
  face at the mirrored lane; continuous mid-turn depth converges exactly on the
  discrete lane index at each face's yaw.
- **Spectrum (21)** — ramp is continuous, in gamut, and passes exactly through
  all seven named bands; out-of-gamut chroma maps to the gamut boundary rather
  than clipping channels; eight lanes spread evenly; apparent size decreases
  with distance.
- **RNG (16)** — reproducible from a seed, unbiased across buckets, forkable,
  restorable from a state snapshot.
- **E2E (5)** — boot screen renders, lanes run red to violet, no console errors,
  no horizontal overflow at 390 px.

### Decisions worth revisiting

- **Depth-lane assignment.** The proposal never says which depth lane a piece
  occupies, and taken literally the game cannot work — every piece would land in
  one lane and cross-axis lines could never complete, which removes Refraction
  Clears entirely. Resolved with a **Lane Dealer** (each piece is dealt an
  anchor lane from a shuffled 8-lane bag) plus **Depth Nudge** unlocked at
  Stage 4. See `docs/DESIGN.md` §4.2. This is the single most consequential gap
  filled and the one most worth challenging.
- **J/L and S/Z are the same tetracube** in 3D, since rotation about the long
  axis is legal. Spawn orientation is randomised so they still present as seven
  familiar silhouettes. §4.1.
- **Camera elevation of 8°** rather than dead-on. A head-on camera makes depth
  nearly unreadable in still frames and leaves colour carrying the entire load.
  The projection invariants are unaffected. §2.1.
- **Per-column naive gravity** after a clear, matching classic falling-block
  behaviour rather than rigid-body piece gravity. §3.1.

### Fixed during the milestone

- The first spectrum ramp had a visible seam near the green→blue traverse: the
  path left the sRGB gamut and per-channel clamping produced a hard step. Fixed
  properly with chroma-reduction gamut mapping plus an unnamed cyan waypoint
  that keeps the path in gamut. Maximum step delta dropped from 0.099 to 0.018.
- The boot screen's `<pre>` status block overflowed the viewport at 390 px.
  Fixed in layout rather than by relaxing the assertion.

### Next

**M1 — Voxel Core.** The whole game, playable headlessly: board, tetracube
catalogue, rotation and kicks, line detection, cascades, seeded dealers,
game-over. Plus an ASCII debug renderer for tests.
