# Refraction — Build Plan

Seventeen milestones. Each one is a self-contained push: source, tests, and a
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

- All six modes: Flatland, Zen, Ascent, Endless, Prism, Blind Spectrum
  (difficulty order on the mode grid; Flatland first).
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

- ✅ **Peek** — hold to tilt 8°, parallax inspection, eases back, changes no
  state. Withdrawn from Stage 6, off in Blind Spectrum.

  The rule lives in the core (`peekAllowed`), not in the renderer, so it is
  testable without a canvas — and it is keyed off the mode's `depthColour` flag
  rather than off Blind Spectrum's name, because that is the actual reason: Peek
  is meant to supplement the depth channel, and in a mode with no depth colour it
  would _be_ the depth channel instead.

  Eight degrees, eased over 180ms in both directions. Small on purpose: enough to
  separate a settled stack along the depth axis, which is the whole point since a
  dead-on board offers no parallax at all, without becoming a second way to read
  depth competing with the spectrum. The board stays orthographic throughout, so
  a far cube is still exactly the size of a near one — only the angle changes.
  The easing is not decoration either: it is the cubes sliding past each other
  that says which is in front, so a hard cut would arrive at the same camera
  position and show none of it.

  Released explicitly when input is dropped, so opening pause with the key held
  cannot strand the camera off-axis for the rest of the run.

- ✅ **Rotating 3D next-piece preview; static preview as a harder option.**

  Drawn into a scissored corner of the board's own canvas rather than into a
  canvas of its own: a second `WebGLRenderer` means a second GL context, a second
  copy of every shader and a second frame to keep in step, where a scissor
  rectangle costs a viewport change. The rectangle comes from the DOM panel that
  frames it, so the two stay aligned through every layout change without either
  knowing about the other.

  Which is also what made it hard. The canvas sits _behind_ the HUD, so the
  panel's own `rgb(10 12 20 / 0.82)` fill and backdrop blur were painted over the
  render — it looked like a black preview, and the camera, the frustum, the
  instance count and the light were all checked before the panel above it was
  suspected. The panel is a window now (`.slot--window`), and its fill moved into
  the preview scene's own background where it sits behind the piece.

  It turns; its colour does not. Each cube wears the colour of the lane it will
  arrive in, exactly as on the board, because the preview's job is to say what is
  coming and where — not to invent a second way of describing depth.

  Two fixes came out of the hunt. `setViewport`/`setScissor` multiply by the
  renderer's pixel ratio internally, so the rect must be passed in CSS pixels;
  pre-multiplying was invisible at ratio 1 and wrong on every other display. And
  the frustum is sized for the longest piece at any yaw rather than fitted to
  each piece, so a compact piece looks small — pieces keep their true relative
  size instead of each being scaled to fill the panel.

- ~~First-run onboarding that teaches by design rather than by tutorial text.~~
  **Superseded by M13.** The play notes ask for the opposite and are more
  specific: a hands-on, on-rails playthrough that pauses to highlight each idea
  as it happens. Teaching by pure design is a lovely goal, and this game has one
  idea too strange to leave to it.
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

### The clarity pass — M10b ✅

- ✅ **Ghost and contact clarity pass** — measured on a highly occluded board
  before anything was re-tuned, and the measurement is why nothing was.

  The marks were fine. The x-ray was not. Every measurement up to this point had
  put three lanes of wall in front of the piece, and three is not the hard case:
  the well is eight deep, and a stack that has filled the front of the board is
  exactly when a player cannot tell where anything will land. Measured against a
  full-depth wall, with the piece bound for lane 7:

  | Sampled cell            | Buried, before | Buried, after | Open board |
  | ----------------------- | -------------- | ------------- | ---------- |
  | Landing footprint       | 134 / peak 135 | 112 / 115     | 109 / 112  |
  | Contact mark            | 170 / 180      | 191 / 213     | 203 / 227  |
  | Channel above them      | **93 / 119**   | 22 / 73       | 11 / 36    |
  | Untouched cube, no aids | 107            | 107           | —          |

  Translucency accumulates. Seven panes at 0.12 leave 0.88⁷ = 41% of the light
  behind them, so the channel came back to 59% coverage — luminance 93 against an
  untouched cube's 107, which is to say the x-ray had turned back into a wall.
  The footprint behind it peaked at 135 against glass peaking at 119: a 13%
  separation where an open board gives fourteen times. **The aid dissolved as the
  board got harder**, which is backwards, and no amount of re-tuning the marks
  could have fixed it because the marks were never the problem.

  Dropping the fill's opacity cannot fix it either — one number has to serve both
  a single pane and eight, and faint enough for eight is invisible for one. Nor
  can per-instance alpha: instance colour multiplies the fragment, not its alpha,
  so dimming a rear pane darkens the stack without making it any more
  transparent.

  So the pane count is capped instead: **one pane of glass per screen cell, the
  nearest**. How many cubes are stacked in the way is not something a player acts
  on; where the region is, how deep it starts, and where the piece will land are,
  and those come from the outline, the outline's colour and the two marks.
  `EdgeLayer` already collapsed the region to one depth per screen cell for
  exactly that reason, so this makes the fill agree with the border drawn around
  it. Buried and open now read within a tenth of each other.

  One existing test had to change its yardstick, not its claim: the interior of
  the x-rayed region was checked by scaling its peak against its own mean, and
  with the fill faint by design that mean sits near the background, turning two
  luminance levels of antialiasing into a 55% swing. It compares the interior
  cell against the border cell in the same frame now, which is what the claim
  was always about.

- ✅ **Gave the page a favicon.** Unrelated to the above and found by the same
  suite: there was no icon at all, so every boot logged a 404 for the browser's
  default `/favicon.ico` probe. One voxel wearing the whole ramp, in the
  palette's own seven bands.

  **Correction (M22i):** the spectrum square said colour and not the game. The
  mark is now the title's own corner-on O — same silhouette as the wordmark
  cube, in accent-beam cyan — plus a 180px apple-touch-icon so a home-screen
  save is the same voxel.

**Exit criteria, met:** the ghost is findable at a glance on a full board — three
tests hold the buried case specifically — and no cube is dimmed unless it sits
behind the falling piece. Peek and the turning preview each carry their own
tests, including that Peek moves the camera and nothing else.

The onboarding bullet moved out to M13, which is where "a new player reaches
their first turn without instructions" is now answered.

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
- **Bring the floor back at a brightness that reads as floor** _(play notes)_.
  The room's lattice is currently absent whenever the board is settled, which is
  an over-correction: it was removed because it clipped to white, not because a
  floor is unwelcome.

  A horizontal plane viewed from zero elevation is edge-on, so all eighteen of
  its grid lines land on the same row of pixels and the additive blend sums them
  past full — luminance 194 against a room that otherwise reads under 30. That
  brightness is what made it read as a UI divider rather than as ground; the play
  note that reported it took it for a touch-area demarcation.

  The fix is to scale the lattice by how _concentrated_ it currently is: full
  strength when a turn spreads it across a hundred rows, and roughly the
  reciprocal of the line count when it collapses onto one. Measured at about
  0.16, and it belongs here rather than in the room's own milestone because it is
  the same question as every other item on this list — how much visual intensity
  is right, and for whom.

  Worth checking against the reduced-motion and photosensitivity settings while
  it is being tuned, since a bright horizontal edge is exactly the kind of thing
  those exist to moderate.

Touch controls and the responsive layout were one-line bullets here — "touch
controls with swipe and tap", "responsive layout from 390 px to ultrawide" — and
they are neither one line of work nor an accessibility footnote. They are their
own milestone now; see M12.

### Interface corrections — M11b ✅ _(play notes)_

Four small ones, unrelated to each other except that they are all interface.

- ✅ **The Shift bar paints over every menu.** `.hud__shift` carries `z-index: 1`
  and `.screens` carries none, so the meter sits above the title screen, the
  mode grid, settings, pause and game over alike. It is purely visual — the HUD
  is `pointer-events: none` — but it is on screen at all times including the
  front door. A live bug on every device, so it goes first rather than waiting
  for the rest of this group.
- ✅ **The ghost piece stops being a setting.** It is not a preference, it is how
  the game is read: everything the last three milestones did to the landing
  marks assumed it is there. A toggle invites a player to turn off the thing
  that makes depth legible and then conclude the game is unfair. Removing a
  setting from the accessibility milestone is worth stating plainly — the case
  for it is that the ghost is a _comprehension_ aid, and the modes that want it
  gone (Blind Spectrum) already say so in their own configuration.
- ✅ **Volume loses its description.** "Master level, kept separately from mute"
  explains a distinction nobody asked about. Everyone knows what volume is.
- ✅ **Flatland becomes the default mode.** `DEFAULT_MODE_ID` is `ascent` today.
  Flatland deals planar pieces only, so depth is purely a property of where a
  piece is put rather than of its own shape — which is the gentlest possible
  first contact with the one idea the whole game rests on. It is already
  unlocked from the start, so nothing else has to move.

  Pairs with the rotation-axis change in M12. As the default and the first thing
  anyone sees, Flatland is roll-only with no depth nudge, so a new player meets
  exactly one new idea — the board turning — rather than four at once. **That
  half is still M12's**; what shipped here is the default itself, so a new player
  currently gets flat pieces but all three rotation axes.

  Two things had to move with it. The mode grid opens on the last-played mode
  rather than on whichever card is first in the table, which is what makes a
  default mean anything on screen rather than only in storage. And the engine's
  own fallback split off as `AUTHORED_MODE_ID`: `new Game({ seed })` means "the
  authored arc", and it had been reading the player-facing constant, so moving
  that constant quietly turned every mode-less test game into a tier-capped one.

### Remapping, and the WASD cluster — M11c _(play notes)_

**New defaults.** The depth nudge moves to `W` / `S` — deeper and nearer — and
yaw moves to `A` / `D`. The WASD block stops being a movement alias and becomes a
**depth manipulator**: `W` and `S` push the piece into and out of the screen,
`A` and `D` spin it about the vertical axis. That reads like handling a solid
object, and it leaves the arrows to do the flat game on their own.

What it costs, stated plainly because it changes something already advertised:

| Key       | Today                  | After          |
| --------- | ---------------------- | -------------- |
| `W`       | unbound                | Push deeper    |
| `S`       | Soft drop _(alias)_    | Pull nearer    |
| `A` / `D` | Left / Right _(alias)_ | Yaw back / Yaw |
| `Q` / `E` | Yaw back / Yaw         | **freed**      |
| `T` / `G` | Push deeper / nearer   | **freed**      |

**Arrows become the only movement keys**, and the README's "arrows or WASD to
move" stops being true. That is the trade, and it is worth taking: WASD as a
depth cluster is a better use of the best-placed keys on the board than a second
way to do what the arrows already do.

**`src/keymap.ts` currently argues against this in its own header**, and the
argument has to go with the change. It says `W` / `S` "cannot work, because `S`
is half of the WASD movement cluster the README advertises and is already the
soft drop" — which was true when the only way to free `S` was to break an
advertised binding. That is now the deliberate choice, so the module doc should
record the reversal rather than be quietly deleted; the reasoning was sound and
the premise changed.

**Configurable in settings.** This is the "full key remapping" bullet above,
pulled up and given a concrete driver. What it needs beyond a UI:

- A field in the save schema, and a migration — `save.ts` is at `SAVE_VERSION 3`
  and `migrate()` never throws, so an old save must land on the new defaults
  rather than on nothing.
- Conflict detection. `BINDINGS` already has a unit test asserting no key carries
  two meanings; a remapping UI has to enforce the same rule live, and this
  proposal would have tripped it three times over.
- The key map reads the player's bindings, not the defaults. It is built from the
  table, so this follows for free — provided the table becomes the _resolved_
  bindings rather than the constant.
- Reset to defaults, which is the only escape from a mapping typed by accident.

**Open, and worth deciding before building:** in a roll-only mode with no depth
nudge — Flatland, per M12 — `W`, `A`, `S` and `D` all do nothing. They could
revert to movement there, which would give a new player the familiar cluster in
the mode they meet first. I would not: a key that means "move left" in one mode
and "yaw" in another teaches a reflex that is wrong everywhere else, and Flatland
is precisely where the arrows should be learned. Inert is better than
inconsistent.

**Exit criteria:** the game is completable with depth colour fully disabled and
by keyboard alone.

---

## M12 — Mobile ✅

**Goal:** the game is genuinely good on a phone, not merely reachable from one.

Nothing exists yet. There is no touch handling of any kind — the only pointer
listener in the codebase resumes the audio context — and the whole responsive
story is a single `@media (max-width: 34rem)` block that restacks the mode grid.
The end-to-end suite checks that the Shift meter stays on screen at phone sizes,
which proves the board fits, not that the game can be played.

### M12a — Touch controls ✅

The input layer, shipped. The gesture recogniser is pure and unit-tested; the
controller is thin pointer plumbing that decides nothing. Touch and pen only — a
mouse keeps the keyboard game, because dragging a piece with a cursor is worse
than pressing an arrow key and a laptop with a touchscreen should not change
behaviour based on which input was used last.

The turn prompt borrows the strip: while the board waits to be turned, a sideways
drag chooses the face. Touch inverts the mapping so a swipe pulls the board the
way the finger moves; the prompt arrows are also tap targets and keep destination
naming (left still means the left-hand face).

✅ **Gate the split by mode** _(play notes)_. The field/strip split exists to carry
three rotation axes. A mode that does not need three does not need the split: the
whole screen can move the piece, a tap anywhere rolls it, and the strip stops
being dedicated screen space paid for out of an eighteen-row well.

**The gate belongs in the mode table, not the UI.** Flatland is a full
three-dimensional mode today that merely happens to be dealt flat pieces:

| What Flatland has now | Measured                                            |
| --------------------- | --------------------------------------------------- |
| Pieces                | Tier 1 only — I, O, L, T, S, every cell at `z = 0`  |
| Rotation              | All three axes, unrestricted                        |
| Depth nudge           | Locked at stage 2, **unlocks at stage 4, 30 lines** |

And yaw is not idle on a flat piece: rotating the I about Y turns it from four
columns in one lane into one column across four lanes. It leaves the screen plane
entirely. So hiding the swipe zone on a phone would take from touch something a
keyboard still had — an input-parity break, and an invisible one until someone
plays both.

✅ **Shipped as: Flatland is roll only, with no depth nudge at all.** The
piece never leaves the screen plane, and its lane changes only when the board
turns — which is what "pure projection reading" has always claimed and what the
mode's own blurb already promises. Two fields in the mode table carry it:

- ✅ **Which rotation axes the mode permits.** `rotation: 'roll' | 'all'`.
  Flatland gets roll alone, and the engine answers `allowsRotation` from it, so
  the interface asks the rule rather than deciding for itself.
- ✅ **Whether the depth nudge is ever available.** Folded into one field —
  `depthNudge: 'never' | 'byStage' | 'always'` — replacing `forceDepthNudge`,
  which could only ever turn the nudge on early. The policy is folded into the
  stage's own boolean by `withOverrides`, so the engine still reads one flag.

Everything else followed from those two:

- ✅ **Touch drops the split in roll-only modes.** Tap anywhere to roll, drag
  anywhere to move. `TouchLayout.stripTop` is null rather than a strip pushed off
  the screen, because the two zones do not merely merge: in the split scheme a
  tap on the strip is a _miss_, since the strip is where the hand rests; with no
  split there is nowhere to rest that is not the playfield, so a tap is the roll.
- ✅ **Both controls panels learned that a row can be inapplicable.** `Q`, `E`,
  `R`, `F` and the two nudge keys are absent in Flatland, and so are the yaw and
  pitch gestures. One predicate, `appliesToMode`, read by the keyboard map and
  the touch map alike, so the two cannot disagree about what a mode offers. The
  touch panel also drops its "in the bottom strip" notes in a mode with no strip,
  which would otherwise point at a region of the screen that is not there.
- ✅ The greedy agent in `playability.test.ts` only ever rolls, so the balance
  tests were unaffected by the restriction — 335 unit tests passed unchanged.

**Still unassigned, and needed before a run can be completed one-thumbed:** hold,
the depth nudge from Stage 4, and pause. All three want a place to live rather
than a gesture, so they belong with the layout below — the HOLD panel is the
obvious target for hold, and the nudge appearing as two controls at the moment
the mechanic unlocks is a better reveal than a gesture nobody discovers.

### Direct manipulation, not repeated swipes

**Revised in M12c** _(play notes)_. "Drag to place" shipped as an absolute
mapping — the column under the finger is the column the piece is in — and that is
what the bullet below asks for. It was wrong in the hand: lifting a thumb and
putting it down somewhere more comfortable teleported the piece there. Movement
is relative to the piece now, with an origin set per touch. See DESIGN §9.2.1.

A swipe that moves one column is a keyboard binding wearing a costume: eight
columns means eight swipes. The piece should **follow the finger** instead.

- ~~**Drag to place**, absolutely — the column under the finger is the column the
  piece is in.~~ **Superseded.** The reasoning was that position is absolute, and
  it conflated two things: the _board's_ coordinates are absolute, and that says
  nothing about the hand's. Each touch sets its own origin now.
- **Double tap to drop.** Hard drop, once the piece is where it should be.
- **Drag down to soft drop**, so the slow descent is available without a second
  gesture vocabulary.

Three things have to be solved for this to feel right, and all three are
gameplay-affecting rather than cosmetic:

- ✅ **The finger covers the board.** Answered by the relative scheme rather than
  by an offset: the thumb no longer has to be anywhere near the column it is
  aiming at, or near the well at all, so it can rest wherever it does not block
  the view. The strip already kept it below the board in modes that have one.
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

**A scheme to prototype**, proposed and part-resolved. Split the screen: a
narrow strip along the bottom takes horizontal drags and moves the piece;
everything above it takes swipes, and a swipe rotates.

That zoning is the right idea and solves the hardest part — a gesture no longer
has to be disambiguated by what it happens to be near, because the region it
starts in already says which verb class it belongs to.

It does not, on its own, reach three axes. Up, down, left and right are four
gestures; an axis needs two of them to turn both ways, so four gestures cover
**two** axes and the third is left with nothing.

And the axis left over is the one used most. In a falling-block game the constant
rotation is the one in the screen plane — here that is `roll`, on `Z` / `X`.
Yaw and pitch are the depth-aware rotations, and a player reaches for them far
less often. Swipes covering yaw and pitch would strand the game's most frequent
verb.

So the resolution is to invert which verbs get which class of gesture:

| Gesture                          | Verb                        |
| -------------------------------- | --------------------------- |
| Horizontal drag, in the strip    | Move — absolute, per column |
| Fling down, in the strip         | Hard drop                   |
| Slow drag down, in the strip     | Soft drop                   |
| Tap, above the strip             | Roll — the frequent one     |
| Swipe up / down, above the strip | Pitch ±                     |
| Swipe left / right, above strip  | Yaw ±                       |

Putting hard drop on a downward fling rather than a double tap also removes the
collision that double tap creates: with tap meaning roll, every double tap would
roll the piece once on its way to dropping it. A fling is a distinct gesture from
a tap at the first sample, so neither has to wait on the other, and the drop
stops feeling late.

Two things still open in this scheme. **Roll's other direction** — rare, and a
candidate for a two-finger tap or a long press, or for being left out entirely on
the grounds that three rolls get there. And **the strip's height**: tall enough
for a thumb, which is around 44 px, without eating a well that is already 18 rows
in portrait.

The **turn prompt** on a phone is answered two ways. Strip swipes are inverted
from the keyboard: a swipe pulls the board the way the finger moves (swipe left
→ right face comes forward). The prompt's ← / → labels are also tap targets and
keep destination naming — left still means the left-hand face.

### Layout — M12b ✅

- ✅ **Portrait.** The HUD flanked the board and was sized for a desktop:
  `min-width: 8.5rem` on the stats alone is 136px before padding, in a margin of
  about 80px, so the score panel lay across the top-left of the well and covered
  the first rows of the stack.

  It is not moved above and below, and that entry was wrong to assume it should
  be. **The board cannot take the width and never could**: the frustum has to
  hold the footprint's 45-degree diagonal so the board does not change scale
  during a turn, which caps the well at about 62% of the window whatever the HUD
  does. The remaining 38% — two margins of roughly 80px on a 412px phone — is
  permanently empty and is exactly where the HUD belongs. So the columns stay and
  the panels are sized to the gap that already exists.

- ✅ **Safe-area insets**, on the two full-bleed layers rather than on the page,
  so the canvas still fills the display and only what has to be read moves
  inward. The Shift meter is positioned inside the HUD's content box, so it
  follows without knowing about it.

- ✅ **`HUD_RESERVE` re-checked, and it was wrong.** It is measured in _cells_,
  and cells shrink with the window: 1.6 of them is 27 pixels on a phone in
  landscape against a 44-pixel Shift meter, so the meter had always been drawn
  over the bottom rows of the board there. The camera fit now takes a reserve in
  **pixels** and treats it as a floor — the board is only pushed up when the
  framing does not already leave that much — so a desktop is framed exactly as
  before and a short window is not.

- **Landscape as a genuine second layout** — still open, and now the only part of
  this section that is. It works and nothing overlaps, but the well is 87px wide
  on a 863×360 window while roughly 600px of horizontal space sits empty either
  side. The board is height-limited there, so the answer is a layout that uses
  the width rather than a reserve that shrinks the board further.

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

**Not done, and moved to M16**, where the profiling pass lives. Nothing here was
measured, so the section is a list of hypotheses rather than findings — and one
of them changed under it: the gel material added per-fragment work to every cube
in M14, which is exactly the kind of thing a budget exists to catch and exactly
why the budget should be set after the look is settled rather than before.

### Say the mobile controls, not the keyboard ones

The key map in settings is hidden on touch-primary devices already — by input
method rather than by width, since a narrow window on a laptop still has a
keyboard. The slot is empty on a phone until this milestone fills it with the
gestures above. A panel that documents controls the game does not answer to is
worse than one that says nothing, so it stays empty until they exist.

The same table-shared-with-the-implementation approach applies: whatever carries
the gestures should be what the panel reads, for the same reason the key map
reads `BINDINGS`.

### Touch hygiene ✅

`touch-action: none` on the playfield, no pull-to-refresh, no double-tap zoom, no
text selection on a long press, no tap highlight. Individually trivial,
collectively the difference between a web game and a web page.

Two of these were only half done. **Text selection** was scoped to four selectors
and to touch-primary devices, which left the title, the score, the mode blurbs
and every panel body selectable — and on a touchscreen laptop, which is not
touch-primary, all of it. It is app-wide now, with the challenge code kept
selectable because a player has an actual reason to copy theirs. **Horizontal
scrolling** was implied by `overflow: hidden` and is now named, on the page and
on the panel layer, because every way a page starts sliding sideways is an
accident — a panel a few pixels too wide, a long unbroken string — and each one
turns a game into a page that moves under the thumb.

**Exit criteria, met** for everything except the frame budget and the landscape
layout, both carried to M16: a run can be played on a phone with one thumb
without the finger hiding anything the player needs. Eleven end-to-end tests run
against a real device profile rather than a narrowed desktop window, because the
two differ in the way that matters — a narrow window still reports a fine pointer
and still has a keyboard, and the layout branches on that.

---

## M13 — Teaching

**Goal:** a player understands the core idea without being told it in prose.

**This supersedes M10's onboarding bullet**, which said the game should teach
"by design rather than by tutorial text" and named no tutorial at all. The play
note asks for the opposite and is more specific: a **hands-on, on-rails
playthrough** that pauses to highlight the key parts as they happen. Worth
recording as a change of direction rather than a refinement — teaching by pure
design is a lovely goal and this game has one idea too strange to leave to it.

- **On rails.** The tutorial deals a fixed sequence of pieces into a fixed
  board, so every beat lands where the script expects. The engine already
  supports this exactly: a run is determined by `(seed, input log)`, and the
  seeded challenge machinery from M9 is the same mechanism. A scripted board is
  a fixture, not a new code path.
- **Hands-on.** The player makes the moves. A tutorial that plays itself teaches
  the player to watch.
- **Pausing to highlight.** `paused` is already a real `GameStatus` that
  preserves determinism, so the tutorial can stop the clock on a beat, point at
  something, and resume without the run drifting.
- **The beats**, in the order the game reveals them: position is absolute and
  colour is relative; a line is eight cells sharing a row _and a lane_; the
  Shift meter fills and the board turns; a face you could not see becomes the
  face you are playing; a line you did not know you had built clears on arrival.
  The turn is the moment the game exists for, so the tutorial's job is to get a
  player to their first one having understood what happened.
- **Skippable, and offered once.** It runs on first launch and lives in the
  title screen afterwards.

**Sequencing note:** this wants the title screen (M14) to have somewhere to
offer it from, but does not depend on it.

**Exit criteria:** a player who has never seen the game completes the tutorial
and can then say, unprompted, what the colours mean and what turning does.

---

## M14 — The Look

**Goal:** the game looks like itself.

Both original items shipped — gel voxels and the title screen. **M14b below is
open**, which is why this heading no longer carries a tick: a play note arrived
after the milestone closed and belongs here rather than in a milestone of its
own.

- ✅ **A stylised title screen** _(play notes)_. It was plain DOM type on a live
  board, which was right for getting the front door working and is not a title
  screen. The board behind it is the strongest asset the game has; whatever this
  became should use it rather than cover it.

  It does. The scrim is a gradient now rather than a flat 86% wash — opaque
  behind the masthead at the top, clearing toward the bottom where the stack
  sits — and the panel aligns to the top instead of centring, so the composition
  is a masthead over a live scene rather than a card in front of one. The HUD
  goes with it: a score of zero, an empty NEXT and a Shift meter for a run nobody
  has started are furniture from a different screen, and they became legible the
  moment the scrim stopped hiding them.

  **The board turns by itself**, using the game's own turn rather than a rotation
  written for the title, so the front door is a demonstration of the central
  mechanic before anyone has pressed anything — and there is one piece of turn
  choreography in the codebase rather than two that can drift apart. Held between
  turns so it reads as presenting a face rather than as spinning, and suppressed
  entirely under reduced motion.

  On a cold boot the well holds a composed stack: a diagonal ridge with exactly
  one cube per screen cell, which is what puts the whole ramp on the front face
  and makes the same stack a completely different picture from every other. On
  any other visit it holds whatever the player last built, which is a better
  backdrop than anything authored here.

  The masthead is achromatic, because §2.2 partitions the palette absolutely: the
  only hue on screen belongs to a cube. A wordmark running red to violet is the
  exact false inference that rule exists to prevent.

  Responsive from the start rather than retrofitted, since **M12b moves the HUD
  to portrait-first** and a desktop-shaped title would simply have been rebuilt
  there.

  One real bug came out of it, and it is the reason a title that moves the camera
  is not free: the renderer's yaw is its own state, so after a few attract turns
  it sits at 90, 180 or 270 while a new game is always on the front face. The
  board would have come up wearing the palette of a face nobody was playing, with
  every control pointing the wrong way. `snapToFace` on `startRun` closes it, and
  a test holds it.

- ✅ **Gel voxels** _(play notes, with reference images)_. Each cube gets a subtle
  three-dimensional gel material: translucent, lit from within, glossy along the
  bevels, with the glow pooling toward the lower edges and a brighter rim where
  the surface turns away. The reference reads as cast resin — a slightly deeper
  core, faint internal specks, a soft bounce onto the ground.

  **The constraint that governs this is DESIGN §2.5:** a settled cube renders at
  exactly its `depthColor`, and two end-to-end tests hold it there. A gel
  material adds variation _within_ a cube — that is the whole point of it — so
  the rule has to be restated rather than broken: **the cube's mean stays at the
  palette value, and the material lives in the variation around it.** Depth is
  read from the field of cubes, not from any one pixel, so a cube that averages
  to its palette colour still says exactly what it said before. Getting this
  wrong is how the board ended up at a fifth of its palette value once already.

  Second constraint, from §2.1: whatever the material does must not vary with
  depth. A gel that glows more brightly at the front would be a second depth cue
  competing with the spectrum, which is the one thing the projection rules
  forbid outright.

  Built as a `onBeforeCompile` injection on the existing `MeshStandardMaterial`
  rather than as a new material, which keeps Three's lighting maths intact —
  reimplementing it is precisely how the board ended up at a fifth of its palette
  value the first time, an ambient light at 1.18 where the Lambert BRDF needs pi.

  **The fidelity rule is stricter than this entry assumed.** It is not the cube's
  mean that is pinned: §2.5's test samples a 5×5 patch at the _centre of the
  face_ and allows six levels of 255. That turned out to make the material easier
  to get right, not harder — every term is multiplied by one of two masks that
  are exactly zero at the face centre, so the invariant is structural rather than
  tuned and cannot be broken by turning the effect up.

  Two attempts were needed on the look itself, and the difference is instructive.
  The first used a uniform band around the whole perimeter, which reads as a
  backlit tile rather than as a solid: the halo is the entire silhouette lighting
  up at once. Real gloss is directional, so the catch is weighted by how much the
  bevel faces the light, and the all-round component is a true Fresnel term —
  which peaks exactly on the silhouette and draws a thin line rather than a band.
  The pooled glow also went from a lerp toward white to emission tinted by the
  cube's own colour, because resin lit from within glows in its own hue; toward
  white it turned a red cube pink along the bottom third, desaturating the one
  channel that carries meaning.

  See DESIGN §2.6 for the two rules restated, and for the muted-band interaction
  that had to be found by measurement.

**Exit criteria, met:** a still frame of the board is recognisably this game and
nothing else, and the colour-fidelity tests pass unchanged. Five new end-to-end
tests; the depth-independence one was confirmed to fail on a violation confined
to the Fresnel rim alone, which is the narrowest form it could take.

### M14b — The last look _(play notes)_

**On game over the camera eases into a slow, continuous orbit of the board.**

This is the one moment the game is allowed to break its own central rule, and it
should. §2.1 keeps the settled board dead-on so that no spatial cue competes with
colour — but that rule exists to protect a player who is _reading_ the board. The
run is over. There is nothing left to read, no decision left to make, and the
flat discipline of the whole run has been building an object nobody has ever
seen. The orbit is the payoff for it: you spend a run reading a field of colour
and at the end you are shown the solid you actually built.

**The recolour comes free, and is the reason this is the right final image.**
`VoxelLayer.update` computes every cube's colour from the _live_ camera yaw, so
an orbit sweeps the entire stack through the spectrum continuously — the same
mechanism that makes a turn a transformation rather than a crossfade. Nothing has
to be written for it. The board simply becomes the demonstration of its own rule.

Four things it touches:

- **The game-over panel currently hides the thing this exists to show.** It sits
  under the same 86%-opaque scrim as every other screen. It needs the title
  screen's treatment — a gradient that is opaque behind the type and clears over
  the board — which is most of the actual work here.
- **The camera has to ease in from wherever it is.** A run can end mid-anything,
  including mid-turn. `snapToFace` handles the inverse case (starting a run from
  a turning title) and this is the same problem in reverse.
- **A continuous orbit is not the 90-degree turn.** `startTurn` eases between two
  faces and stops; this never arrives. Closer to the title's attract cycle, but
  without the dwell — and it should keep the turn's elevation, since a dead-on
  orbit would be a board spinning edge-on rather than an object being examined.
- **Reduced motion.** Same call as the title's attract turn: an unattended,
  unstoppable animation is exactly what that setting is for. Hold the board
  still, or orbit slowly enough that it reads as drift.

Zen never ends, so it never orbits. Restart already snaps the camera back to the
front face, so no work there.

**Exit criteria:** the board is legible under the game-over panel, turning, and
the colours are visibly cycling as it goes.

---

## M15 — Full Shift

**Goal:** a mode that inverts the turn economy — you buy turns instead of earning
them.

**Flatland's rules, with the turn set free.** Planar pieces only, roll the sole
rotation, no depth nudge — and on top of that, **`A` and `D` turn the board left
or right at any moment, each turn costing one line off the total.**

That is a real inversion rather than a variation. The existing loop is _place →
anticipate → rotate → reveal_, with the rotation arriving on the game's schedule
and the skill being preparation. Here the rotation arrives on the player's
schedule and the skill is knowing when a turn is worth what it costs — a line
spent to reveal a line, or two, or nothing.

Building it on Flatland is what makes it legible rather than merely permissive.
In Flatland the piece never leaves the screen plane, so depth is purely a
property of _where you put things_ — and the board turning is the only
three-dimensional idea in the mode. Handing the player that one lever, and
charging for it, gives them direct control of the single thing Flatland is about.
It is the natural next mode after the one a new player starts in, and a candidate
for an unlock earned there rather than an option offered from the first screen.

### What it costs, and what that touches

`lines` is not just a score. It drives stage progression and gravity through
`modeStage` and `modeGravity`, and it feeds the Shift meter. Subtracting from it
naively would let a player **buy their way back down the difficulty curve**: turn
often enough and the stage never climbs, gravity never accelerates, and the arc
the game is built on is opted out of.

**Recommendation: split earned from spendable.** Progression counts lines _ever
cleared_ and only ever goes up; the HUD's LINES readout shows the balance, earned
minus spent, which is what the player is actually deciding with. The note says
the cost comes off the total, and it does — off the total they can see and spend,
not off the record of how far they have come.

The alternative is to let the cost reach progression as well, so turning is a
brake on difficulty as much as a tool. That is a more interesting mode and a
harder one to keep honest, and it should be a deliberate choice rather than a
side effect of subtraction.

### The rest of the shape

- **The Shift meter has nothing to do here** and should go, not sit at zero. The
  HUD gains a price instead: what a turn costs, and whether one is affordable.
- **Nothing at zero.** A player with no lines cannot turn. That is the whole
  tension, and it wants to be legible before the last line is spent rather than
  discovered at it.
- **Refraction and Prism still pay.** Turning is what makes a line eligible, so
  the chain scoring is the reward the cost is measured against. `refractionScale`
  already exists to tune that balance without touching the engine.
- **`linesPerTurn` changes meaning** from a threshold to a price. Worth a
  distinct field rather than reusing one whose name would then lie.
- **Inherits from Flatland**, so `maxTier: 1` and `startStage: 2` come with it,
  along with the roll-only and no-nudge fields M12 adds. The "no two modes with
  identical rules" test is satisfied by the turn economy alone, which is exactly
  the difference the mode exists for.
- **The name is Full Shift.** It uses the game's own word for turning the board,
  which is what the mode is about: the Shift is no longer rationed by a meter.

  One adjacency to keep an eye on. `Full Spectrum` is already the banner for a
  Prism event — a four-face chain, the game's biggest scoring moment — so two
  `Full` two-word phrases now sit in the same vocabulary, one a mode and one an
  event. They are different enough in context that this is a note rather than an
  objection, but if the mode's banner and the event's banner ever share a screen
  they should not be set alike.

### The binding resolves itself

M11c gives `A` and `D` to yaw, which looked like a conflict: a key meaning "yaw
the piece" in most modes and "turn the board" in this one is the mode-dependent
meaning M11c argued against.

Inheriting Flatland's rules settles it without a special case. Roll is the only
rotation there and the depth nudge never unlocks, so `A`, `D`, `W` and `S` are
**unbound in this mode already**. `A` and `D` are free to take the turn, and they
take it in the shape the game has always used them for: left and right choosing
which face comes forward, exactly as they do at the turn prompt everywhere else.
The key does not change meaning — it stops being conditional on the meter.

**Exit criteria:** a run in which the player turns the board when they choose,
can see what it costs before they commit, and can be caught out by spending their
last line. Pieces stay planar throughout, the stage arc climbs at the same rate
it does everywhere else, and a player who never turns has played Flatland.

---

## M16 — Performance and Release Candidate

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

## M17 — Spectral Collapse ✅ _(play notes)_

**Goal:** a rare, earned, board-wide event — the one thing that destroys
structure the ordinary rules preserve.

**Sequencing: this must land before M16, not after it.** It is numbered later
because it arrived later, but M16 is the release-candidate pass — profiling,
visual regression baselines, final difficulty tuning — and none of that means
anything with a core mechanic still to come.

### The mechanic

A **hot bar** fills as lines are cleared and cools on its own, so it only rises
if the player keeps clearing. Full, it glows and flickers, cooling suspends, and
**Spectral Collapse** becomes available. Triggering it collapses the stack: every
voxel falls independently to the floor of its column, any lines completed by the
settling clear immediately, the bar empties and cooling begins again.

### Why it is worth a milestone: it is the operation the rules refuse

This is not "gravity, but bigger". `Board.clearLines` runs per-column naive
gravity and is deliberately careful _not_ to do this, in its own words:

> Suspended cells stay suspended — a piece bridging two columns can legitimately
> leave a cell with nothing beneath it, and compacting the whole column would
> silently destroy that structure.

So overhangs accumulate for the whole run and nothing removes them. A piece that
does not fit its footprint locks with a gap under it — that is the entire subject
of M10's landing marks — and those gaps are most of what makes a board hard.

Spectral Collapse is a new, explicit `Board` operation: full per-column
compaction, applied to the whole board, on demand. It leaves §3.1 untouched,
which matters — the clear-time rule is what keeps a face you cannot see
predictable, and this must not quietly become the general behaviour.

That framing also settles why it has to be rare and earned: it is the only thing
in the game that erases accumulated structure wholesale.

### The colour rule, stated first because it is the easiest thing to get wrong

A heat gauge conventionally runs blue to red. **That is forbidden here**, and not
mildly: red means _near_ and violet means _far_, and a bar that reddens as it
fills would teach a player that colour means intensity — the exact false
inference §2.2 exists to prevent, and precisely what the standing amendment rules
out (no spectrum for scoring tiers, difficulty or progression).

The gauge is achromatic. It expresses heat the way the room already expresses
everything: **as brightness and agitation, not as temperature.** The shimmer
growing wilder toward full is the right instinct and is already the game's
language — see §2.4, "the room answers the board by getting brighter, not by
changing colour."

### Two meters fed by the same action

The Shift meter already fills as lines are cleared. A second gauge on the same
input is a real risk: a player who sees two bars move together will not know
which one is about to do something, and one of them freezes the game to ask a
question.

They have to differ in kind, not only in position:

|           | Shift meter                  | Hot bar                      |
| --------- | ---------------------------- | ---------------------------- |
| Fills on  | lines, cumulative            | lines, against a decay       |
| Shape     | discrete pips                | continuous column            |
| Placement | horizontal, below the board  | vertical, on the wall        |
| Fires     | automatically, freezing play | only when the player chooses |

The decay is what makes them legible as different things: the Shift meter never
falls, and this one always is. A player who stops clearing watches one hold and
the other drain, which teaches the distinction without a word.

### Decisions, as made

- ✅ **The bar lives in screen space**, pinned to the right edge of the well's
  silhouette and spanning its height. World space would have turned it with the
  board — sweeping away and sometimes sitting behind the stack, which is unusable
  for a gauge read under pressure.
- ✅ **Cooling is tick-driven**, off `deltaMs`, so replays and challenge codes
  survive.
- ✅ **A collapse does not refill its own bar.** Its clears are real lines: they
  score, they count, they feed the Shift meter. They just do not feed the thing
  that made them, or a large enough stack buys the next collapse outright.
- ✅ **It scores through the ordinary resolution cycle.** `triggerCollapse`
  compacts and then calls `beginResolve`, so the clears glow, cascade and score
  exactly as any other clear does. Reusing that is what keeps a collapse _a lot
  of clears_ rather than a special case with its own rules.
- ✅ **On in every shipped mode, including Flatland.** The mode-table field remains
  so a mode can still withhold the gauge and bindings; Flatland no longer does.
  (Was off at first ship — see M17b.)
- ✅ **Ready cue is not the spend.** Crossing full fires `spectralReady` once:
  sampled klaxon, banner **SPECTRAL COLLAPSE IMMINENT** / **PRESS V TO TRIGGER**.
  Spending plays `collapse.webm`, a short white bloom, room react, and shake —
  without announcing the collapse as if it had already happened.
- ✅ **The piece in hand comes down with everything else.** It is a group of
  voxels in the air when the floor gives way; leaving it hovering would be both
  odd to look at and a second state to reason about. `lock` was split so the
  collapse can settle a piece without starting a resolution.
- ✅ **Trigger:** `V` on a keyboard — chosen for where it sits, next to `Z`, `X`
  and `C`, rather than for what it spells; `W` was free and left alone for M11c.
  On touch, a sliding **X** button above pause while the bar is full — the gauge
  stays a readout so a thumb over the well always reaches the piece.

### Decisions that were open

- **Where the bar lives.** "Attached to the right wall" reads as world space, and
  in world space it turns with the board — so it would sweep away and sometimes
  sit behind the stack, which is unusable for a gauge you need to read under
  pressure. Recommendation: screen space, pinned to the right edge of the well's
  silhouette and drawn as part of the frame, so it reads as attached without
  rotating away. Worth deciding explicitly.
- **Cooling must be tick-driven, not wall-clock.** A run is determined by
  `(seed, input log)`; the engine already steps on a fixed timestep, so this is
  free if done right and silently breaks every replay and challenge code if it
  reads `Date.now()`.
- **The collapse must not refill its own bar.** Lines cleared by the settling are
  real lines and should score, but feeding them back into the hot bar is a loop.
  Whether they feed the _Shift_ meter is a separate question with a real
  consequence: a large collapse could fill it and force a turn immediately, which
  might be a good moment or a confusing one.
- **How it scores.** The cascade machinery already exists and a collapse is
  structurally a cascade — several lines resolving at once, possibly in waves.
  Reusing it is likely right and needs checking rather than assuming.
- **Which modes have it**, as a field in the mode table like everything else.
  Almost certainly not Flatland, which is the mode a new player starts in and
  already carries the game's one strange idea on its own.
- **What happens to the falling piece**, and which states allow a trigger —
  falling, awaiting a turn, mid-turn, resolving. Probably falling only.
- **Input.** Unassigned on both keyboard and touch. Touch is the harder half: in
  a roll-only mode there is no strip to put it in, and tapping the gauge itself
  is the obvious answer since it is already the thing announcing readiness.

### The balance risk, and why the agent could not settle it

It removes most of what makes a board hard, so the earn rate is the only control.
This entry said to tune it against the greedy agent, **and that turned out not to
work.** The agent hard-drops every piece and only runs the clock while a clear or
a turn resolves, so it spends no thinking time at all — and this mechanic is
priced in time. An agent with none reports that the bar fills instantly.

What the agent _can_ give is the line rate, which is measured: about 0.3 lines
per piece. The rest is a model, written out in `game.ts` and pinned by
`heatModel` in the tests:

| Clearing at       | Result                    |
| ----------------- | ------------------------- |
| 0.3 lines/second  | fills in about 45 seconds |
| 0.15 lines/second | loses ground, never fills |

The pace behind that — roughly a piece a second — is an assumption, and it is
labelled as one. It wants playtesting to confirm, which is the honest state for a
number that depends on how fast a person actually plays.

It also rescues a player from an imminent top-out, which is the point, but means
the mechanic is at its most valuable exactly when the run is least under control.

**Exit criteria, met:** the gauge reads its level and carries no hue at any fill
(held by test against the same threshold as the room and the masthead); a
collapse resolves through the ordinary clear cycle rather than as a special case;
the mechanic is absent — gauge, key row and gesture row — in a mode without it.
Seventeen unit tests and seven end-to-end.

**Still open:** whether the collapse's clears should feed the Shift meter is
answered "yes" by reusing the resolution cycle, and that has a consequence worth
watching in play — a large collapse can fill the meter and force a turn
immediately. That may be a good moment or a confusing one, and only playing it
will say.

### M17a — The gauge cools too fast ✅ _(play note)_

**Asked for:** cooling at a fifth of its current speed.

One constant: `HEAT_DECAY_PER_MS` from `1 / 26_000` to `1 / 130_000`. The bar goes
from full to empty in 130 seconds of clearing nothing rather than 26.

**What that does to the model.** M17's numbers came from a model written down in
`game.ts`, and this changes both halves of it. At the modelled pace — a brisk
player at roughly a piece a second, clearing 0.3 lines per piece — a collapse is
earned in about **19 seconds** instead of about 45.

The second half is the one worth a decision rather than a shrug. The model's
other claim was that **at half that clearing rate the bar loses ground and never
fills**, which is the pressure the mechanic exists to create. At a fifth of the
cooling that stops being true: the break-even rate drops to about 0.04 lines per
second, which is slower than almost any play. The bar would fill eventually
whatever the player does, so Spectral Collapse becomes a reward for playing long
enough rather than for keeping a pace up.

### Decided: cooling ÷5 and `HEAT_PER_LINE` 0.2 → 0.1

Both constants move together, and the pair does something neither half does
alone. Cooling ÷5 on its own doubles how often a collapse arrives; halving the
earn rate alongside it puts that back almost exactly where it was, while keeping
all of the forgiveness.

|                                          | Now                        | Decided                     |
| ---------------------------------------- | -------------------------- | --------------------------- |
| `HEAT_PER_LINE`                          | 0.2                        | 0.1                         |
| Cooling, per second                      | 1/26 ≈ 0.0385              | 1/130 ≈ 0.0077              |
| Lines to fill, ignoring decay            | 5                          | 10                          |
| Time to fill at the modelled 0.3 lines/s | ≈ 46 s                     | **≈ 45 s**                  |
| Break-even clearing rate                 | 0.19 lines/s (64% of pace) | 0.077 lines/s (26% of pace) |
| At half the modelled pace                | never fills                | fills in ≈ 137 s            |

So the cost of _earning_ a collapse through sustained good play is unchanged —
about three quarters of a minute either way — and what changes is the penalty for
easing off. The old cliff, where dropping to two thirds of pace meant the bar
could never fill at all, becomes a gradient: half pace still gets there, in a bit
over two minutes.

This also makes each line a **tenth** of the gauge rather than a fifth, so the bar
moves in finer steps and reads more like a filling gauge and less like a five-slot
counter. Worth a look on screen once it is in.

**Also in scope:** the `heatModel` unit tests pin both halves of the old model.
"Never fills at half pace" stops being a true statement about the game and has to
be rewritten rather than retuned — the property that survives is that the bar
still _loses_ ground below a quarter of the modelled pace. The prose model in
`game.ts` gets the new arithmetic, including the note that the two constants were
moved as a pair and why.

**Shipped.** Both constants moved, and the model in `game.ts` was rewritten
rather than having its numbers edited. `never fills at half that rate` became
`costs a player who eases off, without shutting them out` — it asserts that half
pace takes more than twice as long as full pace and still arrives inside three
minutes — and a new `still loses ground below a quarter of the modelled pace`
holds the floor at `Infinity`, which is what keeps this a rate mechanic. Both
were checked by sabotage: restoring the old cooling fails the first, and
over-cooling to `1 / 400_000` fails the second.

**Wants play, not arithmetic.** The break-even rate is 0.077 lines/second and the
whole of this change lives in how it feels to sit near it. Worth watching for two
things: whether a gauge that only empties over 130 seconds now reads as a bar
that is always nearly full, and whether tenths make the fill legible or merely
smaller.

---

## M18 — The Front Door ✅

A real title screen: assets are fetched before the game opens, a bar reports the
fetch, and a tap opens the door. The tap is the point — a browser will not start
an `AudioContext` outside a user gesture, so until there was a screen whose only
job was to collect one, menu music was not a thing this game could have.

**Shipped**

- `src/assets/preload.ts` — streaming fetch with weighted, monotonic progress, a
  stall timeout rather than a deadline, and failure that resolves rather than
  throws. No DOM, so it is unit-tested in the node environment.
- `src/audio/tracks.ts` — the music manifest, one `?url` import per track that
  actually plays, so the bundler hashes and emits it.
- `src/audio/music.ts` — a streamed `<audio>` through a
  `MediaElementAudioSourceNode` into the existing master gain, with fades.
- The `boot` screen: centred wordmark, bar beneath, `TAP TO PLAY` once loaded.
- `Blockfall Skyline` plays on the menu and stops when a run begins.

**Decisions**

- **Streamed, not decoded.** 137 seconds of stereo at 48 kHz is ~53 MB of
  resident float32 for a 1.8 MB file. The cost is a loop seam a buffer would not
  have; taken deliberately, and only for music.
- **Deep links go round the door.** `?mode=` and `?challenge=` open straight
  into a run. The gate fills a wait and collects a gesture, and a player arriving
  on a shared code has already chosen. The preload still runs behind the run.
- **A missing track cannot jam the door.** The bar completes and the button
  appears regardless; the game is playable without music.

---

## M19 — Audible on a phone, and a door that settles ✅

The theme played on a laptop and was silent on mobile. Music no longer goes
through the Web Audio graph — `createMediaElementSource` moves output onto a path
iOS treats as ambient and silences — so the element plays itself, mute is a pause
rather than a zero level, and the page declares `audioSession.type = 'playback'`.
A track is now a list of encodings chosen by `canPlayType` before the fetch, so a
device that cannot decode WebM/Opus can be given an `.m4a` by dropping the file in.

Also: the tagline is off the gate, the board is pushed into a true backdrop there
(zoomed past its own edges, well frame faded), and panels cross-fade instead of
cutting.

**Open:** no `.m4a` ships, so if the cause is the codec rather than the routing,
one has to be encoded. The command is in `tracks.ts`, and `?debug=1` reports
`music().error` and `music().source` to tell the two apart.

## M20 — The room becomes the title screen ✅

The composed stack is gone from the title; the room carries the picture. The
wireframe blocks are solid voxels of assorted sizes, coloured from the ramp on
the menus and absent during a run.

Two constraints shaped it, both from the orthographic projection:

- **Visible width is fixed and aspect-dependent** — about ±19 units on a laptop,
  about ±7 on a phone in portrait, which is inside the well. One ring cannot fill
  both, so the field is two bands: beside the well, and above and below it.
- **No radius keeps a floater out of the well's column**, since screen-x is
  `r·cos(angle − yaw)` and the camera orbits. A solid cube behind the playfield
  shows through every empty cell, which is why the wireframe field is kept for
  play rather than replaced.

Colour is gated by §2.2: hue means depth from the current camera, so the room
shows the ramp only when no board is being read.

---

### M20a — Corrections to M20 ✅

Placement, count and size of the drifting field restored to the wireframes' own —
the note was to change what they are made of, not where they float. One field
again, with a fade that keeps a voxel out of the play column while a board is
being read, since no radius can do that geometrically. The well is hidden on every
screen where nobody is playing, and the menu is vertically centred like the gate.

---

## M21 — The room holds still ✅

The attract turn is gone: it orbited the camera to present a stack that no longer
exists, and with the room fixed in world space that dragged the whole background
across the screen on a timer. Group rotations gone with it, and the five drifting
shafts of light deleted. The floaters bob and turn individually; nothing moves as
a body.

The field is placed from a measured seed rather than `Math.random`, so it is an
arrangement someone looked at instead of one rolled per load — and the same one
the tests and captures see.

Also found: the title screen had never been getting its lighter scrim. The rule
listed `boot` alone, so the menu still took the blackout meant for panels over a
paused run.

**Open:** mobile music. Second attempt — the element now uses the network URL
rather than a blob, which WebKit's media loader handles better. Unconfirmed from
here. The gate reports `MUSIC UNAVAILABLE` with a reason when there is none, which
names the cause without devtools.

---

### M18a — The rest of the music ✅

Five more tracks sat in `src/audio/tracks/` unreferenced. They now form a
**gameplay bed**: shuffled at random when a run is on screen, advancing when a
track ends. Theme loops on the main menu (and mode / challenge); the boot gate
stays silent. The front door preloads the whole catalogue; theme is prepared
immediately, gameplay waits as a pool.

Of the three candidates — per-mode, tension-layered stems, or a shuffled pool —
this ships the third. Tension still drives the lattice alone; coupling a bed to
it is a later design claim, not a precondition for having music under a run.

---

### M22f — A way home, and scores behind a fold ✅ _(play note)_

Game over gains **Main Menu** (same quit path as pause). The title's session
log and lifetime totals move behind a collapsed **Scores** fold — out of flow
when open, so the wordmark does not jump — and stay hidden until there is
something to show.

---

### M22g — Mode grid by difficulty ✅ _(play note)_

The mode table is listed easiest → hardest: Flatland, Zen, Ascent, Endless,
Prism, Blind Spectrum. Cards carry a pip rating and a cool→warm accent (not
spectrum stops). `difficulty` is presentation only; the engine ignores it.

---

### M22h — Caption washes, and a game-over ledger ✅ _(play note)_

Floating type over the board (popups, MUTED, stage / event banners, chain,
spinning NEXT label) and secondary front-door copy (tagline, loading notes)
now sit on the same soft edge-faded void wash as the title Scores fold —
ground without a plate. Achromatic over a live board; beam-tinted only on
boot/title. Wordmark, Scores toggle, and menu copy on the `.screens` scrim
were left alone on purpose.

Game over stops being a stack of captions: one washed result block with
masthead rules, a labeled score hero, a best pill, LINES / STAGE columns, and
a challenge chip when the run was coded.

---

### M22i — The title voxel as the page icon ✅ _(play note)_

Favicon and apple-touch-icon now draw the wordmark's O: the corner-on voxel
from M22d, in `--accent-beam` on `--surface-deep`. The spectrum cube they
replaced was legible as a rainbow square, not as this game.

---

## Deliberately out of scope

Not in this plan, and not by accident:

- **Multiplayer or leaderboards.** The core loop has to prove itself solo first.
- **Deployment.** GitHub Pages is explicitly disabled. `npm run build` produces
  a portable static bundle in `dist/`; where it gets hosted is a later decision.
- **Level editor, daily challenges, cosmetics.** Post-1.0 candidates.
