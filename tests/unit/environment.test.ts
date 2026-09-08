import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Environment } from '../../src/render/environment';

function field(environment: Environment): THREE.Group {
  return environment.group.children.find((c) => c.userData['floaters']) as THREE.Group;
}

describe('production environment', () => {
  it('excludes the complete floater silhouette immediately when a menu becomes gameplay', () => {
    const room = new Environment(false);
    room.setChroma(true);
    room.update(1000, 0, false);
    room.setChroma(false);
    for (let yaw = 0; yaw < 360; yaw += 5) {
      room.update(0, yaw, true);
      for (const floater of field(room).userData['floaters'] as THREE.Mesh[]) {
        const x =
          floater.position.x * Math.cos((yaw * Math.PI) / 180) -
          floater.position.z * Math.sin((yaw * Math.PI) / 180);
        const radius = floater.userData['size'] as number;
        if (Math.abs(x) - (radius * Math.sqrt(3)) / 2 <= 7) expect(floater.visible).toBe(false);
      }
    }
    room.dispose();
  });

  it('never writes gameplay depth, shares ordinary geometry/material and stays below 10000 floater triangles', () => {
    const room = new Environment(false);
    const objects = field(room).userData['floaters'] as THREE.Mesh[];
    expect(new Set(objects.slice(1).map((o) => o.geometry)).size).toBe(1);
    expect(new Set(objects.slice(1).map((o) => o.material)).size).toBe(1);
    const triangles = objects.reduce(
      (n, o) => n + o.geometry.getAttribute('position').count / 3,
      0
    );
    expect(triangles).toBeLessThan(10000);
    expect(field(room).children.filter((c) => c instanceof THREE.InstancedMesh)).toHaveLength(1);
    room.group.traverse((object) => {
      if ('material' in object) {
        const material = object.material as THREE.Material;
        expect(material.depthWrite).toBe(false);
        expect(material.depthTest).toBe(false);
      }
    });
    let disposed = 0;
    objects[1]!.geometry.addEventListener('dispose', () => disposed++);
    room.dispose();
    room.dispose();
    expect(disposed).toBe(1);
  });

  it('has repeatable independent drift, no reaction-driven scale pumping, and no reduced-motion rings', () => {
    const a = new Environment(true);
    const b = new Environment(true);
    for (const room of [a, b]) {
      room.setChroma(true);
      room.react(1);
      room.ripple(1);
      room.update(500, 0, false);
    }
    const one = field(a).userData['floaters'] as THREE.Mesh[];
    const two = field(b).userData['floaters'] as THREE.Mesh[];
    for (let i = 0; i < one.length; i++) {
      expect(one[i]!.position).toEqual(two[i]!.position);
      expect(one[i]!.scale.x).toBe(one[i]!.userData['size']);
    }
    expect(new Set(one.map((o) => o.userData['spin'])).size).toBe(one.length);
    expect(a.group.children.filter((c) => c instanceof THREE.LineLoop && c.visible)).toHaveLength(
      0
    );
    a.dispose();
    b.dispose();
  });
});
