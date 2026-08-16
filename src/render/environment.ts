/**
 * The reactive environment, and the debris a clear throws off.
 *
 * The board floats in a loud space: coloured beams, cycling fragments, a
 * pulsing lattice, drifting dust, and rings that ripple outward when lines
 * clear. Decorative colour is allowed here -- it makes no claim about the
 * rules. The near-opaque play column is what keeps that colour from ever
 * sitting on a cube, so a hue on the board is still only ever a depth claim.
 *
 * It is strictly a backdrop. Every element draws in the opaque pass with a
 * negative render order and no depth writes, so board pixels always paint
 * over environment pixels. Brightness is carried by additive colour rather
 * than opacity so the elements can live in the opaque pass at all.
 *
 * Debris is gameplay feedback rather than scenery: it erupts from the cells
 * a clear removed, carries their spectrum colour truthfully, and draws over
 * the board like the other clear effects.
 */

import * as THREE from 'three';
import { BOARD_HEIGHT } from '@core/constants';

const BACKDROP_ORDER = -10;

const DUST_INNER_RADIUS = 13;
const DUST_OUTER_RADIUS = 42;
const DUST_COUNT = 520;

const FRAGMENT_COUNT = 18;
const BEAM_COUNT = 7;
const RIPPLE_POOL = 5;
const RIPPLE_LIFE_MS = 950;

const DEBRIS_POOL = 600;
const DEBRIS_LIFE_MS = 700;
const DEBRIS_GRAVITY = 0.000028;

function backdropMaterialSettings(material: THREE.Material): void {
  material.depthWrite = false;
  material.depthTest = false;
  material.blending = THREE.AdditiveBlending;
  material.transparent = false;
}

function hueColor(hue: number, sat: number, lit: number): THREE.Color {
  return new THREE.Color().setHSL(((hue % 1) + 1) % 1, sat, lit);
}

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
  const material = new THREE.PointsMaterial({ size: 2.6, sizeAttenuation: false });
  backdropMaterialSettings(material);
  const points = new THREE.Points(geometry, material);
  points.renderOrder = BACKDROP_ORDER;
  points.frustumCulled = false;
  return points;
}

function fragmentField(): THREE.Group {
  const group = new THREE.Group();
  for (let i = 0; i < FRAGMENT_COUNT; i += 1) {
    const size = 1.2 + Math.random() * 3.8;
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(size, size, size));
    const material = new THREE.LineBasicMaterial();
    backdropMaterialSettings(material);
    const fragment = new THREE.LineSegments(edges, material);
    const angle = Math.random() * Math.PI * 2;
    const radius = 18 + Math.random() * 24;
    fragment.position.set(
      Math.cos(angle) * radius,
      (Math.random() - 0.4) * BOARD_HEIGHT * 2.2,
      Math.sin(angle) * radius
    );
    fragment.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
    fragment.userData.hue = i / FRAGMENT_COUNT;
    fragment.renderOrder = BACKDROP_ORDER;
    fragment.frustumCulled = false;
    group.add(fragment);
  }
  return group;
}

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

function discoBeams(): THREE.Group {
  const group = new THREE.Group();
  for (let i = 0; i < BEAM_COUNT; i += 1) {
    const geometry = new THREE.PlaneGeometry(1.4, 90);
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    backdropMaterialSettings(material);
    const beam = new THREE.Mesh(geometry, material);
    const angle = (i / BEAM_COUNT) * Math.PI * 2;
    beam.position.set(Math.cos(angle) * 16, 0, Math.sin(angle) * 16);
    beam.rotation.z = (Math.random() - 0.5) * 0.6;
    beam.userData.hue = i / BEAM_COUNT;
    beam.userData.spin = 0.0004 + i * 0.00007;
    beam.renderOrder = BACKDROP_ORDER;
    beam.frustumCulled = false;
    group.add(beam);
  }
  return group;
}

interface Ripple {
  readonly ring: THREE.LineLoop;
  readonly material: THREE.LineBasicMaterial;
  ageMs: number;
  strength: number;
  hue: number;
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
  return { ring, material, ageMs: RIPPLE_LIFE_MS, strength: 0, hue: 0 };
}

export class Environment {
  readonly group = new THREE.Group();
  readonly backdrop = new THREE.Color(0x05060a);

  private readonly dustNear: THREE.Points;
  private readonly dustFar: THREE.Points;
  private readonly fragments: THREE.Group;
  private readonly lattice: THREE.LineSegments;
  private readonly beams: THREE.Group;
  private readonly strobe: THREE.Mesh;
  private readonly ripples: Ripple[] = [];

  private pulse = 0;
  private tension = 0;
  private turnDrive = 0;
  private hue = 0;
  private strobePhase = 0;
  private readonly reducedMotion: boolean;
  private readonly intensity: number;

  constructor(reducedMotion: boolean) {
    this.reducedMotion = reducedMotion;
    this.intensity = reducedMotion ? 0.45 : 1;

    this.dustNear = dustCloud(0);
    this.dustFar = dustCloud(2.1);
    this.fragments = fragmentField();
    this.lattice = floorLattice();
    this.beams = discoBeams();

    const strobeGeometry = new THREE.PlaneGeometry(180, 180);
    const strobeMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    backdropMaterialSettings(strobeMaterial);
    this.strobe = new THREE.Mesh(strobeGeometry, strobeMaterial);
    this.strobe.position.z = -50;
    this.strobe.renderOrder = BACKDROP_ORDER - 1;
    this.strobe.frustumCulled = false;
    this.strobe.visible = !reducedMotion;

    for (let i = 0; i < RIPPLE_POOL; i += 1) this.ripples.push(buildRipple());

    this.group.add(
      this.strobe,
      this.dustNear,
      this.dustFar,
      this.fragments,
      this.lattice,
      this.beams,
      ...this.ripples.map((ripple) => ripple.ring)
    );
  }

  react(strength: number): void {
    this.pulse = Math.min(1.8, this.pulse + strength * this.intensity);
  }

  ripple(strength: number): void {
    const idle = this.ripples.find((candidate) => candidate.ageMs >= RIPPLE_LIFE_MS);
    if (!idle) return;
    idle.ageMs = 0;
    idle.strength = strength * this.intensity;
    idle.hue = this.hue;
    idle.ring.visible = true;
  }

  setTension(tension: number): void {
    this.tension = THREE.MathUtils.clamp(tension, 0, 1);
  }

  update(deltaMs: number, yawDegrees: number, turning: boolean): void {
    this.pulse = Math.max(0, this.pulse - deltaMs * 0.0022);
    const target = turning ? 1 : 0;
    this.turnDrive += (target - this.turnDrive) * Math.min(1, deltaMs * 0.008);

    const drive = 1 + this.tension * 0.9 + this.turnDrive * 2.6 + this.pulse * 1.4;
    const step = deltaMs * 0.000018 * drive * this.intensity;
    this.hue += deltaMs * 0.000045 * (this.reducedMotion ? 0.25 : 1) * drive;

    this.dustNear.rotation.y += step * 3;
    this.dustFar.rotation.y -= step * 2;
    this.fragments.rotation.y += step;
    this.beams.rotation.y += step * 1.8;

    const glow = this.pulse + this.tension * 0.3;
    (this.dustNear.material as THREE.PointsMaterial).color.copy(
      hueColor(this.hue, 0.55, 0.28 + glow * 0.35)
    );
    (this.dustFar.material as THREE.PointsMaterial).color.copy(
      hueColor(this.hue + 0.18, 0.5, 0.16 + glow * 0.28)
    );
    (this.dustNear.material as THREE.PointsMaterial).size = 2.6 + this.pulse * 2.2;

    this.fragments.children.forEach((child, index) => {
      const fragment = child as THREE.LineSegments;
      const hue = (fragment.userData.hue as number) + this.hue;
      (fragment.material as THREE.LineBasicMaterial).color.copy(
        hueColor(hue, 0.7, 0.18 + glow * 0.35)
      );
      fragment.rotation.x += step * 0.7;
      fragment.scale.setScalar(1 + this.pulse * 0.18 + Math.sin(this.hue * 8 + index) * 0.08);
    });

    (this.lattice.material as THREE.LineBasicMaterial).color.copy(
      hueColor(this.hue + 0.5, 0.45, 0.1 + glow * 0.22)
    );

    this.beams.children.forEach((child) => {
      const beam = child as THREE.Mesh;
      beam.rotation.y += (beam.userData.spin as number) * deltaMs * drive;
      const hue = (beam.userData.hue as number) + this.hue * 1.4;
      (beam.material as THREE.MeshBasicMaterial).color.copy(
        hueColor(hue, 0.85, 0.08 + glow * 0.18 + this.turnDrive * 0.1)
      );
    });

    // Strobe is the photosensitivity risk. Under reduced motion it is gone
    // entirely, not scaled -- a dim flash is still a flash.
    if (!this.reducedMotion) {
      this.strobePhase += deltaMs * (0.009 + this.pulse * 0.02 + this.turnDrive * 0.012);
      const flash = Math.max(0, Math.sin(this.strobePhase) ** 32) * (0.08 + this.pulse * 0.22);
      (this.strobe.material as THREE.MeshBasicMaterial).color.copy(
        hueColor(this.hue + 0.08, 0.6, flash)
      );
      this.strobe.rotation.y = THREE.MathUtils.degToRad(yawDegrees);
    }

    this.backdrop.setHSL(
      ((this.hue + 0.72) % 1 + 1) % 1,
      0.35 + this.tension * 0.15,
      0.035 + glow * 0.04
    );

    const yawRad = THREE.MathUtils.degToRad(yawDegrees);
    for (const ripple of this.ripples) {
      if (ripple.ageMs >= RIPPLE_LIFE_MS) {
        ripple.ring.visible = false;
        continue;
      }
      ripple.ageMs += deltaMs;
      const t = Math.min(1, ripple.ageMs / RIPPLE_LIFE_MS);
      ripple.ring.scale.setScalar(9 + t * 26);
      ripple.ring.rotation.y = yawRad;
      ripple.material.color.copy(
        hueColor(ripple.hue + t * 0.15, 0.8, (1 - t) * (1 - t) * 0.45 * ripple.strength)
      );
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
 * keeps the spectrum colour of the cell it came from -- the board's depth
 * colour being carried away, distinct from the decorative colour of the room.
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
