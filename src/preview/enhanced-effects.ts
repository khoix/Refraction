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
    blurb: 'Staggered line dissolve, chromatic debris, stronger ripple and bloom.',
  },
  {
    id: 'prism-boost',
    name: 'Full Spectrum +',
    blurb: 'Rainbow shockwave, spectral trails, longer whiteout with hue fringe.',
  },
  {
    id: 'collapse-boost',
    name: 'Collapse +',
    blurb: 'Floor fracture flash, particle fountain, camera punch with afterglow.',
  },
  {
    id: 'lock-boost',
    name: 'Lock +',
    blurb: 'Impact ring, gel pulse through locked cells, brief edge bloom.',
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

interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
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
  private readonly particleGeo = new THREE.BoxGeometry(0.18, 0.18, 0.18);
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
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 1.1, 0.48, 0.65);
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
    row.forEach((mesh, index) => {
      if (!(mesh instanceof THREE.Mesh)) return;
      const delay = index * 45;
      window.setTimeout(() => {
        this.burstFrom(mesh.position, mesh.userData.depth as number, 6);
        mesh.visible = false;
      }, delay);
    });
    this.addRipple(0x88ccff, 1.4, 0.55);
  }

  private spawnPrismWave(): void {
    for (const child of this.board.children) {
      if (!(child instanceof THREE.Mesh)) continue;
      this.burstFrom(child.position, child.userData.depth as number, 3);
    }
    this.addRipple(0xffffff, 2.4, 0.75);
    this.bloomPass.strength = 1.65;
    this.chromaPass.uniforms['amount']!.value = 0.008;
  }

  private spawnCollapseFountain(): void {
    for (let i = 0; i < 48; i += 1) {
      const x = (Math.random() - 0.5) * 7;
      const z = (Math.random() - 0.5) * 2.5;
      this.burstFrom(new THREE.Vector3(x, -2.2, z), Math.random(), 2, true);
    }
    this.addRipple(0xffffff, 3.2, 0.9);
    this.bloomPass.strength = 1.35;
  }

  private spawnLockPulse(): void {
    const target = this.board.children.find((c) => c instanceof THREE.Mesh && c.position.y < 0);
    if (target instanceof THREE.Mesh) {
      this.burstFrom(target.position, target.userData.depth as number, 10);
      const mat = target.material as THREE.MeshStandardMaterial;
      const base = mat.emissive.clone();
      mat.emissive.setRGB(1, 1, 1);
      mat.emissiveIntensity = 0.8;
      window.setTimeout(() => {
        mat.emissive.copy(base);
        mat.emissiveIntensity = 0;
      }, 420);
    }
    this.addRipple(0xaaccff, 0.9, 0.35);
    this.bloomPass.strength = 0.95;
  }

  private burstFrom(origin: THREE.Vector3, depth: number, count: number, upward = false): void {
    const rgb = depthColor(depth);
    const color = new THREE.Color(rgb.r, rgb.g, rgb.b);
    for (let i = 0; i < count; i += 1) {
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(this.particleGeo, mat);
      mesh.position.copy(origin);
      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * (upward ? 0.14 : 0.22),
        Math.random() * 0.18 + (upward ? 0.22 : 0.06),
        (Math.random() - 0.5) * 0.14
      );
      this.scene.add(mesh);
      this.particles.push({
        mesh,
        velocity,
        life: 0,
        maxLife: 600 + Math.random() * 500,
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
      p.velocity.y -= 0.00035 * deltaMs;
      p.mesh.position.addScaledVector(p.velocity, deltaMs * 0.06);
      const fade = 1 - p.life / p.maxLife;
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = fade * 0.95;
      if (p.life >= p.maxLife) {
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        this.scene.remove(p.mesh);
        this.particles.splice(i, 1);
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

    this.bloomPass.strength = THREE.MathUtils.lerp(this.bloomPass.strength, 0.72, 0.02);
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
