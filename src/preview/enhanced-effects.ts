/**
 * Standalone enhanced effect demos — proposed visual upgrades for preview only.
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { depthColor } from '@core/spectrum';
import { createGelMaterial, GEL_VARIANTS } from './gel-materials';

export type EffectDemoId = 'clear-boost' | 'prism-boost' | 'collapse-boost' | 'lock-boost';

export interface EffectDemo {
  readonly id: EffectDemoId;
  readonly name: string;
  readonly blurb: string;
}

export const EFFECT_DEMOS: readonly EffectDemo[] = [
  {
    id: 'clear-boost',
    name: 'Clear +',
    blurb: 'Staggered line dissolve, chromatic debris, sparks, stronger ripple and bloom.',
  },
  {
    id: 'prism-boost',
    name: 'Full Spectrum +',
    blurb: 'Rainbow shockwave, spectral trails, spark shower, longer whiteout with hue fringe.',
  },
  {
    id: 'collapse-boost',
    name: 'Collapse +',
    blurb: 'Floor fracture flash, debris fountain, welding sparks, camera punch with afterglow.',
  },
  {
    id: 'lock-boost',
    name: 'Lock +',
    blurb: 'Impact ring, radial sparks, gel pulse through locked cells, brief edge bloom.',
  },
] as const;

const ChromaticAberrationShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    amount: { value: 0.0035 as number },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float amount;
    varying vec2 vUv;
    void main() {
      vec2 dir = (vUv - 0.5) * amount;
      float r = texture2D(tDiffuse, vUv + dir).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - dir).b;
      gl_FragColor = vec4(r, g, b, 1.0);
    }
  `,
};

type ParticleShape = 'shard' | 'sliver' | 'speck' | 'chunk';

type SparkKind = 'streak' | 'flash' | 'arc';

interface SparkProfile {
  readonly count: number;
  readonly kinds: readonly SparkKind[];
  readonly speedMin: number;
  readonly speedMax: number;
  readonly lifeMin: number;
  readonly lifeMax: number;
  readonly lengthMin: number;
  readonly lengthMax: number;
  readonly drag: number;
  readonly gravity: number;
  readonly spreadX: number;
  readonly spreadY: number;
  readonly spreadZ: number;
  readonly whiteMix: number;
  readonly upwardBias?: number;
  readonly hueJitter?: number;
}

interface Spark {
  object: THREE.Line | THREE.Points;
  kind: SparkKind;
  head: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  length: number;
  baseOpacity: number;
  drag: number;
  gravity: number;
  dispose(): void;
}

interface ParticleProfile {
  readonly count: number;
  readonly shapes: readonly ParticleShape[];
  readonly sizeMin: number;
  readonly sizeMax: number;
  readonly lifeMin: number;
  readonly lifeMax: number;
  readonly speedMin: number;
  readonly speedMax: number;
  readonly spinMin: number;
  readonly spinMax: number;
  readonly drag: number;
  readonly gravity: number;
  readonly upwardBias?: number;
  readonly spreadX: number;
  readonly spreadY: number;
  readonly spreadZ: number;
  readonly hueJitter?: number;
  readonly lightnessJitter?: number;
}

interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
  maxLife: number;
  baseOpacity: number;
  drag: number;
  gravity: number;
}

const PARTICLE_PROFILES: Record<EffectDemoId, ParticleProfile> = {
  'clear-boost': {
    count: 7,
    shapes: ['sliver', 'shard', 'speck'],
    sizeMin: 0.04,
    sizeMax: 0.22,
    lifeMin: 420,
    lifeMax: 920,
    speedMin: 0.08,
    speedMax: 0.28,
    spinMin: 0.002,
    spinMax: 0.012,
    drag: 0.9992,
    gravity: 0.00028,
    spreadX: 0.32,
    spreadY: 0.14,
    spreadZ: 0.12,
    hueJitter: 0.02,
  },
  'prism-boost': {
    count: 5,
    shapes: ['shard', 'chunk', 'speck', 'sliver'],
    sizeMin: 0.05,
    sizeMax: 0.26,
    lifeMin: 520,
    lifeMax: 1100,
    speedMin: 0.1,
    speedMax: 0.34,
    spinMin: 0.003,
    spinMax: 0.016,
    drag: 0.999,
    gravity: 0.00022,
    spreadX: 0.38,
    spreadY: 0.22,
    spreadZ: 0.28,
    hueJitter: 0.08,
    lightnessJitter: 0.06,
  },
  'collapse-boost': {
    count: 3,
    shapes: ['chunk', 'shard', 'speck'],
    sizeMin: 0.06,
    sizeMax: 0.34,
    lifeMin: 680,
    lifeMax: 1400,
    speedMin: 0.12,
    speedMax: 0.42,
    spinMin: 0.001,
    spinMax: 0.009,
    drag: 0.9994,
    gravity: 0.00018,
    upwardBias: 0.28,
    spreadX: 0.22,
    spreadY: 0.36,
    spreadZ: 0.18,
    hueJitter: 0.04,
  },
  'lock-boost': {
    count: 12,
    shapes: ['speck', 'sliver', 'shard'],
    sizeMin: 0.03,
    sizeMax: 0.16,
    lifeMin: 280,
    lifeMax: 620,
    speedMin: 0.06,
    speedMax: 0.2,
    spinMin: 0.004,
    spinMax: 0.02,
    drag: 0.9988,
    gravity: 0.00032,
    spreadX: 0.24,
    spreadY: 0.18,
    spreadZ: 0.24,
    lightnessJitter: 0.08,
  },
};

const SPARK_PROFILES: Record<EffectDemoId, SparkProfile> = {
  'clear-boost': {
    count: 10,
    kinds: ['streak', 'flash'],
    speedMin: 0.28,
    speedMax: 0.62,
    lifeMin: 90,
    lifeMax: 240,
    lengthMin: 0.18,
    lengthMax: 0.52,
    drag: 0.992,
    gravity: 0.00042,
    spreadX: 0.55,
    spreadY: 0.12,
    spreadZ: 0.1,
    whiteMix: 0.92,
    hueJitter: 0.03,
  },
  'prism-boost': {
    count: 8,
    kinds: ['streak', 'flash', 'arc'],
    speedMin: 0.32,
    speedMax: 0.78,
    lifeMin: 70,
    lifeMax: 210,
    lengthMin: 0.22,
    lengthMax: 0.68,
    drag: 0.991,
    gravity: 0.00035,
    spreadX: 0.62,
    spreadY: 0.28,
    spreadZ: 0.42,
    whiteMix: 0.96,
    hueJitter: 0.1,
  },
  'collapse-boost': {
    count: 6,
    kinds: ['arc', 'streak', 'flash'],
    speedMin: 0.38,
    speedMax: 0.95,
    lifeMin: 110,
    lifeMax: 320,
    lengthMin: 0.28,
    lengthMax: 0.82,
    drag: 0.993,
    gravity: 0.00028,
    spreadX: 0.38,
    spreadY: 0.52,
    spreadZ: 0.24,
    whiteMix: 0.94,
    upwardBias: 0.42,
    hueJitter: 0.05,
  },
  'lock-boost': {
    count: 14,
    kinds: ['streak', 'flash'],
    speedMin: 0.34,
    speedMax: 0.88,
    lifeMin: 60,
    lifeMax: 180,
    lengthMin: 0.14,
    lengthMax: 0.46,
    drag: 0.988,
    gravity: 0.00048,
    spreadX: 0.48,
    spreadY: 0.22,
    spreadZ: 0.48,
    whiteMix: 0.98,
  },
};

const pick = <T,>(values: readonly T[]): T => values[Math.floor(Math.random() * values.length)]!;

const rand = (min: number, max: number): number => min + Math.random() * (max - min);

function particleGeometry(shape: ParticleShape, size: number): THREE.BufferGeometry {
  switch (shape) {
    case 'speck':
      return new THREE.TetrahedronGeometry(size * 0.55, 0);
    case 'sliver':
      return new THREE.BoxGeometry(size * 0.22, size * 1.4, size * 0.18);
    case 'chunk':
      return new THREE.BoxGeometry(size * 0.95, size * 0.82, size * 0.88);
    case 'shard':
    default:
      return new THREE.BoxGeometry(size * 1.1, size * 0.42, size * 0.28);
  }
}

function jitterColor(base: THREE.Color, profile: ParticleProfile): THREE.Color {
  const out = base.clone();
  if (profile.hueJitter) {
    const hsl = { h: 0, s: 0, l: 0 };
    out.getHSL(hsl);
    out.setHSL(
      (hsl.h + (Math.random() - 0.5) * profile.hueJitter + 1) % 1,
      THREE.MathUtils.clamp(hsl.s + (Math.random() - 0.5) * 0.08, 0.35, 1),
      hsl.l
    );
  }
  if (profile.lightnessJitter) {
    const hsl = { h: 0, s: 0, l: 0 };
    out.getHSL(hsl);
    out.setHSL(hsl.h, hsl.s, THREE.MathUtils.clamp(hsl.l + (Math.random() - 0.5) * profile.lightnessJitter, 0.2, 0.95));
  }
  return out;
}

function sparkColor(base: THREE.Color, profile: SparkProfile): THREE.Color {
  const out = base.clone();
  if (profile.hueJitter) {
    const hsl = { h: 0, s: 0, l: 0 };
    out.getHSL(hsl);
    out.setHSL((hsl.h + (Math.random() - 0.5) * profile.hueJitter + 1) % 1, hsl.s, hsl.l);
  }
  if (profile.whiteMix > 0) {
    out.lerp(new THREE.Color(1, 1, 1), profile.whiteMix + Math.random() * 0.05);
  }
  // Push past 1 so additive sparks clear the bloom threshold and read as hot.
  out.multiplyScalar(1.85 + Math.random() * 0.45);
  return out;
}

function makeSpark(
  kind: SparkKind,
  origin: THREE.Vector3,
  velocity: THREE.Vector3,
  length: number,
  color: THREE.Color,
  opacity: number
): Spark {
  if (kind === 'flash') {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(origin.toArray(), 3));
    const material = new THREE.PointsMaterial({
      color,
      size: rand(3.6, 7.2),
      sizeAttenuation: false,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const object = new THREE.Points(geometry, material);
    return {
      object,
      kind,
      head: origin.clone(),
      velocity: velocity.clone(),
      life: 0,
      maxLife: 0,
      length: 0,
      baseOpacity: opacity,
      drag: 0,
      gravity: 0,
      dispose() {
        geometry.dispose();
        material.dispose();
      },
    };
  }

  const head = origin.clone();
  const tail = origin.clone().addScaledVector(velocity.clone().normalize(), -length);
  const geometry = new THREE.BufferGeometry().setFromPoints([head, tail]);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    linewidth: 1,
  });
  const object = new THREE.Line(geometry, material);
  return {
    object,
    kind,
    head: origin.clone(),
    velocity: velocity.clone(),
    life: 0,
    maxLife: 0,
    length,
    baseOpacity: opacity,
    drag: 0,
    gravity: 0,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

function updateSparkGeometry(spark: Spark, head: THREE.Vector3, tail: THREE.Vector3): void {
  if (spark.object instanceof THREE.Points) {
    const attr = spark.object.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.setXYZ(0, head.x, head.y, head.z);
    attr.needsUpdate = true;
    return;
  }
  const attr = spark.object.geometry.getAttribute('position') as THREE.BufferAttribute;
  attr.setXYZ(0, head.x, head.y, head.z);
  attr.setXYZ(1, tail.x, tail.y, tail.z);
  attr.needsUpdate = true;
  spark.object.geometry.computeBoundingSphere();
}

export class EnhancedEffectsShowcase {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly chromaPass: ShaderPass;
  private readonly board: THREE.Group;
  private readonly particles: Particle[] = [];
  private readonly sparks: Spark[] = [];
  private readonly scratchTail = new THREE.Vector3();
  private elapsed = 0;
  private demoElapsed = 9999;
  private activeDemo: EffectDemoId | null = null;
  private whiteout = 0;
  private shake = 0;
  private ripple: THREE.Mesh | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.scene.background = new THREE.Color(0x05060a);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.32, 0.28, 0.92);
    this.composer.addPass(this.bloomPass);
    this.chromaPass = new ShaderPass(ChromaticAberrationShader);
    this.composer.addPass(this.chromaPass);
    this.composer.addPass(new OutputPass());

    this.scene.add(new THREE.AmbientLight(0xffffff, Math.PI * 0.6));
    const key = new THREE.DirectionalLight(0xffffff, Math.PI * 0.9);
    key.position.set(8, 14, 10);
    this.scene.add(key);

    this.board = this.buildBoard();
    this.scene.add(this.board);
    this.camera.position.set(0, 0, 50);
    this.camera.lookAt(0, 0, 0);
  }

  private buildBoard(): THREE.Group {
    const group = new THREE.Group();
    const variant = GEL_VARIANTS.find((v) => v.id === 'neon-edge') ?? GEL_VARIANTS[4]!;
    const geometry = new RoundedBoxGeometry(1, 1, 1, 4, variant.roundness);
    const baseMaterial = createGelMaterial(variant);

    for (let x = 0; x < 8; x += 1) {
      for (let z = 0; z < 3; z += 1) {
        for (let y = 0; y < 4; y += 1) {
          if (y > 1 + (x % 2)) continue;
          const mesh = new THREE.Mesh(geometry, baseMaterial.clone());
          mesh.scale.setScalar(0.9);
          mesh.position.set(x - 3.5, y - 1.5, z - 1);
          const t = (x + z * 8 + y * 2) / 40;
          const rgb = depthColor(t);
          (mesh.material as THREE.MeshStandardMaterial).color.setRGB(rgb.r, rgb.g, rgb.b);
          mesh.userData.baseY = mesh.position.y;
          mesh.userData.depth = t;
          group.add(mesh);
        }
      }
    }
    return group;
  }

  fire(id: EffectDemoId): void {
    this.activeDemo = id;
    this.demoElapsed = 0;
    this.whiteout = 0;
    this.shake = 0;
    this.clearParticles();
    this.clearRipple();

    switch (id) {
      case 'clear-boost':
        this.spawnLineClear();
        this.shake = 0.55;
        break;
      case 'prism-boost':
        this.whiteout = 1;
        this.spawnPrismWave();
        this.shake = 1;
        break;
      case 'collapse-boost':
        this.whiteout = 0.85;
        this.spawnCollapseFountain();
        this.shake = 1;
        break;
      case 'lock-boost':
        this.spawnLockPulse();
        this.shake = 0.35;
        break;
      default:
        break;
    }
  }

  private spawnLineClear(): void {
    const row = this.board.children.filter((c) => c instanceof THREE.Mesh && c.position.y > 0.4);
    const debris = PARTICLE_PROFILES['clear-boost'];
    const sparks = SPARK_PROFILES['clear-boost'];
    row.forEach((mesh, index) => {
      if (!(mesh instanceof THREE.Mesh)) return;
      const delay = index * 45;
      window.setTimeout(() => {
        const biasX = (index / Math.max(row.length - 1, 1) - 0.5) * 0.18;
        this.burstFrom(mesh.position, mesh.userData.depth as number, debris, { biasX });
        this.sparkFrom(mesh.position, mesh.userData.depth as number, sparks, { biasX });
        mesh.visible = false;
      }, delay);
    });
    this.addRipple(0x88ccff, 1.4, 0.55);
  }

  private spawnPrismWave(): void {
    const debris = PARTICLE_PROFILES['prism-boost'];
    const sparks = SPARK_PROFILES['prism-boost'];
    for (const child of this.board.children) {
      if (!(child instanceof THREE.Mesh)) continue;
      this.burstFrom(child.position, child.userData.depth as number, debris);
      this.sparkFrom(child.position, child.userData.depth as number, sparks);
    }
    this.addRipple(0xffffff, 2.4, 0.75);
    this.bloomPass.strength = 0.92;
    this.chromaPass.uniforms['amount']!.value = 0.0045;
  }

  private spawnCollapseFountain(): void {
    const debris = PARTICLE_PROFILES['collapse-boost'];
    const sparks = SPARK_PROFILES['collapse-boost'];
    for (let i = 0; i < 52; i += 1) {
      const x = (Math.random() - 0.5) * 7;
      const z = (Math.random() - 0.5) * 2.5;
      const origin = new THREE.Vector3(x, -2.2, z);
      this.burstFrom(origin, Math.random(), debris, { upward: true });
      if (i % 2 === 0) this.sparkFrom(origin, Math.random(), sparks, { upward: true });
    }
    this.addRipple(0xffffff, 3.2, 0.9);
    this.bloomPass.strength = 0.78;
  }

  private spawnLockPulse(): void {
    const target = this.board.children.find((c) => c instanceof THREE.Mesh && c.position.y < 0);
    const debris = PARTICLE_PROFILES['lock-boost'];
    const sparks = SPARK_PROFILES['lock-boost'];
    if (target instanceof THREE.Mesh) {
      for (let ring = 0; ring < 3; ring += 1) {
        const angle = (ring / 3) * Math.PI * 2;
        const offset = new THREE.Vector3(Math.cos(angle) * 0.35, 0.15, Math.sin(angle) * 0.35);
        const origin = target.position.clone().add(offset);
        this.burstFrom(origin, target.userData.depth as number, debris);
        this.sparkFrom(origin, target.userData.depth as number, sparks);
      }
      this.sparkFrom(target.position, target.userData.depth as number, sparks, { burstScale: 1.35 });
      const mat = target.material as THREE.MeshStandardMaterial;
      const base = mat.emissive.clone();
      mat.emissive.setRGB(1, 1, 1);
      mat.emissiveIntensity = 0.35;
      window.setTimeout(() => {
        mat.emissive.copy(base);
        mat.emissiveIntensity = 0;
      }, 420);
    }
    this.addRipple(0xaaccff, 0.9, 0.35);
    this.bloomPass.strength = 0.62;
  }

  private sparkFrom(
    origin: THREE.Vector3,
    depth: number,
    profile: SparkProfile,
    options: { upward?: boolean; biasX?: number; burstScale?: number } = {}
  ): void {
    const rgb = depthColor(depth);
    const baseColor = new THREE.Color(rgb.r, rgb.g, rgb.b);
    const count = Math.round(profile.count * (options.burstScale ?? 1));

    for (let i = 0; i < count; i += 1) {
      const kind = pick(profile.kinds);
      const speed = rand(profile.speedMin, profile.speedMax);
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * profile.spreadX + (options.biasX ?? 0),
        Math.random() * profile.spreadY + (options.upward ? profile.upwardBias ?? 0.22 : 0.02),
        (Math.random() - 0.5) * profile.spreadZ
      );
      if (kind === 'arc') {
        velocity.y += rand(0.12, 0.32);
        velocity.x *= 0.65;
        velocity.z *= 0.65;
      }
      if (velocity.lengthSq() > 0) velocity.normalize().multiplyScalar(speed);

      const length = rand(profile.lengthMin, profile.lengthMax);
      const color = sparkColor(baseColor, profile);
      const opacity = rand(0.92, 1);
      const spark = makeSpark(kind, origin, velocity, length, color, opacity);
      spark.maxLife = rand(profile.lifeMin, profile.lifeMax);
      spark.drag = profile.drag;
      spark.gravity = profile.gravity;
      this.scene.add(spark.object);
      this.sparks.push(spark);
    }
  }

  private burstFrom(
    origin: THREE.Vector3,
    depth: number,
    profile: ParticleProfile,
    options: { upward?: boolean; biasX?: number } = {}
  ): void {
    const rgb = depthColor(depth);
    const baseColor = new THREE.Color(rgb.r, rgb.g, rgb.b);

    for (let i = 0; i < profile.count; i += 1) {
      const shape = pick(profile.shapes);
      const size = rand(profile.sizeMin, profile.sizeMax);
      const geometry = particleGeometry(shape, size);
      const color = jitterColor(baseColor, profile);
      const opacity = rand(0.55, 0.98);
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.position.copy(origin);
      mesh.rotation.set(rand(0, Math.PI), rand(0, Math.PI), rand(0, Math.PI));

      const speed = rand(profile.speedMin, profile.speedMax);
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * profile.spreadX + (options.biasX ?? 0),
        Math.random() * profile.spreadY + (options.upward ? profile.upwardBias ?? 0.18 : 0.04),
        (Math.random() - 0.5) * profile.spreadZ
      );
      if (velocity.lengthSq() > 0) velocity.normalize().multiplyScalar(speed);

      const spin = rand(profile.spinMin, profile.spinMax);
      const spinAxis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
      if (spinAxis.lengthSq() > 0) spinAxis.normalize().multiplyScalar(spin);

      this.scene.add(mesh);
      this.particles.push({
        mesh,
        velocity,
        spin: spinAxis,
        life: 0,
        maxLife: rand(profile.lifeMin, profile.lifeMax),
        baseOpacity: opacity,
        drag: profile.drag,
        gravity: profile.gravity,
      });
    }
  }

  private addRipple(color: number, scale: number, peak: number): void {
    const geo = new THREE.RingGeometry(0.2, 0.35, 48);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: peak,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -2.4;
    ring.scale.setScalar(scale);
    ring.userData.peak = peak;
    this.ripple = ring;
    this.scene.add(ring);
  }

  private clearRipple(): void {
    if (this.ripple) {
      this.ripple.geometry.dispose();
      (this.ripple.material as THREE.Material).dispose();
      this.scene.remove(this.ripple);
      this.ripple = null;
    }
  }

  private clearParticles(): void {
    for (const p of this.particles) {
      p.mesh.geometry.dispose();
      (p.mesh.material as THREE.Material).dispose();
      this.scene.remove(p.mesh);
    }
    this.particles.length = 0;
    for (const spark of this.sparks) {
      spark.dispose();
      this.scene.remove(spark.object);
    }
    this.sparks.length = 0;
    for (const child of this.board.children) {
      if (child instanceof THREE.Mesh) child.visible = true;
    }
  }

  resize(): void {
    const width = this.renderer.domElement.clientWidth;
    const height = this.renderer.domElement.clientHeight;
    if (width <= 0 || height <= 0) return;
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    const aspect = width / height;
    const frustum = 7.5;
    this.camera.left = -frustum * aspect;
    this.camera.right = frustum * aspect;
    this.camera.top = frustum;
    this.camera.bottom = -frustum;
    this.camera.updateProjectionMatrix();
  }

  update(deltaMs: number): void {
    this.elapsed += deltaMs;
    if (this.activeDemo) this.demoElapsed += deltaMs;

    const decay = Math.exp(-deltaMs / 380);
    this.shake *= decay;
    if (this.whiteout > 0) this.whiteout *= Math.exp(-deltaMs / (this.activeDemo === 'prism-boost' ? 520 : 280));

    this.board.rotation.y = Math.sin(this.elapsed * 0.00018) * 0.12;
    const shakeX = Math.sin(this.demoElapsed * 0.09) * this.shake * 0.35;
    const shakeY = Math.sin(this.demoElapsed * 0.113) * this.shake * 0.25;
    this.camera.position.x = shakeX;
    this.camera.position.y = shakeY;

    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const p = this.particles[i]!;
      p.life += deltaMs;
      p.velocity.y -= p.gravity * deltaMs;
      p.velocity.multiplyScalar(Math.pow(p.drag, deltaMs / 16));
      p.mesh.position.addScaledVector(p.velocity, deltaMs * 0.06);
      p.mesh.rotation.x += p.spin.x * deltaMs;
      p.mesh.rotation.y += p.spin.y * deltaMs;
      p.mesh.rotation.z += p.spin.z * deltaMs;
      const fade = 1 - p.life / p.maxLife;
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = fade * p.baseOpacity;
      if (p.life >= p.maxLife) {
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        this.scene.remove(p.mesh);
        this.particles.splice(i, 1);
      }
    }

    for (let i = this.sparks.length - 1; i >= 0; i -= 1) {
      const spark = this.sparks[i]!;
      spark.life += deltaMs;
      spark.velocity.y -= spark.gravity * deltaMs;
      spark.velocity.multiplyScalar(Math.pow(spark.drag, deltaMs / 16));
      spark.head.addScaledVector(spark.velocity, deltaMs * 0.06);

      const fade = 1 - spark.life / spark.maxLife;
      const opacity = fade * spark.baseOpacity;
      if (spark.kind === 'flash') {
        const material = spark.object.material as THREE.PointsMaterial;
        material.opacity = opacity;
        updateSparkGeometry(spark, spark.head, spark.head);
        material.size = THREE.MathUtils.lerp(material.size, 0.5, 1 - fade);
      } else {
        const material = spark.object.material as THREE.LineBasicMaterial;
        material.opacity = opacity;
        const trail = spark.velocity.clone();
        if (trail.lengthSq() > 0) trail.normalize();
        const trailLen = spark.length * (0.35 + fade * 0.65);
        this.scratchTail.copy(spark.head).addScaledVector(trail, -trailLen);
        updateSparkGeometry(spark, spark.head, this.scratchTail);
      }

      if (spark.life >= spark.maxLife) {
        spark.dispose();
        this.scene.remove(spark.object);
        this.sparks.splice(i, 1);
      }
    }

    if (this.ripple) {
      const t = this.demoElapsed / 900;
      const scale = 1 + t * 3.5;
      this.ripple.scale.setScalar(scale * (this.ripple.userData.peak as number));
      (this.ripple.material as THREE.MeshBasicMaterial).opacity =
        (this.ripple.userData.peak as number) * Math.max(0, 1 - t);
      if (t > 1) this.clearRipple();
    }

    this.bloomPass.strength = THREE.MathUtils.lerp(this.bloomPass.strength, 0.32, 0.02);
    this.chromaPass.uniforms['amount']!.value = THREE.MathUtils.lerp(
      this.chromaPass.uniforms['amount']!.value as number,
      0.002,
      0.03
    );

    if (this.demoElapsed > 4000) {
      this.activeDemo = null;
      this.clearParticles();
    }
  }

  render(): void {
    this.composer.render();
    if (this.whiteout > 0.02) {
      const ctx = this.renderer.getContext();
      ctx.enable(ctx.BLEND);
      ctx.blendFunc(ctx.SRC_ALPHA, ctx.ONE_MINUS_SRC_ALPHA);
      // Screen-space white flash overlay via canvas 2D would need a second pass;
      // approximate with renderer clear color flash on the DOM parent instead in lab.
    }
  }

  get whiteoutLevel(): number {
    return this.whiteout;
  }

  dispose(): void {
    this.clearParticles();
    this.clearRipple();
    for (const child of this.board.children) {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        child.material.dispose();
      }
    }
    this.composer.dispose();
    this.renderer.dispose();
  }
}
