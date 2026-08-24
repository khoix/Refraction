/**
 * Gel material variants for the preview lab.
 *
 * Proof-of-concept looks only — nothing here ships to the game until one of
 * these reads right in /preview.html.
 */

import * as THREE from 'three';
import { applyGel, setGelYaw } from '@render/gel';

export interface GelVariant {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly roundness: number;
  readonly roughness: number;
  readonly opacity: number;
  readonly physical?: boolean;
  readonly ior?: number;
  readonly transmission?: number;
  readonly thickness?: number;
  readonly clearcoat?: number;
  /** Extra shader terms layered on top of the production gel. */
  readonly boost?: GelBoost;
}

export interface GelBoost {
  readonly gloss?: number;
  readonly rim?: number;
  readonly pool?: number;
  readonly density?: number;
  readonly specks?: number;
  readonly innerGlow?: number;
  readonly translucency?: number;
  readonly caustic?: number;
  readonly chromatic?: number;
}

export const GEL_VARIANTS: readonly GelVariant[] = [
  {
    id: 'current',
    name: 'Current',
    blurb: 'Production gel — cast resin, directional catch, pooled lower edge.',
    roundness: 0.11,
    roughness: 0.34,
    opacity: 1,
  },
  {
    id: 'translucent',
    name: 'Translucent',
    blurb: 'See-through gel — faces breathe, edges hold the light like thick glass.',
    roundness: 0.14,
    roughness: 0.22,
    opacity: 0.72,
    boost: {
      rim: 0.32,
      gloss: 0.28,
      translucency: 0.32,
      innerGlow: 0.06,
      density: 0.14,
      pool: 0.03,
    },
  },
  {
    id: 'deep-resin',
    name: 'Deep resin',
    blurb: 'Denser core, stronger pool — colour settles toward the lower edge.',
    roundness: 0.13,
    roughness: 0.3,
    opacity: 0.94,
    boost: {
      density: 0.3,
      pool: 0.06,
      innerGlow: 0.1,
      gloss: 0.32,
      rim: 0.28,
    },
  },
  {
    id: 'glass',
    name: 'Glass cube',
    blurb: 'Physical transmission — refractive body with a tight specular catch.',
    roundness: 0.16,
    roughness: 0.08,
    opacity: 1,
    physical: true,
    ior: 1.45,
    transmission: 0.55,
    thickness: 0.7,
    clearcoat: 0.6,
    boost: {
      rim: 0.3,
      gloss: 0.34,
      chromatic: 0.05,
      density: 0.12,
    },
  },
  {
    id: 'neon-edge',
    name: 'Neon edge',
    blurb: 'Bloom-friendly rim — silhouette glows, centre stays faithful to the ramp.',
    roundness: 0.12,
    roughness: 0.26,
    opacity: 0.9,
    boost: {
      rim: 0.36,
      innerGlow: 0.08,
      gloss: 0.3,
      caustic: 0.06,
      density: 0.16,
    },
  },
  {
    id: 'soft-jelly',
    name: 'Soft jelly',
    blurb: 'Pillow corners, squishy body — rounded bevels and a milky centre.',
    roundness: 0.2,
    roughness: 0.45,
    opacity: 0.7,
    boost: {
      translucency: 0.38,
      density: 0.1,
      pool: 0.04,
      innerGlow: 0.05,
      rim: 0.22,
      gloss: 0.2,
    },
  },
] as const;

const GEL_LIGHT_BASE: readonly [number, number, number] = [0.42, 0.78, 0.46];
const BEVEL_START = 0.74;
const GLOSS_FOCUS = 1.6;

const gelYaw = { value: 0 };

export function setPreviewGelYaw(yawDegrees: number): void {
  gelYaw.value = THREE.MathUtils.degToRad(yawDegrees);
  setGelYaw(yawDegrees);
}

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

vec3 gelLight() {
  float c = cos(uGelYaw);
  float s = sin(uGelYaw);
  vec3 b = vec3(${GEL_LIGHT_BASE.map((v) => v.toFixed(3)).join(', ')});
  return normalize(vec3(b.x * c + b.z * s, b.y, -b.x * s + b.z * c));
}
`;

function makeBoostAlbedo(base: GelBoost | undefined): string {
  // Absolute coefficients (same scale as production gel), not stacked on top of it.
  const gloss = base?.gloss ?? 0.38;
  const rim = base?.rim ?? 0.4;
  const pool = base?.pool ?? 0.04;
  const density = base?.density ?? 0.22;
  const specks = base?.specks ?? 0.07;
  const translucency = base?.translucency ?? 0;
  const caustic = base?.caustic ?? 0;
  const chromatic = base?.chromatic ?? 0;

  return /* glsl */ `
  float gEdge = gelEdge(vGelPosition);
  float gPool = gelBelow(vGelPosition) * uGelStrength;
  float gBevel = smoothstep(${BEVEL_START.toFixed(2)}, 1.0, gEdge);
  float gLambert = max(dot(normalize(vGelNormal), gelLight()), 0.0);
  float gGloss = gBevel * pow(gLambert, ${GLOSS_FOCUS.toFixed(2)}) * uGelStrength;
  float gSpeck = (gelHash(floor(vGelPosition * 30.0)) - 0.5) * gEdge;
  float gRim = pow(1.0 - abs(vGelView.z), 4.0) * gEdge * uGelStrength;

  // Centre stays at palette value; surround darkens for depth read.
  diffuseColor.rgb *= 1.0 - gEdge * gEdge * ${density.toFixed(3)};
  diffuseColor.rgb *= 1.0 + gSpeck * ${specks.toFixed(3)};

  // Translucent body: centre lifts toward background, edges stay saturated.
  float gTranslucent = (1.0 - gEdge * gEdge) * ${translucency.toFixed(3)} * uGelStrength;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.55 + vec3(0.08), gTranslucent);

  // Caustic shimmer along the lit bevel.
  float gCaustic = gBevel * pow(gLambert, 2.2) * (0.5 + 0.5 * gelHash(floor(vGelPosition * 18.0 + gelLight() * 2.0)));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), gCaustic * ${caustic.toFixed(3)} * uGelStrength);

  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), gGloss * ${gloss.toFixed(3)});
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), gRim * ${rim.toFixed(3)});

  // Chromatic fringe at the silhouette — preview only, not a depth cue.
  float gChroma = pow(1.0 - abs(vGelView.z), 3.0) * gEdge * ${chromatic.toFixed(3)} * uGelStrength;
  diffuseColor.r = mix(diffuseColor.r, 1.0, gChroma * 0.6);
  diffuseColor.b = mix(diffuseColor.b, 1.0, gChroma * 0.35);

  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), gPool * ${pool.toFixed(3)});
`;
}

function makeBoostEmission(base: GelBoost | undefined): string {
  const innerGlow = base?.innerGlow ?? 0.1;
  return /* glsl */ `
  float gEdge = gelEdge(vGelPosition);
  float gPool = gelBelow(vGelPosition) * uGelStrength;
  float gInner = (1.0 - gEdge) * gPool * ${innerGlow.toFixed(3)} * uGelStrength;
  totalEmissiveRadiance += diffuseColor.rgb * gInner;
`;
}

function applyBoostedGel(
  material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
  boost: GelBoost | undefined
): void {
  const strength = { value: 1 };
  material.userData.gelStrength = strength;
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
        `#include <begin_vertex>\nvGelPosition = position;\nvGelNormal = normal;\nvGelView = normalize(normalMatrix * normal);`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GEL_COMMON}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${makeBoostAlbedo(boost)}`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>\n${makeBoostEmission(boost)}`
      );
  };
}

/** Build a preview-only gel material for one variant definition. */
export function createGelMaterial(variant: GelVariant): THREE.Material {
  const transparent = variant.opacity < 1 || (variant.transmission ?? 0) > 0;

  if (variant.physical) {
    const material = new THREE.MeshPhysicalMaterial({
      roughness: variant.roughness,
      metalness: 0,
      transparent,
      opacity: variant.opacity,
      transmission: variant.transmission ?? 0,
      ior: variant.ior ?? 1.45,
      thickness: variant.thickness ?? 0.5,
      clearcoat: variant.clearcoat ?? 0,
      clearcoatRoughness: 0.08,
      envMapIntensity: 0.4,
    });
    applyBoostedGel(material, variant.boost);
    return material;
  }

  const material = new THREE.MeshStandardMaterial({
    roughness: variant.roughness,
    metalness: 0,
    transparent,
    opacity: variant.opacity,
  });

  if (variant.id === 'current' && !variant.boost) {
    applyGel(material);
    return material;
  }

  applyBoostedGel(material, variant.boost);
  return material;
}
