# Release Notes

Milestone log for **Refraction**. Newest first. One entry per pushed milestone.

Every entry records what shipped, what was tested, and any decision worth
revisiting later. The full milestone roadmap lives in [`docs/PLAN.md`](docs/PLAN.md).

---

## M5 — Progression

**Branch:** `claude/webapp-game-plan-vtrxqx`

The game now has an arc rather than just a loop.

### Shipped

- **Seven authored stages**, each faster, turning more often, and dealing from a
  wider piece set than the last, and then a tail that keeps numbering upward
  indefinitely — gravity climbing 15% a stage, the Shift meter tightening to two
  lines.
- **Stage transitions announce themselves** with a quiet centre-screen banner
  that spaces its letters outward as it fades. The arc should be felt through
  the speed and the pieces, not narrated, so it is deliberately brief and
  deliberately colourless.
- **The reveal schedule is pinned by test.** Stage 1 can only deal flat pieces,
  the screws arrive at stage 2, the tripod no earlier than stage 4, and Depth
  Nudge unlocks at stage 4. These were true before; now they cannot quietly stop
  being true.

### Stages are numbered, not named

They were named for the spectrum on first pass — Red, Orange, Yellow through to
Violet, then an Ultraviolet tail — and the HUD tinted the stage readout and the
transition banner with the matching band. It looked good. It was wrong, and the
correction is the most substantial thing in this milestone.

The governing rule is **position is absolute, colour is relative**: a hue on
screen is a claim about depth from the current camera. Naming a stage "Green"
makes a second claim with the same vocabulary and no marker separating the two.
A player who believes both has no way to tell which one a green cube is
speaking, and the reasonable inferences from there — green cubes must be
cleared, green is worth more, reach the green stage by making green — are all
rules this game does not have. It would have taught them anyway.

So:

- **Stages are identified by number.** `Stage 1` through `Stage 7`, and the
  numbering simply continues past the end of the authored table rather than
  renaming itself. Nothing announces a new tier because there isn't one — it is
  the same arc, still climbing.
- **A stage may still earn a name**, but only for a genuine identity: its own
  rule, a new piece class, different rotation behaviour, a board condition. The
  name has to say something the number doesn't; flavour is not a reason.
  `StageConfig.name` is optional and currently unset on all seven. When one is
  set, it renders _alongside_ the number (`Stage 4 — Eclipse`) so the player
  never loses their place.
- **The spectrum is reserved**, and that reaches past stage names into the whole
  interface. The Shift meter pips, score popups, chain readout, scoring banners,
  turn-prompt arrows and the game-over score were all drawing on a mirrored copy
  of the spectrum palette — mostly amber. They are now achromatic, from a single
  neutral accent. The scoring banner's rainbow gradient is now white, which is
  also the truer image: the whole spectrum together _is_ white light, which is
  exactly what the board does when a Prism chain closes.

The partition is now absolute. Cubes on the board and cubes in the next-piece
preview carry spectrum colour, because in both cases the colour is that cube's
actual depth. Nothing else on screen carries a hue at all — so any hue the
player sees is a depth claim, and can be trusted as one. The rule and its
reasoning are written down in `docs/DESIGN.md` §2.2, and §2.3 covers when a
stage may take a name.

### The tuning pass

`LINES_PER_STAGE` went from **10 to 15**.

This came from measurement rather than taste. The greedy agent in
`playability.test.ts` is the closest thing the project has to a competent
player. At ten lines per stage it reported:

```
arc: 200 pieces, 65 lines, stage 7
```

— the entire authored arc consumed inside a single 200-piece run, with most of
the run spent past the end of it. That makes finishing the arc the default
outcome rather than an achievement.

At fifteen the same agent reports:

```
arc: 200 pieces, 52 lines, stage 4
```

The full arc is now 90 lines, which sits at the top of the 71–103 lines that
agent manages across seeds. Stage 7 is reachable but has to be earned.

Every test that depended on the old pacing is **parameterised on the constant**
instead of hard-coding line counts, so the next retune is a one-line change.

### Tested

**179 unit tests, 26 end-to-end tests.**

New in `progression.test.ts` (18), organised around the schedule rather than
around the functions:

- **The reveal schedule** — every piece available at stage 1 is planar; tier 2 is
  the screws and arrives at stage 2; the tripod arrives no earlier than stage 4;
  Depth Nudge unlocks only once the player can already read depth; a piece once
  introduced is never withdrawn.
- **Stage identity** — no stage carries a name, no stage name may collide with a
  spectrum band (checked against `SPECTRUM_STOPS`, so adding a band cannot open
  a hole), numbering is consecutive from one into the tail, and a named stage
  still shows its number.
- **The dealer respects the schedule** — deals only stage-appropriate pieces
  across 300 deals at every tier, still touches all eight lanes, and brings a
  newly unlocked piece in promptly instead of after the current bag drains.
- **The endless tail** — begins only once the authored stages are exhausted,
  counts its own depth from one, renames nothing, and keeps accelerating over
  six full arcs without stalling, overflowing or returning a non-finite interval.

At browser level, the notable one is a regression test for the correction above:
_never tints the stage readout, at any stage_ samples the computed colour of the
stage number, asserts it is achromatic (no channel dominating), then advances the
run deep into the arc and asserts it has not moved — and that it still matches
the score readout beside it. Also: the banner announces by number, and the
numbering continues past stage 7.

### Decisions worth revisiting

- **Fifteen is tuned against one agent.** The greedy search is a decent player
  but not a human one — it never panics, never misreads a colour, and never
  wastes a piece. If real play is slower than the agent, 15 will feel long and
  should come down. This is exactly the knob to revisit once M6 gives us
  persistence and real scores to look at.
- **The endless tail is now silent.** Dropping "Ultraviolet" removed the one
  signal that a player had passed the end of the authored content. Numbering is
  honest and the difficulty still climbs, but if playtesting shows that milestone
  wants marking, that is a legitimate case for a _named_ stage under the new
  rule — it has a real mechanical identity. The name would have to be a
  non-spectrum one.
- **The achromatic HUD is a stronger constraint than it looks.** It rules out
  colour-coding anything in the interface — mode badges, warning states, a
  low-stack danger tint. Each of those will want a hue at some point, and the
  answer has to be shape, weight, motion or position instead.

### Next

**M6 — Modes and Meta.** All six modes, title and mode select, versioned
`localStorage` persistence with migration, and the settings menu.

---

## M4 — Feel

**Branch:** `claude/webapp-game-plan-vtrxqx`

Correct became satisfying.

### Shipped

- **Procedural audio.** `tones.ts` holds every decision as pure data —
  frequencies, envelopes, gains — and `audio.ts` is a thin WebAudio layer over
  it. The organising idea mirrors the visual one: **depth is pitch**, near lanes
  low and far lanes high, matching the direction the spectrum runs. Lanes walk a
  minor pentatonic scale so adjacent lanes never clash.
- **Full Spectrum.** On a chain that closes a four-face revolution the board
  blooms toward white — the colour metaphor stated literally, since the visible
  spectrum combined _is_ white light — with every band sounding at once.
- **Clear dissolve.** Lines being removed swell slightly as they go instead of
  vanishing between frames.
- **Screen shake**, scaled by how much cleared and hardest on a Full Spectrum.
- **Score popups** and a **mute indicator**; `M` toggles sound.
- The engine now reports `prism`, `cascade` and `refraction` on clear events, so
  the presentation reads flags instead of parsing the label string.

### Accessibility

`prefers-reduced-motion` is honoured, and `?reducedMotion=1` forces it for
testing. Under it the shake is suppressed **entirely** and the Full Spectrum
bloom is capped well below white and ramped rather than flashed — that cap is
the photosensitivity guard, not just a motion preference.

Sound is worth calling out as an accessibility gain rather than decoration:
§2.1 leaves colour carrying depth alone, so pitch is a genuinely redundant
channel for it.

### Tested

**160 unit tests, 23 end-to-end tests.**

- **Tones (17)** — pitch rises monotonically from the near lane to the far one,
  every lane is distinct, everything stays in a sane register and within gain
  limits, the Full Spectrum chord cannot clip, and the lock sound stays quiet
  enough to hear over since it fires on every piece.
- **Full Spectrum fires only on the fourth face.** The test turns through a full
  revolution, clearing on each face, and asserts the flag is absent on the first
  three and present on the fourth.
- Clear events carry their cascade index and whether a turn caused them.
- Shake displaces the camera by a felt-but-not-disorienting amount, and reduced
  motion suppresses it to exactly zero.

### A testing trap worth recording

Both the shake test and, earlier, the mid-turn capture were defeated by the same
thing: **a Playwright screenshot round-trip takes longer than the effect being
measured**. A 380 ms shake sampled by screenshot is always sampled after it has
died, which reads as "the feature is broken". Instrumenting directly showed the
camera moving exactly as intended.

The renderer now exposes `shakeOffset`, and the test samples it across animation
frames inside the page. The general lesson: for anything shorter than about half
a second, assert on state, not pixels.

### Next

**M5 — Progression.** The Red → Violet arc, piece tiers arriving on schedule,
and the Ultraviolet endless tier.

---

## M3 — The Turn

**Branch:** `claude/webapp-game-plan-vtrxqx`

The reveal is now something you can watch.

### The bug this milestone existed to fix

`chooseTurn` resolved the clears **synchronously**, before the camera moved a
degree. By the time the rotation played, the cleared cells were already gone —
so the single most important moment in the game, a line that exists only along
the hidden axis being revealed by the turn, happened entirely off-screen. The
score went up and the player never saw why.

### Shipped

- **The turn is a timed engine state.** `chooseTurn` flips the face and records
  `pendingClears` — exactly the lines that will be eligible on arrival — but
  removes nothing. The board sits in `turning` for the turn's duration, then
  clears. `turnProgress` exposes how far through it is.
- **Staged resolution.** Each cascade step holds its completed lines lit for
  `clearFlashMs` before removing them, so the player can see which lines went
  and why, one step at a time, instead of the board silently jumping to its
  final state.
- **The glow.** An additively blended layer lights the lines that are complete
  or about to be, pulsing over the board. During a rotation these are the lines
  the turn is revealing.
- **Chain indicator** in the HUD while a Refraction Chain is alive.
- The engine and the renderer now share one turn duration, so the camera's snap
  and the clear land on the same frame. The renderer no longer gates the
  simulation — the engine holds itself still while the board rotates.

The clock lives in the engine rather than the renderer on purpose: that is what
keeps a run reproducible from `(seed, input log)`. A headless `tick` walks the
identical sequence of steps, and the tests drive it exactly that way.

### Tested

**143 unit tests, 18 end-to-end tests.**

New, and all of them about the thing that was broken:

- The eligible lines stay lit for the whole rotation and the cells stay on the
  board — asserted at every 50 ms across a 600 ms turn, not just at the ends.
- `pendingClears` predicts exactly the lines that do clear on arrival.
- A completed line is held on the board while lit, then removed.
- A cascade advances one step per flash rather than all at once.
- `turnProgress` runs 0 → 1.
- At browser level: mid-rotation the line is still physically present, flagged
  for the glow, and uncounted; then it clears.

Every existing test that assumed instant resolution now drives the clock through
a `settle` helper, including the greedy playability agent — so the design test
still holds against the staged engine.

### Next

**M4 — Feel.** Line-clear effects, selective bloom, procedural audio, and the
Full Spectrum / Prism event.

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
- Colour recomputed every frame from **live camera distance**, not from the
  snapped face, so the turn recolours continuously instead of crossfading.
- The well: a flat frame that follows the camera, plus box posts that fade in
  only while the board is turning.
- Ghost piece at its true landing depth; active piece; HUD with score, lines,
  stage, face, Shift meter, next and hold; turn prompt and game-over overlay.
- Keyboard input with DAS/ARR and soft-drop repeat, fixed-timestep loop.

**Landed early from M3:** the 750 ms turn animation, with continuous
recolouring and parallax separation. The camera needed yaw interpolation
regardless, and because colour follows live camera distance the continuous
recolour came free.

**Depth is colour, and nothing else.** A cube eight lanes back is exactly the
same size on screen as one at the front. The projection is **orthographic and
stays orthographic** — perspective foreshortening, size falloff and distance haze
were each offering a second, more familiar depth cue, and a player would read
distance instead of reading colour. All three are gone.

The board reads as flat 2D when settled: dead-on, orthographic, uniformly lit,
so every cube is a flat coloured tile. Turning orbits the camera, and cubes
become visibly cubes because their side and top faces come into view and the
stack separates horizontally — consequences of the rotation, not distance cues.
A single `flatness` value follows a half sine across the turn and drives the
lighting, the elevation, the cube spacing and the well furniture.

Two mid-turn adjustments are worth flagging because they look at first glance
like the cues just removed:

- **12° of elevation at the midpoint, 0° whenever settled.** Dead level, a cube
  never shows its top face and the rotating stack reads as a squashed mosaic
  rather than as cubes. Under orthographic projection this costs nothing against
  the rule — a far cube is still exactly the size of a near one — and a face at
  rest offers no spatial cue at all. `TURN_ELEVATION_DEG` is one constant; set it
  to 0 to remove it.
- **Cube spacing opens uniformly during the turn.** Packed flush they smear into
  bands at an angle. Every cube shrinks by the same factor, so it carries no
  depth information.

`depthScale`, `NEAR_CUBE_SCALE` and `FAR_CUBE_SCALE` are deleted rather than left
unused: size no longer encodes anything.

The consequence worth noting: **colour is the only depth channel**. Uniform size
is also what lets a near cube cover the ones behind it exactly, which keeps the
settled board flat. That puts the full weight on the spectrum ramp, and makes
the luminance-monotonic accessibility ramps load-bearing rather than optional.

### Tested

**137 unit tests, 17 end-to-end tests.** Coverage on `src/core`: 94.6%
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
- The turn duration is overridable via `?turnMs=` in debug builds. Screenshots
  and assertions were landing at unpredictable points inside a 750ms rotation,
  which made "capture the midpoint of the turn" a matter of luck; stretching the
  turn makes a chosen moment reachable reliably.

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
