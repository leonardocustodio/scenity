// SPDX-License-Identifier: Apache-2.0
/**
 * The helpers of the glTF export tests: read a GLB file back with glTF Transform, find a node by its name,
 * and compare a world matrix with the world transform of an entity.
 */
import { expect } from "bun:test";
import type { Document, Node } from "@gltf-transform/core";
import { worldTransform, type SceneDocument } from "@scenity/scene";
import { gltfIO } from "../src/build/optimize";

/** The tolerance of a world transform in the export tests. */
export const TOLERANCE = 1e-5;

/** The glTF document of GLB bytes. */
export async function readGlb(bytes: Uint8Array): Promise<Document> {
  return (await gltfIO()).readBinary(bytes);
}

/** The one node with a name; the test fails when there is no node or more than one. */
export function nodeNamed(doc: Document, name: string): Node {
  const found = doc
    .getRoot()
    .listNodes()
    .filter((node) => node.getName() === name);
  expect(found.map((node) => node.getName())).toEqual([name]);
  return found[0]!;
}

/** Expect the world matrix of a node to be the world matrix of an entity of the scene, to the tolerance. */
export function expectEntityMatrix(scene: SceneDocument, node: Node, id: string): void {
  const expected = worldTransform(scene, id)?.matrix;
  expect(expected).toBeDefined();
  const actual = node.getWorldMatrix();
  const worst = Math.max(...expected!.map((value, index) => Math.abs(value - actual[index]!)));
  expect({ id, worst: worst <= TOLERANCE ? 0 : worst }).toEqual({ id, worst: 0 });
}

/** The direction -Z of a node in world space (the view direction of a glTF camera or light). */
export function forwardOf(node: Node): [number, number, number] {
  const m = node.getWorldMatrix();
  const length = Math.hypot(m[8], m[9], m[10]);
  return [-m[8] / length, -m[9] / length, -m[10] / length];
}

/** The unit direction from `from` to `to`. */
export function direction(from: readonly number[], to: readonly number[]): [number, number, number] {
  const d = [to[0]! - from[0]!, to[1]! - from[1]!, to[2]! - from[2]!];
  const length = Math.hypot(d[0]!, d[1]!, d[2]!);
  return [d[0]! / length, d[1]! / length, d[2]! / length];
}

/** The dot product of two directions. */
export function dot(a: readonly number[], b: readonly number[]): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
}
