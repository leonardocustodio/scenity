// SPDX-License-Identifier: Apache-2.0
/**
 * The meshes of the `shape` component in the glTF export. The geometry follows the `shape` presenter of the
 * runtime: a box, a plane in the XZ plane that faces +Y, a cylinder and a sphere with X as the diameter and Y as the
 * height. The round shapes have the segments of three.js (32 around, 16 from pole to pole).
 */
import type { Accessor, Buffer, Document, Mesh } from "@gltf-transform/core";
import type { ShapeValue } from "@scenity/scene";
import { linearColour } from "./math";

/** The segments of the round shapes. */
const ROUND_SEGMENTS = 32;
/** The smallest size of a part of a shape, so that a geometry never has a zero scale. */
const MIN_SIZE = 1e-4;

/** The vertex data of a shape. */
export interface ShapeGeometry {
  readonly positions: number[];
  readonly normals: number[];
  readonly uvs: number[];
  readonly indices: number[];
}

type V3 = readonly [number, number, number];

function emptyGeometry(): ShapeGeometry {
  return { positions: [], normals: [], uvs: [], indices: [] };
}

/** Add a flat rectangle with the normal `n` and the half sizes `hu` and `hv` along `u` and `v` (u × v = n). */
function addQuad(out: ShapeGeometry, centre: V3, n: V3, u: V3, v: V3, hu: number, hv: number): void {
  const base = out.positions.length / 3;
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const;
  for (const [su, sv] of corners) {
    const [a, b] = [su * hu, sv * hv];
    out.positions.push(
      centre[0] + u[0] * a + v[0] * b,
      centre[1] + u[1] * a + v[1] * b,
      centre[2] + u[2] * a + v[2] * b,
    );
    out.normals.push(...n);
    out.uvs.push((su + 1) / 2, (1 - sv) / 2);
  }
  out.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function boxGeometry(x: number, y: number, z: number): ShapeGeometry {
  const out = emptyGeometry();
  const [hx, hy, hz] = [x / 2, y / 2, z / 2];
  addQuad(out, [hx, 0, 0], [1, 0, 0], [0, 0, -1], [0, 1, 0], hz, hy);
  addQuad(out, [-hx, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 1, 0], hz, hy);
  addQuad(out, [0, hy, 0], [0, 1, 0], [1, 0, 0], [0, 0, -1], hx, hz);
  addQuad(out, [0, -hy, 0], [0, -1, 0], [1, 0, 0], [0, 0, 1], hx, hz);
  addQuad(out, [0, 0, hz], [0, 0, 1], [1, 0, 0], [0, 1, 0], hx, hy);
  addQuad(out, [0, 0, -hz], [0, 0, -1], [-1, 0, 0], [0, 1, 0], hx, hy);
  return out;
}

function planeGeometry(x: number, z: number): ShapeGeometry {
  const out = emptyGeometry();
  addQuad(out, [0, 0, 0], [0, 1, 0], [1, 0, 0], [0, 0, -1], x / 2, z / 2);
  return out;
}

/** Add a cap of a cylinder at the height `y`; `up` tells if the cap faces +Y. */
function addCap(out: ShapeGeometry, radius: number, y: number, up: boolean): void {
  const centre = out.positions.length / 3;
  out.positions.push(0, y, 0);
  out.normals.push(0, up ? 1 : -1, 0);
  out.uvs.push(0.5, 0.5);
  for (let i = 0; i <= ROUND_SEGMENTS; i += 1) {
    const theta = (i / ROUND_SEGMENTS) * Math.PI * 2;
    out.positions.push(radius * Math.sin(theta), y, radius * Math.cos(theta));
    out.normals.push(0, up ? 1 : -1, 0);
    out.uvs.push(0.5 + Math.sin(theta) / 2, 0.5 - Math.cos(theta) / 2);
  }
  for (let i = 0; i < ROUND_SEGMENTS; i += 1) {
    const a = centre + 1 + i;
    if (up) out.indices.push(centre, a, a + 1);
    else out.indices.push(centre, a + 1, a);
  }
}

function cylinderGeometry(radius: number, height: number): ShapeGeometry {
  const out = emptyGeometry();
  for (const [row, y] of [
    [0, height / 2],
    [1, -height / 2],
  ] as const) {
    for (let i = 0; i <= ROUND_SEGMENTS; i += 1) {
      const theta = (i / ROUND_SEGMENTS) * Math.PI * 2;
      out.positions.push(radius * Math.sin(theta), y, radius * Math.cos(theta));
      out.normals.push(Math.sin(theta), 0, Math.cos(theta));
      out.uvs.push(i / ROUND_SEGMENTS, row);
    }
  }
  const row = ROUND_SEGMENTS + 1;
  for (let i = 0; i < ROUND_SEGMENTS; i += 1) {
    const [a, b, c, d] = [i, i + row, i + row + 1, i + 1];
    out.indices.push(a, b, d, b, c, d);
  }
  addCap(out, radius, height / 2, true);
  addCap(out, radius, -height / 2, false);
  return out;
}

/** A sphere of the diameter `x`, scaled in Y to the height `y` (the normals follow the scale). */
function sphereGeometry(x: number, y: number): ShapeGeometry {
  const out = emptyGeometry();
  const [around, rows, radius, stretch] = [ROUND_SEGMENTS, ROUND_SEGMENTS / 2, x / 2, y / x];
  for (let iy = 0; iy <= rows; iy += 1) {
    const v = iy / rows;
    for (let ix = 0; ix <= around; ix += 1) {
      const u = ix / around;
      const n: V3 = [
        -Math.cos(u * Math.PI * 2) * Math.sin(v * Math.PI),
        Math.cos(v * Math.PI),
        Math.sin(u * Math.PI * 2) * Math.sin(v * Math.PI),
      ];
      out.positions.push(radius * n[0], radius * n[1] * stretch, radius * n[2]);
      const length = Math.hypot(n[0], n[1] / stretch, n[2]);
      out.normals.push(n[0] / length, n[1] / stretch / length, n[2] / length);
      out.uvs.push(u, v);
    }
  }
  const row = around + 1;
  for (let iy = 0; iy < rows; iy += 1) {
    for (let ix = 0; ix < around; ix += 1) {
      const [a, b, c, d] = [iy * row + ix + 1, iy * row + ix, (iy + 1) * row + ix, (iy + 1) * row + ix + 1];
      if (iy !== 0) out.indices.push(a, b, d);
      if (iy !== rows - 1) out.indices.push(b, c, d);
    }
  }
  return out;
}

/** The geometry of a shape, with its centre at the origin of the entity. */
export function shapeGeometry(kind: ShapeValue["kind"], size: readonly [number, number, number]): ShapeGeometry {
  const [x, y, z] = size.map((part) => Math.max(part, MIN_SIZE)) as [number, number, number];
  switch (kind) {
    case "box":
      return boxGeometry(x, y, z);
    case "plane":
      return planeGeometry(x, z);
    case "cylinder":
      return cylinderGeometry(x / 2, y);
    case "sphere":
      return sphereGeometry(x, y);
  }
}

function accessor(doc: Document, buffer: Buffer, type: "VEC2" | "VEC3", values: number[]): Accessor {
  return doc.createAccessor().setType(type).setArray(new Float32Array(values)).setBuffer(buffer);
}

/** The glTF mesh of a shape, with a metal and roughness material from its values (the defaults of the component). */
export function shapeMesh(doc: Document, buffer: Buffer, name: string, value: ShapeValue): Mesh {
  const geometry = shapeGeometry(value.kind, value.size ?? [1, 1, 1]);
  const material = doc
    .createMaterial(name)
    .setBaseColorFactor([...linearColour(value.colour ?? "#cccccc"), 1])
    .setRoughnessFactor(value.roughness ?? 0.8)
    .setMetallicFactor(value.metalness ?? 0);
  const indices = doc.createAccessor().setType("SCALAR").setArray(new Uint16Array(geometry.indices)).setBuffer(buffer);
  // The default mode of a primitive is TRIANGLES.
  const primitive = doc
    .createPrimitive()
    .setAttribute("POSITION", accessor(doc, buffer, "VEC3", geometry.positions))
    .setAttribute("NORMAL", accessor(doc, buffer, "VEC3", geometry.normals))
    .setAttribute("TEXCOORD_0", accessor(doc, buffer, "VEC2", geometry.uvs))
    .setIndices(indices)
    .setMaterial(material);
  return doc.createMesh(name).addPrimitive(primitive);
}
