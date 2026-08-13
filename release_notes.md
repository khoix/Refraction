# Release Notes

Milestone log for **Refraction**. Newest first. One entry per pushed milestone.

Every entry records what shipped, what was tested, and any decision worth
revisiting later. The full milestone roadmap lives in [`docs/PLAN.md`](docs/PLAN.md).

---

## M1 + M2 — Voxel Core and First Light

**Branch:** `claude/webapp-game-plan-vtrxqx`

The game is playable. Pieces fall, lines clear, the board turns, and a line that
only exists along the hidden axis clears when you turn onto it.

### Shipped

**M1 — the engine, pure and headless**

- `board.ts` — voxel occupancy, line detection per face, per-column gravity.
- `pieces.ts` — the eight free tetracubes, rotation about all three axes,
  orientation enumeration, connectivity and planarity tests.
- `dealer.ts` — seeded piece bag plus the **Lane Dealer** that assigns each
  piece its depth lane.
- `stages.ts` — the Red → Violet curve and the endless Ultraviolet tier.
- `scoring.ts` — line values, refraction, chain, cascade and Prism multipliers.
- `game.ts` — state machine: gravity, lock delay with the 15-reset rule, hold,
  kicks, the turn sequence, cascades, top-out and block-out.
- `ascii.ts` — text rendering of any face, which is what makes the projection
  testable by inspection.

**M2 — the renderer**

- Three.js scene driven from `FACE_YAW`, so the camera can never disagree with
  the engine's geometry.
- One `InstancedMesh` of bevelled cubes for the whole board — a single draw call.
- Colour and apparent size recomputed every frame from **live camera distance**,
  not from the snapped face.
- The well: lane-tinted floor grid, corner posts, contact plane.
- Ghost piece at its true landing depth; active piece; HUD with score, lines,
  stage, face, Shift meter, next and hold; turn prompt and game-over overlay.
- Keyboard input with DAS/ARR and soft-drop repeat, fixed-timestep loop.

**Landed early from M3:** the 750 ms turn animation, with continuous
recolouring and parallax separation. The camera needed yaw interpolation
regardless, and because colour follows live camera distance the continuous
recolour came free.

**Flat until it turns.** The board presents as flat 2D and becomes visibly
three-dimensional only while rotating — the Fez rule. Nothing about the geometry
changes between the two looks: a cube viewed dead-on through an orthographic
camera is already a flat square. What animates is the field of view (5° → 30°),
the elevation (0° → 14°), the lighting (flat ambient → directional key and rim),
the apparent-size falloff, and the well's own depth cues, all driven by a single
`flatness` value following a half sine across the turn. Camera distance is
refitted as the field opens so the board holds its apparent size and the change
reads as perspective arriving rather than as a zoom. See `docs/DESIGN.md` §2.1.

The consequence worth noting: while settled, **colour is the only depth
channel**. Uniform cube size is what lets a near cube cover the ones behind it
exactly, so the apparent-size falloff exists only during the turn. That puts the
full weight on the spectrum ramp, and makes the luminance-monotonic
accessibility ramps load-bearing rather than optional.

### Tested

**138 unit tests, 17 end-to-end tests.** Coverage on `src/core`: 94.6%
statements, 87.7% branches, 96.4% lines.

Highlights beyond the obvious:

- **Playability (`playability.test.ts`)** — a greedy placement agent plays real
  games and must clear lines at a healthy rate. This is a design test, not a
  unit test: it exists specifically to catch a change that makes the game
  unplayable. In tuning runs a competent player clears 71–103 lines over
  250–330 pieces.
- **The tier-2 impossibility** — proves exhaustively that no planar tetracube
  survives having one cube pushed a lane.
- **Refraction Clear**, at both engine and browser level: eight cubes along Z
  are not a line from the front and are already a line from the left.
- **Overhangs survive clears** — gravity must not compact columns, or structures
  bridging two columns are silently destroyed.
- **The camera rotates rather than cutting**, asserted from real screenshots.
- **Flat when settled, dimensional only mid-turn**, sampled from real pixels:
  unshaded tiles yield few distinct colours, and the midpoint of a turn yields
  far more once the cubes are lit and showing their tops.

### Design decisions validated, and one corrected

- **The Lane Dealer works.** This was flagged in M0 as the most consequential
  gap filled and the one most worth challenging. It is now backed by evidence:
  a competent player clears ~0.3 lines per piece with no depth control at all.
  An early dumb-bot run reaching zero lines was the bot, not the design.
- **Tier 2 as specified was impossible.** "A planar tetracube with one cube
  pushed ±1 lane" always disconnects the piece. Corrected to the two chiral
  screws, which is what that tier actually wanted. See `docs/DESIGN.md` §4.1.
- **Pieces now spawn inside the visible field** rather than in the buffer above
  it, where they rendered as detached from the board. §5.3.

### Fixed during the milestone

- **Lights were fixed in world space**, so orbiting to the Left or Back face lit
  the board from behind and the stack went muddy. Two of four faces rendered
  badly — fatal in a game where colour carries the depth information. The light
  rig now rotates with the camera.
- **The turn was started twice**, once from the input handler and once from the
  engine event, which could overshoot 90°. The engine event is now the single
  source of truth.
- The ghost piece is unlit, so it shows its landing lane's true colour from
  every face instead of going dark when backlit.
- The HUD banner and turn prompt were falling into implicit grid rows and
  landing on top of the stack; they now overlay properly, and the turn prompt
  dims the board to read as the deliberate modal beat it is.
- The playability test exceeded the default 5s timeout under coverage
  instrumentation, which would have failed CI.

### Next

**M3 — The Turn.** Eligible lines glowing during the rotation, animated
cascades, and the chain-scoring presentation.

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
