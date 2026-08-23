/**
 * Turntable grid comparing gel material variants side by side.
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SPECTRUM_STOPS, depthColor } from '@core/spectrum';
import { createGelMaterial, GEL_VARIANTS, setPreviewGelYaw, type GelVariant } from './gel-materials';

const CUBE_GAP = 0.88;
const GRID_COLS = 3;
const GRID_ROWS = 2;

interface VariantSlot {
  readonly variant: GelVariant;
  readonly group: THREE.Group;
  readonly cubes: THREE.Mesh[];
}

export class GelShowcase {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly slots: VariantSlot[] = [];
  private readonly keyLight: THREE.DirectionalLight;
  private readonly fillLight: THREE.DirectionalLight;
  private readonly rimLight: THREE.DirectionalLight;
  private elapsed = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.scene.background = new THREE.Color(0x05060a);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.72, 0.55, 0.45);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    this.scene.add(new THREE.AmbientLight(0xffffff, Math.PI * 0.55));

    this.keyLight = new THREE.DirectionalLight(0xffffff, Math.PI * 0.85);
    this.fillLight = new THREE.DirectionalLight(0xd8e4ff, Math.PI * 0.28);
    this.rimLight = new THREE.DirectionalLight(0xffffff, Math.PI * 0.42);
    this.scene.add(this.keyLight, this.fillLight, this.rimLight);

    this.buildGrid();
    this.orientLights(18);
    setPreviewGelYaw(18);
  }

  private buildGrid(): void {
    const cellW = 4.2;
    const cellH = 4.6;
    const originX = -((GRID_COLS - 1) * cellW) / 2;
    const originY = ((GRID_ROWS - 1) * cellH) / 2;

    GEL_VARIANTS.forEach((variant, index) => {
      const col = index % GRID_COLS;
      const row = Math.floor(index / GRID_COLS);
      const group = new THREE.Group();
      group.position.set(originX + col * cellW, originY - row * cellH, 0);

      const cubes = this.buildCluster(variant);
      for (const cube of cubes) group.add(cube);

      this.slots.push({ variant, group, cubes });
      this.scene.add(group);
    });
  }

  /** A small 2×2×2 stack — enough to read translucency where cubes overlap. */
  private buildCluster(variant: GelVariant): THREE.Mesh[] {
    const geometry = new RoundedBoxGeometry(1, 1, 1, 4, variant.roundness);
    const material = createGelMaterial(variant);
    const cubes: THREE.Mesh[] = [];

    const offsets: readonly [number, number, number][] = [
      [0, 0, 0],
      [1.05, 0, 0],
      [0, 1.05, 0],
      [1.05, 1.05, 0],
      [0.52, 0.52, 1.05],
      [1.57, 0.52, 1.05],
      [0.52, 1.57, 1.05],
      [1.57, 1.57, 1.05],
    ];

    offsets.forEach(([x, y, z], i) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.scale.setScalar(CUBE_GAP);
      mesh.position.set(x - 0.78, y - 0.78, z - 0.52);
      const stop = SPECTRUM_STOPS[Math.min(i % SPECTRUM_STOPS.length, SPECTRUM_STOPS.length - 1)]!;
      const rgb = depthColor(stop.t);
      const color = new THREE.Color(rgb.r, rgb.g, rgb.b);
      mesh.material = material.clone();
      (mesh.material as THREE.MeshStandardMaterial).color.copy(color);
      cubes.push(mesh);
    });

    groupCentre(cubes);
    return cubes;
  }

  private orientLights(yawDegrees: number): void {
    const yaw = THREE.MathUtils.degToRad(yawDegrees);
    const pitch = THREE.MathUtils.degToRad(14);
    const dist = 28;
    this.keyLight.position.set(
      Math.sin(yaw + 0.4) * Math.cos(pitch) * dist,
      Math.sin(pitch) * dist + 6,
      Math.cos(yaw + 0.4) * Math.cos(pitch) * dist
    );
    this.fillLight.position.set(
      Math.sin(yaw - 1.2) * dist * 0.7,
      4,
      Math.cos(yaw - 1.2) * dist * 0.7
    );
    this.rimLight.position.set(
      -Math.sin(yaw) * dist,
      8,
      -Math.cos(yaw) * dist
    );
    setPreviewGelYaw(yawDegrees);
  }

  setBloom(strength: number, threshold: number): void {
    this.bloomPass.strength = strength;
    this.bloomPass.threshold = threshold;
  }

  highlightVariant(id: string | null): void {
    for (const slot of this.slots) {
      const dim = id !== null && slot.variant.id !== id;
      for (const cube of slot.cubes) {
        const mat = cube.material as THREE.MeshStandardMaterial;
        mat.opacity = dim ? slot.variant.opacity * 0.35 : slot.variant.opacity;
        mat.transparent = mat.opacity < 1;
      }
    }
  }

  resize(): void {
    const width = this.renderer.domElement.clientWidth;
    const height = this.renderer.domElement.clientHeight;
    if (width <= 0 || height <= 0) return;
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);

    const aspect = width / height;
    const frustum = 11.5;
    this.camera.left = -frustum * aspect;
    this.camera.right = frustum * aspect;
    this.camera.top = frustum;
    this.camera.bottom = -frustum;
    this.camera.position.set(0, 0, 42);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
  }

  update(deltaMs: number): void {
    this.elapsed += deltaMs;
    const yaw = 14 + Math.sin(this.elapsed * 0.00022) * 10;
    this.orientLights(yaw);

    for (const slot of this.slots) {
      slot.group.rotation.y = Math.sin(this.elapsed * 0.00035 + slot.variant.id.length) * 0.08;
      slot.group.rotation.x = Math.sin(this.elapsed * 0.00028) * 0.04;
    }
  }

  render(): void {
    this.composer.render();
  }

  dispose(): void {
    for (const slot of this.slots) {
      for (const cube of slot.cubes) {
        cube.geometry.dispose();
        const mat = cube.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat.dispose();
      }
    }
    this.composer.dispose();
    this.renderer.dispose();
  }
}

function groupCentre(meshes: THREE.Mesh[]): void {
  const box = new THREE.Box3();
  for (const mesh of meshes) box.expandByObject(mesh);
  const centre = box.getCenter(new THREE.Vector3());
  for (const mesh of meshes) mesh.position.sub(centre);
}
