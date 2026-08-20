# Release Notes

Milestone log for **Refraction**. Newest first. One entry per pushed milestone.

Every entry records what shipped, what was tested, and any decision worth
revisiting later. The full milestone roadmap lives in [`docs/PLAN.md`](docs/PLAN.md).

---

## M22 — The front door, from the mockup

**Branch:** `claude/webapp-game-plan-vtrxqx`

Built to a supplied conceptualization of the title screen. Oxanium, a glowing
wordmark whose O is a cube, and a frame full of coloured wireframe cages.

### The one rule this bends, and where it stops

§2.2 reserves hue: a colour on screen means depth from the current camera and
nothing else, which is why every piece of chrome in this game is a neutral ink
ramp. The mockup puts a cyan accent on the wordmark, its rules and the button.

That is allowed here for one reason: **the gate and the menu have no board on
them.** There is nothing whose distance a colour could be mistaken for. The
accent lives in `--accent-beam` and every rule using it is scoped to
`[data-screen='boot']` or `[data-screen='title']`.

The lettering itself stays white — white type throwing coloured light reads as
lit, tinted type reads as cheap — and a test now asserts both halves: the letters
carry no hue, and nothing sitting over a live board carries the accent.

### Cages, not solids

The floaters are an edge cage with a faint pane of light inside it, at a tenth of
the cage's brightness. Solid lit cubes were wrong twice over: an orthographic
camera flattens a diffuse box into a grey polygon, and enough of them made the
room look like confetti. What makes a voxel read as a voxel is its edges — which
is the thing the original wireframes had right and the only thing, being
colourless and unlit.

**Aimed into the frame.** The distance each floater is dealt is kept and only its
_direction_ is chosen: pick the screen position, solve for depth. An orthographic
camera does not shrink what is far away, so a ring at radius 26–48 sat almost
entirely outside a frame nineteen units wide — the field existed and the screen
was empty. And a keep-out band round the wordmark is enforced at placement, since
a seed that clears the type on a laptop will not also clear it on a phone.

### Bloom, on the screens that can afford it

In a run the bloom threshold sits just under white so only a clear's additive glow
or a Full Spectrum whiteout ever blooms; that restraint is why the settled board
reads as tiles rather than neon, and it is untouched. On a boardless screen there
is nothing to protect and the cages are lines one pixel wide, so the threshold
drops to 0.12 — eased on the same curve as the well's departure, so the two arrive
together.

### Oxanium, vendored

14 KB, variable, covering every weight. Fetched into the repo rather than linked:
a static bundle should not need a third-party request to draw its own wordmark,
and the front door is the worst place to wait on one.

### Two tests rewritten, not retuned

- **`the masthead carries no hue`** asserted the thing this milestone
  deliberately changes. It now asserts what the rule actually protects: neutral
  lettering, and no accent on anything over a live board.
- **`hides the HUD`** compared the Shift meter's rectangle on the title against
  in play. That worked while the room behind it was nearly black; the front door
  now glows, so the "hidden" reading rose to meet the visible one. It reads the
  computed opacity instead — exact, and it still catches the failure this has
  actually had, when `.hud--hidden` was nested into a descendant selector matching
  nothing.

### Tested

374 unit, and 52 e2e across the title screen, the front door, rendering, the
x-ray, the landing marks, Spectral Collapse and the phone layouts.

---

## M21 — The room holds still

**Branch:** `claude/webapp-game-plan-vtrxqx`

Play note: the background is still shifting, and no disco lights. Plus a third
report of no music on mobile.

### What "shifting" actually was

Twice misread. The first time it was taken as re-staging the field, the second as
group rotation. Both were wrong, or at least incomplete — the largest source of
movement was **the attract turn**.

The title orbited the camera every 2.6 seconds. That was written when a composed
stack sat in the well and the turn presented each of its four faces, which made
the front door a demonstration of the central mechanic. With the stack gone the
turn presents nothing: the room is fixed in world space, so orbiting the camera
drags the entire background across the screen on a timer. It is gone, and with it
the floor lattice, which is gated on the turn and had no business under a menu.

The rest of the movement went too. Every group in the room rotated on Y — dust
one way, the far dust the other, the floaters a third — which slid the background
sideways behind a board that is itself the only thing meant to turn. Nothing moves
as a body now. The floaters still bob and turn individually, which is what
floating is.

### No disco lights

Five wide shafts of light drifted, spun and breathed across the room. They are
deleted. A space made of light does not need a lighting rig.

### The field is arranged, not rolled

Fourteen items is a small enough sample that chance composes it badly on a fair
number of loads — all behind the camera, or bunched in a corner, or simply absent.
Tolerable for debris, not for the only thing on the title screen, and it was
making two pixel tests intermittent for exactly that reason: they measured a
different room each run.

Placement now comes from a fixed seed, chosen by **measuring** candidates on how
many floaters land inside the frame at a laptop's aspect and at a phone's. The
first seed tried put almost nothing on screen at either — the hazard, demonstrated.

### The title screen was never actually getting its light wash

Found by a test, and only after the pixel test that should have found it was
rewritten. The rule that gives the front screens their lighter scrim listed only
`boot`; `title` was still taking the 0.86 blackout meant for panels over a paused
game. Every pixel measurement of "does the title let the scene through" had been
comparing 0.86 against 0.86, which is why they all came out marginal and why the
thresholds kept needing defending.

### A pixel test retired, and why

`shows the scene rather than covering it` had been a pixel test for four
milestones. Its premise — a lit stack in the well for the scrim to reveal — is
gone, and three attempts to re-aim it each failed differently: over the well
_inverted_ the result, because a panel's own text lands there; a strip down the
side measured almost nothing; the brightest pixels outside the panel inverted it
again, because the HUD returns on the settings screen and its chrome sits exactly
there. That last one was diagnosed by finally opening the failure screenshot,
which should have been the first move rather than the fourth.

The room is a few dim floaters on a dark ground. There is no longer enough light
in it to measure a scrim through, so the test now reads the scrim's own alpha. It
is weaker in one way — it cannot catch the wash being defeated by something drawn
over it — and much stronger in another: it is exact, it cannot go intermittent,
and it caught the bug above on its first run.

### Music on mobile: second attempt, still unconfirmed

The element is pointed at the **network URL** rather than an object URL over the
fetched bytes. WebKit serves media through a loader that expects byte-range
requests and `blob:` sources are a long-standing weak spot there — a track that
plays on every desktop browser can silently never start on an iPhone. The preload
keeps both of its real jobs: it fills the bar honestly and warms the HTTP cache.

And the gate now **says so when there will be no music**, with the reason:
`MUSIC UNAVAILABLE · FORMAT` when no encoding is playable, `· DOWNLOAD` when the
fetch failed. Silence is the one failure this keeps producing and it looks
identical from the outside whatever caused it. A player deserves to know it is the
game and not their volume — and if that line appears on the phone, it names the
cause without anyone opening devtools.

**Not fixed if neither is the cause**, and that cannot be settled from here. An
AAC fallback was attempted: this machine has no ffmpeg, and the Chromium here
reports `audio/mp4` recordable but cannot decode AAC, which means it would
likely produce Opus-in-MP4 — a file that looks like a fallback and is not.

### Tested

17 e2e across the title screen and the front door, 374 unit. Two title tests
rewritten rather than retuned: the attract turn they were built on no longer
exists, so "turns by itself" became "holds completely still", and the snap-to-face
guard now drives the renderer off front directly instead of waiting for a title
animation.

---

## M20a — Three corrections to M20

**Branch:** `claude/webapp-game-plan-vtrxqx`

Play notes on M20, all three of them cases of the milestone doing more than was
asked.

### The field was re-staged when it only needed re-made

The note was to make the floaters **voxels**, like the wireframe boxes were. M20
also moved them: in to radius 11–30, split into two bands, and up from 14 to 30 of
them, on the reasoning that the old radius 26–48 put most of them off screen.
That reasoning was sound and answered a question nobody had asked. Distance is
what makes the field read as a room the board is in rather than as clutter drawn
around it.

Placement, count and size are back to exactly the wireframes'. The only change
from before M20 is that they are solid and coloured.

### One field again

M20 ended with two — wireframes for a run, solid voxels for the menus — because a
solid cube behind the playfield shows through every empty cell, and no radius
avoids that: with an orthographic projection and an orbiting camera, screen-x is
`r·cos(angle − yaw)` and sweeps the full ±r as the board turns.

Two fields was the wrong answer to a real problem. The floaters are one thing that
is dimmer during a run, not two things, and the problem was never that they are
solid — it is that a few of them pass behind the board. So the fix aims at the
few: a voxel fades out as it crosses the play column and back in as it leaves,
computed from its world position so the field's own rotation counts, and applied
only while there is a board to protect.

### The play column, and the menu's alignment

- **The well is gone from every screen where nobody is playing**, not just the
  boot gate. An empty box drawn in outline around nothing was left behind when
  the composed stack went.
- **The menu is vertically centred**, like the front door it hands over from. It
  was top-aligned with a gradient opaque behind the masthead and clearing at the
  bottom, both of which existed to make room for a stack in the lower half. With
  no stack the reason for both is gone, so the two screens now share one
  treatment rather than each having its own.

### Tested

36 e2e across the front door, the title screen, the landing marks and the phone
layouts — including the phone strip test that failed CI on M19.

**Branch:** `claude/webapp-game-plan-vtrxqx`

The composed stack is gone from the title, and the room's wireframe blocks are
solid voxels: assorted sizes, colours from the game's own ramp, each drifting and
bobbing on its own phase.

### What the removal exposed

`composeAttract` is deleted. It had a second job nobody had written down — it
cleared the spawned piece as a side effect of composing. Without it a cube hung
in mid-air over the gate with a ghost, a landing mark and a drop channel cut
through the well beneath it, all describing a move nobody was making. The title
state now says so explicitly.

### One ring cannot serve both screens

The wireframes sat at radius 26–48, which put nearly all of them off screen —
fine for sparse debris, useless for the thing carrying the front door. The
projection is orthographic, so the visible width is _fixed_, and fixed at very
different values by aspect: about **±19** units on a laptop and about **±7** on a
phone in portrait, which is inside the well.

So the field is two bands. Beside the well for wide windows; above and below it
for tall ones. Both keep out of the board's own volume.

M19's backdrop zoom is also gone. It existed to push the stack past the frame
edges; with no stack it magnified an empty well and threw the voxel field outside
the viewport.

### Colour is gated, and so is the field itself

§2.2 reserves hue: a colour on screen means depth from the current camera and
nothing else. Coloured cubes drifting past during a run would be exactly the
second colour language that rule exists to prevent, so the voxels carry the ramp
**on the menus only**.

The first pass gated colour but kept the solid field during play, and it was
plainly worse than what it replaced: bright grey slabs crowding the stack. The
second pass dimmed them, and the end-to-end suite caught what dimming could not
fix — three pixel measurements of the landing marks swung by **70 to 80 levels**
depending on where the randomly-placed field happened to land. That reported as
flakiness and was not.

The geometry says why, and says it is unfixable by tuning: with an orthographic
projection and an orbiting camera, a floater's horizontal screen position is
`r·cos(angle − yaw)`, which sweeps the full ±r as the board turns. **No radius
keeps a floater out of the well's column.** A wireframe surviving that is fine —
a few thin lines at a twentieth of full brightness. A solid cube behind the
playfield shows through every empty cell.

So both fields exist. The wireframes are the room a board is read against, tuned
and measured for that job and now restored unchanged; the solid voxels belong to
the screens with no board on them. Their _visibility_ rides the chroma target
rather than the eased value, so they stop drawing the instant a run begins rather
than lingering through the fade — half a second of a board that cannot be trusted
is half a second too many. The wireframes fading up cover the swap.

### The scrim test had to be rewritten, not retuned

"The title shows the board rather than covering it" measured hue in the well,
which no longer holds anything. Two attempts were wrong before the third worked,
and both are worth recording:

- Measuring luminance over the well **inverted** the result — the settings panel's
  own text lands in that rectangle, so the scrimmed screen read as _brighter_.
  Panels are centred and bounded, so the measurement moved to a strip down the
  side, which carries the room and nothing else on every screen.
- The old 0.55 ratio was easy to meet because a lit stack sat in frame. The room
  alone reads under ten and the scrim's own colour has a luminance near six, so
  no opacity can push far below that floor. The threshold is 0.8 now, with the
  arithmetic written next to it — and giving the title the heavy scrim still
  collapses the two and fails it.

### Tested

- **Front door (11 e2e)** — the room carries the ramp on the menus and drops it
  for a run, measured outside the well so the board's own cubes cannot be
  mistaken for the room's; the gate holds no piece nobody is playing.
- Sabotages: forgetting the chroma gate, leaving the spawned piece, and giving
  the title the heavy scrim each fail exactly one test.

---

## M19 — The music actually plays, and the door settles

**Branch:** `claude/webapp-game-plan-vtrxqx`

M18's theme played on a laptop and was silent on a phone. This is that fix, plus
three corrections to the front door itself.

### The silence

Reported precisely, which is what made it findable: Safari showed the tab as
producing audio — so _something_ was playing — but nothing was audible, and
neither the tab's mute nor the game's volume changed that.

The cause was an architectural choice in M18, not a bug in it.
`createMediaElementSource` takes an `<audio>` element's output off the media path
and onto the Web Audio path, and on iOS those are not the same thing. Web Audio
output is treated as **ambient** audio — the hardware silent switch kills it —
while a plain media element plays like a video and is unaffected. The same
routing is also the long-standing WebKit bug where a source node fed from a
`blob:` URL yields silence downstream while the element reports playing, which
matches the symptom exactly.

So music no longer touches the graph at all. The element plays itself.

**What that costs, and how the rule survived.** The rule was never "music goes
through `master`" — it was that mute and volume reach the music. `Audio` now
pushes its level at `Music` whenever it changes. But **iOS ignores `volume` on a
media element**: it is read-only there, because volume belongs to the hardware.
A slider that cannot attenuate is a control that lies, so mute is implemented as
a **pause** rather than as a zero level. Pausing works everywhere, so the one
setting that must always be obeyed always is. Held by test, and sabotage-verified
by making mute lower the level instead.

`navigator.audioSession.type = 'playback'` is now declared at boot as well — the
sanctioned way to tell iOS this page is playing media rather than making ambient
noise.

### The other candidate, wired but not proven

WebKit's Opus-in-WebM support is recent on the desktop and weaker on mobile, and
a media element that cannot decode its source does not announce itself — it
simply never makes a sound. That may also be in play here, and it cannot be ruled
out from this machine.

A track is therefore a **list of encodings** now, and the browser is asked which
it can play, honouring `canPlayType`'s three-valued answer: certainty beats the
manifest's preference order, so a browser sure about MP4 and hedging about WebM
gets MP4. The choice is made _before_ the fetch — downloading two megabytes and
then discovering the platform cannot decode them is the same silence, only
slower.

When nothing is playable the answer is `null` and nothing is fetched, rather than
the first source and a silent failure. Sabotage-verified.

**No `.m4a` ships yet**, because this machine has no ffmpeg and installing one
was declined. Drop `Blockfall Skyline (Theme).m4a` beside the `.webm` and it is
picked up with no code change — a glob finds it, and matches nothing until it
exists. The command is in `tracks.ts`.

### The front door

- **The tagline is gone from the gate.** It earns its place over the menu; the
  first screen is already carrying a loading bar and a way in.
- **The board is scenery there now, not an object under the wordmark.**
  `camera.zoom` pushes in until the arrangement runs past every edge, and the
  well's frame and posts fade out — zooming past the edges is wasted while two
  uprights and a floor line are still drawing the box. `fitCamera`'s guarantee is
  untouched: the zoom is constant while the door is open, so the board still never
  changes scale during a turn.
- **The handover is a cross-fade, not a cut.** The outgoing panel is held on
  screen for the length of the fade and hidden after, with `hidden` still the end
  state so assistive technology and the suite see exactly one panel. Both halves
  move the same way, so the wordmark reads as rising into the masthead rather
  than as one mark vanishing and another appearing. The board's 900 ms draw
  forward carries the same beat.

### Two defects the cross-fade introduced, found by the full suite

Both were product bugs rather than test breakage, and both are now covered.

**The outgoing panel stayed in the accessibility tree while it faded.** Its
buttons kept their place in the tab order and a screen reader would read two
screens at once — for 280 ms after the door opened there were two buttons whose
accessible names contain "play", which is exactly the ambiguity someone
navigating by voice or by screen reader would hit. `pointer-events: none` hid
none of that; it only stops the mouse. The panel is now `inert` and
`aria-hidden` the instant it starts leaving.

**The entry animation translated every panel**, which left menu geometry
unsettled while it was being measured — arrow-key navigation groups controls into
rows by where they actually land, so a grid still in motion is a grid whose rows
are read wrong. The rise is now scoped to the front door and the menu, the two
screens it means something for; every other panel fades in place.

A third was caught by reasoning rather than by the suite: the outgoing animation
has to be its own keyframes, not the arrival's reversed. Reversing an animation
that has already finished does not replay it, so the panel would have held full
opacity for the whole handover and then vanished — passing "is it hidden
afterwards" while looking exactly like the cut this replaced. Now sabotage-
verified.

### Tested

- **Encoding choice (6 unit)** — certainty over order, fallback, null when
  nothing plays, and a guard that every shipped mime declares its codec, since a
  bare container makes `canPlayType` answer "maybe" to almost anything and
  silently disables the whole mechanism.
- **Front door (9 e2e)** — mute pauses and unmute resumes; the gate drops the
  tagline the menu keeps; the board covers measurably more of the frame as
  scenery than as a board; the outgoing panel does not stay on screen.
- Five sabotages, each caught by exactly one test.

### Still unproven

The fix cannot be confirmed from here — there is no iOS device on this machine,
and Chromium does not reproduce WebKit's audio session behaviour. `?debug=1` now
reports `music()` with `error` and the chosen `source`, so if it is still silent
that readout says which of the two causes it is.

---

## M18 — The Front Door

**Branch:** `claude/webapp-game-plan-vtrxqx`

A real title screen. The wordmark centred over the live board, a progress bar
under it reporting a genuine fetch, and a `TAP TO PLAY` button that appears when
the fetch finishes. Behind it, `Blockfall Skyline` starts on the menu and stops
when a run begins.

### The tap is the mechanism, not the decoration

A browser will not start an `AudioContext` outside a user gesture. Until there
was a screen whose entire job was to collect one, the first sound in the game was
whatever the player happened to press first — which meant menu music was not
something this game could have, regardless of what was in the repository. The
gate exists to collect that gesture; filling the wait with a loading bar is what
makes collecting it honest rather than a toll.

So `onEnter` does everything synchronously inside the click: resume the context,
show the title, start the theme. The frame loop would pick the theme up a frame
later anyway, but by then the gesture has ended and starting media relies on the
browser's stickier "has interacted" rule instead of on the gesture itself.

### Streamed, not decoded

The theme is 137 seconds at ~112 kbps. Decoded into an `AudioBuffer` that is
about **53 MB** of resident float32 for a file that is 1.8 MB on disk, which is
not a price a phone should pay for menu music. It plays through an `<audio>`
element and a `MediaElementAudioSourceNode` instead, so only the compressed bytes
are held.

The cost is real and is written down where the decision is: a `MediaElement` loop
is not sample-exact, so there is a small seam at the wrap. Accepted for music,
and the wrong trade for a sound effect.

The graph is `element → source → fade → master → destination`. Routing through
`master` is not a tidiness preference — mute and volume are implemented as
`master.gain`, so an element left to play on its own would be music that keeps
going after the player mutes the game.

### What "an honest progress bar" turned out to require

Three properties, each of which the obvious implementation gets wrong, and each
now pinned by a test that was verified to fail without it:

- **It cannot read full before the bytes are in.** An asset's share is capped
  just below its weight until the transfer actually completes. The failing case
  is an understated `Content-Length` — a stale manifest, a proxy that re-encoded
  — where `received / expected` passes 1 well before the body ends.
- **It always finishes.** A failed asset resolves its whole share and reports
  the error rather than rejecting. A front door that a missing file can jam shut
  is worse than no front door at all.
- **It weights by declared size, not by asset count.** A 100 KB file finishing
  first moves the bar a tenth, not a half.

The timeout is a **stall** timeout, re-armed on every chunk, not a deadline. A
deadline punishes exactly the connection that most needs patience: a slow link
making steady progress is working, and killing it at fifteen seconds turns a long
wait into no music at all.

### Corrected during the milestone

Two of the six preload tests did not discriminate when first written, found by
sabotage rather than by review:

- The slow-transfer fake built a `ReadableStream` that ignored its abort signal,
  so a timeout that fired and a timeout that did not looked identical. Replaced
  with a paced body that errors on abort, the way a real fetch body does.
- The module doc claimed the monotonic filter prevents the bar rewinding when
  `Content-Length` corrects an estimate. It does not, and cannot: each asset's
  denominator is fixed when its headers land, before any progress for it is
  reported, so the sum is already monotonic. What the filter actually removes is
  _repeats_ — once a share is held at the cap, every further chunk computes the
  same fraction. Comment rewritten to say that, and a seventh test added to pin
  it.

The first visual pass used a radial vignette of its own and was wrong twice over:
it read as a different screen from the title, and it sat over the arrangement and
drained the cubes to grey — on the one screen whose whole job is to say what this
game looks like. Replaced with the title screen's own gradient, and the block
centred in the space _above_ the stack rather than in the viewport, so the mark
and the arrangement are both legible at once.

### Rules kept

- **The bar is achromatic.** A loading bar is the most tempting surface in this
  interface to run through the spectrum, and §2.2 reserves hue for cubes alone —
  a red-to-violet bar would be a second colour language on the first screen
  anyone sees. Held by an end-to-end test that rejects both a background _image_
  and a wide channel spread.
- **Deep links go round the door.** `?mode=` and `?challenge=` still open
  straight into a run; the preload runs behind it, so the theme is there if the
  player quits back to the menu.
- **Only the track that plays is imported.** An `import.meta.glob` would pick up
  all six in a line and emit 9.7 MB into `dist` for the one that is reachable.

### Tested

- **Preload (7 unit)** — starts empty and ends full; never reads full early;
  finishes and reports when an asset fails; weights by declared size; emits each
  step once; survives a slow transfer; abandons a silent one. All five relevant
  sabotages caught by exactly one test each.
- **Front door (5 e2e)** — opens on the gate with the room behind it and an
  achromatic bar; holds the button until loading finishes (asset held open by a
  route); starts the theme on the menu and stops it for a run, read off the media
  element rather than off the intent; a deep link bypasses; an aborted track
  still opens the door.
- Sabotage-verified end to end: opening the gate early, letting the theme run
  into a game, and making a failed asset reject each fail exactly one test.

### Scripts

`scripts/boot-capture.mjs` — captures the gate loading, ready and after the tap,
at desktop and phone sizes, holding the asset with a route so the loading state
can actually be looked at.

### Next

**M18a — the rest of the music.** Five tracks sit unreferenced. The question is
not how to play one but when: the room already carries a tension signal driving
the lattice glow, and music that ignores it would be the one part of the
presentation not answering to the board. See `docs/PLAN.md`.

---

## M17 — Spectral Collapse

**Branch:** `claude/webapp-game-plan-vtrxqx`

A hot bar bought with cleared lines, spent on one board-wide collapse: every
voxel falls to the floor of its column and whatever completes clears
immediately.

### It is the operation the ordinary rules refuse

Not "gravity, but bigger". `Board.clearLines` runs per-column gravity and is
deliberately careful _not_ to compact — its own comment says a piece bridging two
columns legitimately leaves a cell with nothing beneath it, and flattening the
column would silently destroy that. So overhangs accumulate for a whole run and
nothing removes them, which is most of what makes a board hard.

`Board.compactAll` is a new, explicit operation, kept separate rather than added
as a flag on the clear path — the clear-time rule is what keeps a face the player
cannot currently see predictable, and this must not become the general behaviour
by accident. A unit test asserts the contrast directly, so the distinction cannot
quietly erode.

The clears resolve through the ordinary cycle: `triggerCollapse` compacts and
then calls `beginResolve`, so they glow, cascade and score exactly as any other
clear does. That is what keeps a collapse _a lot of clears_ rather than a second
set of rules.

### The gauge

A thin vertical bar pinned to the right edge of the well, filling from the
bottom, shimmering faster as it rises and flickering hard when ready.

**Screen space, not world space.** "Attached to the right wall" reads as part of
the board, and in world space it would turn with it — sweeping away and sometimes
sitting behind the stack, which is unusable for a gauge read under pressure.

**Achromatic at every fill level**, and this is the thing the mechanic was most
likely to get wrong. A heat gauge conventionally runs blue to red; here red means
_near_, and a bar that reddened as it filled would teach that colour means
intensity — the exact false inference §2.2 exists to prevent. Heat is brightness
and agitation, never temperature. Held by test against the same chroma threshold
as the room and the masthead, and sabotage-verified by making the bar redden.

### Rules, not tuning

- **Cooling suspends once the bar is full.** Earned is earned; a player choosing
  where to spend it must not lose it for thinking.
- **A collapse does not refill its own bar.** Its clears are real lines — they
  score, they count, they feed the Shift meter — but feeding them back would let
  a large enough stack buy the next collapse outright. Sabotage-verified.
- **The piece in hand comes down with everything else.** It is a group of voxels
  in the air when the floor gives way. `lock` was split so a collapse can settle
  a piece without starting a resolution.
- **Off in Flatland**, through a mode-table field — gauge, key row and gesture
  row all absent, through the same `appliesToMode` predicate the rotation gates
  already use.
- **Cooling is tick-driven**, so replays and challenge codes survive.

Trigger: `V` on a keyboard, chosen for where it sits — next to `Z`, `X` and `C` —
rather than for what it spells. `W` was free and left alone, since M11c has it
becoming half the depth cluster. On touch, a tap on the gauge, which takes
pointer events only while it is ready.

### The balance number, and why the agent could not settle it

The plan said to tune the earn rate against the greedy agent, the way
`LINES_PER_STAGE` was tuned. **That does not work here.** The agent hard-drops
every piece and only runs the clock while a clear or a turn resolves, so it
spends no thinking time at all — and this mechanic is priced in time. An agent
with none reports that the bar fills instantly.

What the agent gives is the line rate, which is measured: about 0.3 lines per
piece. The rest is a model, written out in `game.ts` and pinned by `heatModel`:

| Clearing at       | Result                    |
| ----------------- | ------------------------- |
| 0.3 lines/second  | fills in about 45 seconds |
| 0.15 lines/second | loses ground, never fills |

The pace behind it — roughly a piece a second — is an assumption and is labelled
as one. It wants playtesting, which is the honest state for a number that depends
on how fast a person actually plays.

### Tests

**361 unit, 130 end-to-end, all passing.** Seventeen new unit tests (compaction,
the bar, the collapse, the balance model) and seven end-to-end (the gauge's
presence, placement, level, hue, both triggers, and the controls panel).

### Worth revisiting

Reusing the resolution cycle means a collapse's clears feed the Shift meter,
which answers a question the plan left open — and has a consequence worth
watching: a large collapse can fill the meter and force a turn immediately. That
may be a good moment or a confusing one, and only playing it will say.

---

## Fix — the white line across the bottom of the screen

**Branch:** `claude/webapp-game-plan-vtrxqx`

Reported in play: a solid white line along the bottom, in Flatland and every
other mode. It had been there a while and I had seen it in my own captures
without registering it.

It was the room's floor lattice. A horizontal plane viewed from zero elevation is
edge-on, so every line in the grid projects onto the same row of pixels; the
backdrop blends additively, so eighteen lines at 0.085 summed past 1 and clipped
to white. Measured at luminance 194 against a room that otherwise reads under 30.

Holding Peek identified it without touching any code: eight degrees of elevation
dropped the peak to 35 and spread it over a hundred rows, which is a grid.

The lattice now fades with `flatness`, exactly as the well's corner posts already
do -- absent when the board is settled, arriving as the camera lifts into the
turn. That is also the right answer on the design's own terms: a ground plane is
a spatial cue, and §2.1 keeps those out of the still frame.

Guarded by a test that measures a **local spike** -- one row far brighter than
the rows either side -- rather than overall brightness, since that is what a line
is and the room's own gradients score near zero by it. The bug reads 123 by that
measure against a threshold of 40; sabotage-verified.

The general rule is written up as DESIGN §2.4.1: anything in the room lying flat
in the ground plane collapses to a line when the board is dead-on.

---

## M12c — Touch moves the piece, not to a column

**Branch:** `claude/webapp-game-plan-vtrxqx`

A play note, and a correction to something M12a got wrong on purpose.

### What changed

Movement was **absolute**: the finger's screen position ran through the well's
geometry to a board column, and the piece went to that column. Lifting a thumb
and putting it back down somewhere more comfortable teleported the piece to
wherever that happened to be.

It is **relative** now. Every touch-down sets a fresh origin, and the piece moves
by the distance the finger covers from it. Where on screen the finger lands
carries no meaning at all — put it down over the HUD, off the well, the other
side of the screen; nothing happens until it moves, and then the piece moves from
where it already was.

The original reasoning was that position is absolute, which is the game's own
rule and the justification written into the code. It conflated two things. **The
board's coordinates are absolute. That says nothing about the hand's.** A player
has to be able to rest, shift grip and reach without the board answering.

### How far a drag moves the piece is now a setting

One column of travel is one column of the well by default, so the piece keeps
pace with the thumb even though it is no longer tied to where the thumb is. The
slider scales that from half to double, because a comfortable thumb arc is about
four columns at 1:1 on a small phone and the whole board at twice that.

Shown wherever the device _has_ a touchscreen — `any-pointer: coarse` — rather
than where touch is the only way in, which is the stricter test the controls
panels use. That one is right for choosing between a key map and a gesture list,
since both describe controls and only one applies. It would be wrong for a
setting: a laptop with a touchscreen can use touch controls, and hiding the
slider there puts it out of reach rather than out of the way.

### Two consequences

**The turn prompt** read the drag's absolute column to pick a face, which is
meaningless once columns are relative. It reads the drag's _direction_ now, which
is the more natural reading of that gesture anyway.

**`columnAt` is gone.** Mapping a screen x to a board column was the whole basis
of the old scheme and nothing calls it any more. It had tests of its own, which
is exactly how a dead function survives a refactor — so it went, and they went
with it.

### A wall needed no special handling, which took two tries to establish

The concern was real: press into the left wall and hold, and travel spent against
it would be banked, so reversing would do nothing until the debt was worked off.
An explicit re-anchor was written for it — move the origin whenever the engine
refuses a step.

It was dead code. The recogniser reports the **change** since the last sample
rather than a running target, so refused steps are simply dropped and there is no
debt to accumulate. The first sample that reverses moves the piece one column
back, with or without the re-anchor.

That was found by sabotage, not by reading: the test written to prove the
re-anchor necessary passed just as well with it removed. The first version of
that test could not have caught it either — it used two separate gestures, and a
new touch re-anchors by itself, so the case only exists inside one continuous
drag. Both the code and the test are now what they claim to be, and the test was
re-verified against the error that _would_ break it: reporting the running total
instead of the change.

### Tests

**338 unit, 122 end-to-end, all passing.** The recogniser's movement tests were
rewritten around the delta — same drag from two distant parts of the screen must
mean the same thing — plus end-to-end cover for lifting and re-placing, for a
drag into a wall, and for the sensitivity setting actually reaching the controls
rather than only persisting.

Four sabotages, each caught by exactly the test that claims it: fixing the origin
to the well (back to absolute), reporting the running total instead of the
change, ignoring the sensitivity setting, and — the one that was _not_ caught —
removing the re-anchor, which is how it was found to be dead.

One existing test needed a scoped locator rather than a change of claim: there
are two range inputs in settings now, and `.field__range` matched both.

---

## M12b — Mobile, wrapped up

**Branch:** `claude/webapp-game-plan-vtrxqx`

The rest of M12: the touch strip gated by mode, the Shift meter kept out from
under the thumb, touch hygiene, and a portrait layout that stops the score panel
lying across the board.

### Flatland is roll only, and gets its strip back

The field/strip split exists to carry three rotation axes. Flatland has one, so
the strip was 84 pixels of an eighteen-row well spent on a verb the mode does not
have.

The gate is in the mode table, not the interface, which matters more than it
sounds: hiding the swipe zone on a phone while the keyboard still answered `Q`
would be an input-parity break, and an invisible one until someone played both.
Two fields carry it — `rotation: 'roll' | 'all'`, and `depthNudge: 'never' |
'byStage' | 'always'` replacing `forceDepthNudge`, which could only ever turn the
nudge on _early_ and had no way to withhold it.

It also makes the mode's own promise true. Flatland is about depth being purely a
property of where you put a piece — and yaw on a flat I-piece turns four columns
in one lane into one column across four lanes, taking the piece out of the screen
plane entirely.

With no split: drag anywhere to move, fling anywhere to drop, tap anywhere to
roll. Modelled as _no strip_ rather than a strip pushed off screen, because the
zones do not merely merge — with a split, a tap on the strip is a **miss**, since
the strip is where the hand rests and resting a thumb must not roll the piece.

### The Shift meter was under the thumb

Measured on a Pixel 7: the meter ran 679 to 723 and the strip 669 to 753. The
hand rested squarely on the one readout that says when the board is about to
turn.

The strip anchored to the bottom of the _well_, which is also where the meter
goes. It anchors to the bottom of the **window** now — where a thumb rests
anyway — leaving the space under the board free.

That exposed an older bug underneath it. `HUD_RESERVE` reserves space below the
board in **cells**, and cells shrink with the window: 1.6 of them is 27 pixels on
a phone in landscape against a 44-pixel meter, so the meter had always been drawn
over the bottom rows of the board there. The camera fit takes a reserve in pixels
now and treats it as a **floor** — the board is pushed up only when the framing
does not already leave that much — so a desktop is framed exactly as before, and
portrait turns out to have room to spare: the strip costs it nothing.

|                    | before                 | after                                    |
| ------------------ | ---------------------- | ---------------------------------------- |
| Portrait, Flatland | meter inside the strip | no strip at all                          |
| Portrait, Ascent   | meter inside the strip | meter 679–719, strip from 755            |
| Landscape, Ascent  | meter over the board   | board ends 220, meter 224–268, strip 276 |

### Touch hygiene

**Text selection** was scoped to four selectors and to touch-primary devices,
which left the title, the score, the mode blurbs and every panel body selectable
— and on a touchscreen laptop, which is not touch-primary, all of it. It is
app-wide now. The challenge code stays selectable, because a player has an actual
reason to copy theirs.

**Horizontal scrolling** was implied by `overflow: hidden` and is now named, on
the page and on the panel layer. Every way a page starts sliding sideways is an
accident — a panel a few pixels too wide, a long unbroken string — and each one
turns a game into a page that moves under the thumb.

### Portrait

The score panel lay across the top-left of the well and covered the first rows of
the stack: `min-width: 8.5rem` on the stats alone is 136px before padding, in a
margin of about 80px.

**The plan said to move the HUD above and below and let the well take the width,
and that was wrong.** The board cannot take the width and never could — the
frustum has to hold the footprint's 45-degree diagonal so the board does not
change scale during a turn, which caps the well at about 62% of the window
whatever the HUD does. The remaining 38% is permanently empty and is exactly
where the HUD belongs. So the columns stayed and the panels were sized to the gap
that already exists, which is a much smaller change than the plan imagined and
the right one.

Safe-area insets go on the two full-bleed layers rather than on the page, so the
canvas still fills the display and only what has to be read moves inward.

### Controls panels stopped advertising verbs the mode ignores

A consequence of the gating, and one the plan called: `Q`, `E`, `R`, `F` and the
two nudge keys do nothing in Flatland, and neither do the yaw and pitch gestures.
Both panels filter through one shared predicate, so the keyboard map and the
touch map cannot disagree about what a mode offers. The touch panel also drops
its "in the bottom strip" notes in a mode with no strip — a note pointing at a
region the player cannot find is worse than no note.

### Tests

**335 unit, 119 end-to-end, all passing.** New: five unit tests for the mode
gating, five for the recogniser with no strip, and eleven end-to-end run against
a real device profile rather than a narrowed desktop window — the two differ in
the way that matters, since a narrow window still reports a fine pointer and
still has a keyboard, and the layout branches on exactly that.

Sabotage-verified: giving Flatland a strip, removing the bottom reserve, and
making text selectable each failed exactly the test that claims it.

### Two findings from the testing

**A test that could not fail.** The meter-clears-the-strip assertion passed with
the meter's own clamp removed, because in portrait the meter lands thirty pixels
clear whatever the layout does. The clamp is a guard; the reserve is the
mechanism. The test now runs in both orientations, where landscape's margin is
thin enough for the reserve to be doing real work, and the code comment says
plainly which of the two is load-bearing.

**A leak that looked like flakiness.** Two phone tests timed out at 35 seconds
and passed in four on their own. Contexts made from `browser` are not closed the
way the `page` fixture is, and each held a page rendering WebGL every frame; by
the seventh test the machine was saturated. Closing them cut the block from three
minutes to fifty seconds.

### Also fixed on the way

**The debug hooks had drifted from the real start path.** `restart` and `play`
constructed a game, reset the flag and showed the screen themselves rather than
calling `startRun` — so they had already missed `snapToFace` from M14, and missed
the strip reserve the moment it was added. The end-to-end suite drives the game
through those hooks, so a debug path that diverges from the real one is a suite
testing something no player ever gets. Both delegate now.

### Still open

**Landscape as a genuine second layout.** It works and nothing overlaps, but the
well is 87px wide on an 863×360 window with roughly 600px of horizontal space
empty either side. The board is height-limited there, so the answer is a layout
that uses the width — not a reserve that shrinks the board further.

**The frame budget**, moved to M16 with the profiling pass. Nothing in that
section was ever measured, and one of its assumptions changed under it: the gel
material added per-fragment work to every cube in M14, which is exactly what a
budget exists to catch and exactly why it should be set after the look settles.

---

## M14 — The Look

**Branch:** `claude/webapp-game-plan-vtrxqx`

Two items: the gel voxels and a stylised title screen. Taken before M12b and M13
deliberately — M13 wants a title screen to be offered from, and M16 wants visual
regression baselines, which would have been pinned to a look that was about to
change.

### Gel voxels

Every solid cube is cast resin now rather than flat plastic: denser through its
thickness, a directional catch along the bevel, a thin rim where the surface
turns away, the glow settling toward the lower edge, and a faint tooth inside it.

Built as a shader injection on the existing `MeshStandardMaterial` rather than as
a new material. Three's lighting maths stays intact, which matters here more than
usual — reimplementing it is exactly how the board ended up at a fifth of its
palette value the first time.

**The fidelity rule turned out to be stricter than the plan assumed, and that
made the material easier rather than harder.** The plan said the cube's _mean_
had to stay at the palette value. It is not the mean: the test samples a 5×5
patch at the _centre of the face_ and allows six levels of 255. So rather than
tune the effect until it happened to average out, every term is multiplied by one
of two masks that are exactly zero at the centre of every face. The invariant is
structural. Turning the effect up is a look decision and can never become a
fidelity bug — which was confirmed by removing one mask and watching the settled
cube come back at 211,65,55 against a palette of 235,73,63.

Two passes on the look, and the difference between them is worth recording:

- The first put a uniform band around the whole perimeter. That reads as a
  backlit tile, not a solid — the halo is the entire silhouette lighting up at
  once. Real gloss is directional, so the catch is now weighted by how much the
  bevel faces the light, and the all-round component is a true Fresnel term,
  which peaks exactly on the silhouette and draws a thin line instead of a band.
- The pooled glow was a lerp toward white and is now emission tinted by the
  cube's own colour. Resin lit from within glows in its own hue; toward white it
  turned a red cube pink along its bottom third, desaturating the one channel
  that carries meaning.

**One consequence had to be found by measurement.** The gel's highlights lerp
toward white, and the muted band exists to read as a dark mass with no structure
— so a cube dimmed to a quarter of its colour came back with a rim as bright as
an undimmed one's, and the muted band's peak overtook the x-ray's, inverting the
two bands the whole drop channel depends on. The gel carries the layer's own dim
now. Scaled by the layer rather than by the pixel's brightness: reading the
brightness would work and would quietly make the effect depth-dependent, since
violet is a darker stop than green.

### The title screen

It was plain type over an 86%-opaque blackout with, on a cold boot, nothing
behind the blackout anyway — a wordmark on a black rectangle, which is true of
any game.

The scrim is a gradient now, opaque behind the masthead and clearing toward the
bottom where the stack sits, and the panel aligns to the top rather than
centring: a masthead over a live scene rather than a card in front of one. The
HUD is hidden there, because a score of zero and a Shift meter for a run nobody
has started are furniture from a different screen — they became legible the
moment the scrim stopped hiding them.

**The board turns by itself**, using the game's own turn rather than a rotation
written for the title, so the front door demonstrates the central mechanic before
anyone has pressed anything. Held between turns so it presents a face rather than
spinning, and suppressed entirely under reduced motion.

On a cold boot the well holds a composed ridge with **exactly one cube per screen
cell**. That is load-bearing: a near cube hides what is behind it completely, so
a second cube in the same cell is not extra material — it is a cube you cannot
see that has taken a lane away from one you can. A denser two-helix version was
tried and reverted for exactly that, because of two cubes sharing a cell the
nearer always wins, and at a half-depth offset the nearer is always in lanes 0
to 3: the front face came out red-through-green with no blue or violet anywhere.
Density comes from height instead. On any later visit the well holds whatever the
player last built.

The masthead is achromatic. §2.2 partitions the palette absolutely — the only hue
on screen belongs to a cube — so the type cannot carry the spectrum and the board
carries it instead, which is the better division of labour anyway.

Built responsive from the start rather than retrofitted, because **M12b moves the
HUD to portrait-first** and a desktop-shaped title would simply have been rebuilt
there.

**One real bug came out of it**, and it is the reason a title that moves the
camera is not free. The renderer's yaw is its own state, so after a few attract
turns it sits at 90, 180 or 270 — while a new game is always on the front face.
The board would have opened wearing the palette of a face nobody was playing,
with every control pointing the wrong way. Found by reasoning about the two
states rather than by seeing it, fixed with `snapToFace` on `startRun`, and the
test for it was confirmed to fail without the fix.

### Tests

**325 unit, 109 end-to-end, all passing.** Five new:

- The gel does not vary with depth, measured in Blind Spectrum — the one mode
  where every cube carries an identical fill, so the material is the only thing
  that could tell one lane from another.
- The gel is actually there, which the fidelity test cannot say: a material
  deleted entirely passes that one perfectly.
- The title shows the board rather than covering it, and every other screen keeps
  the heavy scrim.
- The masthead carries no hue.
- The HUD is hidden on the title, and a run starts on the face the engine is
  playing.

Two existing assertions had to change, both the same shape: they asserted a cube
is _featureless_ (`peak - mean < 3`), which was true of flat shading and is
deliberately false now — a gel cube reads about sixty levels between peak and
mean on its own. Both now compare the cube against an untouched neighbour in the
same frame, which is the claim they were always making and does not care what the
material does, as long as it does it to both.

### On the testing itself

Three of the new tests did not discriminate when first written, and each was
found by sabotaging the code and watching the test pass anyway:

- **The depth-independence test sampled the inner 80% of a cube**, and the
  Fresnel rim lives on the extreme silhouette — outside the window. A violation
  confined to the rim changed the measurement by nothing at all. The sample now
  covers the cube's full extent (4% to 96% of its cell) and catches it: 1.16
  levels of spread clean, 2.5 to 2.9 sabotaged.
- **The HUD test probed the stats panel**, which sits under the opaque end of the
  title's gradient and reads dark whether the HUD is hidden or not. Moved to the
  Shift meter, at the bottom where the gradient has cleared.
- **That test then compared means**, and the meter's region is mostly dark either
  way, so the ratio landed either side of the threshold from run to run — one
  attempt failed at 0.74 and the retry passed at 0.57. It compares peaks now: the
  meter's near-white label is either drawn or it is not, 67 against 147, stable
  to four decimals.

Worth recording separately: a `git checkout src/main.ts src/render/gel.ts`
restored **neither** file, because `gel.ts` was untracked and git rejects the
whole pathspec if any part of it is invalid. Several "the sabotage was not
caught" results in between were measured against a tree that still had the
sabotage in it. Verify the file, not the command's intent.

### Worth revisiting

The attract board is composed only when the well is empty, so it never appears
again once a player has a stack. That is deliberate, but it means the composed
arrangement is seen mostly by new players — worth re-checking when M13's tutorial
decides what a first launch looks like.

---

## M10 — Reading the board, closed out

**Branch:** `claude/webapp-game-plan-vtrxqx`

The three items M10 had left: Peek, the turning next-piece preview, and the ghost
and contact clarity pass.

### Peek

Hold `P` and the camera tilts eight degrees; let go and it comes back. It changes
no game state at all — no piece moves, no lock timer runs, no line resolves —
which is what makes it safe to hand a player in the middle of a run.

Eight degrees is small on purpose. It has to be enough to separate a settled
stack along the depth axis, which is the whole point since a dead-on board offers
no parallax whatsoever, without becoming a second way to read depth competing
with the spectrum. The board stays orthographic throughout, so a far cube is
still exactly the size of a near one; only the angle changes. Eased over 180ms
rather than snapped, in both directions, because the movement is what carries the
reading — it is the cubes sliding past each other that says which is in front, and
a hard cut arrives at the same camera position showing none of it.

It is a comprehension aid with a deadline. Offered while the spectrum is still
being learned and **withdrawn at Stage 6**, where reading depth from colour is
the skill rather than the tutorial; a tool that never withdraws teaches a player
to lean on it. And off entirely in Blind Spectrum — keyed off the mode's
`depthColour` flag rather than off its name, because that is the actual reason:
there, Peek would not supplement the depth channel, it would be it.

The rule lives in `Game.peekAllowed`, not in the renderer, so it is unit-testable
without a canvas. The camera side releases explicitly when input is dropped, so
opening pause with the key held cannot strand the board off-axis for the rest of
the run.

### The turning preview

The next piece is a 3D render now, turning once every seven seconds. A flat
preview shows only what the board shows — one projection — and for a piece with
cubes at two depths that is not enough to know its shape: a screw and its mirror
project identically from one face, so the player was being asked to plan a
placement for a solid they had only seen flattened. A still preview is still
available in settings, as the _harder_ option rather than the plainer one.

It turns; its colour does not. Each cube wears the colour of the lane it will
arrive in, exactly as on the board, because the preview's job is to say what is
coming and where — not to invent a second way of describing depth.

It is drawn into a scissored corner of the board's own canvas rather than into a
canvas of its own. A second `WebGLRenderer` means a second GL context, a second
copy of every shader and a second frame to keep in step; a scissor rectangle
costs a viewport change. The rectangle is taken from the DOM panel that frames
it, so the two stay aligned through every layout change without either knowing
about the other.

**Which is also what made it hard.** The canvas sits _behind_ the HUD, so the
panel's own 82%-opacity fill and backdrop blur were being painted over the
render. It looked like a black preview, and the camera position, the frustum, the
instance count, the material and the light were all verified correct before the
panel sitting on top of it was suspected. The panel is a window now, and its fill
moved into the preview scene's own background, where it is behind the piece
instead of in front of it.

Two more came out of that hunt:

- **`setViewport` and `setScissor` multiply by the renderer's pixel ratio
  internally.** The rect was being pre-multiplied as well — correct at ratio 1,
  and off by a factor of two on every other display.
- **The frustum is sized for the longest piece at any yaw**, not fitted per
  piece, so a compact piece looks small. Pieces keep their true relative size
  rather than each being scaled to fill the panel.

### The clarity pass, which turned out not to be about the marks

Measured before re-tuning anything, and the measurement is why nothing was
re-tuned. Every previous measurement had put three lanes of wall in front of the
piece, and three is not the hard case: the well is eight deep, and a stack that
has filled the front of the board is exactly when a player cannot tell where
anything will land.

Against a full-depth wall, with the piece bound for lane 7:

| Sampled cell            | Buried, before | Buried, after | Open board |
| ----------------------- | -------------- | ------------- | ---------- |
| Landing footprint       | 134 / peak 135 | 112 / 115     | 109 / 112  |
| Contact mark            | 170 / 180      | 191 / 213     | 203 / 227  |
| Channel above them      | **93 / 119**   | 22 / 73       | 11 / 36    |
| Untouched cube, no aids | 107            | 107           | —          |

Translucency accumulates. Seven panes at 0.12 each leave 0.88⁷ = 41% of the light
behind them, so the channel came back at 59% coverage — luminance 93 against an
untouched cube's 107, which is to say **the x-ray had turned back into a wall.**
The landing footprint behind it peaked at 135 against glass peaking at 119: a 13%
separation, where an open board gives fourteen times. The aid dissolved as the
board got harder, which is backwards, and no amount of re-tuning the marks could
have fixed it, because the marks were never the problem.

Lowering the fill's opacity cannot fix it — one number has to serve both a single
pane and eight, and faint enough for eight is invisible for one. Per-instance
alpha cannot either: instance colour multiplies the fragment, not its alpha, so
dimming a rear pane darkens the stack without making it any more transparent.

So the pane count is capped: **one pane of glass per screen cell, the nearest
one.** How many cubes are stacked in the way is not something a player acts on;
where the region is, how deep it starts and where the piece will land are, and
those come from the region's outline, the outline's colour and the two marks.
`EdgeLayer` already collapsed the region to one depth per screen cell for exactly
that reason, so this makes the fill agree with the border drawn around it. Buried
and open now read within a tenth of each other.

### A favicon

Unrelated, and found by the same suite: the page had no icon at all, so every
boot logged a 404 for the browser's default `/favicon.ico` probe — a pre-existing
red test on this branch. It is one voxel wearing the whole ramp, using the
palette's own seven bands from `depthColor` rather than colours picked to look
like a rainbow.

### Tests

**325 unit, 102 end-to-end, all passing.** New this milestone:

- Three unit tests for `peekAllowed`: offered at Stage 1, withdrawn at the stage
  the spectrum has to carry alone, off where there is no depth colour.
- Six end-to-end tests for Peek — the tilt holds and returns, it is eased rather
  than snapped, it moves the camera and nothing else, it is withdrawn at Stage 6
  and in Blind Spectrum, and a menu opening cannot strand it.
- Three for the turning preview: it turns rather than holding one projection, it
  holds still when the player asks, and its colour does not drift as it turns.
- Three for the buried board — both marks stand clear of seven lanes of glass,
  a wall in front costs them almost nothing, and a column the piece does not
  cover keeps its full colour.

Four existing tests had to move rather than change what they claim. The preview
is not DOM any more, so "shows the next piece" reads the canvas; the grid-spacing
test reads the hold slot, which still uses the DOM grid; Blind Spectrum's
no-colour-leak check reads both. The colour-fidelity test moved to the hold slot
too, and that one mattered most: NEXT was its independent reference precisely
_because_ it was DOM painted straight from the palette, and comparing the board
to a WebGL preview would have been comparing the pipeline against itself, with
every fault it exists to catch cancelling out.

One changed its yardstick without changing its claim. The interior of the x-rayed
region was checked by scaling its peak against its own mean; with the fill now
faint by design, that mean sits near the background and two luminance levels of
antialiasing become a 55% swing. It compares the interior cell against the border
cell in the same frame now, which is what the claim was always about.

### Worth revisiting

The hold slot is still a flat DOM preview. It is the fidelity suite's independent
reference now, so if it ever becomes a 3D render the reference has to be replaced
first — with a plain palette swatch in the DOM — not simply moved again.

---

## M11b — Interface corrections

**Branch:** `claude/webapp-game-plan-vtrxqx`

Four small ones from the play notes, unrelated except that they are all things
the interface was getting wrong.

### The Shift bar was painting over every menu

`.hud__shift` carries `z-index: 1` so the meter clears the board's chrome, and
`.screens` carried nothing to answer it — so the meter sat on top of the title
screen, the mode grid, settings, pause and game over alike. Purely visual, since
the HUD is `pointer-events: none`, but it was on screen at the front door.

Fixed by declaring the painting order in one place rather than patching a number,
since this was the second cascade bug in two milestones and both were a rule that
was right alone and wrong beside one written later.

### The ghost piece stops being a setting

It is not a preference, it is how the board is read: every landing-mark decision
of the last three milestones assumed it is there. A toggle invites a player to
switch off the thing that makes depth legible and then conclude the game is
unfair. Gone from the settings panel and from the save schema. It survives as a
renderer flag, because the end-to-end suite turns the marks off to measure the
cubes underneath them on their own — and that is a different thing from offering
it to a player.

### Volume loses its description

"Master level, kept separately from mute" explained a distinction nobody asked
about.

### Flatland is the default mode

Planar pieces only, so depth is purely a property of where a piece is put rather
than of its own shape — the gentlest first contact with the idea the game rests
on, and it was already unlocked so nothing else had to move. Roll-only is still
M12's half; for now a new player gets flat pieces but all three rotation axes.

Two things had to move with it, and the second was a genuine latent bug.

**The mode grid opens on the last-played mode** rather than on whichever card is
first in the table. Without that, "the default mode" meant something in storage
and nothing on screen: the grid still focused Ascent, so pressing Play and Enter
still started Ascent. It is better behaviour for a returning player too.

**The engine's default split off from the player's.** `new Game({ seed })` was
resolving its mode through `DEFAULT_MODE_ID`, and its own doc comment said
"defaults to Ascent, the authored arc" — true until the player-facing default
moved, at which point every mode-less game in the test suite quietly became a
tier-capped one starting at stage 2. Two tests failed and were right to. They are
now two constants: `AUTHORED_MODE_ID` is the reference ruleset the engine falls
back to, `DEFAULT_MODE_ID` is what a player is handed first. A test that asserted
"defaults to Ascent" while comparing against whichever constant was handy has
been split the same way.

### Tested

**322 unit tests, 90 end-to-end tests.** Typecheck and lint clean. Four new
browser tests, each confirmed to fail when its behaviour is reverted.

One of those four was **passing for the wrong reason** and had to be rewritten.
The stacking test used `document.elementFromPoint` to ask what was on top at the
meter's position — but the HUD is `pointer-events: none`, so hit-testing skips it
entirely and reports the panel underneath _whichever way round the two are
stacked_. It passed just as happily with the bug reinstated. It measures pixels
now: the meter's own rectangle, with a panel open and without, and the 86%-opaque
backdrop has to take most of its brightness away.

---

## M12a — Touch controls

**Branch:** `claude/webapp-game-plan-vtrxqx`

The game had no touch handling at all: the only pointer listener in the codebase
resumed the audio context. It has a full gesture vocabulary now, built on the
zoning from the play notes.

### The scheme

A narrow strip along the bottom moves the piece; everything above it rotates it.
That zoning is what makes the vocabulary work — a gesture never has to be
disambiguated by what it happens to be near, because the region it starts in
already says which verb class it belongs to. It also keeps the thumb off the
board: movement happens below the well, so the hand is never over the thing being
aimed at, which was the first worry on the list when this was scoped.

| Gesture                     | Verb                        |
| --------------------------- | --------------------------- |
| Drag sideways, in the strip | Move — absolute, per column |
| Flick down, in the strip    | Hard drop                   |
| Drag down, in the strip     | Soft drop                   |
| Tap left of centre, above   | Roll back                   |
| Tap right of centre, above  | Roll                        |
| Swipe left / right, above   | Yaw                         |
| Swipe up / down, above      | Pitch                       |

Two of those replaced the obvious answer with a better one.

**Hard drop is a flick, not a double tap.** A double tap is two taps plus a
waiting window, so either the drop waits on the window and feels late, or the
first tap fires and every drop rolls the piece on its way down. A flick and a tap
differ at the first sample that moves, so neither waits on the other.

**Roll takes its direction from where the tap lands.** Roll is the rotation used
constantly — the screen-plane one, the ordinary falling-block rotate — so it
cannot carry the latency of a double tap or the dwell of a long press. Splitting
the field at the well's centre gives both directions at no cost, and reads
naturally: tap left to turn left. That is what closes the gap identified when the
scheme was scoped, where four swipe directions covered only two of three axes.

Movement is **absolute, not accumulated**: the column under the finger is the
column the piece is in, not a running total of how far the finger has travelled.
It is the claim the game already makes about everything else. The piece centres
on the target rather than aligning by its left edge, and each column is a stepped
move through the collision check, so dragging across a wall stops at the wall.

The turn prompt borrows the strip: while the board is waiting to be turned, a
sideways drag chooses the face. Same double duty Left and Right already do on a
keyboard in that state.

### Split so the feel can be tested

`GestureRecogniser` is pure — samples and a layout in, intents out, no DOM and no
clock of its own — and `TouchController` is thin plumbing that decides nothing.
Every threshold that governs how a gesture feels is a named constant in one
module, which is the only way any of it can be tuned or pinned. Seventeen unit
tests cover the cases that actually matter: a flick that should drop against a
slow drag of the same distance that should not, a tap against a thumb resting too
long, a diagonal resolving to one axis rather than both or neither.

### The panel follows the input method

A phone gets the gestures, a keyboard gets the keys, chosen by
`(hover: none) and (pointer: coarse)` rather than by width — a narrow window on a
laptop still has a keyboard. Two tables rather than two columns of one, because
the vocabularies do not line up: a keyboard binds a key per direction, and touch
gets both directions of roll out of where a tap lands.

### Tested

**321 unit tests, 86 end-to-end tests.** Typecheck and lint clean.

Five browser tests on the wiring — a drag lands the piece under the finger, a
flick drops it, a tap rotates without moving it, a mouse is still a keyboard
player, and nothing reaches the piece while a menu is up. Each confirmed to fail
when its behaviour is reverted.

Two bugs the tests caught in themselves rather than in the code. The drop test
first asserted on the piece's height, which cannot tell "dropped" from "did not
move" — a hard drop locks the piece and spawns the next one at the same spawn
row. It measures the board now. And the panel-selection test looked like broken
device emulation when it was **a plain CSS cascade error**: the default
`display: none` for the touch panel was declared after the media query that
un-hides it, and at equal specificity the later rule wins.

### Still open in M12

Hold, the depth nudge, and pause have no touch route yet. All three want a place
to live rather than a gesture, so they land with the layout work: the HOLD panel
is the obvious target for hold, and the nudge appearing as two controls at the
moment it unlocks at Stage 4 is a better reveal than a gesture nobody discovers.
Until then a run is playable by thumb but not fully steerable — the Shift meter
still falls back to turning itself after five seconds.

Portrait layout, safe-area insets, landscape, and the frame budget are M12b and
M12c.

---

## Play response: one border, not two

**Branch:** `claude/webapp-game-plan-vtrxqx`

> "You don't need to show keyboard mapping for mobile. Just mobile actions. Also,
> for the landing indicator, remove the border — it gets confusing with the x-ray
> borders in place."

### The landing mark loses its outline

Two milestones ago the landing mark was invisible, and an outline was what fixed
it. But an outlined mark sitting inside an outlined x-ray region is two borders a
few pixels apart saying different things, and both got harder to read for it.
There is one border on screen now, and it belongs to the x-ray.

Which puts the mark's legibility back on its fill, and the original problem back
in play: on an open board, where the x-ray correctly does nothing, a translucent
cube reads as a dead block — 0.44 of a lane colour over the well's near-black
background lands around luminance 47. The fill is raised to 0.72 and lifted 45%
toward white, which also evens out the ramp. Violet at luminance 67 is the case
that decides the numbers: a fill alone leaves the dark end of the spectrum far
fainter than the bright end, and the lift is what carries it. Measured on an open
board, the mark now peaks at 168 against an empty cell's 21.

It stays inset at 0.78, which is what keeps it reading as a mark rather than as a
cube now that it is this solid. The two marks stay distinguishable by hue as well
as position: the landing mark wears its lane's colour, the surface mark below it
is near-white.

**A process note worth recording.** The first attempt at this changed nothing,
because the edit that was supposed to set the new opacity never matched the
source — so two rounds of measurement were taken against the old value, and the
numbers looked inexplicably flat. The tell was that raising opacity from 0.5 to
0.7 moved the measured peak by two luminance levels. When a change has no effect
it is worth checking that it was applied before concluding anything about it.

### The key map is for keyboards

Hidden on touch-primary devices — `(hover: none) and (pointer: coarse)` rather
than a width breakpoint, since a narrow window on a laptop still has a keyboard
and a tablet with one attached reports a fine pointer.

The slot is empty on a phone rather than filled with mobile actions, because the
mobile actions do not exist yet. A panel documenting gestures the game does not
answer to is worse than one that says nothing. M12 fills it, and reads whatever
carries the gestures the same way the key map reads `BINDINGS`.

### The mobile rotation scheme, part-resolved

Recorded in M12 rather than built. The proposed split — a narrow strip along the
bottom for movement, swipes above it for rotation — is the right idea, and solves
the hardest part: a gesture no longer has to be disambiguated by what it is near,
because the region it starts in says which verb class it belongs to.

It does not reach three axes on its own. Four swipe directions cover two axes
bidirectionally, and the third is left with nothing — and the one left over is
`roll`, the screen-plane rotation a player uses constantly, while yaw and pitch
are the specialists. So the resolution is to invert which verbs get which class
of gesture: tap for roll, swipes for yaw and pitch, and hard drop on a downward
fling in the strip rather than a double tap, which also removes the collision
where every double tap would roll the piece once on its way to dropping it.

### Tested

**304 unit tests, 79 end-to-end tests.** Typecheck and lint clean.

The landing-mark test changed with the mark: it asserted a border and now asserts
the fill, still against the same claim — that the mark reads with nothing in
front of it, on the board where the x-ray does nothing at all.

---

## M11a — The controls, told to the player

**Branch:** `claude/webapp-game-plan-vtrxqx`

> "Need a key map in settings so player knows what keys do what."
> "Arrows should allow you to move around the menu."

Both from the play notes, both shipped. Writing the first one is what found a
bug that had been sitting in the game since the depth nudge was added.

### The bindings are a table now, and the panel reads it

The key map could have been a list written out in the settings panel in its own
words. That is exactly how a key map goes stale: right on the day it is written,
wrong by the next binding change, with nothing to catch it. So the bindings moved
into `src/keymap.ts` as data, and both the input controller and the panel read
it. The panel cannot describe a key the engine does not answer to, and the engine
cannot answer to a key the panel does not show.

The end-to-end test asserts the rendered rows against that same table, read off
the live build rather than copied into the test.

### Which found half a mechanic missing

`nudgeDepth` takes `-1 | 1`, and the design spec said the Depth Nudge "shifts
the piece ±1 lane" on `W` / `S`. That pairing cannot work: `S` is half of the
WASD movement cluster the README advertises, and is already the soft drop. So
only `W` was ever bound, only one direction ever worked, and **half of a Stage 4
mechanic had been unreachable** — quietly, because nothing in the game had ever
listed its own controls.

Depth takes its own vertical pair now, `T` deeper and `G` nearer, sitting next to
the `R` / `F` used for pitch: two spatial axes, two adjacent pairs, and neither
of them stealing a movement key. The spec and the README are corrected to match.

The table makes this class of bug hard to repeat. `Action` is a union and the
unit test asserts every member appears exactly once, so an unbound direction is
now a failing test rather than a silence.

### Arrow keys move through the menus

Focus travels the panels and the mode grid with the same keys that move a piece,
so the player does not have to work out that this part of the game wants Tab
instead.

Rows come from the **laid-out geometry**, not from the markup: the mode grid is
one column on a phone and several on a laptop from the same DOM, and only the
rectangles know which it currently is. Left and right walk the row and spill into
the next; up and down change row and keep the nearest horizontal position.

Two controls keep their arrows. A text field needs them for the caret and a
slider needs left and right for its value — taking those would make the volume
control unusable by the very keyboard this is meant to serve.

### Two layout fixes the key map forced

- **The settings panel could not scroll.** `.screens` centres its panel in a
  grid, and centring an item taller than its container pushes the top edge above
  it, where scrolling cannot reach. It had never mattered because no panel was
  that tall. `place-items: safe center` falls back to start alignment at exactly
  the point centring would start hiding something.
- **Sixteen bindings in one column** made the key map taller than the settings it
  was added to, pushing the actual controls off the top of the window. It is
  two-column now, one on narrow screens, with each group a block so the column
  break cannot strand a row from its heading.

### Tested

**304 unit tests, 79 end-to-end tests.** Typecheck and lint clean.

Eight new unit tests on the table itself — every action bound once, no key with
two meanings, every code resolving, the depth nudge working both ways and still
locked before Stage 4 — and six browser tests on the panel and the navigation.

A note on how those were verified, because the method silently failed for a
while. Playwright's `reuseExistingServer` is on outside CI, so a preview server
left running from an earlier run keeps serving the **previous build** — which
means deliberately breaking a behaviour to confirm a test catches it can report a
false pass. Two of these checks did exactly that before it was noticed. Running
with `CI=1` forces a fresh server and is the reliable way to confirm a test bites.

The strict compiler is also doing more of this work than expected: removing a
binding, orphaning the key map builder, or unhooking the arrow handler are all
caught by `tsc` before a test ever runs. Confirming the _behavioural_ guards
needed sabotage that still compiles.

---

## M10a — The landing marks

**Branch:** `claude/webapp-game-plan-vtrxqx`

> "Right now, x-ray terminates where the piece would land. The x-ray effect
> should terminate at the ghost voxel… The ghost indicator still isn't present.
> Used to look like a smaller solid square on the face of the ghost voxel… Only
> the outer circumference of the x-ray voxel area should have a border highlight,
> not each individual voxel."

Four notes that turned out to share a vocabulary problem, and it had been costing
passes at this. **"The ghost voxel" means the first settled cube beneath the
piece — the surface it comes to rest above — not the projected piece position.**
They are the same cell only when the piece lands flush, and a piece that does not
fit its footprint stops with a gap underneath. Measured, with a flat four-wide bar
dropped onto a staircase:

| Column | Piece lands at | First actual voxel | Gap    |
| ------ | -------------- | ------------------ | ------ |
| 1      | y = 9          | y = 8              | 0 rows |
| 2      | y = 9          | y = 4              | 4 rows |
| 3      | y = 9          | y = 2              | 6 rows |
| 4      | y = 9          | y = 1              | 7 rows |

### The channel was stopping four to seven rows short

Its floor was the landing row — y = 9 in every column above — so the gap under
three of those four columns sat outside the channel and drew solid. That is the
one thing a player most needs to see when a piece is about to land badly. The
floor now comes per column from `firstContactCells()`, which was already being
computed each frame for the contact layer.

The surface cube itself stays solid: it is the backstop the channel stops
against, and an x-rayed cube cannot carry a mark.

### There are two landing marks, and neither had ever worked

Not one mark reported twice. On a stepped board they are rows apart, and the
distance between them **is** the gap.

| Mark            | What it is                                                   |
| --------------- | ------------------------------------------------------------ |
| Landing outline | the piece's own cells at their landing position              |
| Surface mark    | a smaller, near-white square on the face of the cube beneath |

**The surface mark had never been visible at all**, for two compounding reasons.
`VoxelLayer` set `emissiveIntensity: options.emissive` alongside
`emissive: 0x000000` — an intensity multiplied into black — so the contact
layer's 0.7 and the active piece's 0.35 had been silently zero since they were
written. And even with that fixed the geometry was buried: the mark was a smaller
cube sharing a centre with the cube it marked, which is simply inside it. It is
pushed out onto the near face now.

Lifting it halfway to white was measured first and is not enough. On an already
bright lane — green at luminance 198, yellow at 190 — a half lift moves it about
12%, so the mark disappears on exactly the colours it most needs to survive.
Near-white gives a quarter or more on every stop of the ramp, and it is the more
consistent choice anyway: the cube it sits on already states the depth, so the
mark is chrome, and chrome in this game is achromatic.

**The landing outline was legible only by accident.** A 0.44 translucent cube
over the well's near-black background lands around luminance 47, and it was at
its faintest on an open board — where the x-ray correctly does nothing and there
was nothing to lend it contrast. Exactly backwards, and exactly what "those
should be wholly separate" was about. It carries its own outline now, drawn above
every see-through pass.

### One outline for the region, not one per cube

Twelve edges per cube turns a block of them into a grid of boxes: busy, and
competing for exactly the attention the marks need. `EdgeLayer` now projects the
cells to screen cells and emits only the edges bordering an unoccupied
neighbour, so interior seams disappear and the region reads as one shape — holes
in it outlined too, which is right, since a hole is a place where there is
nothing to see through. Drawn flat on the plane just in front of the board:
orthographically a screen-space boundary is exactly what a silhouette is, and
nothing on the board should hide the border of the region the player is being
asked to look into.

### Tested

**296 unit tests, 73 end-to-end tests.** Typecheck and lint clean.

Five new end-to-end tests, each confirmed to fail when its behaviour is reverted:
the channel reaches the first real voxel rather than the landing row; the surface
cube stays solid and takes a mark; the landing outline reads with nothing in
front of it; and the x-rayed region is outlined once rather than per cube.

Two measurement traps worth recording, because both produced a wrong reading
first. The staircase makes the x-rayed region's own shape stepped — each column's
floor is its own surface — so a cell that looks interior can sit against a column
whose floor is higher. And every column's floor row holds the backstop cube,
which is solid and carries a mark, so a probe there measures the mark rather than
the x-ray.

One existing assertion was replaced rather than retuned. "Leaves the board alone
when nothing is falling" compared brightness between the two states against a
factor of two, and sat within a percent of it — it would have failed on any
change of a few luminance levels. It now asserts that the settled cube is a flat
solid face, peak against mean, which is both the actual claim and not on a knife
edge.

---

## The x-ray becomes a channel, not a mode the board is in

**Branch:** `claude/webapp-game-plan-vtrxqx`

> "It's say you have a blue piece 4 voxel long, and it's turned sideways and
> center at the top… All voxels in the 4 lanes beneath the piece, above the ghost
> indicator, as well as any in front of those are x-ray voxels. Any behind are
> muted."

Sent with a hand-drawn illustration, and it named three things the previous pass
had wrong.

### The region was the whole board

Every version until now classified **every cube on the board** by its lane alone:
in front of the piece, in the piece's lane, or behind. That is why a piece dealt
to a back lane turned the entire board to glass and one dealt to the front muted
all of it — and it is the real reason "everything looks muted" survived a
rollback, a retune, and a colour-pipeline fix. The opacities were never the
problem. The region was.

The region is the **drop channel**: the columns the piece spans, from the row it
will land on upward, and nothing else.

| Where the cube is                                   | Drawn as   |
| --------------------------------------------------- | ---------- |
| In the channel, at or in front of the piece's depth | **X-ray**  |
| In the channel, behind the piece's depth            | **Muted**  |
| Anywhere else — another column, below the ghost     | **Normal** |

On a 4-wide piece that is 4 of 8 columns, above one row. The rest of the board —
most of it, most of the time — is untouched.

### There was no vertical cut at all

"Above the ghost indicator" had no counterpart in the code. The buried stack
below the landing row was being x-rayed along with everything else, despite
having nothing to do with the shot being lined up. The channel now has a floor,
read per column off the ghost.

A consequence worth stating: **on a level board the x-ray does nothing, and that
is correct.** The ghost sits on top of the stack, so on flat ground there is
nothing above it to see through. The effect only has work to do when the stack is
uneven. The first rewrite of the tests missed this and built a flat slab, which
measured the one board where the right answer is "no change".

### There is no focal band

The legend in the illustration lists four things — normal, x-ray, ghost, muted —
and a focal state is not among them. The piece's own lanes are x-rayed along with
the ones in front of them, because a cube above the ghost hides the landing row
whatever its depth. Normal is the default state, not a third band. The layers are
renamed to match: `lockedXray`, `lockedPlain`, `lockedMuted`.

A follow-up note — "any voxels in front of a ghosted or x-rayed voxel are also
x-rayed" — is satisfied by construction, since the channel runs from the front
lane through the piece's depth in one span. It is now pinned by its own test
rather than left as an implication.

### Tested

**296 unit tests, 69 end-to-end tests.** Typecheck and lint clean.

The old band tests were built on the lane split and could not be adapted, so the
x-ray suite is rewritten around the channel instead:

- a column the piece does not cover renders identically whether or not something
  is falling;
- the channel stops at the landing row, with the stack below it untouched;
- an x-rayed cell reads as glass, not as a fade — mean 52 against an untouched
  cube's 107, but a peak of 169 where the solid cube is a flat 107;
- a cube level with the ghost in a nearer lane is x-rayed, so the marker reads
  through it — measured with the marker suppressed and again with it drawn, since
  the difference between those two _is_ how much of the ghost gets through;
- what stands behind the landing surface is dark but not deleted.

Both boundaries were confirmed by breaking them: shifting the channel floor by
one row fails three tests, and dropping the column restriction fails the first.

One measurement bug worth recording, because it very nearly produced a wrong
conclusion. The band sampler averaged the middle 70% of a cell for both mean and
peak — but a cube's outline runs around its **perimeter**, so an interior-only
window measures fill and nothing else, and reads a perfectly good x-ray as a flat
fade. Mean now comes from the interior and peak from the whole cell: fill from
the middle, structure from the edge.

---

## The board gets its colour back

**Branch:** `claude/webapp-game-plan-vtrxqx`

> "Can I see a preview of gameplay? The previews you've shown so far look like
> they removed all the colour."

They had. It was not a testing artifact and it was not the x-ray — a real
played-out board, captured mid-run, came out dark and muddy while the NEXT
preview beside it was vivid red. That gap is the whole diagnosis: the preview is
DOM and paints `depthColorHex` directly, so it cannot be wrong. Everything
between the palette and the canvas could be, and three separate stages of it
were.

### What was happening

A settled cube was reaching the screen at roughly **a fifth of its palette
value**.

| Cause                                                                     | Effect                      |
| ------------------------------------------------------------------------- | --------------------------- |
| The play-column backdrop composited **over** the board rather than behind | ×0.38                       |
| Ambient light at 1.18 where the Lambert BRDF needs π to return albedo     | ×0.376                      |
| ACES Filmic tone mapping compressing what survived                        | hue shift, channel clipping |

**The panel.** A translucent material goes into the renderer's _transparent_
queue, which draws after every opaque object regardless of `renderOrder` —
`renderOrder` only sorts within a queue. With `depthTest: false` on top of that,
a plane positioned safely behind the board was being painted across the finished
playfield as a 62% wash of near-black. `docs/DESIGN.md` §2.2 had already called
this panel "the tell" for a room that was competing with the board; it turned
out to be doing the damage directly. It keeps its depth test now, which is the
job it was always meant to do.

**The ambient light.** Three's physical shading divides irradiance by π, so an
ambient light of intensity 1 renders a surface at under a third of the colour it
was authored in. Flat lighting was at 1.18. The levels in `setLightingFlatness`
are now written as fractions of albedo multiplied by a `UNIT_ALBEDO = Math.PI`
constant, so the arithmetic is visible instead of buried in a magic number.

**ACES.** A filmic curve exists to fit a scene lit in physical units into a
display. This scene is authored in display values from the start: every cube is
a point on an OKLCH ramp chosen to land at an exact place on screen. ACES was
reinterpreting it — clipping red's blue channel to `0x14` and violet's green to
`0x00`, which are precisely the distinctions the ramp is made of. Removed.
`NeutralToneMapping` was measured as the alternative and also fails: it
compresses anything with a peak above 0.76, which is most of the ramp.

`metalness` went to 0 in the same pass. With no environment map there was
nothing for it to reflect, so all it did was subtract 8% from every cube's
diffuse colour.

### The result

A settled board, sampled cube by cube, now reads `#eb493f #fc810b #fdbf08
#abda56 #24cbcb #5183e6 #744aca #9521a6` — bit-for-bit identical to
`depthColorHex` for each lane. Mean luminance across a played board went from
**32.5 to 123.0**.

### Retuning what had been tuned against the wash

Everything measured during the x-ray work was measured through a 0.38 filter, so
three numbers moved:

| Setting     | Was  | Now  | Why                                                      |
| ----------- | ---- | ---- | -------------------------------------------------------- |
| X-ray fill  | 0.05 | 0.12 | Unlit, so it gained nothing from the lighting correction |
| X-ray edges | 0.15 | 0.70 | Same — its peak had to stay above the focal band's mean  |
| `FAR_DIM`   | 0.58 | 0.74 | At 0.58 the far band out-shone the x-ray in front of it  |

The far band's old 0.58 was really 0.16 of the palette once the wash is
accounted for, which is why "darker and faded" was the note. It lands at 18% of
the focal band now — dark mass, no structure, hue intact.

| Band                 | Mean  | Peak  |
| -------------------- | ----- | ----- |
| Focal (landing lane) | 112.8 | 198.5 |
| In front (x-ray)     | 25.5  | 133.6 |
| Behind               | 19.8  | 29.4  |

### Why nothing caught it

Every existing test compared the board against itself — bands against bands,
board against room. All of them were wrong by the same factor, so all of them
passed. Two new end-to-end tests compare the board against something outside the
pipeline instead:

- **A settled cube is exactly its depth colour** — samples one cube per lane and
  asserts each channel is within 6 of `depthColor`, imported from the core
  module so the test cannot carry a stale copy of the palette.
- **The board is as vivid as the preview beside it** — compares the canvas
  against the DOM preview's chroma, which is the comparison that found this.

Each of the three causes was re-introduced in turn to confirm the tests fail on
it. The panel and the ambient level each fail both tests; ACES fails the
exactness test.

### Tested

**296 unit tests, 64 end-to-end tests.** Typecheck and lint clean.

`scripts/play-capture.mjs` is new and stays in the repo: it plays 34 pieces with
varied movement and captures three frames — settled, mid-fall with the piece in
a middle lane so all three bands are on screen, and mid-fall with the piece in
the back lane, where every settled cube is in front of it and the whole board
x-rays at once. The existing `scripts/capture.mjs` composes deliberate
set-pieces, which is exactly why it never showed this: a hand-built board is
usually one lane deep, and one lane is one hue.

### Still open

- **The room is slightly brighter in absolute terms**, since removing ACES lifts
  small values. It is far quieter _relative_ to the board than before — the
  board-to-room contrast went from 3.6× to 10.7× — and its guard tests still
  pass, so it was left alone rather than re-tuned on top of a change it did not
  cause.
- The far band still reads as dimmed rather than translucent. Unchanged from the
  previous entry: transparency there risks depth-sorting artifacts.
- The two input notes — a key map in settings, arrow-key menu navigation — remain
  scheduled for M11.

---

## Play response: the x-ray, and the ghost that was never gone

**Branch:** `claude/webapp-game-plan-vtrxqx`

Four notes came back from play. Two were rendering and turned out to be one root
cause; they are fixed here. The other two are input and are scheduled into M11.

### The ghost was being painted over, not removed

`ghostCells()` was returning its cells and `showGhost` was on the whole time. The
lane-focus veil drew at `renderOrder: 1` with opacity 0.28, above the ghost's
default order at 0.3 — a veil on top of a ghost, both translucent, and the ghost
lost. It now draws after the x-ray passes and at 0.44.

### X-ray is not a fade

The near band was a uniformly translucent cube, and that construction cannot do
what was being asked of it. Whatever fraction of a translucent cube you can see
is exactly the fraction of the board behind it that you cannot: turn it down to
reveal the board and the cube vanishes, turn it up to show the cube and
everything under it greys out. There is no setting where both read. That is the
"everything looks muted" report, and no amount of tuning the one number would
have fixed it.

Splitting fill from structure escapes the trade. The fill drops to almost
nothing so the board behind comes through at full strength, and a new
`EdgeLayer` draws the cube's twelve edges in its own lane colour — so an x-rayed
cube still says how deep it is, which is the one thing this game may never stop
saying.

The edges need real line primitives. The first attempt used `wireframe: true` on
a box, which draws every _triangle_ edge: a diagonal across all six faces, and a
wall of cubes reading as a mesh of X's. `EdgeLayer` rebuilds twelve clean edges
per cube per frame instead — a few hundred cubes into preallocated buffers, so
it is a memcpy rather than an allocation.

### Tuned by measurement

Eyeballing this went wrong twice, so the bands were measured instead: one cube
per lane, each in its own column so nothing occludes anything.

| Band                 | Mean     | Peak      |
| -------------------- | -------- | --------- |
| Focal (landing lane) | 30.6     | 52.5      |
| In front (x-ray)     | 9.5–12.1 | 41.9–49.7 |
| Behind               | 2.8–7.5  | 3.9–10.3  |

The near band's **low mean with a high peak** is the x-ray signature: mostly
empty, crisply edged. The far band has neither — a dark mass with no structure.
And the focal band's peak stays above everything, so the landing surface is the
brightest thing on the board.

Two wrong answers were measured on the way to the far band's 0.58. At 0.82 it
collapsed to luminance 2, which is deleted rather than receded. And the original
0.55 was never what made the board look washed out — that was the near veil. The
far dim barely had to move; fixing the near band is what let it stay put.

### A test that was measuring the wrong thing

The room's "sits under the board" assertion started failing, because with lane
focus dimming most of the board during play, the board's brightest pixel now
sits _below_ the room's. Both numbers were correct; the comparison was not. It
now measures a settled board — every cube at full strength, which is the
comparison actually worth making — and uses the 99.5th percentile rather than
the maximum, since bloom throws a halo a few pixels past the well and one stray
pixel is not the room out-shining the board.

### Tested

**296 unit tests, 62 end-to-end tests.**

Two new browser tests pin the bands: the focal lane is the brightest surface,
the near band's mean stays under 60% of it while its peak stays above the focal
mean and below the focal peak, the far band is dimmer than the near band with no
bright edges, and it never reaches zero. A second test settles the board and
asserts the far band returns to more than double its dimmed brightness — the
bands belong to the falling piece, not to the board.

### Still open

- **The far band is dark but not "faded".** It reads as dimmed rather than
  translucent. Transparency there risks depth-sorting artifacts between far
  cubes, so it was left alone pending a look at whether it is worth the cost.
- The two input notes — a key map in settings, arrow-key menu navigation — are
  scheduled into M11 rather than done here.

---

## M9 — Modes and Meta

**Branch:** `claude/webapp-game-plan-vtrxqx`

Everything around the core loop. The game now has a front door.

### First, a correction to how this was built

This milestone was originally written against `be385b5` — three milestones
stale — because the branch was never fetched before work started. It would have
reverted M6's `main.ts` wiring, M7's inverted turn direction, and M8's HUD, and
its end-to-end suite still asserted the pre-M7 turn mapping. That commit was
discarded and the work redone on top of `cc4b663`. Fetching `main` before a
milestone is now the standing practice.

### Shipped

- **Title, mode select, pause, game over, settings, challenge entry** — plain
  DOM over the live board, which stays visible behind every screen.
- **Six modes**, each pure configuration over the stage table rather than a code
  path of its own. The engine keeps one implementation, so a mode cannot
  introduce a rule by accident.
- **Versioned `localStorage` persistence** — settings, per-mode bests, lifetime
  stats, a session log, last mode played. Parsing lives in `src/core/save.ts`
  and knows nothing about browsers; `localStorage` is isolated in
  `src/ui/storage.ts`.
- **Settings**: sound, volume, reduced motion, screen shake, bloom, ghost piece.
  Reachable from the title and from pause, applied live, saved immediately.
- **Seeded challenges** — a seven-character code naming a mode and a seed, plus
  a daily challenge derived from the UTC date with no server involved.
- **`?mode=` and `?challenge=`** open a run directly. Both still respect the
  unlock; a URL is not a reason to spend it.

### Pause is an engine state, because the plan said it had to be

The milestone carried an explicit engine note: `GameStatus` had no `paused`
state, so pause is a core state-machine change "made without breaking
`(seed, input log)` determinism".

`GameStatus` gains `paused`. Every input path already refused to act outside
`falling` and `awaitingTurn`, so one status change closes all of them at once —
and the renderer can _see_ that the game is stopped rather than inferring it
from the host.

Determinism is asserted rather than argued: one scripted thirty-piece run is
played with a pause between every action — twenty ticks of simulated time
passing while paused — and one without, and the two are compared cell by cell.
They are identical. A pause mid-turn or mid-cascade resumes into the same state
with its timers untouched.

### Ascent and Endless were one mode described twice

The spec called Ascent "primary progression" and Endless "score attack,
continuously increasing speed and complexity", which as written are the same
game. They are now separated by what they do with **content** rather than speed:
Ascent is the authored arc and reveals the game on schedule; Endless starts past
the reveal with everything available, pins the stage table, and accelerates
without end.

That split produced a finding. Endless first pinned stage 4 — "where the game is
fully itself" — and a test caught that stage 4 only reaches tier 3. A pinned
stage never advances, so tier 4 would have been withheld _forever_, in the one
mode that promises everything unlocked. Endless now pins **stage 6** for its
content and scales gravity to ×0.54 for its speed, opening at roughly stage 4's
pace. Content and pace needed separate knobs, and this is the case that proved
it.

### Mode-specific scoring

Modes are not equally dangerous, and a scoreboard that ignored that would rank a
Zen session above a real run. Zen cannot be lost, so it pays ×0.25; Blind
Spectrum asks the hardest thing the game has, so it pays ×1.5; Prism doubles the
clears the turn itself made eligible and nothing else does.

### Zen needed an answer the spec did not give

"No failure state" leaves open what happens at the top. Zen now **trims the top
row**: when a piece cannot spawn, the highest occupied row is deleted outright
and the piece retried, repeating until it fits. Nothing collapses and nothing
below moves, so the structure survives and the rescue reads as local rather than
as a board wipe. A `rescue` event fires so the HUD can say `OVERFLOW CLEARED`.

The condition rescued _for_ is "the next piece fits", not "the stack is below the
buffer". Writing it the second way passed the top-out test and would still have
ended the run one piece later.

### The save file is the one input that cannot be trusted

`migrate` never throws and always returns something playable. Every field is
recovered independently, so a corrupt settings block cannot take the scores with
it. Three decisions inside that are worth naming:

- **Records are read by iterating the known modes, never the file's own keys.**
  A save naming a mode that no longer exists loses that entry rather than
  resurrecting it.
- **`stats.bestStage` is reconciled against the per-mode records**, taking the
  higher of the two. Unlocks hang off that number, and a player who has already
  earned Blind Spectrum must not have it taken back by a damaged stats block.
- **A damaged session entry is dropped, not repaired.** The log is decoration,
  not a record of achievement; repairing an entry would put a run on the board
  that never happened.

### An optimisation that had to be backed out

Rendering was briefly suspended behind menus — the engine is frozen there, so
the scene looked identical frame to frame. Two of M6's tests caught it: the
environment is _supposed_ to keep moving when the board is still, and a frozen
room behind the title screen is a dead room. The optimisation was reverted. The
engine still freezes; the rendering does not.

Also removed: the HUD's game-over overlay from M6, now that a screen owns that
moment and can offer the mode list and the session log. M6's regression test —
which parses the advertised restart key out of the copy so the two can never
diverge — moved onto the new panel and still passes.

### The room was reworked from a disco to light

M8's environment looked cheap, and the cause turned out to be specific rather
than a matter of taste.

- **One hue clock drove everything.** Dust, fragments, lattice, beams, strobe
  and backdrop all read from `this.hue` at fixed offsets, so the whole room
  cycled the colour wheel in lockstep — which reads as a hue slider being
  dragged, not as a place.
- **Saturation sat at 0.7–0.85** on unlit materials with hard edges, so the
  beams were flat coloured strips rather than light.
- **The backdrop was a saturated near-black.** A dark tint reads as dirt; that
  is where the muddy brown came from.

It is now achromatic: grey light shafts that fade to nothing at both ends via a
vertex-colour ramp, white dust, dim wireframe pushed out to distance, a neutral
floor lattice. Each shaft has its own drift, phase and peak so the room breathes
unevenly. The room answers play by getting brighter, never by changing colour.
The strobe is gone entirely — it was both the photosensitivity risk and the
cheapest-looking element, and a space made of light does not need to flash.

**A colour-space bug was hiding underneath it.** The first achromatic pass still
looked like a flat grey field brighter than the board. Measuring rather than
squinting gave the answer: the room averaged **28.3** luminance against the
well's **5.9**, and its brightest pixel (149) beat the brightest cube (89) — the
hierarchy was inverted. Cutting every level barely moved it, and hiding the
entire environment left the room at **20.3**, which proved the environment was
not the source at all.

It was the colour space. Three works in linear and converts on output, so the
`0.008` I had written as "nearly black" was arriving at about 26/255. Every
level now goes through a `light()` helper that converts explicitly, so the
numbers in that file mean what they look like. Final measurements: room mean
**8.7**, room max **62.6** against a board max of **88.9**, saturation ≤21.

This also takes back M8's amendment to DESIGN §2.2, which had allowed
decorative hue in the room. The near-opaque panel was the tell: a room that has
to be walled off from the board is competing with it. The panel is still there
at 62% — enough to hold brightness back, loose enough that the dust shows
through and the board reads as floating in the room rather than pasted over it.

Three end-to-end tests now pin it: the room is achromatic (max channel spread
under 40, against ~170 for a cube at full chroma), it sits under the board (its
brightest pixel below the board's brightest, its mean far below), and it still
moves — dark is not the same as dead.

### Tested

**296 unit tests, 54 end-to-end tests.**

- `pause.test.ts` (10) — freezes gravity, refuses every input, restores a turn
  and a prompt mid-flight, cannot escape game over, and the determinism
  comparison above.
- `save.test.ts` (44) — twenty-one shapes of corrupt save, each asserted to
  produce a fully playable result, plus the session log's cap, ordering, and
  refusal to repair a damaged entry.
- `modes.test.ts` (30) — no two modes have identical rules; acceleration is one
  curve or the other, never both; `maxTier` is a ceiling not a floor; Zen cannot
  end and the run still ends in a mode that can; the score scales reach a real
  clear rather than only the table.
- `challenge.test.ts` (15) — codes round-trip, survive being retyped with the
  wrong case and stray dashes, never contain a character that can be misread,
  and two runs from one code produce the same twelve pieces and the same score.

At browser level: title-to-playing, the lock on the expert mode, pause freezing
the board and swallowing keystrokes, settings surviving a reload _and_ reaching
the renderer, a corrupt save booting cleanly, a deep link refusing a locked mode,
a challenge code rejected without starting a run, the same code giving the same
game twice, and Flatland, Blind Spectrum and Zen each behaving differently.

### Decisions worth revisiting

- **Endless's ×0.54 opening and 1.5%-per-line compounding are tuned with one
  data point.** The late curve is the suspect half: gentle early, severe by line
  100, and unmeasured against a real player.
- **The score scales are asserted for direction, not magnitude.** ×0.25 and ×1.5
  say Zen is cheap and Blind Spectrum is dear; whether those are the right
  numbers needs scores on a board.
- **Blind Spectrum unlocks at stage 5 in any mode**, which is reachable in Zen
  without much pressure. Possibly too cheap.
- **Challenges have no verification.** A code names a run, but nothing stops a
  player editing their own save. That is fine for a local game and would not be
  for a shared leaderboard.
- **No key remapping.** Listed under this milestone's settings menu, but it
  belongs with the input work in M11 and moved there.

### Next

**M10 — Reading the Board.** Peek, the rotating 3D next-piece preview, first-run
onboarding, and the ghost/contact clarity pass over M6's silhouettes and M7's
lane focus.

---

## M8: Spectacle and the HUD

The second playtest of M6 asked for a louder room and a HUD that looks like a
HUD. M7 fixed the three things the game was saying wrongly; this milestone
is the presentation that was waiting on that. The colour rule in DESIGN §2.2
is restated so it forbids a second _rules_ language, not decorative hue in
the room behind the board.

### Shipped

- **A disco background.** Coloured beams, hue-cycling fragments and dust, a
  pulsing lattice, ripples on clears, a slow HSL backdrop, and a strobe.
  Density and colour surge on lock, clear, turn, and Prism. Under reduced
  motion the strobe is gone entirely — a dim flash is still a flash — and
  the hue cycle slows. Decorative colour makes no claim about the rules.
- **A ~95% opaque play column.** A dark panel, billboarded and sized to the
  projected footprint, sits behind the well so the disco never competes with
  a cube for a depth reading. Opacity dips through the Prism whiteout so the
  bloom can still wash the column.
- **The Shift meter is a segmented bar under the well.** Segment count still
  follows `linesPerTurn`. It is positioned from the orthographic silhouette
  in viewport pixels, then converted into the HUD's own origin so a
  width-capped HUD cannot drift it off the column.
- **HUD chrome.** Stats, face, NEXT, HOLD, and the Shift bar are framed
  modules: raised surface, hairline, blur. Dim type is brighter against the
  disco; prompt and overlay scrims are darker. The chrome stays achromatic
  because it is the surface that describes the rules.
- **The colour rule's scope, corrected.** Cubes keep the spectrum. The room
  may have hue. The HUD may not. The opaque column is the device that keeps
  those two languages from mixing on a cube.

### Tested

**197 unit tests, 32 end-to-end tests.**

New e2e pins that the Shift bar sits under the column (centred on the
canvas, in the lower half) and that the HUD is five framed panels. The
idle-liveliness assertion still requires the background to move while the
board is frozen. The flatness assertion now samples the well rather than
the whole canvas, because a disco room would drown the signal.

---

## M7: Controls and Comprehension

The first playtest of M6 said three things the game was communicating wrongly:
the turn went the opposite way to the prompt, the next-piece preview was laid
out with a cell-sized vertical gap, and the contact X-ray read as decoration
rather than as information. None of those are taste. All three have a correct
answer. The roadmap grew again: this M7 is those three fixes, M8 is the
spectacle and HUD work that follows, and the old M7–M10 (Modes, Reading the
Board, Accessibility, Performance) are now M9–M12.

### Shipped

- **A turn direction names the destination.** Pressing left brings the
  left-hand face forward; pressing right, the right-hand. It used to mean a
  world-spin, which delivered the opposite face — DESIGN §2 even documented
  that, and playtesting was unambiguous about it being wrong. Two sign flips
  in `turn()` and `turnYawDelta`, and the name now means what the player
  thinks it means. The prompt labels each arrow with the face it will
  actually produce (`← LEFT · RIGHT →` from the front, and the real
  destinations from every other face), so the mapping cannot silently invert
  again. The turn sweep still follows the camera: left (now −yaw) falls,
  right rises.
- **The next-piece preview is a fixed 4×4 with even spacing.** The previous
  layout stretched a shrink-to-fit `1fr` grid to a min-height, so row tracks
  grew while cells stayed 0.85 rem — a vertical gap of roughly one whole
  cell against a 2 px horizontal gap. Tracks are now explicit rem sizes,
  every piece is centred in the same 4×4, and an end-to-end test asserts
  that the row step equals the column step.
- **Lane focus replaces the contact X-ray.** The falling piece's occupied
  lanes are a focal plane. Settled cubes nearer than that plane go
  transparent (depth-write off, so the piece and its landing surface show
  through); the focal lane stays fully opaque, with a restrained inner
  highlight on the cubes `firstContactCells()` names as the ones the piece
  will actually touch; cubes farther than the piece darken toward the void,
  keeping their hue. The split exists only while a piece is falling, moves
  when the piece moves, and vanishes at lock — it cannot be read as an
  absolute distance cue. The additive pulsing X-ray shell and core are gone.

### Tested

**197 unit tests, 30 end-to-end tests.**

The projection ring, yaw deltas, game-over turn destinations, refraction
clears (now reached by choosing _left_ to get the left face), and the audio
sweep pairing all follow the new meaning. A new e2e pins the preview's
spacing and another pins that the prompt's labelled faces match the keys
that deliver them.

---

## M6: Playtest Readability & Presentation

The roadmap grew a milestone: observed play said the board becomes unreadable
under occlusion and the presentation feels mechanical, and those problems
outrank menus. The old M6–M9 are now M7–M10, and this M6 answers the playtest.

### Shipped

- **The falling piece and its ghost never disappear.** Where settled cubes
  occlude them, both draw as translucent silhouettes — a second instanced pass
  per layer that renders exactly where the depth test fails, so the piece looks
  ordinary when visible and shows through the stack the moment it is buried.
  Both keep their true spectrum colours; no outline hue was added, because an
  unexplained hue on this screen would be read as a depth claim. The active
  silhouette is solid, the ghost's fainter and inset, so they stay distinct
  even when both show through.
- **First-contact X-ray.** The piece acts as a vertical flashlight: for each
  occupied column of its footprint, the topmost settled cube beneath it — and
  nothing beneath that — shows through the board as a breathing translucent
  shell with a brighter core. The X-ray manipulates opacity, luminance and
  animation, never hue, so the cube's depth colour survives; intervening cubes
  stay visibly present through the translucency, which is what makes it read
  as seeing _through_ the board rather than as geometry pasted on top. The
  trace lives in the engine (`firstContactCells`), derived from the piece's
  position, so it follows every move and rotation for free, and its rules are
  pinned by unit tests. Hierarchy, strongest to weakest: active piece → ghost →
  X-rayed contact → normally occluded board.
- **The void is gone.** A reactive achromatic environment — drifting dust,
  distant wireframe fragments, a faint floor lattice, camera-facing rings that
  ripple outward on clears. It pulses when a piece locks, brightens and
  accelerates as the Shift meter fills, surges through a turn, and answers a
  Refraction Clear or a Prism with a bigger (still colourless) response. It is
  strictly a backdrop _by construction_: every element renders before the board
  with no depth writes, so a board pixel always wins and nothing environmental
  can ever sit between the player and a cube. White and grey light only —
  DESIGN §2.4 writes the rule down.
- **The M2/M4 visual debts, paid.** Bloom is now a real thresholded
  post-process chain rather than a colour lerp, and the threshold sits above
  anything the settled board can produce, so only the clear glow and the Prism
  whiteout can reach it — "selective" enforced by arithmetic. Clears dissolve
  along their axis into spectrum-tinted debris (each particle carries the
  colour of the cell it came from, staggered so the line goes end to end), and
  locking lands with a brief flash of the settled cells.
- **The lane bag is dead.** Depth lanes now come from a free seeded draw with a
  starvation floor: nothing pushes the counts toward even, so the sequence
  clusters, repeats and leaves gaps the way real randomness does, and a lane
  absent past `LANE_STARVATION_GAP` deals has its weight climb steeply until it
  is dealt. Balance is a floor, not a levelling force. The tests now pin the
  _texture_: repeats must occur, 8-deal windows must not keep sweeping all
  eight lanes, and no lane may starve past the floor — so a future "fix" that
  quietly reintroduces a levelling force will fail the suite.
- **Tier 4 finally does something.** Stages 6–7 declared `maxTier: 4` while the
  catalogue topped out at 3. The design spec always defined tier 4 as
  projection ambiguity, and that is what it now is: at tier 4 the dealer deals
  each piece in a random orientation from a third seeded stream. Same eight
  shapes, presenting differently.
- **The piece-vocabulary experiment**, behind `?pieces=experimental` and never
  the default: the screws at tier 1 so depth arrives with the first bag, a
  tricube as a rescue piece, the tripod at tier 2, and three purpose-built
  non-planar pentacubes at tier 3. First measurement, from the greedy agent:
  the experimental vocabulary clears _more_ lines than the standard one (61 and
  51 across two 200-piece seeded runs, where the standard catalogue's benchmark
  run manages 47) — the tricube's rescue value apparently outweighs the
  pentacubes' awkwardness. Graduation into the standard catalogue waits on
  human playtesting.

### Corrections

- The game-over screen said "Press R to play again". R rotates pitch; restart
  is Enter. The hint now tells the truth, and an end-to-end test parses the key
  out of the hint and presses it, so the copy and the binding can never
  advertise different keys again. The overlay also rebuilt itself only once, so
  a second game over displayed the first run's score; it now rebuilds per run.
- The lock-delay 15-reset cap and block-out game over existed but were
  untested. Both are now pinned: a wiggling grounded piece locks on schedule
  (the sixteenth reset buys nothing), and a blocked spawn ends the run without
  the stack ever reaching the buffer.
- `docs/PLAN.md` claimed things the tree did not contain — the M2 camera spec
  the orthographic decision had superseded, a floor grid and contact shadows
  that were never built, M3 apparent-size interpolation the size-constancy rule
  forbids, and the M4 bloom/debris/lock-flash that shipped only now. Every
  claim is corrected in place with a note saying what happened to it.

### A testing note worth keeping

The bloom chain made headless software GL fall over: three end-to-end tests
timed out or missed their sampling windows because every frame was paying for
a full-resolution post-process that, below threshold, produces exactly the
same image as a plain render. The fix was not test-shaped but honest: the
composer now runs only while a pixel that _can_ bloom exists — a lit clear
line, the whiteout, a lock flash, debris in flight — and ordinary play renders
without it. The suite went green again, and integrated GPUs get the same win.

### Tested

**197 unit tests, 29 end-to-end tests.**

New: first-contact tracing (topmost cube only, per column, through overhangs,
empty over bare floor, gone at lock); the lane draw's determinism, floor,
texture and non-sweep properties; the experimental catalogue's connectivity,
non-planar-at-tier-1 guarantee, and isolation from the standard deal; tier-4
orientation variety below/at the boundary; the lock-reset cap; block-out; the
restart key contract; the environment's idle liveliness (two frames of a frozen
board, taken a moment apart, must differ); and a clean boot-and-play pass under
the experimental flag.

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
