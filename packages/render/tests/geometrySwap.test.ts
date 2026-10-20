// SPDX-License-Identifier: Apache-2.0
// A new geometry of a mesh on WebGPU (src/geometrySwap.ts). A geometry with another vertex layout (a quantized cushion
// and its float copy of `conform`) is a change. A new geometry with the same layout (a cable that the core makes
// again) is not a change.
import { describe, expect, it } from "bun:test";
import { BufferAttribute, BufferGeometry, InterleavedBuffer, InterleavedBufferAttribute, Mesh } from "three";
import { GeometrySwaps, layoutOf } from "../src/geometrySwap";

/** A geometry as the quantized files give it: 16-bit positions in an interleaved buffer with a stride of 4. */
function quantized(): BufferGeometry {
  const geometry = new BufferGeometry();
  const buffer = new InterleavedBuffer(new Int16Array(12), 4);
  geometry.setAttribute("position", new InterleavedBufferAttribute(buffer, 3, 0, true));
  geometry.setAttribute("normal", new BufferAttribute(new Int8Array(9), 3, true));
  return geometry;
}

/** The copy of `conform`: the attributes of the clone, with float positions. */
function conformed(source: BufferGeometry): BufferGeometry {
  const geometry = source.clone();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(9), 3));
  return geometry;
}

/** A float geometry, as a cable or a tube of the core. */
function plain(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(9), 3));
  geometry.setAttribute("normal", new BufferAttribute(new Float32Array(9), 3));
  return geometry;
}

describe("layoutOf", () => {
  it("names the value type, the size, the stride and the offset of each attribute", () => {
    expect(layoutOf(quantized())).toBe("normal:Int8Array:3n:,position:Int16Array:3n:4+0");
    expect(layoutOf(conformed(quantized()))).toBe("normal:Int8Array:3n:,position:Float32Array:3:");
  });

  it("gives the same layout for two geometries with the same attributes", () => {
    expect(layoutOf(plain())).toBe(layoutOf(plain()));
  });
});

describe("GeometrySwaps", () => {
  it("is false at the first draw and while the geometry stays", () => {
    const swaps = new GeometrySwaps();
    const mesh = new Mesh(quantized());
    expect(swaps.changed(mesh, mesh.geometry)).toBe(false);
    expect(swaps.changed(mesh, mesh.geometry)).toBe(false);
  });

  it("is true once when a geometry with another layout comes in", () => {
    const swaps = new GeometrySwaps();
    const mesh = new Mesh(quantized());
    swaps.changed(mesh, mesh.geometry);
    mesh.geometry = conformed(mesh.geometry);
    expect(swaps.changed(mesh, mesh.geometry)).toBe(true);
    expect(swaps.changed(mesh, mesh.geometry)).toBe(false);
  });

  it("is false for a new geometry with the same layout", () => {
    const swaps = new GeometrySwaps();
    const mesh = new Mesh(plain());
    swaps.changed(mesh, mesh.geometry);
    mesh.geometry = plain();
    expect(swaps.changed(mesh, mesh.geometry)).toBe(false);
  });

  it("keeps each object apart", () => {
    const swaps = new GeometrySwaps();
    const first = new Mesh(quantized());
    const second = new Mesh(plain());
    swaps.changed(first, first.geometry);
    swaps.changed(second, second.geometry);
    expect(swaps.changed(second, first.geometry)).toBe(true);
    expect(swaps.changed(first, first.geometry)).toBe(false);
  });
});
