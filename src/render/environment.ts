/**
 * The reactive environment, and the debris a clear throws off.
 *
 * The room is made of **light, not colour**. Every element here is achromatic:
 * shafts of cool grey light, white dust, dim wireframe, a neutral floor
 * lattice, and rings that ripple outward when lines clear. It reacts to play
 * through brightness and motion, and never through hue.
 *
 * That is a rule, not a preference. This space once ran on a single hue clock
 * -- dust, fragments, lattice, beams, strobe and backdrop all cycling the
 * colour wheel in lockstep at 0.7-0.85 saturation -- and it read as a
 * screensaver: flat coloured strips with hard edges over a saturated near-black
 * that came out muddy brown. Worse, it fought the one thing the game means by
 * colour. A room that needs a near-opaque panel to keep it off the cubes is a
 * room competing with the board rather than holding it.
 *
 * Achromatic solves both at once. Grey light cannot be mistaken for a depth
 * claim, so the only hue on screen still belongs to a cube, and the space can
 * sit right up against the board instead of being walled off from it.
 *
 * The craft rules that keep it from looking cheap:
 *
 * - **Beams fade at both ends.** A vertex-colour ramp runs bright at the
 *   board's height and falls to black top and bottom, so a shaft reads as light
 *   with no beginning and no end rather than as a rectangle someone drew.
 * - **Nothing moves in lockstep.** Each beam has its own drift, phase and peak,
 *   so the room breathes unevenly the way a real one does.
 * - **The ground is a true neutral.** A saturated near-black is a tint, and
 *   dark tints read as dirt.
 *
 * It is strictly a backdrop. Every element draws in the opaque pass with a
 * negative render order and no depth writes, so board pixels always paint over
 * environment pixels. Brightness is carried by additive colour rather than
 * opacity so the elements can live in the opaque pass at all.
 *
 * Debris is the one exception, and it is gameplay feedback rather than scenery:
 * it erupts from the cells a clear removed and carries their spectrum colour
 * truthfully, because that colour *is* a depth claim.
 */

import * as THREE from 'three';
import { BOARD_HEIGHT } from '@core/constants';

const BACKDROP_ORDER = -10;

const DUST_INNER_RADIUS = 13;
const DUST_OUTER_RADIUS = 42;
const DUST_COUNT = 520;

const FRAGMENT_COUNT = 14;
/**
 * Fewer, wider, softer than the disco's seven hard strips. A shaft of light
 * only reads as light if there is room around it.
 */
const BEAM_COUNT = 5;
/** Vertical segments per beam, for the falloff ramp along its length. */
const BEAM_SEGMENTS = 16;
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

/**
 * A neutral at a given brightness, very slightly cool.
 *
 * Not pure grey: a trace of blue keeps the room from reading as a
 * black-and-white photograph, and at this saturation it cannot be mistaken for
 * a hue that means something.
 *
 * **`level` is sRGB, not linear.** Three works in linear space and converts on
 * output, which lifts the bottom end hard: a linear 0.008 -- which reads as
 * "nearly black" to anyone writing it -- arrives on screen at about 26/255, a
 * mid-dark grey. That mistake is what made the old room a flat grey field, and
 * it is why every level in this file is stated the way it will actually look.
 */
function light(level: number): THREE.Color {
  const value = Math.max(0, level);
  return new THREE.Color().setRGB(value * 0.94, value * 0.97, value, THREE.SRGBColorSpace);
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
    const size = 1.1 + Math.random() * 2.6;
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(size, size, size));
    const material = new THREE.LineBasicMaterial();
    backdropMaterialSettings(material);
    const fragment = new THREE.LineSegments(edges, material);
    const angle = Math.random() * Math.PI * 2;
    // Well clear of the board, so the field reads as distance rather than as
    // clutter drawn across the well.
    const radius = 26 + Math.random() * 22;
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

/**
 * A flat grid on the ground, seen only while the board turns.
 *
 * It has to be gated on the turn, and not because a floor is a spatial cue --
 * though it is one, and §2.1 rules those out of the still frame anyway. A
 * horizontal plane viewed from zero elevation is **edge-on**, so every line in
 * it projects onto the same row of pixels. Under additive blending eighteen
 * lines at 0.085 sum past 1 and clip: what the player saw was not a grid, it was
 * a hard white rule across the bottom of the screen, measured at luminance 194
 * against a room that reads under 30.
 *
 * Holding Peek is what proved it -- eight degrees of elevation dropped the peak
 * to 35 and spread it over a hundred rows, which is a grid.
 *
 * So it fades with `flatness`, exactly as the well's corner posts do: absent
 * when the board is settled, arriving as the camera lifts into the turn, gone
 * again on the other side.
 */
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

/**
 * Shafts of light standing around the board.
 *
 * The falloff is the whole trick. A flat plane at constant brightness reads as
 * a coloured strip of paper; the same plane with its brightness ramped to
 * nothing at both ends reads as light passing through. The ramp is baked into
 * vertex colours -- under additive blending, black is invisible -- so it costs
 * one attribute and no shader.
 */
function lightShafts(): THREE.Group {
  const group = new THREE.Group();
  for (let i = 0; i < BEAM_COUNT; i += 1) {
    const width = 2.2 + Math.random() * 2.0;
    const geometry = new THREE.PlaneGeometry(width, 96, 1, BEAM_SEGMENTS);

    // Brightest across the board's own height, falling to nothing top and
    // bottom, so a shaft has no visible beginning or end.
    const position = geometry.getAttribute('position');
    const shade = new Float32Array(position.count * 3);
    for (let v = 0; v < position.count; v += 1) {
      const t = Math.abs(position.getY(v)) / 48;
      const falloff = Math.max(0, 1 - t * t);
      shade[v * 3] = falloff;
      shade[v * 3 + 1] = falloff;
      shade[v * 3 + 2] = falloff;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(shade, 3));

    const material = new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      vertexColors: true,
    });
    backdropMaterialSettings(material);

    const beam = new THREE.Mesh(geometry, material);
    const angle = (i / BEAM_COUNT) * Math.PI * 2 + Math.random() * 0.5;
    const radius = 15 + Math.random() * 9;
    beam.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    beam.rotation.z = (Math.random() - 0.5) * 0.5;
    // Its own drift, phase and peak, so no two breathe together.
    beam.userData.spin = 0.00018 + Math.random() * 0.00022;
    beam.userData.phase = Math.random() * Math.PI * 2;
    beam.userData.peak = 0.5 + Math.random() * 0.5;
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
  readonly backdrop = new THREE.Color(0x05060a);

  private readonly dustNear: THREE.Points;
  private readonly dustFar: THREE.Points;
  private readonly fragments: THREE.Group;
  private readonly lattice: THREE.LineSegments;
  private readonly beams: THREE.Group;
  private readonly ripples: Ripple[] = [];

  private pulse = 0;
  private tension = 0;
  /** 1 while the board is settled and dead-on, 0 at the midpoint of a turn. */
  private flatness = 1;
  private turnDrive = 0;
  /** Free-running clock for the beams' individual breathing. */
  private phase = 0;
  private readonly reducedMotion: boolean;
  private readonly intensity: number;

  constructor(reducedMotion: boolean) {
    this.reducedMotion = reducedMotion;
    this.intensity = reducedMotion ? 0.45 : 1;

    this.dustNear = dustCloud(0);
    this.dustFar = dustCloud(2.1);
    this.fragments = fragmentField();
    this.lattice = floorLattice();
    this.beams = lightShafts();

    // The strobe is gone. It was the photosensitivity risk and the single
    // cheapest-looking thing in the room, and nothing replaced it: a space made
    // of light does not need to flash to feel alive.

    for (let i = 0; i < RIPPLE_POOL; i += 1) this.ripples.push(buildRipple());

    this.group.add(
      this.dustNear,
      this.dustFar,
      this.fragments,
      this.lattice,
      this.beams,
      ...this.ripples.map((ripple) => ripple.ring)
    );
  }

  /**
   * How dead-on the camera currently is.
   *
   * Only the floor lattice reads it, and only because a horizontal plane has no
   * thickness from zero elevation -- see `floorLattice`. Everything else in the
   * room stands up in the frame and is unaffected by the camera's elevation.
   */
  setFlatness(flatness: number): void {
    this.flatness = Math.min(1, Math.max(0, flatness));
  }

  react(strength: number): void {
    this.pulse = Math.min(1.8, this.pulse + strength * this.intensity);
  }

  ripple(strength: number): void {
    const idle = this.ripples.find((candidate) => candidate.ageMs >= RIPPLE_LIFE_MS);
    if (!idle) return;
    idle.ageMs = 0;
    idle.strength = strength * this.intensity;
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
    this.phase += deltaMs * 0.00035 * (this.reducedMotion ? 0.4 : 1);

    this.dustNear.rotation.y += step * 3;
    this.dustFar.rotation.y -= step * 2;
    this.fragments.rotation.y += step;
    this.beams.rotation.y += step * 1.4;

    // One brightness signal for the whole room. Everything below is a level,
    // never a hue: the room answers the board by getting brighter, not by
    // changing colour.
    const glow = this.pulse + this.tension * 0.3;

    (this.dustNear.material as THREE.PointsMaterial).color.copy(light(0.26 + glow * 0.3));
    (this.dustFar.material as THREE.PointsMaterial).color.copy(light(0.13 + glow * 0.16));
    (this.dustNear.material as THREE.PointsMaterial).size = 1.9 + this.pulse * 1.2;

    this.fragments.children.forEach((child, index) => {
      const fragment = child as THREE.LineSegments;
      // Each fragment sits at its own level, so the field has depth rather
      // than reading as one flat sheet of wireframe.
      const own = 0.055 + (((index * 37) % 11) / 11) * 0.05;
      (fragment.material as THREE.LineBasicMaterial).color.copy(light(own + glow * 0.14));
      fragment.rotation.x += step * 0.7;
      fragment.scale.setScalar(1 + this.pulse * 0.1);
    });

    // Nothing at all when the board is dead-on, where this would be a hard white
    // rule rather than a floor. See `floorLattice`.
    (this.lattice.material as THREE.LineBasicMaterial).color.copy(
      light((0.085 + glow * 0.11) * (1 - this.flatness))
    );

    this.beams.children.forEach((child) => {
      const beam = child as THREE.Mesh;
      beam.rotation.y += (beam.userData.spin as number) * deltaMs * drive;
      // Its own phase and peak, so the room breathes unevenly.
      const breath = 0.6 + 0.4 * Math.sin(this.phase + (beam.userData.phase as number));
      const level = (beam.userData.peak as number) * breath * (0.05 + glow * 0.06);
      (beam.material as THREE.MeshBasicMaterial).color.copy(light(level + this.turnDrive * 0.045));
    });

    // A true neutral ground. A saturated near-black is a tint, and dark tints
    // read as dirt -- which is exactly how the old hue-cycled backdrop looked.
    const ground = 0.035 + glow * 0.03;
    this.backdrop.setRGB(ground * 0.92, ground * 0.96, ground, THREE.SRGBColorSpace);

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
      ripple.material.color.copy(light((1 - t) * (1 - t) * 0.5 * ripple.strength));
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
      if ((this.ages[i] as number) >= DEBRIS_LIFE_MS) continue;
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

      this.positions[i * 3] =
        (this.positions[i * 3] as number) + (this.velocities[i * 3] as number) * deltaMs;
      const vy = (this.velocities[i * 3 + 1] as number) - DEBRIS_GRAVITY * deltaMs;
      this.velocities[i * 3 + 1] = vy;
      this.positions[i * 3 + 1] = (this.positions[i * 3 + 1] as number) + vy * deltaMs;
      this.positions[i * 3 + 2] =
        (this.positions[i * 3 + 2] as number) + (this.velocities[i * 3 + 2] as number) * deltaMs;

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
