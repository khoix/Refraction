# Execution 3 — production environment

Scoped environment pass complete. No UI, gameplay, audio, lab or general QA work.
Branch: astra/refraction-visual-optimization. Earlier unvalidated game-over,
landscape and broader rendering edits remain included in the local checkpoint;
this does not declare those phases complete.

## Continuity recovery

The initial status contained the completed Execution 1/2 files. After resuming,
the filesystem instead contained an older snapshot: cube/Shift edits, their tests,
notes and new captures were missing, and Chromium was truncated. Restored the
recorded cube and Shift implementation from the thread, reconstructed the safety
checks/capture entry points, and re-extracted the existing browser archive.
No new browser dependency was added. Recovery is semantic, not a byte-for-byte
claim. The missing PNG collections could not be recovered. Original before,
before-tail, before-phone and baseline-dist remain available. Do not repeat the
broad baseline to compensate: the current environment captures show the restored
material and Shift, and their numerical invariants have been retested.

## Changes

- Floater materials cannot write/test gameplay depth. Immediate gameplay colour
  gating eliminates the menu fade's residual coloured/black solids inside the well.
  Column exclusion accounts for each cube's entire bounding sphere, at every yaw.
- A baked pair of neutral light pools shapes the room outside the subject. This
  is static vertex colour, with no moving light rig, texture or fragment noise.
- A broader, feathered backing replaces the hard rectangular edge. It remains
  depth-tested behind cubes; palette tests verify it does not wash over them.
- Ordinary floaters share one instanced draw, geometry and material. Per-instance
  colour/strength/size retain the gel character; transformed normals correctly
  support independent rotation. The large title hero remains separate and keeps
  its previous full-detail geometry and placement.
- Ordinary distant bevels use two geometry segments instead of four. Dust is
  half as numerous and finer. Independent floater spin rates replace common
  rates; events no longer expand all floaters or accelerate them together.
- Clear ripples are smaller, dimmer and originate near the base of the well.
  Reduced motion suppresses these rings. Global backdrop flashing is removed;
  restrained dust/floater intensity still responds to events.
- Shared ownership/disposal is explicit and idempotent. Inactive rings remain
  hidden. No board material, spectrum math, camera path or projection change.

## Evidence

Reused earlier title/Shift/room captures before editing. New artifacts:
../environment-v1-recovered and final ../environment-v2. Each contains title,
mode select, fresh active piece, populated settled board, mid-Shift, buried
landing aids and normal clear. All seven states were visually inspected.
The first iteration still had an oversized clear ring; the final version quiets
and lowers it. Gameplay now has a clear column without stray black floaters,
soft neutral framing, and brighter, immediately identifiable playable colour.
The title retains its hero, coloured field and wordmark negative space.

Reproduce: npm run build, then
node scripts/environment-capture.mjs <new-output-directory>.
The script uses the existing audit seed/board/RAF clock and refuses overwrite.
Use CHROMIUM_PATH=/workspace/scratch/ac9a8c479c11/browser-runtime/chromium and
LD_LIBRARY_PATH=/workspace/scratch/ac9a8c479c11/browser-runtime.
The seed fixes room placement; music text is not part of visual determinism.

## Performance

| Measure | Before | After |
| --- | ---: | ---: |
| Ordinary floater draws (maximum) | 27 | 1 |
| Floater materials including hero | 28 | 2 |
| All 28 floater triangles | 27,216 | 9,072 |
| Dust points | 1,040 | 520 |
| Sampled environment draws, first/final iteration | 23 | 6 |

The last row is the same environment-only post-clear sample from the two new
captures, not an original-production benchmark. Both samples submit 5,880
triangles, 520 points and 92 line segments; instancing changes draw count without
removing those visible instances. The baked light pools add one draw and 480
triangles. These are relative software/headless counts, not mobile GPU timings.
Animation uses existing object transforms and preallocated instance attributes;
no transient per-frame maps, arrays or materials were added.

## Verification

- 15 unit tests passed: environment isolation, resource sharing/disposal, seeded
  independent movement, reduced-motion rings, render caching, material and Shift.
- 17 distinct focused Playwright tests passed across the targeted runs: room
  luminance/chroma/motion, title/menu palette permission, settled palette and gel,
  buried landing hierarchy, flat/turn contrast and both reduced-motion settings
  of the reconstructed Shift invariants.
- Production build/typecheck, targeted lint and diff whitespace checks passed.
- The idle-room fixture needed correction: its old game-over freeze now starts
  a camera cinematic, and its 400ms wait still includes 780ms coloured cell
  debris below the well. It now isolates the dead-on camera and waits 1000ms.
  All colour/luminance thresholds are unchanged; diagnostics report the worst
  pixel and measured board rectangle on failure.
- Capture console recorded no shader/runtime errors. No verify:full was run.

## Execution 4

Stop at this checkpoint. UI drift during Shift, prior game-over/landscape work,
and real-device performance remain separate validation tasks. No mobile-layout
or broad cinematic completion claim is made. The recovered source and capture
utilities are present; earlier lost post-baseline PNGs are not. Keep this local
checkpoint before any further work. No PR was opened or branch pushed.
