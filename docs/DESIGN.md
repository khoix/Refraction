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

Turning **right** spins the world right, sliding the face that was on the
player's left into view.

```
right:  front → left  → back  → right → front
left:   front → right → back  → left  → front
```

Turning right moves the camera towards −θ; turning left towards +θ. The camera
animates the way the player asked, never the short way round.

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

- Every piece is dealt an **anchor lane** along with its shape, drawn from a
  shuffled 8-lane bag so all lanes get coverage without clumping.
- The anchor lane is visible before the piece lands: the preview renders it in
  depth colour, the piece spawns already wearing its lane's colour, and the
  ghost shows the landing footprint at the correct depth.
- **Depth Nudge** (`W` / `S`) shifts the piece ±1 lane. It is **locked until
  Stage 4 (Green)**, and always available in Prism and Zen.

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

| Stage       | Lines per turn     |
| ----------- | ------------------ |
| 1 Red       | 5                  |
| 2 Orange    | 5                  |
| 3 Yellow    | 4                  |
| 4 Green     | 4                  |
| 5 Blue      | 4                  |
| 6 Indigo    | 3                  |
| 7 Violet    | 3                  |
| Ultraviolet | 3, decreasing to 2 |

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

| Stage       | Gravity (cells/s) | Lock delay | Piece tier |
| ----------- | ----------------- | ---------- | ---------- |
| 1 Red       | 1.0               | 500 ms     | 1          |
| 2 Orange    | 1.4               | 500 ms     | 1–2        |
| 3 Yellow    | 2.0               | 500 ms     | 1–2        |
| 4 Green     | 2.8               | 450 ms     | 1–3        |
| 5 Blue      | 3.8               | 450 ms     | 1–3        |
| 6 Indigo    | 5.2               | 400 ms     | 1–4        |
| 7 Violet    | 7.0               | 350 ms     | 1–4        |
| Ultraviolet | 7.0 × 1.15^n      | 300 ms     | 1–4        |

- Lock delay resets on move or rotate, up to **15 resets**, then locks hard.
- **DAS** 150 ms, **ARR** 33 ms.
- Soft drop is 20× gravity; hard drop is instant with a 100 ms settle.

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
- **Rim light** — a fresnel edge tinted by the cube's own lane colour.
- **Floor grid** — the well's floor is gridded and lane-tinted; it anchors depth
  absolutely rather than relatively.
- **Peek** — hold `Space` to tilt the camera 8° for parallax. Changes no game
  state. Limited or disabled at Stage 6+ and in Blind Spectrum.
- **Ghost piece** — rendered at the true landing depth, in that lane's colour.
- **Preview** — a slowly rotating 3D render of the incoming polycube.

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

| Event         | Sound                                                             |
| ------------- | ----------------------------------------------------------------- |
| Lock          | short, soft, pitched by the piece's nearest lane                  |
| Clear         | one note per line, rising; brighter with each cascade step        |
| Turn          | a filtered sweep, falling when turning right and rising when left |
| Full Spectrum | every band at once — the audible form of white light              |
| Game over     | a single low fall                                                 |

Decisions live in `src/audio/tones.ts` as pure data and are unit-tested;
`audio.ts` only turns them into sound. Audio starts on the first key press,
because a browser will not open an `AudioContext` outside a user gesture. `M`
mutes.

## 11. Modes

| Mode               | Description                                                     |
| ------------------ | --------------------------------------------------------------- |
| **Spectrum**       | Primary progression, Red → Violet → Ultraviolet.                |
| **Endless**        | Score attack, continuously increasing speed and complexity.     |
| **Prism**          | Frequent turns, scoring weighted to multi-face chains.          |
| **Flatland**       | Planar pieces only, board still turns. Pure projection reading. |
| **Blind Spectrum** | No depth colour. Unlockable expert mode.                        |
| **Zen**            | No failure state. Depth Nudge always on.                        |

## 12. Rendering targets

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

## 13. Determinism

Every random draw — piece bag, lane bag, cosmetic jitter — comes from the seeded
stream in `src/core/rng.ts`. A run is fully reproducible from `(seed, input
log)`, which lets the test suite replay entire games headlessly and diff the
outcome. This is the mechanism that keeps the promise in the proposal's most
important constraint: the geometry must be completely trustworthy.
