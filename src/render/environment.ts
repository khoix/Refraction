/**
 * The reactive environment, and the debris a clear throws off.
 *
 * The board floats in a living space rather than a black void: drifting dust,
 * distant geometric fragments, a faint floor lattice, and rings that ripple
 * outward when lines clear. All of it is **achromatic** -- white and grey
 * light only. On this screen a hue is a claim about depth from the current
 * camera, so the environment is allowed brightness, density, geometry and
 * motion, and is never allowed a colour.
 *
 * It is also strictly a backdrop. Every element draws in the opaque pass with
 * a negative render order and no depth writes, so board pixels always paint
 * over environment pixels -- nothing here can ever sit between the player and
 * a cube, and none of its motion is coupled to board depth. Brightness is
 * carried by additive colour rather than opacity so the elements can live in
 * the opaque pass at all.
 *
 * The one exception is debris, which is gameplay feedback rather than
 * scenery: it erupts from the cells a clear removed, carries their spectrum
 * colour truthfully, and draws over the board like the other clear effects.
 */

import * as THREE from 'three';
import { BOARD_HEIGHT } from '@core/constants';

const BACKDROP_ORDER = -10;

/** Dust ring bounds, comfortably outside the board's turning diagonal. */
const DUST_INNER_RADIUS = 13;
const DUST_OUTER_RADIUS = 42;
const DUST_COUNT = 420;

const FRAGMENT_COUNT = 14;
const RIPPLE_POOL = 5;
const RIPPLE_LIFE_MS = 950;

const DEBRIS_POOL = 600;
const DEBRIS_LIFE_MS = 700;
const DEBRIS_GRAVITY = 0.000028; // cells per ms^2

function backdropMaterialSettings(material: THREE.Material): void {
  material.depthWrite = false;
  material.depthTest = false;
  material.blending = THREE.AdditiveBlending;
  // Deliberately NOT transparent: that keeps the element in the opaque pass,
  // where it renders before the board and the board paints over it.
  material.transparent = false;
}

/** Points spread through an annular volume around the board. */
function dustCloud(seedAngle: number): THREE.Points {
  const positions = new Float32Array(DUST_COUNT * 3);
  for (let i = 0; i < DUST_COUNT; i += 1) {
    const angle = seedAngle + Math.random() * Math.PI * 2;
    const radius =
      DUST_INNER_RADIUS + Math.random() * Math.random() * (DUST_OUTER_RADIUS - DUST_INNER_RADIUS);
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = (Math.random() - 0.35) * BOARD_HEIGHT * 1.9;
    positions[i * 3 + 2] = Math.sin(angle) * radius;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({ size: 2.4, sizeAttenuation: false });
  backdropMaterialSettings(material);
  const points = new THREE.Points(geometry, material);
  points.renderOrder = BACKDROP_ORDER;
  points.frustumCulled = false;
  return points;
}

/** Sparse wireframe boxes drifting far behind the well. */
function fragmentField(): THREE.Group {
  const group = new THREE.Group();
  for (let i = 0; i < FRAGMENT_COUNT; i += 1) {
    const size = 1.2 + Math.random() * 3.4;
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(size, size, size));
    const material = new THREE.LineBasicMaterial();
    backdropMaterialSettings(material);
    const fragment = new THREE.LineSegments(edges, material);

    const angle = Math.random() * Math.PI * 2;
    const radius = 20 + Math.random() * 22;
    fragment.position.set(
      Math.cos(angle) * radius,
      (Math.random() - 0.4) * BOARD_HEIGHT * 2.2,
      Math.sin(angle) * radius
    );
    fragment.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
    fragment.renderOrder = BACKDROP_ORDER;
    fragment.frustumCulled = false;
    group.add(fragment);
  }
  return group;
}

/** A faint square lattice on the floor plane, well below the well. */
function floorLattice(): THREE.LineSegments {
  const half = 34;
  const step = 4;
  const y = -BOARD_HEIGHT / 2 - 2.4;
  const points: number[] = [];
  for (let v = -half; v <= half; v += step) {
    points.push(-half, y, v, half, y, v);
    points.push(v, y, -half, v, y, half);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const material = new THREE.LineBasicMaterial();
  backdropMaterialSettings(material);
  const lattice = new THREE.LineSegments(geometry, material);
  lattice.renderOrder = BACKDROP_ORDER;
  lattice.frustumCulled = false;
  return lattice;
}

interface Ripple {
  readonly ring: THREE.LineLoop;
  readonly material: THREE.LineBasicMaterial;
  ageMs: number;
  strength: number;
}

function buildRipple(): Ripple {
  const segments = 56;
  const points: number[] = [];
  for (let i = 0; i < segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    points.push(Math.cos(angle), Math.sin(angle), 0);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const material = new THREE.LineBasicMaterial();
  backdropMaterialSettings(material);
  const ring = new THREE.LineLoop(geometry, material);
  ring.renderOrder = BACKDROP_ORDER;
  ring.frustumCulled = false;
  ring.visible = false;
  return { ring, material, ageMs: RIPPLE_LIFE_MS, strength: 0 };
}

export class Environment {
  readonly group = new THREE.Group();

  private readonly dustNear: THREE.Points;
  private readonly dustFar: THREE.Points;
  private readonly fragments: THREE.Group;
  private readonly lattice: THREE.LineSegments;
  private readonly ripples: Ripple[] = [];

  /** Momentary excitement from an event, decaying back to calm. */
  private pulse = 0;
  /** How close the Shift meter is to full, 0..1. Creeping anticipation. */
  private tension = 0;
  /** Extra drive while the board is turning. */
  private turnDrive = 0;
  private readonly intensity: number;

  constructor(reducedMotion: boolean) {
    // Under reduced motion the space stays alive but everything reacts at a
    // fraction of its strength; ambience is not a photosensitivity risk, spikes
    // are.
    this.intensity = reducedMotion ? 0.35 : 1;

    this.dustNear = dustCloud(0);
    this.dustFar = dustCloud(2.1);
    this.fragments = fragmentField();
    this.lattice = floorLattice();
    for (let i = 0; i < RIPPLE_POOL; i += 1) this.ripples.push(buildRipple());

    this.group.add(
      this.dustNear,
      this.dustFar,
      this.fragments,
      this.lattice,
      ...this.ripples.map((ripple) => ripple.ring)
    );
  }

  /** An event pushed energy into the space. Strength 0..1, biggest for Prism. */
  react(strength: number): void {
    this.pulse = Math.min(1.6, this.pulse + strength * this.intensity);
  }

  /** A clear sends a ring outward through the space. */
  ripple(strength: number): void {
    const idle = this.ripples.find((candidate) => candidate.ageMs >= RIPPLE_LIFE_MS);
    if (!idle) return;
    idle.ageMs = 0;
    idle.strength = strength * this.intensity;
    idle.ring.visible = true;
  }

  /** How full the Shift meter is; the space leans in as the turn approaches. */
  setTension(tension: number): void {
    this.tension = THREE.MathUtils.clamp(tension, 0, 1);
  }

  update(deltaMs: number, yawDegrees: number, turning: boolean): void {
    this.pulse = Math.max(0, this.pulse - deltaMs * 0.0022);
    const target = turning ? 1 : 0;
    this.turnDrive += (target - this.turnDrive) * Math.min(1, deltaMs * 0.008);

    // Drift accelerates with tension and the turn. Two clouds run against each
    // other so the motion reads as space rather than as a spinning prop.
    const drive = 1 + this.tension * 0.9 + this.turnDrive * 2.6 + this.pulse * 1.4;
    const step = deltaMs * 0.000016 * drive * this.intensity;
    this.dustNear.rotation.y += step * 3;
    this.dustFar.rotation.y -= step * 2;
    this.fragments.rotation.y += step;

    const glow = this.pulse + this.tension * 0.25;
    (this.dustNear.material as THREE.PointsMaterial).color.setScalar(0.34 + glow * 0.5);
    (this.dustFar.material as THREE.PointsMaterial).color.setScalar(0.2 + glow * 0.34);
    (this.dustNear.material as THREE.PointsMaterial).size = 2.4 + this.pulse * 1.8;

    this.fragments.children.forEach((child) => {
      const fragment = child as THREE.LineSegments;
      (fragment.material as THREE.LineBasicMaterial).color.setScalar(0.09 + glow * 0.22);
      fragment.rotation.x += step * 0.6;
    });
    (this.lattice.material as THREE.LineBasicMaterial).color.setScalar(0.07 + glow * 0.16);

    const yawRad = THREE.MathUtils.degToRad(yawDegrees);
    for (const ripple of this.ripples) {
      if (ripple.ageMs >= RIPPLE_LIFE_MS) {
        ripple.ring.visible = false;
        continue;
      }
      ripple.ageMs += deltaMs;
      const t = Math.min(1, ripple.ageMs / RIPPLE_LIFE_MS);
      const radius = 9 + t * 26;
      ripple.ring.scale.setScalar(radius);
      // Face the camera, so the ring reads as a shockwave from every face.
      ripple.ring.rotation.y = yawRad;
      ripple.material.color.setScalar((1 - t) * (1 - t) * 0.55 * ripple.strength);
    }
  }

  dispose(): void {
    const disposeObject = (object: THREE.Object3D): void => {
      const mesh = object as Partial<THREE.Mesh> & THREE.Object3D;
      if (mesh.geometry) (mesh.geometry as THREE.BufferGeometry).dispose();
      if (mesh.material) (mesh.material as THREE.Material).dispose();
    };
    this.group.traverse(disposeObject);
  }
}

/**
 * Debris from a line clear: a burst of points at the removed cells, thrown
 * outward and pulled down, fading over well under a second. Each particle
 * keeps the spectrum colour of the cell it came from -- the one place colour
 * is allowed, because it is that cell's actual depth being carried away.
 *
 * Particles are staggered along the clearing axis, so the burst reads as the
 * line dissolving from one end to the other rather than popping all at once.
 */
export class Debris {
  readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly velocities: Float32Array;
  private readonly ages: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.PointsMaterial;
  private cursor = 0;
  private active = 0;

  constructor() {
    this.positions = new Float32Array(DEBRIS_POOL * 3);
    this.colors = new Float32Array(DEBRIS_POOL * 3);
    this.velocities = new Float32Array(DEBRIS_POOL * 3);
    this.ages = new Float32Array(DEBRIS_POOL).fill(DEBRIS_LIFE_MS);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));

    this.material = new THREE.PointsMaterial({
      size: 3.2,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.renderOrder = 3;
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  /**
   * Erupt from one cleared cell. `along` is the cell's position along the
   * clearing axis, 0..1, which staggers its start so the line dissolves
   * directionally; `rgb` is the cell's spectrum colour at the moment it went.
   */
  burst(
    x: number,
    y: number,
    z: number,
    along: number,
    rgb: { r: number; g: number; b: number },
    count: number
  ): void {
    for (let n = 0; n < count; n += 1) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % DEBRIS_POOL;

      this.positions[i * 3] = x + (Math.random() - 0.5) * 0.6;
      this.positions[i * 3 + 1] = y + (Math.random() - 0.5) * 0.6;
      this.positions[i * 3 + 2] = z + (Math.random() - 0.5) * 0.6;

      this.velocities[i * 3] = (Math.random() - 0.5) * 0.008;
      this.velocities[i * 3 + 1] = 0.004 + Math.random() * 0.009;
      this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.008;

      this.colors[i * 3] = rgb.r;
      this.colors[i * 3 + 1] = rgb.g;
      this.colors[i * 3 + 2] = rgb.b;

      // Negative age delays the particle: the far end of the line waits.
      this.ages[i] = -along * 200 - Math.random() * 60;
    }
    this.active = DEBRIS_POOL;
    this.points.visible = true;
  }

  /** True while any particle is still visible. */
  get isActive(): boolean {
    return this.active > 0;
  }

  update(deltaMs: number): void {
    if (this.active === 0) return;
    let alive = 0;

    for (let i = 0; i < DEBRIS_POOL; i += 1) {
      if (this.ages[i] as number >= DEBRIS_LIFE_MS) continue;
      this.ages[i] = (this.ages[i] as number) + deltaMs;
      const age = this.ages[i] as number;
      if (age < 0) {
        alive += 1;
        continue; // still waiting for its place in the dissolve
      }
      if (age >= DEBRIS_LIFE_MS) {
        // Park the spent particle somewhere it cannot be seen.
        this.positions[i * 3 + 1] = -1000;
        continue;
      }
      alive += 1;

      this.positions[i * 3] = (this.positions[i * 3] as number) + (this.velocities[i * 3] as number) * deltaMs;
      const vy = (this.velocities[i * 3 + 1] as number) - DEBRIS_GRAVITY * deltaMs;
      this.velocities[i * 3 + 1] = vy;
      this.positions[i * 3 + 1] = (this.positions[i * 3 + 1] as number) + vy * deltaMs;
      this.positions[i * 3 + 2] = (this.positions[i * 3 + 2] as number) + (this.velocities[i * 3 + 2] as number) * deltaMs;

      const fade = 1 - age / DEBRIS_LIFE_MS;
      this.colors[i * 3] = (this.colors[i * 3] as number) * (0.9 + 0.1 * fade);
    }

    this.active = alive;
    this.points.visible = alive > 0;
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
