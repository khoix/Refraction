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
recovered by turning, or by Peek (§9).

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
| The environment around the board                                                     | achromatic — light, never hue                   |
| Everything that describes the rules — HUD, meter, banners, popups, prompts, overlays | achromatic                                      |

The HUD chrome is drawn from a neutral ink ramp with a single near-white accent
(`--accent-ui`). The partition is now **absolute**: the only hue on screen
belongs to a cube.

That last row was briefly written the other way. The room was allowed
"decorative hue" on the reasoning that colour behind the board makes no claim
about the rules, and a near-opaque panel was added to keep it off the cubes.
Both halves turned out to be wrong. The panel was the tell: a room that has to
be walled off from the board is competing with it, not holding it. And a player
looking at one screen does not partition it — a magenta beam and a violet cube
are the same kind of thing until someone explains otherwise. See §2.4.

Two consequences worth stating, because both replaced something that looked
better in isolation:

- **Stage banners and the stage readout are colourless.** They were briefly
  tinted with the band matching the stage number. It read well and it was wrong.
- **Scoring banners are white, not a rainbow sweep.** White is also the truer
  image: the whole spectrum together is white light, which is exactly what the
  board does when a Prism chain closes.

The title screen is the partition's clearest consequence. It was plain type over
an 86%-opaque blackout, and on a cold boot there was nothing behind the blackout
anyway — a wordmark on a black rectangle, which is true of any game. It shows the
board now: a composed stack in the well, turning by itself with the game's own
turn, under a masthead drawn from the neutral ink ramp. The type cannot carry the
spectrum, so the board carries it, which is the better division of labour in any
case.

Two properties of that arrangement are deliberate. It holds **exactly one cube
per screen cell**, because a near cube hides what is behind it completely and a
second cube in the same cell is not extra material — it is a cube you cannot see
that has taken a lane away from one you can. A denser version with two helices
was tried and reverted for precisely that: of two cubes sharing a cell the nearer
always wins, and at a half-depth offset the nearer is always in lanes 0 to 3, so
the front face came out red-through-green with no blue or violet on screen at
all. And the board is composed **only when it is empty**, so returning from a
finished run leaves the player's own board behind the title.

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

### 2.4 The environment: light, not colour

The board floats in a dark room made of **light**: shafts of cool grey standing
around the well, white dust, dim wireframe at distance, a neutral floor lattice,
and rings that ripple on clears. It is allowed **brightness, contrast, density,
geometry and motion** — everything except hue.

It answers the board by getting brighter, never by changing colour: a pulse on
lock, a ripple on a clear, a creeping density as the Shift meter fills, stronger
movement through a turn, and a major response to a Refraction Clear or a Prism.

**What this replaced, and why.** The room was once a disco — coloured beams,
cycling fragments, a strobe, a hue-cycled backdrop. Three things were wrong with
it:

- **One hue clock drove everything.** Dust, fragments, lattice, beams, strobe
  and backdrop all cycled the colour wheel in lockstep at fixed offsets, which
  reads as a hue slider being dragged rather than as a place.
- **Saturation was very high** (0.7–0.85) on unlit materials with hard edges, so
  the beams were flat coloured strips rather than light.
- **The backdrop was a saturated near-black**, and a dark tint reads as dirt.
  That is where the muddy brown came from.

Three rules keep the replacement from looking cheap:

- **Beams fade at both ends.** A vertex-colour ramp runs bright across the
  board's height and falls to nothing top and bottom, so a shaft reads as light
  with no beginning and no end. Under additive blending, black is invisible, so
  this costs one attribute and no shader.
- **Nothing moves in lockstep.** Each shaft has its own drift, phase and peak.
- **The ground is a true neutral.**

**Levels are stated in sRGB, not linear.** Three works in linear space and
converts on output, which lifts the bottom end hard: a linear `0.008` — which
reads as "nearly black" to anyone writing it — arrives on screen at about
26/255, a mid-dark grey. That single mistake is what made the first achromatic
pass a flat grey field brighter than the board. Every level in
`src/render/environment.ts` now goes through `light()`, which converts
explicitly, so the numbers mean what they look like.

**The hierarchy is measured, not eyeballed.** Two end-to-end tests sample the
canvas inside and outside the well: the room's brightest pixel must stay below
the board's brightest, its mean must stay far below that, and its maximum
channel spread must stay under 40 — a cube at full chroma spans about 170, so
nothing in the room can be mistaken for one.

The play column is still there but no longer load-bearing: at 62% it lets the
dust through, so the board reads as floating in the room rather than pasted over
it. With an achromatic room it protects against brightness, not hue.

Under reduced motion the ambience stays and slows. **The strobe is gone
entirely** — it was both the photosensitivity risk and the cheapest-looking
element, and nothing replaced it. A space made of light does not need to flash
to feel alive.

### 2.5 The pipeline may not rewrite the palette

Every rule above assumes the colour that reaches the screen is the colour the
ramp chose. That assumption held in the palette module and failed everywhere
after it. Three separate stages of the render pipeline were each rescaling the
spectrum, and together they put a settled cube at roughly **a fifth of its
palette value** — dark, muddy, and low-contrast, while the next-piece preview
next to it, which is DOM and paints `depthColorHex` directly, stayed vivid. That
disagreement between the two is what finally exposed it; nothing in the suite
had noticed, because every test compared parts of the board against each other
and they were all wrong by the same factor.

The three causes, in order of size:

| Cause                                                                     | Effect on a cube            |
| ------------------------------------------------------------------------- | --------------------------- |
| The play-column backdrop composited **over** the board rather than behind | ×0.38                       |
| Ambient light at 1.18 where Three's Lambert BRDF needs π to return albedo | ×0.376                      |
| ACES Filmic tone mapping compressing what was left                        | hue shift, channel clipping |

The panel was the worst of them and the least visible. A translucent material
goes into the renderer's _transparent_ queue, which draws after every opaque
object no matter what `renderOrder` says — `renderOrder` only sorts within a
queue. With its depth test disabled as well, a plane positioned safely behind
the board was painted across the finished playfield as a 62% wash of near-black.
It is the same panel §2.2 already called a tell; it turns out it was not merely
conceptually wrong, it was doing the damage directly.

So, as a standing constraint:

- **A settled cube renders at exactly its `depthColor` value.** Flat ambient is
  set to π precisely so that a surface returns its albedo, and the levels in
  `setLightingFlatness` are written as fractions of albedo times that constant
  rather than as bare intensities.
- **No tone mapping.** A filmic curve exists to fit a scene lit in physical
  units into a display. This scene is authored in display values from the start.
  ACES was reinterpreting the ramp — clipping red's blue channel and violet's
  green one, which are exactly the distinctions the ramp is made of. The bloom
  chain is the only thing that goes past 1, and clipping to white is what a
  whiteout is supposed to do.
- **Nothing may sit in front of the board except the passes that are meant to.**
- **A turn changes how the light falls, not how much of it there is.** Flat and
  dimensional are balanced to the same peak, so the board does not appear to dim
  and brighten as it rotates while the player is reading colour off it.

Guarded by two end-to-end tests that sample the canvas and compare it against
`depthColor` directly, and against the DOM preview's chroma. Each of the three
causes above was re-introduced in turn to confirm the tests fail on it.

### 2.6 The gel material, and the two rules it restates

Every solid cube is cast resin rather than flat plastic: denser through its
thickness, a bright catch along the bevel the light falls on, the glow settling
toward its lower edge, a thin rim where the surface turns away, and a faint tooth
inside it.

A material whose whole purpose is variation _within_ a cube runs straight at both
rules above, so neither is loosened — each is restated as something the shader
cannot break:

- **Fidelity.** §2.5's test samples a 5×5 patch at the centre of a cube's face
  and allows six levels of 255. So every term in the gel is multiplied by one of
  two masks, `gelEdge` or `gelBelow`, both of which are exactly zero at the
  centre of every face. The material cannot shift the sampled colour however its
  constants are set. Turning the effect up is a look decision; it can never
  become a fidelity bug.

- **No second depth cue.** §2.1 forbids anything that lets a player rank cubes by
  distance without reading colour. The shader is given the object-space position
  and normal of the unit cube and the camera's yaw, and nothing else — no lane,
  no world position, no instance — so every cube wears an identical material.

  Worth separating two things that sound alike: **making each cube look like a
  solid is not making the board look three-dimensional.** A highlight that lands
  in the same place on every cube ranks nothing. Differential shading would be
  the violation; uniform shading is a material, and the field of cubes is exactly
  as flat as it was.

  Measured in Blind Spectrum, where every cube carries one neutral fill whatever
  lane it sits in — so the instance colour is identical across the board and the
  only thing that could distinguish one lane from another is the material. Eight
  cubes, one per lane, spread 1.16 luminance levels; scaling any gel term by the
  cube's depth spreads 2.5 to 2.9.

One consequence had to be found by measurement rather than by reasoning. The
gel's highlights lerp toward **white**, and the muted band exists to read as a
dark mass with no structure — so a cube dimmed to a quarter of its colour came
back with a rim as bright as an undimmed one's, and the muted band's peak
overtook the x-ray's, inverting the two bands the whole drop channel depends on.
The gel now carries the layer's own dim, so a receding cube's material recedes
with it. Scaled by the layer rather than by the pixel's brightness: reading the
brightness would work and would quietly make the effect depth-dependent, since
violet is a darker stop than green.

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
- **Depth Nudge** (`T` deeper, `G` nearer) shifts the piece ±1 lane. It is
  **locked until Stage 4**, and always available in Prism and Zen.

  This said `W` / `S` until M11, and that pairing cannot work: `S` is half of the
  WASD movement cluster the README advertises and is already the soft drop. What
  actually shipped was `W` alone, so the nudge only ever moved the piece one way
  and half a Stage 4 mechanic was unreachable. Writing the bindings out as a
  table for the key map is what surfaced it. Depth takes its own vertical pair
  now, next to the `R` / `F` used for pitch: two spatial axes, two adjacent
  pairs, neither stealing a movement key.

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
- **The x-ray, over the drop channel.** Cubes standing between the player and
  the surface the piece is aimed at are drawn see-through rather than solid.

  **The region is the channel, not the board.** It is the columns the falling
  piece spans, from the first settled cube beneath it upward — nothing wider,
  nothing lower. Inside it:

  | Where the cube is                                 | Drawn as   |
  | ------------------------------------------------- | ---------- |
  | At or in front of the piece's depth               | **X-ray**  |
  | Behind the piece's depth                          | **Muted**  |
  | The surface the piece will rest on                | **Normal** |
  | Anywhere else — another column, below the surface | **Normal** |

  There is no fourth "focal" state. The piece's own lanes are x-rayed along with
  the ones in front of them, because a cube above the ghost hides the landing row
  whatever its depth. Normal is the default and the great majority of the board
  is in it at any moment.

  Two consequences worth stating, because both were got wrong first:

  - **A cube only changes if it is in the way.** The first implementation
    classified every cube on the board by its lane alone. A piece dealt to a back
    lane therefore turned the entire board to glass and one dealt to the front
    muted all of it — which is what "everything looks muted" was, and no amount of
    tuning the opacities would have fixed it. Restricting the region to the
    channel is the fix; the opacities were never the problem.
  - **On a level board the x-ray does nothing, correctly.** The piece comes to
    rest on top of the stack, so on flat ground there is nothing above it to see
    through. The effect only has work to do when the stack is uneven — when cubes
    in some other lane stand higher than the row the piece is aiming for.
  - **It reaches the first real voxel, not the row the piece stops at.** Those are
    the same row only when the piece lands flush. A piece whose underside does not
    match the stack rests on its highest point and leaves a gap under everything
    else: a flat four-wide bar on a staircase lands at one height in all four
    columns while the surface below sits four, six and seven rows lower. That gap
    is the single most useful thing to be able to see when a piece is about to
    land badly, and stopping the channel at the landing row hid all of it.
  - **The surface cube itself stays solid.** It is the backstop the channel stops
    against, and it carries the landing mark — an x-rayed cube cannot hold a
    mark.

  The channel is measured per column rather than as one bounding box. An S or an
  L lands at different heights in different columns and may occupy different lanes
  in each, so the region follows the piece rather than a box drawn round it. Both
  ends are read off the ghost, which already carries the columns, the lanes and
  the landing row.

  **X-ray is not a fade, and the difference is the whole point.** A uniformly
  translucent cube trades one for the other: whatever fraction of it you can
  see is exactly the fraction of the board behind it that you cannot. Turn it
  down far enough to reveal the board and the cube disappears; turn it up far
  enough to see the cube and everything underneath greys out. There is no
  setting at which both read.

  Splitting fill from structure escapes that. The fill goes to almost nothing so
  the board behind comes through at full strength, and the outline carries the
  cube's shape _and_ its lane colour, so an x-rayed cube still says how deep it
  is. The signature is a **low mean with a high peak**: mostly empty, crisply
  edged. Against an untouched cube measuring a flat 107 in and out, an x-rayed
  one means 52 with a peak of 169 — half the light, and structure where the solid
  cube has none.

  **The outline is of the region, not of each cube in it.** Twelve edges per cube
  turns a block of them into a grid of boxes: busy, and competing with the
  landing marks for exactly the attention those need. The cells are projected to
  screen cells and only the edges bordering an unoccupied neighbour are drawn, so
  interior seams disappear and the region reads as one shape — with any holes in
  it outlined too, which is right: a hole is a place where there is nothing to
  see through. It is drawn flat on the plane just in front of the board, since
  orthographically a screen-space boundary is exactly what a silhouette is, and
  nothing on the board may hide the border of the region the player is being
  asked to look into.

  The outline needs real line primitives. `wireframe` on a box draws every
  triangle edge, which puts a diagonal across all six faces and turns a wall of
  cubes into a mesh of X's, so `EdgeLayer` builds clean lines each frame instead
  of instancing triangles.

  The region belongs to the _piece_, moves when the piece moves, and vanishes at
  lock — it cannot be read as an absolute distance cue the way size falloff or
  haze would. Gated to `falling`; off during a turn, when lanes are being
  remapped.

  Levels are tuned by measurement, not by eye, and asserted end-to-end: a column
  the piece does not cover renders identically whether or not something is
  falling; the channel stops at the landing row, with the buried stack below it
  untouched; a cube level with the ghost in a nearer lane is x-rayed, not solid,
  so the marker reads through it; and the muted band is dark but never deleted —
  it still carries its hue.

- **Two landing marks, not one.** Where the piece will come to _rest_, and what
  it will come to rest _on_. They are the same cell only when the piece lands
  flush; on a stepped board they are rows apart, and the distance between them is
  the gap the player is about to create.

  | Mark            | What it is                                                   |
  | --------------- | ------------------------------------------------------------ |
  | Landing outline | the piece's own cells at their landing position              |
  | Surface mark    | a smaller, near-white square on the face of the cube beneath |

  Both are built so that **neither depends on the x-ray to be legible.** That was
  the failure: the outline was a translucent cube at 0.44, which over the well's
  near-black background lands around luminance 47 — a dark smudge — and it was at
  its faintest on an open board, where the x-ray correctly does nothing and there
  was nothing to lend it contrast. It carries its own outline now, drawn above
  every see-through pass.

  The surface mark had never been visible at all, for two compounding reasons.
  Its layer asked for `emissive: 0.7` on a material whose emissive colour was
  black, so the intensity multiplied into nothing; and its geometry was a smaller
  cube sharing a centre with the cube it marked, which is simply inside it. It is
  pushed out onto the near face now, and lifted nearly to white rather than
  halfway — on an already-bright lane, green at luminance 198 or yellow at 190, a
  half lift moves it about 12% and the mark disappears on exactly the colours it
  most needs to survive. Near-white is also the more consistent choice: the cube
  it sits on already states the depth, so the mark is chrome, and chrome here is
  achromatic.

- **Peek** — hold to tilt the camera 8° for parallax, eased over 180ms in both
  directions. Changes no game state at all: the camera moves and nothing else
  does, which is what makes it safe to offer. Withdrawn from Stage 6, where
  reading depth from colour is the skill rather than the tutorial, and off
  entirely where the mode carries no depth colour — in Blind Spectrum it would
  not supplement the depth channel, it would _be_ it.

  Eight degrees is small on purpose. It has to be enough to separate a settled
  stack along the depth axis, which is the whole point since a dead-on board
  offers no parallax at all, without becoming a second way to read depth that
  competes with the spectrum. The board stays orthographic throughout, so a far
  cube is still exactly the size of a near one — only the angle changes, and it
  is the cubes sliding past each other that carries the reading.

- **Preview** — the incoming piece, turning slowly, in the depth colours it will
  arrive wearing. A flat preview shows only what the board shows: one projection,
  which for a piece with cubes at two depths is not enough to know its shape, as
  a screw and its mirror project identically from one face. The turn resolves
  that; the colour does not change while it turns, because depth is the board's
  statement about where the piece is going, not a property of the diagram.

  A still preview is offered as the _harder_ option rather than the plainer one:
  it shows the piece the way the board shows everything and leaves the player to
  infer the rest.

The visual hierarchy when these overlap, strongest to weakest: **active piece →
landing ghost → untouched board → x-rayed channel → muted band behind it.**

### 9.1 One pane of glass per screen cell

The x-ray draws only the **nearest** cube in each screen cell. The ones behind it
are not drawn at all.

Translucency accumulates, and that is what made the x-ray fail on exactly the
boards it exists for. Seven panes at 0.12 each leave 41% of the light behind
them, so a channel seen through a full-depth wall came back to 59% coverage —
measured at luminance 93 where an untouched cube reads 107. The landing footprint
behind it peaked at 135 against glass peaking at 119: a 13% separation, where an
open board gives fourteen times. The aid dissolved as the board got harder.

Lowering the fill's opacity cannot fix this, because one number has to serve both
a single pane and eight of them, and faint enough for eight is invisible for one.
Per-instance alpha cannot either: instance colour multiplies the fragment, not
its alpha, so dimming a rear pane darkens the stack without making it any more
transparent.

Capping the pane count is the fix, and one is the right cap. **The number of
cubes stacked in the way is not something a player acts on.** Where the region
is, how deep it starts, and where the piece will land are — and those are carried
by the region's outline, the outline's colour and the two landing marks
respectively. `EdgeLayer` already collapses the region to one depth per screen
cell for that reason, so this makes the fill agree with the border drawn around
it.

### 2.4.1 A flat plane has no thickness when the board is dead-on

The room's floor lattice is a horizontal grid, and it is drawn only while the
board turns.

Not for the reason it sounds like. A ground plane _is_ a spatial cue and §2.1
would rule it out of the still frame on those grounds alone -- but the reason it
had to change is simpler and was visible on screen: a horizontal plane viewed
from zero elevation is **edge-on**, so every line in it projects onto the same
row of pixels. The room's backdrop blends additively, so eighteen lines at 0.085
summed past 1 and clipped. What the player got was not a grid, it was a hard
white rule across the bottom of the screen, measured at luminance 194 against a
room that reads under 30.

Holding Peek is what identified it: eight degrees of elevation dropped the peak
to 35 and spread it across a hundred rows, which is a grid.

The general rule this is an instance of: **anything in the room that lies flat in
the ground plane disappears into a line when the board is settled, and has to
fade with `flatness` the way the well's corner posts do.** Everything else in the
room -- dust, the wireframe fragments, the light shafts, the clear ripples --
stands up in the frame and is unaffected.

### 9.2 The touch split, and when there isn't one

A narrow strip along the bottom of the window moves the piece; everything above
it rotates it. The zoning is what makes the vocabulary work: a gesture never has
to be disambiguated by what it happens to be near, because the region it starts
in already says which verb class it belongs to.

**The split is gated by the mode.** It exists to carry three rotation axes, and a
mode that permits only roll has nothing for it to carry — at which point the
strip is not a convenience, it is 84 pixels of an eighteen-row well spent on a
verb the mode does not have. Flatland drops it: drag anywhere to move, fling
anywhere to drop, tap anywhere to roll.

The two zones do not merely merge when the split goes, which is why a mode with
no strip is modelled as _no strip_ rather than as a strip pushed off the screen.
A tap means something different in each: with a split, a tap on the strip is a
**miss** rather than a verb, because the strip is where the hand rests for the
whole game and resting a thumb must not roll the piece. With no split there is
nowhere to rest that is not the playfield, so a tap is the roll.

Two consequences reach outside the gesture layer, and both are the same rule —
**the interface asks the engine what a mode permits, it never decides**:

- The board's bottom reserve grows by the strip's height only in modes that have
  one, so a roll-only mode gets the pixels back.
- Both controls panels omit the rows a mode does not answer to, through one
  predicate they share. A panel that lists a key the engine ignores is the drift
  a table-shared-with-the-implementation exists to prevent, arriving through the
  mode instead of through a stale copy.

### 9.2.1 A touch is relative to the piece, not to the board

A drag does not say _which column_ the piece should be in. It says **how far** to
move it from wherever it is. Every touch-down sets a fresh origin; the piece
steps by the distance the finger covers from that origin, and where on screen the
finger happens to be carries no meaning at all.

The first version mapped the finger's position through the well's geometry to a
column, and it reads well written down: the column under your finger is the
column the piece is in, which is the same claim the game makes about everything
else. In the hand it is wrong. Lifting a thumb and putting it back somewhere more
comfortable teleported the piece to wherever that happened to be, so the player
could not rest, could not shift grip, and could not reach without the board
answering. **"Position is absolute" is a rule about the board. It was never a
rule about the hand.**

Two properties follow, and both are the reason the scheme is worth the change:

- **Lift and re-place is free.** Put the thumb down anywhere — over the HUD, off
  the well entirely, the other side of the screen — and nothing happens until it
  moves. The new point is simply where the piece is now.
- **A wall costs nothing.** The recogniser reports the _change_ since the last
  sample rather than a running target, so a finger pressed past the edge of the
  board banks no debt: refused steps are dropped, and the first sample that
  reverses moves the piece one column back. An explicit re-anchor was written for
  this and turned out to be dead code — the delta already had the property, and
  the test written to prove the re-anchor necessary passed just as well without
  it.

**How far is a setting.** One column of travel is one column of the well by
default, so the piece keeps pace with the thumb; the slider scales that, because
a comfortable thumb arc is four columns at 1:1 on a small screen and the whole
board at twice that. It is shown wherever the device _has_ a touchscreen —
`any-pointer: coarse` — rather than where touch is the only way in, since hiding
a setting a player can use is not tidying, it is putting it out of reach.

Rotation stays anchored to the board: a tap left of the well's centre rolls one
way and right of it the other. A tap has no origin to be relative to — it is one
point with no drag — so the only reference available is one the player can see.

### 9.3 What lives under the board

Two things sit below the well and neither is laid out by the document: the Shift
meter is absolutely positioned, and the touch strip is a region of the window
rather than an element. So the board has to be told how much room to leave, and
`HUD_RESERVE` — which is measured in **cells** — could not tell it. Cells shrink
with the window: 1.6 of them is 27 pixels on a phone in landscape against a
44-pixel meter, so the meter had always been drawn over the bottom rows of the
board there, and the strip made the same arithmetic worse rather than
introducing it.

The camera fit takes a reserve in pixels now, and treats it as a **floor** rather
than an addition: the board is pushed up only when the framing does not already
leave that much clear. A window with room to spare is framed exactly as it was,
which is every desktop, and a phone in portrait — where the reserve is satisfied
without shrinking anything.

## 9.4 Spectral Collapse

A hot bar fills as lines are cleared and cools on its own. Full, it glows and
flickers and can be spent on one board-wide collapse: every voxel falls to the
floor of its column, and whatever completes clears immediately.

**It is the operation the ordinary rules refuse.** `Board.clearLines` runs
per-column gravity and is deliberately careful not to compact: a piece bridging
two columns legitimately leaves a cell with nothing beneath it, and flattening
the column would silently destroy that structure (§3.1). So overhangs accumulate
for a whole run and nothing removes them — which is most of what makes a board
hard, and exactly what this spends its charge on. Keeping it a separate
`Board.compactAll` rather than a flag on the clear path is what stops it becoming
the general behaviour by accident.

**The gauge is achromatic at every fill level.** A heat gauge conventionally runs
blue to red; here red means _near_, and a bar that reddened as it filled would
teach that colour means intensity — the false inference §2.2 exists to prevent,
and one the standing amendment rules out by name. Heat is expressed the way the
room expresses everything (§2.4): as brightness and agitation, never as
temperature. The shimmer quickens with the level and turns to a hard flicker when
ready.

**Bought with rate, not with a total.** The bar is always draining, so what
matters is whether the player is clearing faster than it cools. Two consequences
follow and both are rules rather than tuning:

- **Cooling suspends once the bar is full.** Earned is earned; a player choosing
  where to spend it must not lose it for thinking.
- **A collapse's own clears do not refill it.** They are real lines — they score,
  they count, they feed the Shift meter — but feeding them back into the bar
  would let a large enough stack buy the next collapse outright.

**Ready and spend are different beats.** Filling the bar is a warning
(imminent banner + klaxon sample); spending it is the fall (collapse sample,
short white bloom, room flash, shake). Announcing “Spectral Collapse” on the
fill would claim an event that has not happened yet.

The clears resolve through the ordinary cycle, so they glow, cascade and score
like any others. That is what keeps a collapse _a lot of clears_ rather than a
second set of rules.

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
| Bar full      | sampled klaxon (`sfx/spectral_collapse_imminent.webm`)             |
| Collapse      | sampled fall (`sfx/collapse.webm`)                                 |
| Game over     | a single low fall                                                  |

Synthesised decisions live in `src/audio/tones.ts` as pure data (and as
fallbacks when a sample is missing); sampled clips live in `src/audio/sfx.ts`.
`audio.ts` turns either into sound. `M` mutes.

### 10.2 Starting the sound

A browser will not open an `AudioContext` outside a user gesture, so something
has to collect one. Any key press or menu click will do it, and for the effects
that is enough — the first sound a player hears is a lock, and by then they have
pressed something.

Music cannot work that way. It has to be running _before_ the player does
anything, which is a contradiction unless there is a screen whose entire job is
to be the thing they do first. That is the boot gate: wordmark, a progress bar
reporting a real fetch, and a button. The loading is genuine and the gesture is
genuinely required; neither is there to justify the other.

A deep link (`?mode=`, `?challenge=`) goes round the gate. It fills a wait and
collects a gesture, and a player arriving on a shared code has already chosen.

### 10.3 Music

**Two beds.** The boot gate is silent. Theme loops on the main menu (and the
mode / challenge panels). A run draws from a separate gameplay pool — five
tracks, shuffled, advancing when one ends — rather than falling silent. Beds
are driven from screen state every frame, so the music follows where the player
is rather than which handler last ran. During a run a thin LCD over the well
credits the current track and offers pause / next.

**Streamed, not decoded.** Decoded audio is float32 at the context's rate — a
two-minute track is tens of megabytes resident for a file that is under two on
disk. Music plays through an `<audio>` element; the cost is that its loop is not
sample-exact, and that trade is right for a bed and wrong for an effect.

**Played as media, not as Web Audio.** The element is _not_ routed through
`createMediaElementSource`. Doing so moves its output onto the Web Audio path,
which iOS classifies as ambient audio and silences with the hardware switch,
while a plain media element plays like a video. Mute and volume still reach it —
`Audio` pushes its level at the element — but **mute is a pause**, not a zero
level, because iOS ignores `volume` on a media element and a slider that cannot
attenuate is a control that lies.

**More than one encoding.** A track is a list, and the browser is asked which it
can play before anything is fetched. WebM/Opus is preferred and is not universal;
mobile WebKit is the case that fails, and it fails silently, since an element
that cannot decode its source never says so. When nothing is playable the answer
is "none" and no bytes are spent. The front door preloads every playable entry
in the catalogue; a device that can decode none spends no bandwidth at all.

**Opus in WebM**, because a loop is the point: MP3 and AAC pad the stream to fill
the final block and that padding decodes as silence at the seam. Opus stores the
exact sample count and a standardised pre-skip. Encode at 48 kHz — libopus only
encodes at that rate, and resampling on the way out moves the loop boundary.

## 11. Modes

A mode is **pure configuration** over the stage table, not a code path. The
engine keeps one implementation and modes select from it, so a mode cannot
introduce a rule by accident. The table lives in `src/core/modes.ts`.

The mode select grid walks that table in **difficulty order**, Flatland first
and Blind Spectrum last. Each card carries a pip rating (`difficulty`, 1..6) in
the top right and a cool→warm accent keyed off the mode id. Those accents are a
menu-only UI language — deliberately **not** spectrum stops — so they do not
borrow the depth channel §2.2 reserves for cubes. The engine never reads
`difficulty`; it is presentation on the card.

| Mode               | Diff | Start | Score | Rules                                                          |
| ------------------ | ---- | ----- | ----- | -------------------------------------------------------------- |
| **Flatland**       | 1    | 2     | ×1    | Tier 1 only — planar pieces, forever. The board still turns.   |
| **Zen**            | 2    | 2     | ×0.25 | Stage pinned, no failure state, Depth Nudge on.                |
| **Ascent**         | 3    | 1     | ×1    | The authored arc, unmodified. Content reveals on schedule.     |
| **Endless**        | 4    | 6\*   | ×1    | Everything unlocked, stage pinned, gravity compounds per line. |
| **Prism**          | 5    | 3     | ×1    | Meter of 2, Depth Nudge on, refraction clears score double.    |
| **Blind Spectrum** | 6    | 4     | ×1.5  | No depth colour at all. Unlocked by reaching stage 5.          |

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
per-mode bests, lifetime stats, a session log, and the mode last played. On the
title screen the session log and lifetime totals sit behind a **Scores** fold —
collapsed by default, out of flow when open, so the wordmark does not jump — and
are hidden entirely until there is something to show.

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
