# Execution 4 — final production integration

This execution validates the existing cube, Shift, room, and earlier checkpoint
work. It does not introduce another visual design pass. Historical execution
handoffs describe the state at those checkpoints; this report supersedes their
pending integration status.

## Retained work and repairs

Preserved the board gel/bevel refinement, fixed-scale orthographic Shift, neutral
instanced room, backing, caches, landscape composition, and final examination.
No gameplay rules, input meanings, scoring, saves, audio, or lab changes.

- Fixed the type-only Three.js import in the landscape helper (full lint gate).
- Moved HUD well projection after the renderer updates camera matrices. This
  removes gauge/Shift-meter lag, conspicuous in the old held-clock mid-Shift
  capture, without changing the camera trajectory or UI design.
- Captured entry cube scale for final examination. Interrupting Shift previously
  switched immediately from its fixed scale to the cinematic spacing; scale now
  eases from the actual entry state alongside the camera.
- Replaced the superseded below-board-only phone meter assertion with rectangle
  separation on either axis. Portrait still sits below; landscape uses its gutter.
  Numerical palette, chroma, brightness and landing thresholds are unchanged.

## Visual inspection

Reused and inspected environment-v2: populated/settled, fresh active piece,
buried landing/channel, mid-Shift, clear, title. No baseline was regenerated.
Final supplement: integration-final, produced with
`node scripts/integration-capture.mjs <new-output-directory>` after a production
build. The script reuses the audit seed, fixtures and held RAF clock.

Inspected settled-before, early/mid/late Shift, settled destination, Prism and
its recovered palette, Blind Spectrum, final-board ledger, portrait Flatland and
Ascent, portrait buried/turn/pause, equivalent 863×360 landscape states, and
reduced-motion Prism/Collapse. No runtime or shader console errors were recorded.
The active piece remains the focal point; the channel and solid landing marks
remain legible. Turning exposes the construction with stable cube transforms,
then restores flatness. The gauge now stays just outside the well. Prism's white
beat clears completely; Blind Spectrum remains neutral. Reduced motion removes
the environment ring and bloom treatment while retaining a quieter event cue.
The final ledger leaves the construction visible.

PNG collections remain external review artifacts, not repository assets.
Execution 1/2's original post-baseline images remain unavailable as documented;
the retained environment and new integration images show the combined material.

## Landscape

At 863×360, settled well width is **138.46 CSS px**, versus the retained
**121.56 px** baseline: **13.9% larger**. Portrait remains **227.10 px**.
The spare gutters now carry chrome; the well, pause control, preview and meter
fit without scrolling. The turning silhouette fits the viewport height.

The earlier 25% target is not claimed. A fixed orthographic scale must fit
`18 cos(12°) + 8√2 sin(12°) = 19.96` vertical cells at mid-Shift. Even with
zero clearance, 360/19.96×8 gives only about 144.3 px settled width (+18.7%).
The retained 20.8-cell camera span leaves clearance and gives 138.46 px.
No turn-time zoom or portrait regression was introduced to chase that target.

## Performance sanity check

Same scenario names/fixtures and measurement method as retained before and
before-tail metrics. Values below are JavaScript render-submission timings in
headless Chromium, **not frame rate or mobile GPU benchmarks**.

| Scenario           | CPU p50 ms, before → final | CPU p95 ms | Draw calls | Buffer uploads/frame |
| ------------------ | -------------------------: | ---------: | ---------: | -------------------: |
| title              |                  0.4 → 0.3 |  1.4 → 1.5 |     32 → 7 |               12 → 4 |
| falling            |                  0.6 → 0.2 |  0.9 → 0.3 |    40 → 14 |               18 → 4 |
| dense              |                  0.5 → 0.2 |  1.2 → 0.3 |    36 → 18 |               22 → 4 |
| xray               |                  0.6 → 0.2 |  1.0 → 0.4 |    35 → 17 |               22 → 4 |
| prism              |                  0.8 → 0.6 |  1.6 → 1.3 |    51 → 32 |              24 → 10 |
| portrait-flatland  |                  0.7 → 0.4 |  1.3 → 0.9 |    36 → 18 |               22 → 4 |
| portrait-ascent    |                  0.4 → 0.2 |  0.8 → 0.3 |    36 → 18 |               22 → 4 |
| landscape-flatland |                  0.5 → 0.3 |  1.3 → 0.7 |    36 → 18 |               22 → 4 |
| landscape-ascent   |                  0.4 → 0.1 |  0.8 → 0.3 |    36 → 18 |               22 → 4 |

Settled scene geometry objects fall from 45–46 to 10–11; idle upload bytes drop
from roughly 519–562 KB/frame to 2,352 B/frame. The room's ordinary floaters use
one draw instead of up to 27, and dust is 520 rather than 1,040 points. These
savings include the earlier checkpoint caches; they are not all new in this
execution. Preview still uses the same renderer/scissor context.

CDP total task duration is noisy and sometimes higher (dense 32.6→37.6 seconds,
x-ray 24.5→58.0 seconds per audit batch), despite faster submission. A bounded
follow-up reused baseline-dist and the final build consecutively on the same
host: five warmups, fifteen x-ray renders with gl.finish. Median submission was
0.8→0.6 ms, with a final outlier of 3.1 ms versus 1.2 ms. This does not establish
GPU speedup or a sustained frame-time regression. No resolution reduction or
material downgrade was justified by this sanity check. Real GPU timing and
long-run allocation/GC behaviour remain unmeasured; do not extrapolate from the
headless CPU timings.

Raw counts, triangles, memory, upload bytes, heap deltas and task timings:
[visual-integration-measurements.json](visual-integration-measurements.json).

## Verification

`npm run verify:full` passed: typecheck, lint, production build, **443 unit
tests (26 files)** and **166 Playwright tests**. The separate CI coverage gate
passed: statements 96.78%, branches 90.46%, functions 98.17%, lines 98.71%.

The first pass exposed the import lint error; after repair, its browser run
passed 162 tests with only the superseded landscape-placement assertion failing.
The final full run includes that corrected assertion and all three new browser
checks. No existing palette/readability thresholds were weakened.

Local Chromium was truncated on resume and restored from its already-present
archive. This required no repository dependency change. Production capture
console errors: zero.
Added production checks for current-camera HUD alignment and final examination's
camera/lens/instance continuity, return to gameplay, and reduced-motion hold.
Existing Shift tests verify unchanged instance matrices/projection and exact
palette recovery; existing pixel tests protect settled colours and readability.

## Limits

Real-device GPU performance, hardware-specific shader appearance, and native
safe-area behaviour require device testing. This integration is not completion
of every historical M16 profiling/adaptive-resolution item. No Preview Lab
files or tests were modified, and no new visual feature was started.
