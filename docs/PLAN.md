# Refraction — Build Plan

Ten milestones. Each one is a self-contained push: source, tests, and a
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

- `Board` — sparse voxel occupancy, `O(1)` cell access, per-column gravity.
- Tetracube catalogue with the four tiers, defined as integer cube offsets.
- `Piece` — spawn, translate along the face's horizontal axis, depth nudge,
  the three rotation axes, generalised kick table.
- Collision, lock delay with the 15-reset rule, hard/soft drop.
- Line detection on the current face's axis; clear; cascade to stable.
- Piece bag and lane bag dealers, both seeded.
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

---

## M2 — First Light ✅ _shipped_

**Goal:** the board becomes visible, and beautiful.

- Three.js scene, flat until it turns: 5° near-orthographic camera dead-on when
  settled, opening to 30° and 14° elevation at the midpoint of a turn.
- Single `InstancedMesh` of bevelled boxes; per-instance colour and scale.
- Continuous spectrum shading driven by live camera distance.
- The well: wireframe cage, lane-tinted floor grid, subtle contact shadows.
- Active piece, ghost piece at true landing depth, lock-flash.
- HUD skeleton: score, stage, Shift meter, next piece, hold.
- Fixed-timestep game loop with interpolated rendering.

**Exit criteria:** a complete game is playable on the Front face alone, at a
locked 60 fps, and it already looks like a finished game.

**Landed early:** the 750 ms camera turn, with continuous recolouring and
parallax, arrived here rather than in M3. The camera code needed the yaw
interpolation anyway, and colour is computed from live camera distance, so the
continuous recolour came for free. M3 keeps the rest: eligible lines glowing
during the turn, animated cascades, and the chain-scoring presentation.

---

## M3 — The Turn ✅ _shipped_

**Goal:** the central mechanic — the reveal.

- Shift meter fills, freezes play, prompts for direction with the 5 s fallback.
- 750 ms camera turn with continuous recolouring, parallax separation, and
  apparent-size interpolation.
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

---

## M4 — Feel ✅ _shipped_

**Goal:** make it satisfying rather than merely correct.

- Line-clear effects: dissolve along the clearing axis, spectrum-tinted debris.
- Selective bloom, thresholded so only clears and Prism events bloom.
- Screen shake, tuned subtle and fully disableable.
- Procedural WebAudio: lane-mapped pitch, filtered sweep on the turn, chord
  bloom on Prism.
- Scoring popups and the escalating `REFRACTION ×n` / `PRISM CHAIN ×n` language.
- **Full Spectrum / Prism** — the board blooms toward white on a four-face chain.

**Exit criteria:** a Prism chain is a genuine event. Reduced-motion and
photosensitivity settings verified.

---

## M5 — Progression ✅ _shipped_

**Goal:** the Red → Violet arc.

- Seven stages with the speed, meter and tier tables from the design spec.
- Piece tiers introduced on schedule; Tier 2 arrives quietly, with no tutorial.
- Stage transition sequence; **Ultraviolet** endless tier on completing Violet.
- Difficulty tuning pass against recorded play sessions.

**Exit criteria:** the first depth-offset piece lands without explanation, and
the first turn lands as a revelation rather than a confusion.

**Note:** the tuning pass moved `LINES_PER_STAGE` from 10 to 15. At ten, the
greedy agent walked the whole spectrum inside one game, which made reaching
Violet routine. The reveal schedule is now pinned by test rather than by
intention — see `tests/unit/progression.test.ts`.

---

## M6 — Modes and Meta

**Goal:** everything around the core loop.

- All six modes: Spectrum, Endless, Prism, Flatland, Blind Spectrum, Zen.
- Title screen, mode select, pause, game-over, restart.
- Versioned `localStorage` persistence with migration: settings, high scores per
  mode, unlocks, lifetime stats.
- Settings menu: video, audio, controls, accessibility.

**Exit criteria:** every mode reachable and completable; a corrupt or outdated
save is recovered from, never crashed on.

---

## M7 — Reading the Board

**Goal:** the comprehension tools.

- **Peek** — hold to tilt 8°, parallax inspection, snaps back, changes no state.
  Limited at Stage 6+, disabled in Blind Spectrum.
- Rotating 3D next-piece preview; static preview as a harder option.
- Hold slot, one swap per piece.
- Ghost piece depth clarity pass.
- First-run onboarding that teaches by design rather than by tutorial text.

**Exit criteria:** a new player reaches their first turn without instructions and
understands what happened afterwards.

---

## M8 — Accessibility and Input

**Goal:** the game is legible and playable for everyone.

- Banded, luminance, and colour-vision-safe depth ramps; lane numerals.
- Full key remapping; gamepad; touch controls with swipe and tap.
- Responsive layout from 390 px to ultrawide.
- Reduced motion, screen-reader board summaries, focus management.

**Exit criteria:** the game is completable with depth colour fully disabled, on
a phone, and by keyboard alone.

---

## M9 — Performance and Release Candidate

**Goal:** ship quality.

- Profiling pass; dynamic resolution scaling; instance buffer reuse.
- WebGL-unavailable fallback message.
- Playwright visual regression baselines for each face and each stage palette.
- Deterministic replay tool for bug reports.
- Bundle budget enforcement in CI.
- Final documentation pass.

**Exit criteria:** every budget in §12 of the design spec met on integrated
graphics; visual regression suite green.

---

## Deliberately out of scope

Not in this plan, and not by accident:

- **Multiplayer or leaderboards.** The core loop has to prove itself solo first.
- **Deployment.** GitHub Pages is explicitly disabled. `npm run build` produces
  a portable static bundle in `dist/`; where it gets hosted is a later decision.
- **Level editor, daily challenges, cosmetics.** Post-1.0 candidates.
