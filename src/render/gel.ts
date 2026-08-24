/**
 * The gel material.
 *
 * Every solid cube is a glass gel rather than flat plastic: denser through its
 * thickness, a bright catch along the bevel the light falls on, the glow settling
 * toward its lower edge, and a faint tooth inside it. It is what makes a still
 * frame of the board look like this game and not like a grid of squares.
 *
 * ## Two rules it is not allowed to break
 *
 * **A settled cube renders at exactly its `depthColor`** (DESIGN §2.5). This is
 * not a preference, it is the game's only depth channel, and it has been broken
 * before -- three stages of the pipeline were each quietly rescaling the ramp and
 * the whole suite passed anyway. The end-to-end test that now holds it samples a
 * 5x5 patch at the centre of a cube's face and allows six levels out of 255 per
 * channel. A material whose entire purpose is to add variation *within* a cube is
 * one careless gradient away from failing it.
 *
 * So the invariant is structural rather than tuned: **every term below vanishes
 * at the centre of every face.** Two masks are provided for that, `gelEdge` and
 * `gelBelow`, and every term is multiplied by one of them. The gel cannot shift
 * the sampled colour however its constants are set, because at that point
 * everything it contributes is multiplied by zero. Turning the effect up is a
 * look decision; it can never become a fidelity bug.
 *
 * **Nothing here may vary with depth** (DESIGN §2.1). A gel that glowed harder at
 * the front would be a second depth cue competing with the spectrum, which the
 * projection rules forbid outright. Guaranteed the same way: the shader reads the
 * object-space position and normal of the unit cube and the camera's yaw, and
 * nothing else. It cannot see the lane, the world position or the instance, so
 * every cube on the board wears an identical material and only its per-instance
 * colour says where it is.
 *
 * ### Why identical volume is not a spatial cue
 *
 * Making each cube look like a solid is not the same as making the board look
 * three-dimensional. What §2.1 forbids is a cue that lets a player rank cubes by
 * distance without reading colour -- a size falloff, a perspective convergence, a
 * shadow. A highlight that lands in the same place on every cube ranks nothing:
 * it says "these are objects", and the field of them is exactly as flat as it was.
 * Differential shading would be the violation; uniform shading is a material.
 *
 * ## Glass read
 *
 * Clearcoat plus the gel shader's edge gloss, rim, and chromatic fringe carry
 * the glass film. There is no environment map: IBL (RoomEnvironment or soft
 * studio) stamped a dark square onto every near-mirror face. Scene lights alone
 * feed clearcoat; every gel term still vanishes at the face centre, so the
 * fidelity rule holds.
 *
 * Transmission is deliberately omitted. `MeshPhysicalMaterial.transmission`
 * samples a scene buffer that EffectComposer's RenderPass does not provide, so
 * the whole board went black for the duration of any bloom event (lock flash,
 * clear debris, Prism). Clearcoat + gel shader is the glass look that survives
 * the post-process chain.
 *
 * ## Camera-relative, like the lighting rig
 *
 * The gel's light tracks the camera's yaw, using the same transform as
 * `orientLights`. The rig is camera-relative for a stated reason -- with lights
 * fixed in world space, orbiting to the opposite face puts the key behind the
 * board and the stack goes muddy -- and a material that did not follow would put
 * its highlight on a different part of the cube on each of the four faces. One
 * shared uniform carries it, so the whole board updates from a single assignment.
 *
 * ## Why a shader injection rather than a new material
 *
 * `onBeforeCompile` keeps Three's own lighting maths intact. Writing a custom
 * material would mean reimplementing it, and reimplementing it is precisely how
 * the board ended up at a fifth of its palette value the first time -- an ambient
 * light at 1.18 where the Lambert BRDF needs pi. The gel modulates the albedo
 * that pipeline is handed, and otherwise stays out of its way.
 */

import * as THREE from 'three';

/**
 * Where the gel's light sits at yaw 0, in the same frame as `KEY_LIGHT_BASE`.
 *
 * Upper right and forward, so the catch agrees with the scene's key light rather
 * than contradicting it during a turn -- the one moment both are visible at once.
 */
const GEL_LIGHT_BASE: readonly [number, number, number] = [0.42, 0.78, 0.46];

/**
 * Bevel radius of every solid cube, in board-cell units.
 *
 * Soft enough to read as glass gel rather than a hard plastic brick; still
 * shallow enough that neighbouring cubes keep a crisp silhouette gap.
 */
export const GEL_ROUNDNESS = 0.16;
/** Surface roughness of the glass gel body. */
export const GEL_ROUGHNESS = 0.08;
/** Clearcoat strength — the thin glass film over the gel. */
export const GEL_CLEARCOAT = 0.55;
export const GEL_CLEARCOAT_ROUGHNESS = 0.1;
/**
 * Environment map intensity. Kept at zero: any IBL map (room or soft studio)
 * reflected as a dark square on flat gel faces. Glass read comes from clearcoat
 * + the gel edge shader instead.
 */
export const GEL_ENV_INTENSITY = 0;

/**
 * How much of the surface counts as bevel.
 *
 * The geometry is a rounded box of radius {@link GEL_ROUNDNESS}, so the flat face
 * runs out near `edge` 0.7 and the bevel occupies the rest. The catch starts just
 * inside that, so the gloss appears to wrap onto the face rather than stopping
 * at a seam.
 */
const BEVEL_START = 0.7;
/**
 * Tightness of the catch along the bevel.
 *
 * The first version had none: a uniform rim all the way round, which reads as a
 * backlit tile rather than as a solid -- the halo was the whole silhouette at
 * once. Real gloss is directional, so the band is weighted by how much the bevel
 * faces the light and raised to a power to keep it tight.
 */
const GLOSS_FOCUS = 1.7;
/** Strength of the catch, as a lerp toward white. */
const GLOSS = 0.34;
/**
 * The rim where the surface turns away from the eye.
 *
 * A true Fresnel term, not the broad band the first attempt used. Fresnel peaks
 * exactly on the silhouette, so it draws a thin bright line around the cube --
 * which is what "a brighter rim where the surface turns away" means. The broad
 * version brightened the whole perimeter at once and read as a backlit tile.
 *
 * It needs no mask of its own: on a flat face the normal points straight at an
 * orthographic camera, so the term is already zero there. It carries `gelEdge`
 * anyway, so the rule that every term is masked stays true by reading rather
 * than by argument.
 */
const RIM = 0.3;
const RIM_FOCUS = 4.2;
/**
 * Light settling toward the lower edge.
 *
 * One-sided on purpose: in cast gel the glow pools, and that is what says the
 * cube has an inside. Symmetrical brightening would only read as a vignette.
 * Starts below the face centre, which is what keeps it clear of the sampled patch.
 */
const POOL = 0.035;
/** Internal glow at the pooled edge, added as emission rather than as albedo. */
const POOL_EMISSION = 0.14;
/**
 * How much darker the cube reads through its thickness, toward its edges.
 *
 * The "deeper core" of the reference, expressed the only way the fidelity rule
 * allows: the centre stays at the palette value and the surround darkens, so the
 * cube reads as something with depth rather than as a painted square. Applied
 * before the highlights, which is the order light actually arrives in.
 */
const DENSITY = 0.12;
/** Amplitude of the internal tooth. Faint enough to be texture, not pattern. */
const SPECKS = 0.05;
/**
 * Chromatic fringe on the silhouette only.
 *
 * Preview-proven glass cue: a hair of red/blue separation where the surface
 * turns away. Masked by `gelEdge` and Fresnel, so the face centre is untouched.
 */
const CHROMATIC = 0.05;

/**
 * One uniform, shared by every gel material.
 *
 * Assigned into each shader's uniform set rather than copied, so a single write
 * per frame reaches all of them.
 */
const gelYaw = { value: 0 };

/** Where a material keeps its own strength uniform, out of the type system's way. */
const STRENGTH_KEY = 'gelStrength';

/** Point the gel's light at the current camera yaw, in degrees. */
export function setGelYaw(yawDegrees: number): void {
  gelYaw.value = THREE.MathUtils.degToRad(yawDegrees);
}

/**
 * How strongly this material's gel asserts itself, 0..1.
 *
 * Set from how far the layer has pushed its cubes toward the void. The muted
 * band exists to read as a dark mass with no structure, and the gel's highlights
 * lerp toward *white* -- so at full strength a cube dimmed to a quarter of its
 * colour came back with a rim as bright as an undimmed one's, which is the
 * opposite of receding. It was measurable as well as wrong: the muted band's peak
 * overtook the x-ray's, inverting the two bands the whole channel depends on.
 *
 * Scaled by the layer's dim rather than by the pixel's own brightness. Reading
 * the brightness would work too and would quietly make the effect depth-dependent
 * -- violet is a darker stop than green -- which is the one thing this material is
 * not allowed to be.
 */
export function setGelStrength(material: THREE.Material, strength: number): void {
  const uniform = material.userData[STRENGTH_KEY] as { value: number } | undefined;
  if (uniform) uniform.value = THREE.MathUtils.clamp(strength, 0, 1);
}

/**
 * `gelEdge`: 0 at the centre of any face, 1 along the bevels and corners.
 *
 * For a point on the unit cube the largest component of `abs(position) * 2` is
 * the face it belongs to and is always about 1; the *middle* component is how far
 * across that face the point lies. Cheap, exactly zero at the centre, and
 * square-contoured, which suits a cube better than a radial falloff.
 *
 * `gelBelow`: 0 at or above the face centre, 1 at the bottom edge. The other
 * mask, for the terms that are meant to settle rather than to ring.
 */
const GEL_COMMON = /* glsl */ `
varying vec3 vGelPosition;
varying vec3 vGelNormal;
varying vec3 vGelView;
uniform float uGelYaw;
uniform float uGelStrength;

float gelHash(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}

float gelEdge(vec3 p) {
  vec3 q = abs(p) * 2.0;
  float hi = max(q.x, max(q.y, q.z));
  float lo = min(q.x, min(q.y, q.z));
  return clamp(q.x + q.y + q.z - hi - lo, 0.0, 1.0);
}

float gelBelow(vec3 p) {
  return smoothstep(-0.12, -0.5, p.y);
}

// The same transform orientLights() uses, so the gel's light and the scene's
// key travel together instead of drifting apart as the board turns.
vec3 gelLight() {
  float c = cos(uGelYaw);
  float s = sin(uGelYaw);
  vec3 b = vec3(${GEL_LIGHT_BASE.map((v) => v.toFixed(3)).join(', ')});
  return normalize(vec3(b.x * c + b.z * s, b.y, -b.x * s + b.z * c));
}
`;

/**
 * Modulate the albedo.
 *
 * Injected after `<color_fragment>`, which is where the instance colour has just
 * been folded into `diffuseColor` -- so this operates on the cube's true depth
 * colour, whatever the layer did to it beforehand.
 */
const GEL_ALBEDO = /* glsl */ `
  float gEdge = gelEdge(vGelPosition);
  float gPool = gelBelow(vGelPosition) * uGelStrength;
  float gBevel = smoothstep(${BEVEL_START.toFixed(2)}, 1.0, gEdge);
  float gLambert = max(dot(normalize(vGelNormal), gelLight()), 0.0);
  float gGloss = gBevel * pow(gLambert, ${GLOSS_FOCUS.toFixed(2)}) * uGelStrength;
  float gSpeck = (gelHash(floor(vGelPosition * 30.0)) - 0.5) * gEdge;
  // Orthographic, so the eye direction is constant and the view-space normal's
  // z component *is* the facing ratio -- no view vector to reconstruct.
  float gRim = pow(1.0 - abs(vGelView.z), ${RIM_FOCUS.toFixed(1)}) * gEdge * uGelStrength;

  diffuseColor.rgb *= 1.0 - gEdge * gEdge * ${DENSITY.toFixed(3)};
  diffuseColor.rgb *= 1.0 + gSpeck * ${SPECKS.toFixed(3)};
  // Toward white rather than toward a brighter version of the hue: a specular
  // highlight is the colour of the light, not of the surface. Hue stays reserved
  // for depth even here.
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), gGloss * ${GLOSS.toFixed(3)});
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), gRim * ${RIM.toFixed(3)});
  // Chromatic fringe at the silhouette only — glass cue that cannot touch the
  // face centre, because gRim and gEdge are both zero there.
  float gChroma = gRim * ${CHROMATIC.toFixed(3)};
  diffuseColor.r = mix(diffuseColor.r, 1.0, gChroma * 0.55);
  diffuseColor.b = mix(diffuseColor.b, 1.0, gChroma * 0.3);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), gPool * ${POOL.toFixed(3)});
`;

/**
 * The lit-from-within term.
 *
 * Emission bypasses the lighting, so it is the only way to say "there is a light
 * source inside this" -- and the only reason it is safe is that it carries the
 * same mask as everything else. Tinted by the cube's own colour, so the glow is
 * the depth colour glowing rather than a white lamp behind it.
 */
const GEL_EMISSION = /* glsl */ `
  totalEmissiveRadiance += diffuseColor.rgb * gPool * ${POOL_EMISSION.toFixed(3)};
`;

/**
 * The solid-cube glass gel material.
 *
 * Clearcoat and the gel edge shader carry the glass film (no IBL — see
 * {@link GEL_ENV_INTENSITY}). Transmission is omitted — it blacks out under the
 * bloom EffectComposer. Marks (ghost, x-ray, glow) never reach here.
 */
export function createGelMaterial(options: {
  readonly transparent?: boolean;
  readonly opacity?: number;
} = {}): THREE.MeshPhysicalMaterial {
  const transparent = options.transparent ?? false;
  const material = new THREE.MeshPhysicalMaterial({
    roughness: GEL_ROUGHNESS,
    metalness: 0,
    clearcoat: GEL_CLEARCOAT,
    clearcoatRoughness: GEL_CLEARCOAT_ROUGHNESS,
    transparent,
    opacity: options.opacity ?? 1,
    envMapIntensity: GEL_ENV_INTENSITY,
  });
  applyGel(material);
  return material;
}

/**
 * Backdrop floaters — same gel *shape* language as the board, not the glass stack.
 *
 * Board cubes use clearcoat + gel edges with no environment map. Floaters drop
 * clearcoat as well so they never bloom with the playfield. Isolation is
 * deliberate: rounded bevel + gel edge shader only.
 */
export function createFloaterMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    roughness: 0.42,
    metalness: 0,
    envMapIntensity: 0,
  });
  applyGel(material);
  return material;
}

/**
 * Give a material the gel treatment.
 *
 * The layers that are marks rather than cubes -- the ghost, the x-ray glass, the
 * occluded silhouettes, the clear glow -- are unlit `MeshBasicMaterial` and never
 * reach here, so the material's own type is what decides.
 */
export function applyGel(material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial): void {
  const strength = { value: 1 };
  material.userData[STRENGTH_KEY] = strength;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGelYaw = gelYaw;
    shader.uniforms.uGelStrength = strength;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying vec3 vGelPosition;\nvarying vec3 vGelNormal;\nvarying vec3 vGelView;`
      )
      .replace(
        '#include <begin_vertex>',
        // `normalMatrix` omits the instance transform, which is exact here: every
        // instance is a translation and a uniform scale, never a rotation, so the
        // instanced normal and the mesh normal agree.
        `#include <begin_vertex>\nvGelPosition = position;\nvGelNormal = normal;\nvGelView = normalize(normalMatrix * normal);`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GEL_COMMON}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${GEL_ALBEDO}`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>\n${GEL_EMISSION}`
      );
  };
}
