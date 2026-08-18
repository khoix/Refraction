# Refraction — Build Plan

Fourteen milestones. Each one is a self-contained push: source, tests, and a
`release_notes.md` entry. Every milestone leaves `main` in a state that builds,
passes `npm run verify:full`, and can be played or inspected.

The ordering is chosen so the riskiest thing is proven first. The gameplay only
works if the geometry is trustworthy, so the projection contract is locked down
and tested before a single triangle is drawn.

**Rule for every milestone:** `npm run verify:full` must pass before the push —
typecheck, lint, unit tests, production build, end-to-end tests.

---

## M0 — Foundation ✅ _shipped_

**Goal:** prove the toolchain and lock down the geometry contract.

- Vite + TypeScript + Vitest + Playwright, strict compiler settings.
- `constants.ts` — board dimensions with a compile-time square-footprint guard.
- `projection.ts` — the face/projection contract, the single source of truth.
- `spectrum.ts` — OKLCH depth ramp with gamut mapping.
- `rng.ts` — seeded deterministic RNG.
- Boot screen exercising the core modules in a real browser.
- Design spec, architecture notes, testing strategy.

**Exit criteria:** projection invariants proven by test; the spectrum ramp is
continuous and in-gamut; production build succeeds; e2e suite green.

---

## M1 — Voxel Core ✅ _shipped_

**Goal:** the entire game, playable headlessly, with no renderer at all.

- `Board` — dense voxel occupancy grid, `O(1)` cell access, per-column gravity.
- Tetracube catalogue with the four tiers, defined as integer cube offsets.
- `Piece` — spawn, translate along the face's horizontal axis, depth nudge,
  the three rotation axes, generalised kick table.
- Collision, lock delay with the 15-reset rule, hard/soft drop.
- Line detection on the current face's axis; clear; cascade to stable.
- Piece bag and lane dealers, both seeded.
- Game-over detection: top-out and block-out.
- ASCII debug renderer — renders any face as text, used heavily by tests.

**Why first:** every later milestone is a consumer of this. If the rules are
wrong here, no amount of rendering polish saves the game.

**Tests:** rotation/kick tables; a piece dropped from every face lands in the
mirrored place; clearing a line touches exactly 8 columns; cascades reach a
fixed point; a structure built on Front produces the exact predicted silhouette
from all four faces; seeded replays are bit-identical.

**Exit criteria:** a full game can be played to game-over through a scripted
input log, with the outcome reproducible from its seed.

**Correction (recorded at M6):** this entry originally said "sparse voxel
occupancy". The board is a dense `Uint8Array` — at 8 × 19 × 8 that is ~1.2 KB
and there was never a reason to be sparse. The behaviour claims all held.

---

## M2 — First Light ✅ _shipped_

**Goal:** the board becomes visible, and beautiful.

- Three.js scene, flat until it turns: orthographic throughout, dead-on when
  settled, gaining 12° of elevation at the midpoint of a turn.
- Instanced bevelled boxes, one draw per layer; per-instance colour.
- Continuous spectrum shading driven by live camera distance.
- The well: flat silhouette frame, corner posts that appear as the board turns.
- Active piece, ghost piece at true landing depth.
- HUD skeleton: score, stage, Shift meter, next piece, hold.
- Fixed-timestep game loop.

**Exit criteria:** a complete game is playable on the Front face alone, at a
locked 60 fps, and it already looks like a finished game.

**Landed early:** the 750 ms camera turn, with continuous recolouring and
parallax, arrived here rather than in M3. The camera code needed the yaw
interpolation anyway, and colour is computed from live camera distance, so the
continuous recolour came for free. M3 keeps the rest: eligible lines glowing
during the turn, animated cascades, and the chain-scoring presentation.

**Superseded (recorded at M6):** this entry originally specified a 5°
near-perspective camera opening to 30° yaw and 14° elevation mid-turn, a
lane-tinted floor grid, and contact shadows. The orthographic decision (commit
`43a66a2`) replaced all three: perspective of any strength is a second depth
cue, a settled face is now dead-on at 0°, and shadows and floor tinting read as
spatial hints the still frame is not allowed to give. The remaining visual
bullets that were claimed here but not built — lock-flash, and a floor
treatment of any kind — shipped in M6 (the flash, and the environment's
achromatic lattice).

---

## M3 — The Turn ✅ _shipped_

**Goal:** the central mechanic — the reveal.

- Shift meter fills, freezes play, prompts for direction with the 5 s fallback.
- 750 ms camera turn with continuous recolouring and parallax separation.
- Snap to exactly 90°; the new projection becomes the active board.
- Refraction Clear evaluation on arrival; cascade resolution and animation.
- Lines that will be eligible on arrival glow during the turn.
- Refraction Chain tracking and multipliers.

**Exit criteria:** the proposal's core loop is real and feels right —
_place → anticipate → rotate → reveal → clear → cascade._ A player who builds a
Z-axis line on Front sees it clear on arrival at Left, every time.

**Note:** the clear had been resolving _before_ the camera moved, so the player
never actually saw the reveal. The turn is now a timed engine state: the face
flips immediately, the eligible lines are recorded and glow for the whole
rotation, and they clear on arrival.

**Superseded (recorded at M6):** "apparent-size interpolation" was planned here
and deliberately dropped. The game now promises the opposite — a cube eight
lanes back is exactly the size of one at the front, always — because size
falloff is a second, more familiar depth cue that players would read instead of
reading colour.

---

## M4 — Feel ✅ _shipped_

**Goal:** make it satisfying rather than merely correct.

- Screen shake, tuned subtle, suppressed under reduced motion.
- Procedural WebAudio: lane-mapped pitch, filtered sweep on the turn, chord
  bloom on Prism.
- Scoring popups and the escalating `REFRACTION ×n` / `PRISM CHAIN ×n` language.
- **Full Spectrum / Prism** — the board blooms toward white on a four-face chain.
- Clear glow with swell-and-pulse while lines resolve.

**Exit criteria:** a Prism chain is a genuine event. Reduced-motion and
photosensitivity settings verified.

**Deferred to M6 (recorded at M6):** three bullets were claimed here and had
not been built — selective post-process bloom (the Prism "bloom" was a colour
lerp), the line-clear dissolve with spectrum-tinted debris, and the lock-flash.
All three shipped in M6.

---

## M5 — Progression ✅ _shipped_

**Goal:** the difficulty arc.

- Seven stages with the speed, meter and tier tables from the design spec.
- Piece tiers introduced on schedule; Tier 2 arrives quietly, with no tutorial.
- Stage transition sequence; the numbering continues indefinitely past stage 7.
- Difficulty tuning pass against recorded play sessions.

**Exit criteria:** the first depth-offset piece lands without explanation, and
the first turn lands as a revelation rather than a confusion.

**Note 1:** the tuning pass moved `LINES_PER_STAGE` from 10 to 15. At ten, the
greedy agent walked the entire arc inside one game, which made finishing it
routine. The reveal schedule is now pinned by test rather than by intention —
see `tests/unit/progression.test.ts`.

**Note 2:** stages shipped named for the spectrum bands — Red through Violet,
then Ultraviolet — and that was corrected. The spectrum means depth from the
current camera and nothing else; a stage called "Green" invites the player to
infer rules that do not exist. Stages are now numbered, the HUD chrome is
achromatic throughout, and the rule is written down in DESIGN §2.2.

**Note 3 (recorded at M6):** stages 6–7 declared `maxTier: 4` while the
catalogue topped out at tier 3, so the tier was a no-op. Tier 4 now does what
the design spec always said it should: the dealer deals random spawn
orientations for projection ambiguity. No new shapes; the same eight present
differently.

---

## M6 — Playtest Readability & Presentation ✅ _shipped_

**Goal:** the board stays readable under occlusion, the space feels alive, and
the systems that felt mechanical get loosened. Driven by observed play.

- **Active-piece and ghost visibility.** Both remain visible through every
  settled cube until lock — a rendering override only, in their true spectrum
  colours, mutually distinct even when both show through the stack.
- **First-contact X-ray.** The piece is a vertical flashlight: the topmost
  settled cube under each footprint column — and nothing beneath it — shows
  through the board as a breathing shell and core that keep the cube's depth
  colour. Reads as seeing through the board, not as drawn on top. Follows every
  move; vanishes at lock.
- **Reactive achromatic environment.** Dust, distant fragments, a floor
  lattice, ripples on clears; brightness, density and motion only, never a hue;
  strictly behind the board by construction. Reacts to lock, clear, meter,
  turn, Refraction and Prism.
- **Lane draw with a starvation floor** replaces the lane bag. Free seeded
  randomness — clusters, repeats, dry spells — with a single guarantee that no
  lane starves past a threshold. Balance is a floor, not a levelling force.
- **Piece-vocabulary experiment** behind `?pieces=experimental`: screws at
  tier 1, a tricube, three non-planar pentacubes. A playtest bed measured by
  the greedy agent, never the default.
- **The M2/M4 leftovers:** true thresholded post-process bloom (only clears and
  Prism can reach it), line-clear dissolve with spectrum-tinted debris
  staggered along the clearing axis, and the lock-flash.

**Exit criteria:** a buried piece is never lost; the landing surface is legible
through the stack; the lane sequence no longer reads as ROYGBIV on a loop; the
experimental vocabulary is playable by the greedy agent; `verify:full` green.

---

## M7 — Controls and Comprehension ✅ _shipped_

**Goal:** the game stops telling the player something wrong. Driven by the first
playtest of M6.

- **Turn direction names the destination.** Pressing left brings the left-hand
  face forward; pressing right, the right-hand. The old mapping spun the world
  the way the key pointed, which delivered the opposite face. The prompt now
  labels each arrow with the face it will actually produce.
- **Next-piece preview is a fixed 4×4 with even spacing.** The previous layout
  stretched a shrink-to-fit grid to a min-height, so row tracks grew while cells
  stayed 0.85 rem — a vertical gap of roughly one whole cell.
- **Lane focus replaces the contact X-ray.** The falling piece's occupied lanes
  are a focal plane: nearer settled cubes go transparent so you see through to
  the piece and its landing surface; the focal lane stays fully opaque, with
  `firstContactCells()` as a restrained emphasis on the cubes the piece will
  actually touch; farther cubes darken toward the void. Gated to `falling`, so
  it cannot be read as an absolute distance cue.

**Exit criteria:** left delivers LEFT; the preview's row gap equals its column
gap; a wall in a nearer lane no longer hides the piece's landing surface;
`verify:full` green.

---

## M8 — Spectacle and the HUD ✅ _shipped_

**Goal:** the space is loud, the board is protected from it, and the chrome
reads as an interface rather than as floating captions.

- **A disco background** — coloured beams, chase and strobe, cycling fragments,
  a pulsing lattice, density and scale that surge on events. `reducedMotion`
  guts the strobing specifically, not merely scales it.
- **The play column is ~95% opaque**, a dark panel behind the well sized to the
  projected footprint, so the disco never competes with a cube for a depth
  reading. Opacity dips through the Prism whiteout.
- **Shift meter as a segmented bar under the column.** Segment count follows
  `linesPerTurn` (five at stage 1, tightening later). Positioned from the
  orthographic well rectangle.
- **HUD chrome** — framed modules, aligned stat grids, framed NEXT/HOLD slots,
  raised dim contrast, darker scrims. Stays achromatic because the HUD is the
  surface that describes the rules.
- **The colour rule's scope, corrected.** Decorative background colour is
  allowed; a second colour language that makes claims about the rules is not.

**Exit criteria:** the background is unmistakably alive from outside the column
and invisible as colour from inside it; the Shift bar sits under the well and
fills with the meter; the HUD reads as panels, not captions; `verify:full` green.

---

## M9 — Modes and Meta ✅ _shipped_

**Goal:** everything around the core loop. Consumes the finalized gameplay
rather than developing against systems still in motion.

- All six modes: Ascent, Endless, Prism, Flatland, Blind Spectrum, Zen.
- Title screen, mode select, pause, game-over, restart.
- Versioned `localStorage` persistence with migration: settings, high scores per
  mode, unlocks, lifetime stats, session records.
- Settings menu: video, audio, controls, accessibility.
- Seeded challenges and mode-specific scoring rules.

**Engine note:** `GameStatus` has no `paused` state today, so pause is a core
state-machine change, made without breaking `(seed, input log)` determinism.

**Exit criteria:** every mode reachable and completable; a corrupt or outdated
save is recovered from, never crashed on.

**Note 1:** a mode is pure configuration over the stage table, not a code path,
so the engine keeps one implementation and a mode cannot introduce a rule by
accident. Ascent and Endless were one mode described twice in the spec; they are
now separated by what they do with content rather than with speed — DESIGN §11.1.

**Note 2:** the engine note is answered. `paused` is a real `GameStatus`, and
determinism is asserted by playing one scripted run with a pause between every
action and one without, then comparing — DESIGN §12.

**Note 3:** the game-over HUD overlay from M6 is gone; the screen owns that
moment now, and it carries the M6 regression test that parses the advertised
restart key out of the copy. Two panels announcing the same thing was one too
many.

**Note 4:** the M8 disco was reworked to an achromatic room during this
milestone. It looked cheap, and the cause was specific: one hue clock driving
every element in lockstep, saturation at 0.7–0.85 on unlit hard-edged
geometry, and levels written in linear space where "nearly black" renders as
mid-grey. DESIGN §2.4 records the diagnosis; §2.2 takes back the relaxation
that had allowed decorative hue in the room.

**Not built:** key remapping. It is listed here under "controls" but belongs
with the input work in M11, and moved there.

---

## M10 — Reading the Board

**Goal:** the comprehension tools.

- **Peek** — hold to tilt 8°, parallax inspection, snaps back, changes no state.
  Limited at Stage 6+, disabled in Blind Spectrum.
- Rotating 3D next-piece preview; static preview as a harder option.
- First-run onboarding that teaches by design rather than by tutorial text:
  position is absolute, colour is relative, rotation changes viewpoint, opposite
  faces mirror, hidden geometry can be inferred before it is revealed.
- ✅ **Rolled the X-ray back to the rule it was meant to implement**
  _(play notes)_.
  The intended behaviour was never a whole-board effect: the lanes **under** the
  falling piece and the lanes **in front of** those are x-ray transparent, so the
  top layer — the one carrying the ghost — reads straight through. Only the lanes
  **behind** that are muted and darkened. What shipped instead veils the near
  cubes and darkens the far ones across the board, which is why everything reads
  muted. Replaces M6's first-contact shell and M7's lane-focus veil as tuned.
- ✅ **Un-buried the ghost** _(play notes)_. It was not missing: `ghostCells()` returns
  its cells and `showGhost` is on. The lane-focus veil draws at `renderOrder: 1`
  over the ghost's default order, so a 0.3-opacity ghost is washed out by a
  0.28-opacity veil painted on top of it. Fixing the item above should restore
  it; this is a separate line because "the ghost is legible on a crowded board"
  is the acceptance test, not a side effect. Done: it draws after the x-ray
  passes now, at 0.44 rather than 0.3.
- ✅ **Gave the board its colour back** _(play notes: "all the colours seem
  muted")_. Not the x-ray after all, and not a tuning question. Three stages of
  the render pipeline were each rescaling the spectrum — a backdrop panel
  composited over the board instead of behind it, ambient light at a third of
  the value that reproduces an albedo, and ACES tone mapping compressing the
  remainder — and together they put every settled cube at about a fifth of its
  palette value. Fixed at all three, and a settled cube now matches
  `depthColor` exactly. See DESIGN §2.5.
- ✅ **Made colour fidelity a tested invariant.** The bug survived a 60-test
  end-to-end suite because every test compared the board against itself. Two
  new tests compare it against the palette and against the DOM preview instead;
  each of the three causes was re-introduced to confirm they fail on it.
- ✅ **Retuned the three bands against a full-strength board.** The x-ray's
  opacities and the muted dim were all measured under the wash, so the muted band
  came out brighter than the x-ray in front of it once the wash was gone.
- ✅ **Scoped the x-ray to the drop channel** _(play notes, with illustration)_.
  The rollback above fixed how the bands were drawn but kept classifying the
  whole board by lane, so a piece dealt to a back lane still turned everything to
  glass. The region is the columns the piece spans, from its landing row upward:
  at or in front of the piece's depth is x-ray, behind it is muted, and every
  other cube on the board — a different column, or below the ghost — is normal.
  There is no separate focal band. See DESIGN §9.

### The landing marks — M10a ✅ _(play notes)_

Four notes, sharing a vocabulary problem that had been costing passes: **"the
ghost voxel" means the first settled cube beneath the piece — the surface it
comes to rest above — not the projected piece position.** Those are the same cell
only when the piece lands flush, and a piece that does not fit its footprint
stops with a gap underneath.

Measured, with a flat four-wide bar dropped onto a staircase:

| Column | Piece lands at | First actual voxel | Gap    |
| ------ | -------------- | ------------------ | ------ |
| 1      | y = 9          | y = 8              | 0 rows |
| 2      | y = 9          | y = 4              | 4 rows |
| 3      | y = 9          | y = 2              | 6 rows |
| 4      | y = 9          | y = 1              | 7 rows |

- ✅ **The channel reaches the first real voxel.** Its floor was the landing row,
  so rows 1 to 8 under three of those columns sat outside it and drew solid —
  precisely the gap the player needs to see into. Taken per column from
  `firstContactCells()`, which was already being computed every frame.
- ✅ **The surface cube stays solid.** It is the backstop the channel stops
  against, and it carries the landing mark; an x-rayed cube cannot hold a mark.
- ✅ **The surface mark exists at last.** Two compounding reasons it never did:
  `VoxelLayer` set `emissiveIntensity: options.emissive` alongside
  `emissive: 0x000000`, multiplying every layer's intensity into black, and the
  mark's geometry was a smaller cube sharing a centre with the cube it marked —
  which is simply inside it. It is pushed onto the near face now and lifted
  nearly to white. Half was measured first and is not enough: on green at
  luminance 198 or yellow at 190, a half lift moves it 12% and the mark vanishes
  on exactly the colours it most needs to survive.
- ✅ **Neither mark depends on the x-ray.** The landing outline was a 0.44
  translucent cube reading around luminance 47 over the well's background, and it
  was faintest on an open board — where the x-ray correctly does nothing and
  there was nothing to lend it contrast. It carries its own outline now, above
  every see-through pass.
- ✅ **The x-rayed region is outlined once, not per cube.** `EdgeLayer` derives
  the region's screen-space silhouette and draws only the edges bordering an
  unoccupied neighbour.

**Exit criteria, met:** on an open board and a crowded one alike, a player can
see both where the piece will come to rest and what it will rest on, and how big
the gap between them is. Five end-to-end tests, each confirmed to fail when its
behaviour is reverted.

- **Ghost and contact clarity pass** — re-tune opacity, emphasis and hierarchy
  once the above lands, and check behaviour on highly occluded boards.

**Exit criteria:** a new player reaches their first turn without instructions and
understands what happened afterwards. The ghost is findable at a glance on a full
board, and no cube is dimmed unless it sits behind the falling piece.

**Sequencing:** the first two items lead this milestone. They are a live
playability regression on `main` rather than a polish pass, and everything else
here is built on top of a board the player can read.

---

## M11 — Accessibility and Input

**Goal:** the game is legible and playable for everyone.

- Banded, luminance, and colour-vision-safe depth ramps; lane numerals. Any
  alternative to ROYGBIV must preserve the core distinction: depth is relative
  to the current camera orientation.
- ✅ **Key map in settings** _(play notes)_ — a visible reference for what every
  key does, built from the same table the input controller reads, so the panel
  cannot describe a key the engine does not answer to.

  Writing the bindings out as a table is what found the bug it now documents:
  the depth nudge takes ±1 and the spec said `W` / `S`, but `S` is half of the
  WASD movement cluster and already the soft drop, so only `W` had ever been
  bound and half a Stage 4 mechanic was unreachable. Depth is `T` / `G` now.

- ✅ **Arrow keys move through menus** _(play notes)_ — focus travels the panels
  and the mode grid with the same keys that move a piece. Rows come from the
  laid-out geometry rather than the markup, because the mode grid is one column
  on a phone and several on a laptop from the same DOM. A text field keeps its
  arrows for the caret and a slider keeps left and right for its value.
- Full key remapping; gamepad parity.
- Reduced motion, bloom/intensity controls, lane-focus intensity, screen-shake
  controls, audio accessibility, screen-reader board summaries, focus
  management.

Touch controls and the responsive layout were one-line bullets here — "touch
controls with swipe and tap", "responsive layout from 390 px to ultrawide" — and
they are neither one line of work nor an accessibility footnote. They are their
own milestone now; see M12.

**Exit criteria:** the game is completable with depth colour fully disabled and
by keyboard alone.

---

## M12 — Mobile

**Goal:** the game is genuinely good on a phone, not merely reachable from one.

Nothing exists yet. There is no touch handling of any kind — the only pointer
listener in the codebase resumes the audio context — and the whole responsive
story is a single `@media (max-width: 34rem)` block that restacks the mode grid.
The end-to-end suite checks that the Shift meter stays on screen at phone sizes,
which proves the board fits, not that the game can be played.

### Direct manipulation, not repeated swipes

A swipe that moves one column is a keyboard binding wearing a costume: eight
columns means eight swipes. The piece should **follow the finger** instead.

- **Drag to place.** While a finger is down the piece tracks its column
  continuously and snaps cell by cell, absolutely — the column under the finger
  is the column the piece is in, not an accumulated offset. That is the same
  claim the game already makes about everything else: position is absolute.
- **Double tap to drop.** Hard drop, once the piece is where it should be.
- **Drag down to soft drop**, so the slow descent is available without a second
  gesture vocabulary.

Three things have to be solved for this to feel right, and all three are
gameplay-affecting rather than cosmetic:

- **The finger covers the board.** A thumb over an 8 × 18 well hides several
  cells, including — on a low stack — the landing surface and both landing marks
  the previous milestone just made visible. Some offset between touch point and
  target column, or a lift of the piece's column indicator above the thumb, has
  to be designed rather than defaulted.
- **Tap, double tap and drag must not fight.** A double tap is two taps plus a
  window, and holding the hard drop behind that window makes it feel late. The
  usual escape is to treat the second touch-down as the drop rather than waiting
  for the second touch-up.
- **A drag that starts on the piece and a drag that starts anywhere else** should
  probably not mean different things, but that is a decision, not an assumption.

### The verb problem, which is the real work

This game has more to say than a flat falling-block game, and a phone has less
room to say it in. The current bindings carry **twelve distinct verbs**:

| Verb                       | Count | Keyboard      |
| -------------------------- | ----- | ------------- |
| Move along the face's axis | 2     | arrows / A D  |
| Soft drop, hard drop       | 2     | down, space   |
| Rotate — roll, yaw, pitch  | 6     | Z X, Q E, R F |
| Depth nudge                | 1     | W             |
| Hold                       | 1     | C / Shift     |

Six of those are rotations across three axes, and that is the one thing that
cannot be dropped: three-axis rotation is why the pieces are cubes rather than
tetrominoes. A phone cannot carry six rotation buttons without burying the
board, and the drag/tap vocabulary above is already spent on movement.

Options to evaluate, none chosen yet: a radial rotation control that appears
under a long press and disappears on release; two-finger twist for one axis with
the other two on taps; a small persistent control cluster in the thumb zone
below the well, accepting the vertical cost; or an axis selector that changes
what a rotate gesture applies to. **Decide before building** — this is the
choice the milestone lives or dies on, and it deserves a prototype rather than a
guess.

The **turn prompt** needs a touch answer too. When the Shift meter fills the game
asks for left or right and falls back after five seconds; on a phone that has to
be a pair of targets, not a keypress.

### Layout

- Portrait first. The HUD flanks the board today — score to the left, next and
  hold to the right — which is exactly wrong on a narrow screen. Above and below,
  and the well takes the width.
- Safe-area insets, so nothing lands under a notch or a home indicator.
- Landscape as a genuine second layout, not a squashed portrait.
- `HUD_RESERVE` and the camera fit were tuned against desktop framing and want
  re-checking once the HUD moves.

### Smooth

- **Every frame is currently rendered**, deliberately: render-on-demand was tried
  and backed out because the room has to keep moving when the board is still. On
  a phone that is a thermal and battery cost, so the environment's own frame cost
  is the thing to reduce rather than the frame itself.
- Pixel ratio is capped at 2. On a DPR-3 phone that is still four times the
  pixels of DPR-1.5, for a scene that is flat colour and hard edges. Worth
  measuring whether the cap should be lower on small screens.
- The bloom chain is already gated to frames where something can bloom, which is
  the expensive path and is already handled.
- Establish a frame-time budget and measure against a throttled CPU profile in
  the end-to-end suite, so a regression is caught rather than felt.

### Touch hygiene

`touch-action: none` on the playfield, no pull-to-refresh, no double-tap zoom, no
text selection on a long press, no tap highlight. Individually trivial,
collectively the difference between a web game and a web page.

**Exit criteria:** a full run — start to game over, including a turn and a hold —
played on a phone with one thumb, without the finger hiding anything the player
needs, and holding its frame budget on a mid-range device profile.

---

## M13 — Performance and Release Candidate

**Goal:** ship quality.

- Profiling pass; dynamic resolution scaling; instance buffer reuse.
- Large-board occlusion cost, lane-focus rendering cost, particle and background
  scalability.
- WebGL-unavailable fallback message.
- Playwright visual regression baselines for each face and each stage palette.
- Deterministic replay tool for bug reports; input latency measurement.
- Save migration verification, error handling, browser compatibility.
- Bundle budget enforcement in CI; final difficulty tuning; final documentation
  pass.

**Exit criteria:** every budget in §12 of the design spec met on integrated
graphics; visual regression suite green.

---

## Deliberately out of scope

Not in this plan, and not by accident:

- **Multiplayer or leaderboards.** The core loop has to prove itself solo first.
- **Deployment.** GitHub Pages is explicitly disabled. `npm run build` produces
  a portable static bundle in `dist/`; where it gets hosted is a later decision.
- **Level editor, daily challenges, cosmetics.** Post-1.0 candidates.
