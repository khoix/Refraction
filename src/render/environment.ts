/**
 * The reactive environment, and the debris a clear throws off.
 *
 * The room is made of **light, not colour**. Every element here is achromatic:
 * white dust, drifting voxels, a neutral floor lattice, and rings that ripple
 * outward when lines clear. It reacts to play through brightness, and never
 * through hue.
 *
 * **It does not sweep, and it has no moving lights.** Both were here and both
 * were wrong for the same reason. Every group rotated on Y, which slid the whole
 * background sideways behind a board that is itself the only thing meant to turn
 * -- it read as the camera moving when it was not. And five wide shafts of light
 * drifted and breathed across it, which is a lighting rig rather than a room.
 * What is left holds still: the floaters each bob and turn on their own, which
 * is what floating is, and nothing moves as a body.
 *
 * With one deliberate exception, added when the title screen stopped composing a
 * stack on the board and the room had to carry that picture alone: the drifting
 * voxels take colour from the ramp **on the menus only**, and fade back to
 * neutral for a run. See `setChroma`. They also fade out where they would cross
 * the play column, so a solid cube never shows through an empty cell of a board
 * someone is reading.
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
 * - **Nothing moves in lockstep.** Each floater has its own phase and rate, so
 *   what motion there is never reads as one mechanism.
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
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { BOARD_HEIGHT } from '@core/constants';
import { depthColor } from '@core/spectrum';
import { createRng } from '@core/rng';
import { createFloaterMaterial, GEL_ROUNDNESS, setGelStrength } from './gel';

const BACKDROP_ORDER = -10;

const DUST_INNER_RADIUS = 13;
const DUST_OUTER_RADIUS = 42;
const DUST_COUNT = 520;

const VOXEL_COUNT = 28;
/**
 * How far out the field floats, unchanged from the wireframes it replaces.
 *
 * A previous pass moved them in to 11-30 so more of them landed inside the frame.
 * That was answering a question nobody asked: the note was to make the floaters
 * *voxels*, not to re-stage them. Distance is what makes the field read as a room
 * the board is in rather than as clutter drawn around it.
 */
const VOXEL_INNER_RADIUS = 26;
const VOXEL_OUTER_RADIUS = 48;
/**
 * Half-width of the region the play column occupies on screen, in board units.
 *
 * The widest the board ever projects is its 45-degree diagonal, `√2/2 × 16 / 2`,
 * a little over 5.6 -- so seven clears it at every yaw with room to spare.
 */
const PLAY_COLUMN_HALF_WIDTH = 7;
/**
 * The seed the field is arranged from.
 *
 * Chosen by measuring, not by taste: candidate seeds were scored on how many
 * floaters land inside the frame at a laptop's aspect and at a phone's, and this
 * one puts six on screen at the first and three at the second. The first seed
 * tried put almost nothing on screen at either, which is the whole hazard of
 * composing fourteen items by chance.
 */
const VOXEL_SEED = 'still';
/**
 * The one large floater, and where it sits.
 *
 * Every other cube is scattered; this one is composed. It hangs above the
 * wordmark because that is where the eye arrives, and it is amber because a
 * single warm mass against a field of cool ones is what stops the room reading
 * as one colour with variations.
 */
const HERO_SIZE = 2.3;
const HERO_HUE = 0.17;
const HERO_LEVEL = 1;
const HERO_X = 1.5;
const HERO_Y = 5.2;
/**
 * The band the wordmark occupies, in board units, which the field keeps out of.
 *
 * Measured on screen rather than in the world, which is legitimate here because
 * the front door's camera never moves: screen-x is world x at yaw zero.
 */
const TYPE_HALF_WIDTH = 13;
const TYPE_HALF_HEIGHT = 3.5;
/**
 * Roughly what the orthographic frame covers, in board units.
 *
 * Not exact and does not need to be: it is the spread the field is scattered
 * over, and a floater past the edge is simply one nobody sees. The frame is
 * narrower than this on a phone and about this wide on a laptop.
 */
const FRAME_HALF_WIDTH = 20;
const FRAME_HALF_HEIGHT = 12;
/**
 * What the field is worth while a board is being read.
 *
 * The floaters are a title-screen element that happens to persist into a run, so
 * during play they drop back to roughly the brightness of the wireframes they
 * grew out of -- present, and never competing with the stack for attention.
 */
const PLAY_DIM = 0.2;
/**
 * How long the drifting voxels take to gain or lose their colour.
 *
 * Slow enough that starting a run reads as the room settling rather than as a
 * light being switched off.
 */
const CHROMA_EASE_MS = 700;
const RIPPLE_POOL = 5;
const RIPPLE_LIFE_MS = 950;

const DEBRIS_POOL = 900;
const DEBRIS_LIFE_MS = 780;
const DEBRIS_GRAVITY = 0.000028;
const SPARK_POOL = 420;
const SPARK_LIFE_MS = 220;
const SPARK_GRAVITY = 0.000045;

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

/**
 * Placed from a fixed seed, not from `Math.random`.
 *
 * Fourteen items is a small enough sample that chance composes it badly on a
 * fair number of loads -- every one of them behind the camera, or bunched into
 * one corner, or simply absent from the frame. That is tolerable for debris and
 * not for the only thing on the title screen, and it made two pixel tests
 * intermittent for exactly the same reason: they were measuring a different room
 * each run.
 *
 * A constant seed makes the field an arrangement someone looked at rather than
 * one rolled fresh for every player, and makes it the *same* arrangement the
 * tests and the capture script see.
 */
function voxelField(): THREE.Group {
  const group = new THREE.Group();
  const rng = createRng(VOXEL_SEED);
  for (let i = 0; i < VOXEL_COUNT; i += 1) {
    /*
     * Same silhouette language as the board, not the same glass stack.
     *
     * Floaters used to call `createGelMaterial()` and inherited transmission,
     * clearcoat, and the scene environment map. Bright env lobes read as flat
     * white panes, then bloomed whenever a lock or clear turned the post-process
     * chain on. `createFloaterMaterial` keeps the rounded bevel and gel edge
     * shader, and drops IBL / transmission so the room can never flash with the
     * playfield.
     */
    const hero = i === 0;
    /*
     * Sized near a board cube, deliberately.
     *
     * The gel's masks are object-space -- the bevel starts at a fraction of the
     * cube's own half-width -- so a floater three times a board cube's size shows
     * the same structure three times larger on screen, and what reads as material
     * at thirty pixels reads as a pattern at ninety: a pale body with a saturated
     * square stamped in the middle of it. Keeping them within touching distance
     * of a real cube is what makes them look like the game's cubes rather than
     * like something wearing its material.
     */
    const size = hero ? HERO_SIZE : 0.7 + rng.next() * 1.1;
    const material = createFloaterMaterial();
    const voxel = new THREE.Mesh(
      new RoundedBoxGeometry(size, size, size, 4, GEL_ROUNDNESS * size),
      material
    );
    // Drawn before the board and depth-tested against it, so a floater behind
    // the well is correctly hidden by whatever the player has stacked there.
    voxel.renderOrder = BACKDROP_ORDER;
    voxel.frustumCulled = false;

    /*
     * Aimed into the frame, and never across the wordmark.
     *
     * The distance a floater is dealt is kept; only the direction is chosen. An
     * orthographic camera does not shrink what is far away, so a ring of them at
     * radius 26 to 48 is almost entirely *outside* a frame about nineteen units
     * wide -- the field was there, and the screen was empty. Picking the screen
     * position and solving for depth puts them where they can be seen without
     * bringing them any closer.
     *
     * The masthead is the one part of this screen that has to stay legible, and a
     * floater drifting behind it turns the glow into mush. A seed can be chosen
     * to avoid that on a laptop and will not also avoid it on a phone, so the
     * keep-out is enforced at placement rather than hoped for: a candidate landing
     * in the band gets re-rolled.
     */
    let x = 0;
    let y = 0;
    let z = 0;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const radius = VOXEL_INNER_RADIUS + rng.next() * (VOXEL_OUTER_RADIUS - VOXEL_INNER_RADIUS);
      x = (rng.next() * 2 - 1) * FRAME_HALF_WIDTH;
      y = (rng.next() * 2 - 1) * FRAME_HALF_HEIGHT;
      z = Math.sqrt(Math.max(1, radius * radius - x * x)) * (rng.next() < 0.5 ? -1 : 1);
      const acrossType = Math.abs(x) < TYPE_HALF_WIDTH + size;
      const behindType = Math.abs(y) < TYPE_HALF_HEIGHT + size;
      if (!(acrossType && behindType)) break;
    }
    voxel.position.set(x, y, z);
    voxel.rotation.set(rng.next() * Math.PI, rng.next() * Math.PI, 0);

    // Where on the ramp this one sits, its own brightness, and its own drift, so
    // the field is a scattering rather than a pattern.
    voxel.userData['hue'] = hero ? HERO_HUE : rng.next();
    voxel.userData['level'] = hero ? HERO_LEVEL : 0.55 + rng.next() * 0.4;
    voxel.userData['bob'] = rng.next() * Math.PI * 2;
    voxel.userData['rise'] = 0.5 + rng.next() * 1.4;

    if (hero) {
      // Placed rather than scattered: the one large floater is a composition
      // element, and it belongs above the wordmark where the eye lands first.
      voxel.position.set(HERO_X, HERO_Y, -18);
      voxel.rotation.set(0.42, 0.62, 0);
    }
    voxel.userData['home'] = voxel.position.y;
    group.add(voxel);
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
  private readonly voxels: THREE.Group;
  /** How much of the ramp the drifting voxels are showing, 0 to 1. */
  private chroma = 0;
  private chromaTarget = 0;
  /** Reused so tinting the field allocates nothing per frame. */
  private readonly scratch = new THREE.Color();
  /** Reused for the keep-out test, for the same reason. */
  private readonly worldScratch = new THREE.Vector3();
  private readonly lattice: THREE.LineSegments;
  private readonly ripples: Ripple[] = [];

  private pulse = 0;
  private tension = 0;
  /** 1 while the board is settled and dead-on, 0 at the midpoint of a turn. */
  private flatness = 1;
  private turnDrive = 0;
  /** Free-running clock for the floaters' individual bobbing. */
  private phase = 0;
  private readonly reducedMotion: boolean;
  private readonly intensity: number;

  constructor(reducedMotion: boolean) {
    this.reducedMotion = reducedMotion;
    this.intensity = reducedMotion ? 0.45 : 1;

    this.dustNear = dustCloud(0);
    this.dustFar = dustCloud(2.1);
    this.voxels = voxelField();
    this.lattice = floorLattice();

    // The strobe is gone. It was the photosensitivity risk and the single
    // cheapest-looking thing in the room, and nothing replaced it: a space made
    // of light does not need to flash to feel alive.

    for (let i = 0; i < RIPPLE_POOL; i += 1) this.ripples.push(buildRipple());

    this.group.add(
      this.dustNear,
      this.dustFar,
      this.voxels,
      this.lattice,
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

  /**
   * Let the drifting voxels show the ramp, or take it away again.
   *
   * On for the menus, off for a run, and that gating is the whole reason this is
   * a method rather than a constant. §2.2 reserves hue: a colour on screen means
   * depth from the current camera and nothing else. Coloured cubes drifting past
   * while someone is learning to read the spectrum would be a second colour
   * language with no marker separating it from the first — which is the exact
   * false inference the rule exists to prevent. With no board being read there is
   * nothing to misread, so the room is free to show what the game is made of.
   */
  setChroma(on: boolean): void {
    this.chromaTarget = on ? 1 : 0;
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

    /*
     * The room does not sweep.
     *
     * Every group in here used to rotate on Y -- dust one way, the far dust the
     * other, the floaters a third -- which made the whole background slide
     * sideways behind a board that is itself the only thing meant to turn. It
     * read as the camera moving when it was not. The floaters still move, but
     * each on its own, which is what "floating" means; the field as a body is
     * still.
     */

    // One brightness signal for the whole room. Everything below is a level,
    // never a hue: the room answers the board by getting brighter, not by
    // changing colour.
    const glow = this.pulse + this.tension * 0.3;

    (this.dustNear.material as THREE.PointsMaterial).color.copy(light(0.26 + glow * 0.3));
    (this.dustFar.material as THREE.PointsMaterial).color.copy(light(0.13 + glow * 0.16));
    (this.dustNear.material as THREE.PointsMaterial).size = 1.9 + this.pulse * 1.2;

    /*
     * One field, kept out of the play column.
     *
     * There were briefly two -- wireframes for a run, solid voxels for the menus
     * -- because a solid cube behind the playfield shows through every empty
     * cell, and orthographic projection with an orbiting camera means *no radius
     * keeps a floater out of the well's column*: screen-x is `r·cos(angle − yaw)`
     * and sweeps the full ±r as the board turns.
     *
     * Two fields was the wrong answer to a real problem. The floaters are one
     * thing that happens to be dimmer during a run, not two things; and the
     * problem is not that they are solid, it is that a few of them pass behind
     * the board. So the fix is aimed at the few: a voxel fades out as it crosses
     * the column and back in as it leaves, and only while there is a board to
     * protect. On the menus nothing fades, because there is nothing to read.
     *
     * The keep-out is computed from the *world* position, so the field's own slow
     * rotation is included -- the group turns, and a voxel that was clear a
     * minute ago need not be now.
     */
    this.chroma += Math.min(1, deltaMs / CHROMA_EASE_MS) * (this.chromaTarget - this.chroma);
    // The screen-right vector, matching the camera convention in `scene.ts`.
    const viewYaw = THREE.MathUtils.degToRad(yawDegrees);
    const rightX = Math.cos(viewYaw);
    const rightZ = -Math.sin(viewYaw);

    this.voxels.children.forEach((child) => {
      const voxel = child as THREE.Mesh;
      voxel.getWorldPosition(this.worldScratch);
      const screenX = this.worldScratch.x * rightX + this.worldScratch.z * rightZ;
      // Full strength once a board's width clear of the column, nothing inside
      // it, and a soft ramp between so a turn does not make them blink.
      const clear = THREE.MathUtils.smoothstep(
        Math.abs(screenX),
        PLAY_COLUMN_HALF_WIDTH,
        PLAY_COLUMN_HALF_WIDTH * 2
      );
      const shown = this.chroma + (1 - this.chroma) * clear;
      voxel.visible = shown > 0.01;
      if (!voxel.visible) return;
      const dim = PLAY_DIM + (1 - PLAY_DIM) * this.chroma;
      const own = ((voxel.userData['level'] as number) + glow * 0.4) * shown * dim;
      const { r, g, b } = depthColor(voxel.userData['hue'] as number);

      /*
       * The colour goes straight into the material, which is what the gel's
       * fidelity invariant makes safe: every term the material adds is multiplied
       * by a mask that is exactly zero at the centre of a face, so a floater
       * renders at exactly the colour it is handed there and the bevel, gloss and
       * rim live only at the edges. Scaling the colour therefore scales the cube,
       * rather than fighting the material for control of it.
       */
      const material = voxel.material as THREE.MeshStandardMaterial;
      material.color
        .copy(light(own))
        .lerp(this.scratch.setRGB(r * own, g * own, b * own, THREE.SRGBColorSpace), this.chroma);
      /*
       * The gel's structure is scaled by the floater's *own* brightness, not just
       * by the field's.
       *
       * The bevel, the gloss and the rim are white light added on top of the
       * colour, and they do not scale with it. Dimming a floater to two thirds
       * while leaving those at full turned every cube milky: a pale body with a
       * small saturated square at the centre, which is the fidelity invariant
       * working exactly as designed and being drowned everywhere else on the
       * face. Scaling them together keeps the material's look and the colour.
       */
      setGelStrength(material, Math.min(1, own));
      voxel.rotation.x += step * 0.7;
      voxel.rotation.y += step * 0.4;
      // Floating: a slow rise and fall around where it was placed, each on its
      // own phase so the field never moves as one body.
      voxel.position.y =
        (voxel.userData['home'] as number) +
        Math.sin(
          this.phase * (voxel.userData['rise'] as number) + (voxel.userData['bob'] as number)
        ) *
          1.4;
      voxel.scale.setScalar(1 + this.pulse * 0.1);
    });

    // Nothing at all when the board is dead-on, where this would be a hard white
    // rule rather than a floor. See `floorLattice`.
    (this.lattice.material as THREE.LineBasicMaterial).color.copy(
      light((0.085 + glow * 0.11) * (1 - this.flatness))
    );

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
 * Debris from a line clear: confetti shards of mixed size thrown outward and
 * pulled down, fading over well under a second. Each particle keeps the spectrum
 * colour of the cell it came from -- the board's depth colour being carried
 * away, distinct from the decorative colour of the room.
 *
 * Particles are staggered along the clearing axis, so the burst reads as the
 * line dissolving from one end to the other rather than popping all at once.
 * Size varies per particle so the burst reads as broken gel rather than as a
 * uniform confetti stamp.
 */
export class Debris {
  readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly velocities: Float32Array;
  private readonly ages: Float32Array;
  private readonly scales: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.PointsMaterial;
  private cursor = 0;
  private active = 0;

  constructor() {
    this.positions = new Float32Array(DEBRIS_POOL * 3);
    this.colors = new Float32Array(DEBRIS_POOL * 3);
    this.velocities = new Float32Array(DEBRIS_POOL * 3);
    this.ages = new Float32Array(DEBRIS_POOL).fill(DEBRIS_LIFE_MS);
    this.scales = new Float32Array(DEBRIS_POOL).fill(1);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('aScale', new THREE.BufferAttribute(this.scales, 1));

    this.material = new THREE.PointsMaterial({
      size: 3.6,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>\nattribute float aScale;`
        )
        .replace('gl_PointSize = size;', 'gl_PointSize = size * aScale;');
    };
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
    count: number,
    options: { sizeScale?: number } = {}
  ): void {
    const sizeScale = options.sizeScale ?? 1;
    for (let n = 0; n < count; n += 1) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % DEBRIS_POOL;

      this.positions[i * 3] = x + (Math.random() - 0.5) * 0.6;
      this.positions[i * 3 + 1] = y + (Math.random() - 0.5) * 0.6;
      this.positions[i * 3 + 2] = z + (Math.random() - 0.5) * 0.6;

      const speed = 0.006 + Math.random() * 0.01;
      const dirX = (Math.random() - 0.5) * 1.4;
      const dirY = 0.35 + Math.random();
      const dirZ = (Math.random() - 0.5) * 1.4;
      const len = Math.hypot(dirX, dirY, dirZ) || 1;
      this.velocities[i * 3] = (dirX / len) * speed;
      this.velocities[i * 3 + 1] = (dirY / len) * speed;
      this.velocities[i * 3 + 2] = (dirZ / len) * speed;

      // Slight hue/brightness jitter so a single cell's debris is not a stamp.
      const jitter = 0.92 + Math.random() * 0.16;
      this.colors[i * 3] = Math.min(1.35, rgb.r * jitter);
      this.colors[i * 3 + 1] = Math.min(1.35, rgb.g * jitter);
      this.colors[i * 3 + 2] = Math.min(1.35, rgb.b * jitter);

      // Specks, shards, and chunks — not one square size.
      const roll = Math.random();
      const base =
        roll < 0.35 ? 0.45 + Math.random() * 0.35 : roll < 0.75 ? 0.85 + Math.random() * 0.55 : 1.5 + Math.random() * 1.1;
      this.scales[i] = base * sizeScale;

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
    (this.geometry.getAttribute('aScale') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * Hot white sparks that ride alongside debris — streaks and pin flashes.
 *
 * Streaks are short line segments that trail their velocity; flashes are
 * point sparks that pop and die. Both lean white-hot so they clear the bloom
 * threshold without needing a second depth cue.
 */
export class Sparks {
  readonly group = new THREE.Group();
  private readonly streakPositions: Float32Array;
  private readonly streakColors: Float32Array;
  private readonly streakHeads: Float32Array;
  private readonly streakVels: Float32Array;
  private readonly streakAges: Float32Array;
  private readonly streakLens: Float32Array;
  private readonly flashPositions: Float32Array;
  private readonly flashColors: Float32Array;
  private readonly flashVels: Float32Array;
  private readonly flashAges: Float32Array;
  private readonly flashSizes: Float32Array;
  private readonly flashBaseSizes: Float32Array;
  private readonly streakGeometry: THREE.BufferGeometry;
  private readonly flashGeometry: THREE.BufferGeometry;
  private readonly streakMaterial: THREE.LineBasicMaterial;
  private readonly flashMaterial: THREE.PointsMaterial;
  private readonly streaks: THREE.LineSegments;
  private readonly flashes: THREE.Points;
  private streakCursor = 0;
  private flashCursor = 0;
  private streakActive = 0;
  private flashActive = 0;

  constructor() {
    // Two vertices per streak.
    this.streakPositions = new Float32Array(SPARK_POOL * 6);
    this.streakColors = new Float32Array(SPARK_POOL * 6);
    this.streakHeads = new Float32Array(SPARK_POOL * 3);
    this.streakVels = new Float32Array(SPARK_POOL * 3);
    this.streakAges = new Float32Array(SPARK_POOL).fill(SPARK_LIFE_MS);
    this.streakLens = new Float32Array(SPARK_POOL);

    this.flashPositions = new Float32Array(SPARK_POOL * 3);
    this.flashColors = new Float32Array(SPARK_POOL * 3);
    this.flashVels = new Float32Array(SPARK_POOL * 3);
    this.flashAges = new Float32Array(SPARK_POOL).fill(SPARK_LIFE_MS);
    this.flashSizes = new Float32Array(SPARK_POOL).fill(1);
    this.flashBaseSizes = new Float32Array(SPARK_POOL).fill(1);

    this.streakGeometry = new THREE.BufferGeometry();
    this.streakGeometry.setAttribute('position', new THREE.BufferAttribute(this.streakPositions, 3));
    this.streakGeometry.setAttribute('color', new THREE.BufferAttribute(this.streakColors, 3));
    this.streakMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.streaks = new THREE.LineSegments(this.streakGeometry, this.streakMaterial);
    this.streaks.renderOrder = 4;
    this.streaks.frustumCulled = false;
    this.streaks.visible = false;

    this.flashGeometry = new THREE.BufferGeometry();
    this.flashGeometry.setAttribute('position', new THREE.BufferAttribute(this.flashPositions, 3));
    this.flashGeometry.setAttribute('color', new THREE.BufferAttribute(this.flashColors, 3));
    this.flashGeometry.setAttribute('aScale', new THREE.BufferAttribute(this.flashSizes, 1));
    this.flashMaterial = new THREE.PointsMaterial({
      size: 4.8,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.flashMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nattribute float aScale;`)
        .replace('gl_PointSize = size;', 'gl_PointSize = size * aScale;');
    };
    this.flashes = new THREE.Points(this.flashGeometry, this.flashMaterial);
    this.flashes.renderOrder = 4;
    this.flashes.frustumCulled = false;
    this.flashes.visible = false;

    this.group.add(this.streaks, this.flashes);
  }

  /**
   * Fire sparks from a cell. `along` staggers with the debris dissolve;
   * `intensity` scales count for prism / lock / collapse peaks.
   */
  burst(
    x: number,
    y: number,
    z: number,
    along: number,
    rgb: { r: number; g: number; b: number },
    count: number,
    options: { upward?: boolean; whiteHot?: number; sizeScale?: number } = {}
  ): void {
    const whiteHot = options.whiteHot ?? 0.55;
    const sizeScale = options.sizeScale ?? 1;
    for (let n = 0; n < count; n += 1) {
      const hotR = THREE.MathUtils.lerp(rgb.r, 1, whiteHot) * (1.05 + Math.random() * 0.25);
      const hotG = THREE.MathUtils.lerp(rgb.g, 1, whiteHot) * (1.05 + Math.random() * 0.25);
      const hotB = THREE.MathUtils.lerp(rgb.b, 1, whiteHot) * (1.05 + Math.random() * 0.25);
      const delay = -along * 180 - Math.random() * 40;

      if (Math.random() < 0.55) {
        const i = this.streakCursor;
        this.streakCursor = (this.streakCursor + 1) % SPARK_POOL;
        const speed = 0.014 + Math.random() * 0.028;
        const dirX = (Math.random() - 0.5) * (options.upward ? 0.7 : 1.6);
        const dirY = Math.random() * (options.upward ? 1.8 : 0.7) + (options.upward ? 0.6 : 0.05);
        const dirZ = (Math.random() - 0.5) * (options.upward ? 0.7 : 1.2);
        const len = Math.hypot(dirX, dirY, dirZ) || 1;
        this.streakHeads[i * 3] = x;
        this.streakHeads[i * 3 + 1] = y;
        this.streakHeads[i * 3 + 2] = z;
        this.streakVels[i * 3] = (dirX / len) * speed;
        this.streakVels[i * 3 + 1] = (dirY / len) * speed;
        this.streakVels[i * 3 + 2] = (dirZ / len) * speed;
        this.streakLens[i] = (0.18 + Math.random() * 0.42) * sizeScale;
        this.streakAges[i] = delay;
        for (let v = 0; v < 2; v += 1) {
          this.streakColors[i * 6 + v * 3] = hotR;
          this.streakColors[i * 6 + v * 3 + 1] = hotG;
          this.streakColors[i * 6 + v * 3 + 2] = hotB;
        }
        this.writeStreak(i);
      } else {
        const i = this.flashCursor;
        this.flashCursor = (this.flashCursor + 1) % SPARK_POOL;
        const speed = 0.01 + Math.random() * 0.022;
        this.flashPositions[i * 3] = x + (Math.random() - 0.5) * 0.2;
        this.flashPositions[i * 3 + 1] = y + (Math.random() - 0.5) * 0.2;
        this.flashPositions[i * 3 + 2] = z + (Math.random() - 0.5) * 0.2;
        this.flashVels[i * 3] = (Math.random() - 0.5) * speed;
        this.flashVels[i * 3 + 1] = Math.random() * speed * (options.upward ? 1.4 : 0.8);
        this.flashVels[i * 3 + 2] = (Math.random() - 0.5) * speed;
        this.flashColors[i * 3] = hotR;
        this.flashColors[i * 3 + 1] = hotG;
        this.flashColors[i * 3 + 2] = hotB;
        this.flashSizes[i] = (0.7 + Math.random() * 1.6) * sizeScale;
        this.flashBaseSizes[i] = this.flashSizes[i] as number;
        this.flashAges[i] = delay;
      }
    }
    this.streakActive = SPARK_POOL;
    this.flashActive = SPARK_POOL;
    this.streaks.visible = true;
    this.flashes.visible = true;
  }

  get isActive(): boolean {
    return this.streakActive > 0 || this.flashActive > 0;
  }

  private writeStreak(i: number): void {
    const hx = this.streakHeads[i * 3] as number;
    const hy = this.streakHeads[i * 3 + 1] as number;
    const hz = this.streakHeads[i * 3 + 2] as number;
    const vx = this.streakVels[i * 3] as number;
    const vy = this.streakVels[i * 3 + 1] as number;
    const vz = this.streakVels[i * 3 + 2] as number;
    const speed = Math.hypot(vx, vy, vz) || 1;
    const len = this.streakLens[i] as number;
    this.streakPositions[i * 6] = hx;
    this.streakPositions[i * 6 + 1] = hy;
    this.streakPositions[i * 6 + 2] = hz;
    this.streakPositions[i * 6 + 3] = hx - (vx / speed) * len;
    this.streakPositions[i * 6 + 4] = hy - (vy / speed) * len;
    this.streakPositions[i * 6 + 5] = hz - (vz / speed) * len;
  }

  update(deltaMs: number): void {
    if (!this.isActive) return;
    let streakAlive = 0;
    let flashAlive = 0;

    for (let i = 0; i < SPARK_POOL; i += 1) {
      if ((this.streakAges[i] as number) >= SPARK_LIFE_MS) continue;
      this.streakAges[i] = (this.streakAges[i] as number) + deltaMs;
      const age = this.streakAges[i] as number;
      if (age < 0) {
        streakAlive += 1;
        continue;
      }
      if (age >= SPARK_LIFE_MS) {
        this.streakPositions[i * 6 + 1] = -1000;
        this.streakPositions[i * 6 + 4] = -1000;
        continue;
      }
      streakAlive += 1;
      this.streakVels[i * 3 + 1] = (this.streakVels[i * 3 + 1] as number) - SPARK_GRAVITY * deltaMs;
      this.streakHeads[i * 3] =
        (this.streakHeads[i * 3] as number) + (this.streakVels[i * 3] as number) * deltaMs;
      this.streakHeads[i * 3 + 1] =
        (this.streakHeads[i * 3 + 1] as number) + (this.streakVels[i * 3 + 1] as number) * deltaMs;
      this.streakHeads[i * 3 + 2] =
        (this.streakHeads[i * 3 + 2] as number) + (this.streakVels[i * 3 + 2] as number) * deltaMs;
      const fade = 1 - age / SPARK_LIFE_MS;
      this.streakLens[i] = (this.streakLens[i] as number) * (0.4 + 0.6 * fade);
      this.writeStreak(i);
      for (let v = 0; v < 2; v += 1) {
        this.streakColors[i * 6 + v * 3] = (this.streakColors[i * 6 + v * 3] as number) * (0.92 + 0.08 * fade);
      }
    }

    for (let i = 0; i < SPARK_POOL; i += 1) {
      if ((this.flashAges[i] as number) >= SPARK_LIFE_MS) continue;
      this.flashAges[i] = (this.flashAges[i] as number) + deltaMs;
      const age = this.flashAges[i] as number;
      if (age < 0) {
        flashAlive += 1;
        continue;
      }
      if (age >= SPARK_LIFE_MS) {
        this.flashPositions[i * 3 + 1] = -1000;
        continue;
      }
      flashAlive += 1;
      this.flashVels[i * 3 + 1] = (this.flashVels[i * 3 + 1] as number) - SPARK_GRAVITY * deltaMs;
      this.flashPositions[i * 3] =
        (this.flashPositions[i * 3] as number) + (this.flashVels[i * 3] as number) * deltaMs;
      this.flashPositions[i * 3 + 1] =
        (this.flashPositions[i * 3 + 1] as number) + (this.flashVels[i * 3 + 1] as number) * deltaMs;
      this.flashPositions[i * 3 + 2] =
        (this.flashPositions[i * 3 + 2] as number) + (this.flashVels[i * 3 + 2] as number) * deltaMs;
      const fade = 1 - age / SPARK_LIFE_MS;
      this.flashSizes[i] = (this.flashBaseSizes[i] as number) * (0.35 + 0.65 * fade);
    }

    this.streakActive = streakAlive;
    this.flashActive = flashAlive;
    this.streaks.visible = streakAlive > 0;
    this.flashes.visible = flashAlive > 0;
    (this.streakGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.streakGeometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    (this.flashGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.flashGeometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    (this.flashGeometry.getAttribute('aScale') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.streakGeometry.dispose();
    this.flashGeometry.dispose();
    this.streakMaterial.dispose();
    this.flashMaterial.dispose();
  }
}
