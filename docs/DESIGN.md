# Refraction — Design Specification

This is the implementation-facing spec. It takes the gameplay proposal as the
source of intent and resolves it into rules precise enough to build and test
against.

Where the proposal was silent or ambiguous, the resolution is marked **[GAP]**
with the reasoning. Those are the decisions most worth arguing with.

The governing rule, unchanged: **position is absolute, colour is relative.**

---

## 1. The board

| Property     | Value                          |
| ------------ | ------------------------------ |
| Width (X)    | 8                              |
| Height (Y)   | 18 visible                     |
| Depth (Z)    | 8                              |
| Spawn buffer | 3 rows above the visible field |
| Total cells  | 1152 visible                   |

X and Z **must** stay equal. Every 90° turn swaps which of them is the on-screen
horizontal axis, and the playfield has to be the same width from every face.
This is enforced as a compile-time assertion in `src/core/constants.ts`.

Gravity always points along −Y. Y is never affected by a turn, so stack height
is physically consistent from all four faces.

## 2. Faces and projection

Four canonical viewing directions. The camera orbits; the board never moves.

Camera position is `centre + R · (sin θ, 0, cos θ)` with world +Y up, which makes
the on-screen right vector `(cos θ, 0, −sin θ)`.

| Face  | Camera yaw θ | Screen horizontal | Nearest lane |
| ----- | ------------ | ----------------- | ------------ |
| Front | 0°           | +X                | high Z       |
| Left  | 270°         | +Z                | low X        |
| Back  | 180°         | −X                | low Z        |
| Right | 90°          | −Z                | high X       |

This reproduces the proposal's projection table exactly. Consequences, all
verified by tests in `tests/unit/projection.test.ts`:

- Opposite faces produce **mirrored** columns: `u_opposite = 7 − u`.
- Opposite faces produce **inverted** depth: `lane_opposite = 7 − lane`.
- `toView` and `fromView` are exact inverses for every cell on every face.
- Screen Y always equals world Y.

### Turn direction

A turn direction names the **face that comes forward**. Pressing left brings
the face that was on the player's left into view; pressing right, the one on
their right. It used to mean the opposite — "right" spun the world right, which
delivered the left-hand face — and playtesting was unambiguous: players read
the prompt as pointing at a destination, not at a spin.

```
left:   front → left  → back  → right → front
right:  front → right → back  → left  → front
```

Choosing left orbits the camera towards −θ; choosing right towards +θ. The
camera animates the way the player asked, never the short way round.

### 2.1 Presentation: depth is colour, and nothing else **[GAP]**

Depth here is a **game mechanic, not a simulation of space**. A cube eight lanes
back is exactly the same size on screen as one at the front, and sits at the same
height. Nothing about it says "far away". The only thing that changes with depth
is colour.

This is the rule everything else defers to. Perspective foreshortening, size
falloff and distance haze would each quietly undermine it by offering a second,
more familiar depth cue — and players would read distance instead of reading
colour, which is the skill the whole game is trying to teach.

So the projection is **orthographic and stays orthographic**.

The board reads as flat 2D when settled: dead-on, orthographic, uniformly lit,
so every cube is a flat coloured tile. Turning orbits the camera. Cubes become
visibly cubes because their side and top faces come into view and the stack
separates horizontally — both genuine consequences of the rotation, neither of
them a distance cue.

|              | Settled on a face | Midpoint of a turn       |
| ------------ | ----------------- | ------------------------ |
| Projection   | orthographic      | orthographic — unchanged |
| Cube size    | uniform           | uniform — unchanged      |
| Yaw          | exactly on a face | sweeping 90°             |
| Elevation    | 0° — dead-on      | 12°                      |
| Lighting     | flat ambient      | directional key and rim  |
| Cube spacing | flush             | opened uniformly         |
| Well         | flat frame        | plus the box posts       |

Flatness follows a half sine over the turn: 1 at the start, 0 at the midpoint,
1 on arrival. The board is fully flat the instant it settles.

Two of those mid-turn changes deserve their reasoning stated, because both look
at first glance like the depth cues this section just forbade:

- **Elevation.** Dead level, a cube never shows its top face and the rotating
  stack reads as a squashed mosaic rather than as cubes. Twelve degrees is
  enough to tell them apart. It costs nothing against the rule — orthographic
  means a far cube is still exactly the size of a near one — and it returns to
  zero the moment the board settles, so a face at rest offers no spatial cue at
  all. `TURN_ELEVATION_DEG` is a single constant; set it to 0 to remove it.
- **Cube spacing.** Every cube shrinks by the _same_ factor as the board turns.
  Packed flush they smear into bands at an angle; opening the gaps lets each one
  read individually. Uniform is the important word: it is a legibility
  adjustment applied equally to all of them, carrying no depth information.

Two consequences follow, and both are deliberate.

**Colour is the only depth channel.** Uniform size is also what makes a nearer
cube cover the ones behind it exactly, which is what keeps the settled board
looking flat. The whole weight sits on the spectrum ramp.

**Occlusion is real.** A near cube completely hides what is behind it, exactly
as the proposal's occlusion section describes. The information is not lost: a
tile's colour is the depth of the _nearest_ cube in that screen cell, so a
violet tile proves every lane in front of it is empty. Everything else is
recovered by turning, and later by Peek.

### 2.2 The spectrum is reserved

The rule above has a converse that is just as binding, and it is easier to break
by accident.

**A hue on screen means depth from the current camera, and means nothing else.**
Red through violet may not also stand for stage progression, objectives, piece
categories, scoring tiers, difficulty, or targets the player is meant to hit.

The failure mode is not ugliness, it is a false inference. A player shown a
stage called "Green", or an amber Shift meter, is being given a second colour
language with no marker separating it from the first — and the reasonable
conclusion is that colour means something in the rules beyond depth. From there
it is a short step to believing green cubes must be cleared, or that the amber
pips indicate a colour to aim for. Neither rule exists. The game would have
taught them anyway.

So the palette is partitioned:

| Surface                                                                              | Colour                                          |
| ------------------------------------------------------------------------------------ | ----------------------------------------------- |
| Cubes on the board                                                                   | spectrum, by lane depth from the current face   |
| Cubes in the next-piece preview                                                      | spectrum, by the lane that piece will arrive in |
| The environment behind the play column                                               | decorative — hue, strobe, spectacle             |
| Everything that describes the rules — HUD, meter, banners, popups, prompts, overlays | achromatic                                      |

The HUD chrome is drawn from a neutral ink ramp with a single near-white accent
(`--accent-ui`). A second colour language _that makes claims about the rules_ —
a stage named for a spectrum band, a tinted Shift meter, rainbow scoring
banners — is what the partition forbids. Decorative colour in the room behind
the board makes no such claim, and the near-opaque play column is the device
that keeps it off the cubes.

Two consequences worth stating, because both replaced something that looked
better in isolation:

- **Stage banners and the stage readout are colourless.** They were briefly
  tinted with the band matching the stage number. It read well and it was wrong.
- **Scoring banners are white, not a rainbow sweep.** White is also the truer
  image: the whole spectrum together is white light, which is exactly what the
  board does when a Prism chain closes.

This rule is not permanent scripture — a future mechanic could earn a spectrum
reference, if it is deliberately built on the same colour-is-depth relationship
rather than borrowing the palette for flavour. The bar is that the reference has
to be _about_ depth. `Blind Spectrum` mode clears it; a stage named "Green" does
not.

### 2.3 Stage identity **[GAP]**

Stages are identified by **number**. There is no default name.

A stage may take a name only when it has an identity worth naming — a rule of
its own, a new piece class, different rotation behaviour, a board condition, an
environmental theme — and the name has to tell the player something the number
does not. Flavour is not a reason. None of the seven authored stages qualifies
today, so none of them has a name; `StageConfig.name` is optional and unset.

When a stage does earn one, it is shown **alongside** the number rather than
instead of it (`Stage 4 — Eclipse`), so the player never loses their place in
the arc. And it may not be a spectrum band, for the reason in §2.2.

### 2.4 The environment

The board floats in a loud space: coloured beams, cycling fragments, a pulsing
lattice, drifting dust, and rings that ripple on clears. It exists to make the
game feel alive, and it is allowed **hue, brightness, contrast, density,
geometry and motion**. Decorative colour makes no claim about the rules.

It is strictly a backdrop, by construction rather than by tuning. A near-opaque
(~95%) panel sits behind the well, sized to the projected footprint, so a board
pixel always wins — nothing environmental can sit between the player and a cube,
and none of its motion is coupled to board depth. From inside the column, the
disco is a rumour; from outside it, it is the room.

It reacts to play: a small pulse on lock, a ripple and colour surge on a clear,
a creeping density as the Shift meter fills, stronger movement through a turn,
and a major response to a Refraction Clear or a Prism. Under reduced motion the
ambience and the slow hue cycle stay; the strobe is cut entirely — a dim flash
is still a flash.

## 3. Lines

A **line** is 8 cells sharing a `y` and a `lane`, spanning the current face's
horizontal axis. It is a line, not a plane: clearing it removes exactly 8 cells.

- From Front/Back, a line spans X at a fixed (Y, Z).
- From Left/Right, a line spans Z at a fixed (Y, X).

Only lines on the **current face's** axis are eligible. This is the whole
strategic engine: structures that are incomplete now may already be complete
along the axis you will be playing two turns from now.

### 3.1 Gravity after a clear **[GAP]**

The proposal says "blocks fall vertically" without saying which blocks.

**Resolution: per-column naive gravity.** Each `(x, z)` column compacts
independently — every cell above a cleared cell in that column falls by one.
Pieces are not treated as rigid bodies and may be split by a clear.

Clearing a line at `(y, lane)` therefore touches only the 8 columns in that
lane. The rest of the board is untouched.

Rationale: this matches classic falling-block behaviour, so it needs no
explanation; it keeps cascades locally predictable, which matters enormously
when the player is reasoning about a face they cannot currently see; and it is
cheap to simulate exactly, which keeps replays deterministic.

### 3.2 Cascades

After a clear, gravity runs, then lines are re-checked on the same axis. Repeat
until stable. Each iteration increments the cascade counter and its multiplier.

## 4. Pieces

### 4.1 The catalogue **[GAP]**

The proposal describes four tiers but never enumerates the pieces.

In 3D, a rotation about a piece's long axis is legal, which means **J and L are
the same tetracube**, and so are **S and Z**. The honest free-tetracube set is 8:

| Tier        | Pieces                                                       | Introduced |
| ----------- | ------------------------------------------------------------ | ---------- |
| 1 — Flat    | I, O, L, T, S — the 5 planar tetracubes, one lane deep       | Stage 1    |
| 2 — Bent    | screw-left and screw-right — the two chiral quarter-helices  | Stage 2    |
| 3 — Folded  | tripod — a cube with three mutually perpendicular arms       | Stage 4    |
| 4 — Complex | full set, spawn orientations chosen for projection ambiguity | Stage 6    |

Because J/L and S/Z are the same object, spawn orientation is randomised so they
still _present_ as J or L, S or Z. Players get the familiar seven silhouettes;
the board keeps its honest geometry. This is a feature, not a compromise — the
first time a player rotates an "L" into a "J", they have learned something true
about the board.

Tier 4's "projection ambiguity" is implemented as exactly that: at tier 4 the
dealer deals each piece in a random orientation drawn from a third seeded
stream, so a familiar shape can arrive as any of its projections. There are no
tier-4-only shapes; the tier changes how the existing eight present, not what
exists.

#### The experimental vocabulary

`?pieces=experimental` swaps in a playtest catalogue: the screws at tier 1 so
depth arrives with the very first bag, a tricube (`V3`) as a rescue piece, the
tripod earlier at tier 2, and three non-planar pentacubes (`HOOK5`, `TWIST5`,
`CROSS5`) at tier 3. It is a bed for the M6.5 experiment — does the game read
better when it stops resembling Tetris sooner? — and is never the default. Each
candidate is measured with the greedy agent in `playability.test.ts` before any
human judgement; whatever earns its place graduates into the standard catalogue
with its own tier, and the rest is deleted.

#### Correction: tier 2 as originally specified is impossible

This spec first described tier 2 as "a planar tetracube with one cube pushed one
lane forward or back". That construction cannot exist. Move a cube from
`(x, y, 0)` to `(x, y, 1)` and it shares a face with none of the remaining
cubes — every one of them now differs from it in two coordinates at once — so
the piece always falls apart. `tests/unit/pieces.test.ts` proves it exhaustively
over every planar piece and every possible push.

The screws are what that tier actually wanted: each is a four-cube chain whose
every turn is perpendicular to the last, which reads exactly as "a familiar
piece with a cube bent out of plane" while being a real tetracube. They are also
the reason the catalogue has eight pieces rather than seven — the two screws are
mirror images that no rotation can superimpose, so unlike J/L and S/Z they stay
distinct in 3D.

### 4.2 Depth-lane assignment **[GAP — most consequential]**

The proposal has the player moving only along the visible horizontal axis, and
never says which depth lane a piece occupies.

Taken literally this breaks the game. If every piece lands in one lane, no line
along the _other_ axis can ever complete, and Refraction Clears — the entire
point — become impossible.

**Resolution: the Lane Dealer.**

- Every piece is dealt an **anchor lane** along with its shape, from a **free
  seeded draw with a starvation floor**. Balance is a floor, not a levelling
  force: nothing pushes lane counts toward even, so the sequence clusters,
  repeats and leaves gaps the way genuine randomness does. The one guarantee is
  that a lane absent past a threshold (`LANE_STARVATION_GAP` deals) has its
  weight climb steeply until it is dealt — which is what keeps cross-axis lines
  reachable on every lane, the reason the dealer exists.
- It was a shuffled 8-lane bag first, and the bag was wrong in play: eight
  deals, eight colours, and the depth assignment read as ROYGBIV on a loop —
  a sequence to memorise rather than weather to read. The texture tests in
  `progression.test.ts` now pin the opposite: repeats must occur, and 8-deal
  windows must not keep sweeping all 8 lanes.
- The anchor lane is visible before the piece lands: the preview renders it in
  depth colour, the piece spawns already wearing its lane's colour, and the
  ghost shows the landing footprint at the correct depth.
- **Depth Nudge** (`W` / `S`) shifts the piece ±1 lane. It is **locked until
  Stage 4**, and always available in Prism and Zen.

This preserves the reveal arc the proposal is built around. Stages 1–3 genuinely
play as a 2D game where colour is the only signal that something else is going
on; by Stage 4 the player has internalised the spectrum and earns direct control
over it. Depth stops being weather and becomes a tool.

### 4.3 Piece rotation **[GAP]**

The proposal says pieces rotate but not about what.

Three rotations, all about the piece's integer pivot, all defined in **world**
space but **selected relative to the current face** so that the same key always
looks like the same motion:

| Input     | Axis                       | Looks like                                            | Unlocked |
| --------- | -------------------------- | ----------------------------------------------------- | -------- |
| `Z` / `X` | the view axis              | classic Tetris spin, in the screen plane              | Stage 1  |
| `Q` / `E` | world Y                    | the piece turns on the spot, swapping width for depth | Stage 4  |
| `R` / `F` | the screen-horizontal axis | the piece tumbles toward/away                         | Stage 6  |

On the Front face, `Z`/`X` is _exactly_ a classic rotation. That is the point.

**Kicks.** A generalised SRS-style offset table, tried in order until one fits:
`(0,0,0)`, ±1 screen-horizontal, ±1 depth, +1 Y, then the diagonal combinations.
Depth kicks come before vertical ones so a blocked rotation prefers to slide
into an adjacent lane rather than float upward.

## 5. The Shift meter and the turn

Each cleared line fills one segment. When the meter fills, the board **must**
turn.

### 5.1 Turn sequence **[GAP]**

The proposal does not say when the turn interrupts play.

**Resolution**, in strict order:

1. The meter fills mid-piece. Play continues — the current piece is never
   snatched away.
2. That piece locks. Its clears and cascades resolve fully.
3. Play freezes. The direction prompt appears: `← LEFT · RIGHT →`.
4. The player chooses. After 5 s with no input the last-used direction repeats
   (defaulting to right on the first turn), so the game never deadlocks.
5. The camera turns over **750 ms** (proposal range: 0.6–0.9 s). Throughout:
   colours recompute continuously from live camera distance, apparent sizes
   change, overlapping cubes separate through parallax, and lines that will be
   eligible on arrival begin to glow.
6. **Snap** at exactly 90°.
7. Refraction Clear evaluation on the new axis, then cascades.
8. The next piece spawns.

The engine owns this timing, not the renderer. `chooseTurn` flips the face and
records `pendingClears` — the lines that will be eligible on arrival — but
removes nothing. The board sits in a `turning` state for the turn's duration
while those lines glow, and only then are they cleared. Resolution is staged
too: each cascade step holds its completed lines lit for a flash before removing
them, so the player can see which lines went and why.

Putting the clock in the engine rather than the renderer is what keeps a run
reproducible from `(seed, input log)`: a headless `tick` walks the identical
sequence of steps, and the tests drive it that way.

The next piece spawns only after the turn fully resolves. Landing a piece into
a board that is still settling would be unreadable and unfair.

### 5.2 Meter length by stage

| Stage | Lines per turn |
| ----- | -------------- |
| 1     | 5              |
| 2     | 5              |
| 3     | 4              |
| 4     | 4              |
| 5     | 4              |
| 6     | 3              |
| 7     | 3              |
| 8+    | 2              |

## 6. Scoring **[GAP — proposal gives ratios only]**

Base value by lines cleared in one resolution step, multiplied by stage number:

| Lines | Base |
| ----- | ---- |
| 1     | 100  |
| 2     | 300  |
| 3     | 700  |
| 4     | 1500 |

Multipliers, applied in this order:

| Event                                                               | Effect                 |
| ------------------------------------------------------------------- | ---------------------- |
| Refraction Clear (cleared by the turn itself)                       | ×2                     |
| Refraction Chain (n consecutive turns that each clear)              | ×(n + 1), capped at ×6 |
| Cascade step n (n ≥ 1)                                              | ×(1 + 0.5n)            |
| **Prism** — chain sustained across all four faces in one revolution | ×8 and +10 000         |
| Soft drop                                                           | +1 per cell            |
| Hard drop                                                           | +2 per cell            |

A Refraction Chain breaks on any turn that clears nothing.

The escalating on-screen language from the proposal is preserved:
`REFRACTION ×2` → `REFRACTION ×3` → `PRISM CHAIN ×4` → `FULL SPECTRUM`.

## 7. Speed and feel **[GAP]**

| Stage | Gravity (cells/s) | Lock delay | Piece tier |
| ----- | ----------------- | ---------- | ---------- |
| 1     | 1.0               | 500 ms     | 1          |
| 2     | 1.4               | 500 ms     | 1–2        |
| 3     | 2.0               | 500 ms     | 1–2        |
| 4     | 2.8               | 450 ms     | 1–3        |
| 5     | 3.8               | 450 ms     | 1–3        |
| 6     | 5.2               | 400 ms     | 1–4        |
| 7     | 7.0               | 350 ms     | 1–4        |
| 8+    | 7.0 × 1.15^n      | 300 ms     | 1–4        |

- Lock delay resets on move or rotate, up to **15 resets**, then locks hard.
- **DAS** 150 ms, **ARR** 33 ms.
- Soft drop is 20× gravity; hard drop is instant with a 100 ms settle.

### 7.1 Stage length **[GAP — proposal gives no threshold]**

A stage lasts **15 cleared lines** (`LINES_PER_STAGE`). The seven authored
stages are therefore 90 lines, and the endless tail begins at 105.

This was set by measurement rather than taste. The greedy agent in
`playability.test.ts` is the closest thing the project has to a competent
player, and it clears 71–103 lines in a run. At ten lines per stage that agent
reached the last authored stage inside a single game and spent most of the run
past the end of the arc, which made finishing the arc routine rather than an
achievement. At fifteen the full arc sits at the top of what the agent manages:
stage 7 is reachable but has to be earned, and the tail is genuinely the far
end.

The tuning knob is deliberately a single constant. Retuning it is a one-line
change, and every test that depends on the pacing is parameterised on it rather
than hard-coding line counts.

### 5.3 Spawn position

Pieces spawn inside the visible field, with their top row at `y = 17`, rather
than in the buffer above it. A piece hovering above the well reads as detached
from the board — it looks like UI, not like a falling block. The three-row buffer
exists to catch locked cells that end up too high, not to stage pieces in.

## 8. Failure

The run ends when, after all clears and cascades resolve, any locked cell sits
at `y ≥ 18` (inside the spawn buffer), or when a spawning piece has nowhere to
go (block-out).

Because Y is invariant under turns, height means the same thing from every face.
A dangerous stack can still be _hidden_ behind another from one angle — tension
without dishonesty.

## 9. Reading the board

The board must never become unknowable. Every occluded cube is legible through
at least two of:

- **Spectrum colour** — the primary channel.
- **Parallax during a turn** — the stack separates horizontally as the board
  rotates, which is what reveals which cubes sit at which depth. Cube size never
  varies with depth, at rest or mid-turn.
- **The falling piece and its ghost never disappear.** Where settled cubes
  occlude them, both draw as translucent silhouettes in their true spectrum
  colours — a rendering override only, with normal occlusion between settled
  cubes untouched. The active silhouette is solid and the ghost's fainter and
  inset, so the two stay distinct even when both show through the stack.
- **Lane focus.** The falling piece's occupied lanes are a focal plane. Settled
  cubes nearer than that plane go transparent, so you see through them to the
  piece and its landing surface; cubes in the focal lanes stay fully opaque,
  with a restrained inner highlight on the cells `firstContactCells()` names
  as the ones the piece will actually touch; cubes farther than the piece
  darken toward the void, keeping their hue. The gradient is relative to the
  _piece_, moves when the piece moves, and vanishes at lock — it cannot be
  read as an absolute distance cue the way size falloff or haze would. Gated
  to `falling`; off during a turn, when lanes are being remapped.
- **Ghost piece** — rendered at the true landing depth, in that lane's colour.
- **Peek** _(future, M10)_ — hold to tilt the camera 8° for parallax. Changes no
  game state. Limited or disabled at Stage 6+ and in Blind Spectrum.
- **Preview** _(2D today; rotating 3D render is M10)_ — the incoming piece, in
  the depth colours it will arrive wearing.

The visual hierarchy when these overlap, strongest to weakest: **active piece →
landing ghost → focal-lane board → faded far board → transparent near board.**

## 10. Accessibility **[GAP — critical]**

Colour is the primary depth channel, so a colourblind player is not losing
decoration, they are losing the game's core information. Depth is therefore
_always_ redundantly encoded.

- **Luminance-monotonic ramps** — every depth ramp, including the default, keeps
  lightness monotonic from near to far, so ordering survives any colour vision.
  This matters more than it would otherwise: while the board is settled, colour
  is the only depth channel (see §2.1), so the ramp is doing all the work.
- **Banded mode** — 7 hard-edged bands instead of a continuous ramp.
- **Luminance mode** — depth as a light-to-dark ramp, no hue dependency.
- **Alternate ramps** — deuteranopia-, protanopia- and tritanopia-safe palettes
  that keep monotonic lightness so ordering survives any colour vision.
- **Lane numerals** — the lane index printed on each cube's face.
- **Reduced motion** — turn shortened to 250 ms, bloom and shake disabled.
- **Photosensitivity** — the Prism bloom is capped and ramped, never a flash.
- Full key remapping, gamepad, and touch.

`Blind Spectrum` mode removes depth colour deliberately. It is an unlockable
expert challenge and is never the default.

## 10.1 Sound **[GAP]**

The proposal does not describe audio. The resolution mirrors the visual rule:
**depth is pitch**. A cube's lane picks its note, near lanes low and far lanes
high — the same direction the spectrum runs, since red sits at the low end of
the visible range and violet at the high end. Lanes walk a minor pentatonic
scale so no two adjacent lanes clash.

That makes sound a genuinely redundant channel for depth, which matters more
here than it normally would: §2.1 leaves colour carrying the depth information
alone, so a second channel is worth having for players still learning to read
the spectrum, and for anyone whose colour vision makes the ramp harder.

| Event         | Sound                                                              |
| ------------- | ------------------------------------------------------------------ |
| Lock          | short, soft, pitched by the piece's nearest lane                   |
| Clear         | one note per line, rising; brighter with each cascade step         |
| Turn          | a filtered sweep, falling when choosing left and rising when right |
| Full Spectrum | every band at once — the audible form of white light               |
| Game over     | a single low fall                                                  |

Decisions live in `src/audio/tones.ts` as pure data and are unit-tested;
`audio.ts` only turns them into sound. Audio starts on the first key press,
because a browser will not open an `AudioContext` outside a user gesture. `M`
mutes.

## 11. Modes

A mode is **pure configuration** over the stage table, not a code path. The
engine keeps one implementation and modes select from it, so a mode cannot
introduce a rule by accident. The table lives in `src/core/modes.ts`.

| Mode               | Start | Score | Rules                                                          |
| ------------------ | ----- | ----- | -------------------------------------------------------------- |
| **Ascent**         | 1     | ×1    | The authored arc, unmodified. Content reveals on schedule.     |
| **Endless**        | 6\*   | ×1    | Everything unlocked, stage pinned, gravity compounds per line. |
| **Prism**          | 3     | ×1    | Meter of 2, Depth Nudge on, refraction clears score double.    |
| **Flatland**       | 2     | ×1    | Tier 1 only — planar pieces, forever. The board still turns.   |
| **Blind Spectrum** | 4     | ×1.5  | No depth colour at all. Unlocked by reaching stage 5.          |
| **Zen**            | 2     | ×0.25 | Stage pinned, no failure state, Depth Nudge on.                |

\* Endless pins stage 6 for its **content** and scales gravity to ×0.54 for its
**speed**, opening at roughly stage 4's pace. See §11.2.

### 11.1 Ascent and Endless **[GAP — the proposal described one mode twice]**

As written, "primary progression" and "score attack with continuously increasing
speed" are the same mode. They are separated by what they do with _content_:

- **Ascent** is the authored arc. It starts at stage 1 and reveals the game on
  schedule — flat pieces, then screws, then the tripod, then depth control —
  climbing the stage table in steps.
- **Endless** starts past the reveal with everything already available, pins the
  stage table, and accelerates smoothly and without end instead. Nothing new
  ever arrives; only the pace changes.

One is the game. The other is the treadmill.

### 11.2 Why Endless pins a late stage and then slows it down

A pinned stage never advances, so whatever tier it carries is the tier that mode
has forever. Stage 4 only reaches tier 3, so pinning stage 4 would withhold tier
4 permanently — contradicting the mode's own promise.

So Endless pins **stage 6**, the first stage with every tier available, and uses
`gravityScale` to walk the opening speed back to about stage 4's. Content and
pace are separate knobs, and this is the case that proves they had to be.

### 11.3 Acceleration is one curve or the other, never both

A mode either climbs the stage table (`pinStage: false`) or compounds gravity
per cleared line (`continuousGravity: true`). Never both: the two curves were
tuned independently, and multiplying them produces a ramp nobody chose. Asserted
in `tests/unit/modes.test.ts`.

### 11.4 `maxTier` is a ceiling, not a floor

A mode may restrict what the stage table would have dealt — Flatland holds the
game at planar pieces for its whole length — but never introduce a piece ahead
of the schedule. Overrides apply with `Math.min`, asserted across every mode and
every stage.

### 11.5 Mode-specific scoring **[GAP]**

Modes are not equally dangerous, and a scoreboard that ignored that would rank a
Zen session above a real run. Two multipliers, both on the mode:

- `scoreScale` prices the risk the mode carries. Zen cannot be lost, so it pays
  ×0.25; Blind Spectrum asks the hardest thing the game has, so it pays ×1.5.
- `refractionScale` weights clears the turn itself made eligible. Prism doubles
  them; every other mode leaves the scoring table exactly as designed.

### 11.6 Zen has no failure state **[GAP]**

"No failure state" needs an answer for what happens when the stack reaches the
top, and the proposal gives none.

**Resolution: trim the top row.** When a piece cannot spawn, the highest occupied
row is deleted outright and the piece retried, repeating until it fits. Nothing
collapses and nothing below moves, so the structure the player has been building
survives exactly as it was and the rescue reads as local rather than as a board
wipe. A `rescue` event fires so the interface can say `OVERFLOW CLEARED` — rows
vanishing silently would look like a bug.

The condition rescued _for_ is "the next piece fits", not "the stack is below the
buffer". Those are not the same, and rescuing only to the weaker one would end
the run a piece later anyway.

## 12. Pause **[GAP]**

Pause is a **state of the engine**, not a flag the host holds: `GameStatus` gains
`paused`, and `pause()` / `resume()` move in and out of it.

Every input path already refuses to act outside `falling` and `awaitingTurn`, so
one status change closes all of them at once — and the renderer can _see_ that
the game is stopped rather than inferring it from the host.

It consumes no simulated time and mutates nothing but the status and the state
to return to, so **`(seed, input log)` still determines the run exactly**: a log
with pauses in it replays identically to one without. A pause mid-turn or
mid-cascade resumes into the same state with its timers untouched. This is
asserted directly in `tests/unit/pause.test.ts` by playing one scripted run with
a pause between every action and one without, and comparing the results.

The room keeps rendering behind the pause panel. The engine is frozen but the
environment is not — it drifts and breathes on the title screen and under the
menus, which is the point of it.

## 13. Persistence **[GAP]**

One versioned record in `localStorage` under `refraction.save.v1`: settings,
per-mode bests, lifetime stats, a session log, and the mode last played.

Parsing lives in `src/core/save.ts` and knows nothing about browsers; the
`localStorage` access is isolated in `src/ui/storage.ts`. The game runs
identically with storage unavailable — it simply forgets.

**`migrate` never throws and always returns something playable.** A save file is
the one input the game cannot validate at its source: it may come from an older
build, a different app on the same origin, a torn write, or a user editing it by
hand. Every field is recovered independently, so a corrupt settings block cannot
take the high scores down with it.

Three consequences worth stating:

- **Records are read by iterating the known modes**, never the file's own keys.
  A save naming a mode that no longer exists loses that entry rather than
  resurrecting it.
- **`stats.bestStage` is reconciled against the per-mode records**, taking the
  higher of the two. Unlocks hang off that number, and a player who has earned
  an expert mode must not have it taken back by a damaged stats block.
- **A damaged session entry is dropped, not repaired.** The log is decoration,
  not a record of achievement, and repairing an entry would put a run on the
  board that never happened.

## 14. Seeded challenges **[GAP]**

A challenge is a `(mode, seed)` pair carried as a seven-character code: one
character naming the mode, six encoding the seed. Two people entering the same
code get bit-identical runs, because the engine is already fully determined by
`(seed, input log)` — the code is only a way of naming a seed out loud.

- The seed half is **Crockford base32** (no `I`, `L`, `O`, `U`), so `1`/`I`/`L`
  and `0`/`O` cannot be confused and a code cannot accidentally spell a word.
- Parsing is deliberately forgiving about case, spaces and dashes, because a
  code is something people read aloud and retype.
- The **daily challenge** is the same machinery with the UTC date as the seed:
  no server, no clock authority, no storage. UTC rather than local time so that
  "today's challenge" names the same run everywhere — a leaderboard split by
  timezone would be two leaderboards.

## 15. Rendering targets

| Target                | Budget                                              |
| --------------------- | --------------------------------------------------- |
| Frame rate            | 60 fps at 1080p on integrated graphics              |
| Engine tick           | < 0.5 ms                                            |
| Frame time            | < 16.6 ms, dynamic resolution below 18 ms sustained |
| Bundle                | < 400 KB gzipped                                    |
| Cold load to playable | < 2 s on a fast 3G profile                          |

Approach: one `InstancedMesh` of rounded boxes with per-instance colour and
scale; crisp silhouettes from real geometry bevels rather than a post-process
outline; ACES tonemapping; selective bloom thresholded high so only clears and
Prism events bloom; MSAA over FXAA for edge crispness; `devicePixelRatio`
clamped to 2.

## 16. Determinism

Every random draw — piece bag, lane bag, cosmetic jitter — comes from the seeded
stream in `src/core/rng.ts`. A run is fully reproducible from `(seed, input
log)`, which lets the test suite replay entire games headlessly and diff the
outcome. This is the mechanism that keeps the promise in the proposal's most
important constraint: the geometry must be completely trustworthy.
