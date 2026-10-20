// SPDX-License-Identifier: Apache-2.0
// The version of the shadow pass material on WebGPU (src/shadowAlpha.ts). An alpha test that changes from object to
// object does not change the version. A change of the material of one object changes it, as the setter of three.js
// does.
import { describe, expect, it } from "bun:test";
import { type Material, Mesh, MeshStandardMaterial, type Object3D, Texture } from "three";
import { steadyShadowAlpha } from "../src/shadowAlpha";

/** A stand-in for the shadow pass material of three.js r186 (`isShadowPassMaterial`). */
function shadowMaterial(): Material {
  const material = new MeshStandardMaterial();
  (material as unknown as { isShadowPassMaterial: boolean }).isShadowPassMaterial = true;
  return material;
}

/** What `Renderer.renderObject` does to the override material for one object: the hook, then the copy of alphaTest. */
function draw(shadow: Material, object: Object3D, material: Material): void {
  steadyShadowAlpha(shadow, object, material);
  shadow.alphaTest = material.alphaTest;
}

describe("steadyShadowAlpha", () => {
  it("keeps the version while the alpha test goes on and off between objects", () => {
    const shadow = shadowMaterial();
    const masked = new MeshStandardMaterial({ alphaTest: 0.5 });
    const opaque = new MeshStandardMaterial();
    const objects = [new Mesh(), new Mesh(), new Mesh()];
    const materials = [opaque, masked, opaque];
    const version = shadow.version;
    for (let frame = 0; frame < 3; frame += 1) {
      for (const [index, object] of objects.entries()) draw(shadow, object, materials[index] ?? opaque);
    }
    expect(shadow.version).toBe(version);
    // The setter keeps the value on the material.
    shadow.alphaTest = 0.25;
    expect(shadow.alphaTest).toBe(0.25);
  });

  it("changes the version when the material of an object changes", () => {
    const shadow = shadowMaterial();
    const object = new Mesh();
    const material = new MeshStandardMaterial();
    draw(shadow, object, material);
    const version = shadow.version;
    material.alphaTest = 0.5;
    draw(shadow, object, material);
    expect(shadow.version).toBe(version + 1);
    material.map = new Texture();
    draw(shadow, object, material);
    expect(shadow.version).toBe(version + 2);
    draw(shadow, object, new MeshStandardMaterial({ alphaTest: 0.5 }));
    expect(shadow.version).toBe(version + 3);
    draw(shadow, object, new MeshStandardMaterial({ alphaTest: 0.5 }));
    expect(shadow.version).toBe(version + 4);
  });

  it("does nothing without the shadow pass material", () => {
    const override = new MeshStandardMaterial();
    const version = override.version;
    steadyShadowAlpha(override, new Mesh(), new MeshStandardMaterial({ alphaTest: 0.5 }));
    override.alphaTest = 0.5;
    expect(override.version).toBe(version + 1);
    expect(() => {
      steadyShadowAlpha(null, new Mesh(), new MeshStandardMaterial());
    }).not.toThrow();
  });
});
