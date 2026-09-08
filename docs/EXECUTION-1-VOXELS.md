# Execution 1 — production voxel polish

Recovered from this thread's recorded checkpoint after the resumed filesystem
omitted Execution 1/2 edits and their capture folders. This is a reconstructed
handoff, not a claim that the missing files were restored byte-for-byte.

The completed production material uses the shared board geometry profile with
0.12 bevel radius (classic floaters retain 0.16), unchanged unit bounds and
triangle count. It adds camera-relative bevel catches, normalized Fresnel,
directional rim, peripheral density and a soft internal band. All terms vanish
at face centres. Fine speck detail is derivative-filtered; the lower pool uses
a defined ascending smoothstep. No transmission, tone mapping or environment map.

Execution 1 inspected settled, all spectrum depths, active piece and a 45-degree
turn, selecting the second iteration. Its recorded results were 8 unit and 11
existing palette/landing/gel Playwright tests passing, plus build and lint.
The earlier cube-original/cube-polish-v1/cube-polish-v2 images were missing after
resume; do not claim those directories are still present. Environment execution
captures now show the restored material, with palette and gel tests rerun.

The reusable production capture entry point is scripts/voxel-polish-capture.mjs.
The earlier board/edge caches, shared geometry, game-over, landscape and preview
layout changes were preserved. Those broader features were not declared complete.
