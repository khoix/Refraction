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

- **Ghost and contact clarity pass** — re-tune opacity, emphasis and hierarchy
  once the above lands, and check behaviour on highly occluded boards.

**Exit criteria:** a new player reaches their first turn without instructions and
understands what happened afterwards. The ghost is findable at a glance on a full
board, and no cube is dimmed unless it sits behind the falling piece.

**Sequencing (updated):** the two items that led this milestone — the x-ray
rollback and the ghost — have shipped, along with everything the play notes
added after them. What remains is Peek, the rotating preview, and the clarity
pass; none of them blocks anything else, and the onboarding bullet has moved out
to M13.

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

## M12 — Mobile

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
drag chooses the face. Same gesture, same double duty Left and Right already do
on a keyboard in exactly that state.

**Gate the split by mode** _(play notes)_. The field/strip split exists to carry
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

**Confirmed shape: Flatland becomes roll only, with no depth nudge at all.** The
piece never leaves the screen plane, and its lane changes only when the board
turns — which is what "pure projection reading" has always claimed and what the
mode's own blurb already promises. Two fields in the mode table carry it:

- **Which rotation axes the mode permits.** Flatland gets roll alone.
- **Whether the depth nudge is ever available.** `forceDepthNudge` exists to turn
  it on early; the inverse is missing, and a mode needs to be able to withhold it
  outright rather than merely start below stage 4. Worth folding both into one
  field — never / by stage / always — rather than adding a second boolean that
  contradicts the first.

Everything else follows from those two:

- Touch drops the split in roll-only modes. Tap to roll, drag to move.
- `Q`, `E`, `R`, `F`, `T` and `G` do nothing in Flatland, so the key map — built
  from `BINDINGS` — has to learn that a row can be inapplicable to the mode in
  play. Otherwise it lists keys the engine is ignoring, which is exactly the
  drift the shared table exists to prevent.
- The greedy agent in `playability.test.ts` only ever rolls (`rotate(offsets,
'z')`), so the balance tests are unaffected by the restriction.

**Still unassigned, and needed before a run can be completed one-thumbed:** hold,
the depth nudge from Stage 4, and pause. All three want a place to live rather
than a gesture, so they belong with the layout below — the HOLD panel is the
obvious target for hold, and the nudge appearing as two controls at the moment
the mechanic unlocks is a better reveal than a gesture nobody discovers.

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

### Say the mobile controls, not the keyboard ones

The key map in settings is hidden on touch-primary devices already — by input
method rather than by width, since a narrow window on a laptop still has a
keyboard. The slot is empty on a phone until this milestone fills it with the
gestures above. A panel that documents controls the game does not answer to is
worse than one that says nothing, so it stays empty until they exist.

The same table-shared-with-the-implementation approach applies: whatever carries
the gestures should be what the panel reads, for the same reason the key map
reads `BINDINGS`.

### Touch hygiene

`touch-action: none` on the playfield, no pull-to-refresh, no double-tap zoom, no
text selection on a long press, no tap highlight. Individually trivial,
collectively the difference between a web game and a web page.

**Exit criteria:** a full run — start to game over, including a turn and a hold —
played on a phone with one thumb, without the finger hiding anything the player
needs, and holding its frame budget on a mid-range device profile.

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

- **A stylised title screen** _(play notes)_. It is plain DOM type on a live
  board today, which was right for getting the front door working and is not a
  title screen. The board behind it is the strongest asset the game has;
  whatever this becomes should use it rather than cover it.
- **Gel voxels** _(play notes, with reference images)_. Each cube gets a subtle
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

**Exit criteria:** a still frame of the board is recognisably this game and
nothing else, and the colour-fidelity tests still pass unchanged.

---

## M15 — Turning on Demand

**Goal:** a mode that inverts the turn economy — you buy turns instead of earning
them.

Every mode so far earns its turns: cleared lines fill the Shift meter, and when
it is full the board demands a direction. This one hands the player the button
and charges for it. **`A` and `D` turn the board left or right at any moment, and
each turn costs one line off the total.**

That is a real inversion rather than a variation. The existing loop is _place →
anticipate → rotate → reveal_, with the rotation arriving on the game's schedule
and the skill being preparation. Here the rotation arrives on the player's
schedule and the skill is knowing when a turn is worth what it costs — a line
spent to reveal a line, or two, or nothing.

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
- **The mode still needs a name.** The modes are Ascent, Endless, Prism,
  Flatland, Blind Spectrum and Zen — each says something about what it is. This
  one is about paying for the reveal.

### The binding, which conflicts with M11c

M11c gives `A` and `D` to yaw. This mode wants them for the turn, and a key that
means "yaw the piece" in five modes and "turn the board" in the sixth is exactly
the mode-dependent meaning M11c argued against — it teaches a reflex that is
wrong everywhere else.

Two clean ways out, and it should be one of them rather than a special case:

- **This mode does not offer yaw**, which frees `A` and `D` honestly. Defensible:
  a mode built around turning the board may not want the piece turning about the
  same axis as well.
- **Turning on demand takes the freed `Q` and `E`**, and `A` / `D` keep meaning
  yaw everywhere.

**Exit criteria:** a run in which the player turns the board when they choose,
can see what it costs before they commit, and can be caught out by spending their
last line. The stage arc still climbs at the same rate it does everywhere else.

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

## Deliberately out of scope

Not in this plan, and not by accident:

- **Multiplayer or leaderboards.** The core loop has to prove itself solo first.
- **Deployment.** GitHub Pages is explicitly disabled. `npm run build` produces
  a portable static bundle in `dist/`; where it gets hosted is a later decision.
- **Level editor, daily challenges, cosmetics.** Post-1.0 candidates.
