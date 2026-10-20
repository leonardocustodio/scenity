// SPDX-License-Identifier: Apache-2.0
// The morph targets of quantized meshes on WebGPU (src/morphKey.ts). Each interleaved attribute gets its own id, so the
// WebGPU renderer does not give the morph texture of one character mesh to another character mesh.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { BufferGeometry, Float32BufferAttribute, InterleavedBuffer, InterleavedBufferAttribute } from "three";
import { keyInterleavedAttributes } from "../src/morphKey";

/** A morph target as the quantized build gives it: an interleaved attribute. */
function interleavedTarget(): InterleavedBufferAttribute {
  return new InterleavedBufferAttribute(new InterleavedBuffer(new Float32Array(8), 4), 3, 0);
}

/** The morph part of the geometry key of a render object, as RenderObject.getGeometryCacheKey of three.js r186. */
function morphKey(geometry: BufferGeometry): string {
  let key = "";
  for (const [name, targets] of Object.entries(geometry.morphAttributes).sort(([a], [b]) => a.localeCompare(b))) {
    key += `morph-${name},`;
    for (const target of targets ?? []) key += `${String((target as { id?: unknown }).id)},`;
  }
  return key;
}

function quantizedGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", interleavedTarget());
  geometry.morphAttributes.position = [interleavedTarget(), interleavedTarget()];
  return geometry;
}

describe("the morph key of the WebGPU backend", () => {
  it("is still the attribute id in the WebGPU renderer of three.js", () => {
    // When this fails, a three.js upgrade changed the key: check whether morphKey.ts is still necessary.
    const source = readFileSync(Bun.resolveSync("three/webgpu", import.meta.dir), "utf8");
    expect(source).toContain("cacheKey += 'morph-' + name + ',';");
    expect(source).toMatch(/const attribute = targets\[ i \];\s+cacheKey \+= attribute\.id \+ ',';/);
  });

  it("gives other morph targets other keys", () => {
    keyInterleavedAttributes();
    const head = quantizedGeometry();
    const eyes = quantizedGeometry();
    expect(morphKey(head)).not.toContain("undefined");
    expect(morphKey(head)).not.toBe(morphKey(eyes));
    // The same targets keep the same key, so equal targets still share one shader.
    expect(morphKey(head)).toBe(morphKey(head));
    const copy = new BufferGeometry();
    copy.morphAttributes.position = head.morphAttributes.position;
    expect(morphKey(copy)).toBe(morphKey(head));
  });

  it("is idempotent and leaves the ids of plain attributes as they are", () => {
    keyInterleavedAttributes();
    keyInterleavedAttributes();
    const target = interleavedTarget();
    const id = (target as unknown as { id: unknown }).id;
    expect(typeof id).toBe("string");
    expect((target as unknown as { id: unknown }).id).toBe(id);
    const plain = new Float32BufferAttribute([0, 0, 0], 3);
    expect(typeof plain.id).toBe("number");
  });
});
