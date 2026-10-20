// SPDX-License-Identifier: Apache-2.0
/**
 * Small glTF files for the tests of the generic asset build. They are made in code, so the tests do not need
 * Blender: a static model of boxes with a PNG color texture, and a clip that turns two nodes.
 */
import { Document } from "@gltf-transform/core";
import { encode } from "fast-png";
import { gltfIO } from "../src/build/optimize";

export interface BoxOptions {
  /** Boxes along x; each box has 12 triangles. */
  readonly boxes?: number;
  readonly textureSize?: number;
  /** Empty leaf nodes under the root node (sockets). */
  readonly sockets?: readonly string[];
}

function png(size: number): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) data.set([(i * 13) % 256, (i * 7) % 256, 160, 255], i * 4);
  return encode({ width: size, height: size, data, channels: 4 });
}

/** A static model of boxes with a color texture, as GLB bytes. */
export async function boxModel(options: BoxOptions = {}): Promise<Uint8Array> {
  const document = new Document();
  const buffer = document.createBuffer();
  const positions: number[] = [];
  const indices: number[] = [];
  for (let b = 0; b < (options.boxes ?? 2); b++) {
    const base = positions.length / 3;
    for (let corner = 0; corner < 8; corner++) {
      positions.push(b * 0.3 + (corner & 1 ? 0.2 : 0), corner & 2 ? 1.6 : 0, corner & 4 ? 0.2 : 0);
    }
    const faces = [
      0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5,
    ];
    indices.push(...faces.map((face) => face + base));
  }
  const count = positions.length / 3;
  const uv = Array.from({ length: count * 2 }, (_, i) => (i % 3) / 2);
  const texture = document
    .createTexture("atlas")
    .setImage(png(options.textureSize ?? 16))
    .setMimeType("image/png");
  const primitive = document
    .createPrimitive()
    .setMaterial(document.createMaterial("surface").setBaseColorTexture(texture))
    .setIndices(document.createAccessor().setType("SCALAR").setArray(new Uint16Array(indices)).setBuffer(buffer))
    .setAttribute(
      "POSITION",
      document.createAccessor().setType("VEC3").setArray(new Float32Array(positions)).setBuffer(buffer),
    )
    .setAttribute(
      "TEXCOORD_0",
      document.createAccessor().setType("VEC2").setArray(new Float32Array(uv)).setBuffer(buffer),
    );
  const body = document.createNode("body").setMesh(document.createMesh("body").addPrimitive(primitive));
  for (const name of options.sockets ?? []) body.addChild(document.createNode(name));
  document.createScene("export").addChild(body);
  return (await gltfIO()).writeBinary(document);
}

/** A clip: two nodes turn over one second. */
export async function turnClip(name = "turn"): Promise<Uint8Array> {
  const document = new Document();
  const buffer = document.createBuffer();
  const root = document.createNode("root");
  const top = document.createNode("top").setTranslation([0, 0.5, 0]);
  root.addChild(top);
  document.createScene("export").addChild(root);
  const times = document
    .createAccessor()
    .setType("SCALAR")
    .setArray(new Float32Array([0, 0.5, 1]))
    .setBuffer(buffer);
  const animation = document.createAnimation(name);
  for (const node of [root, top]) {
    const values = new Float32Array([0, 0, 0, 1, 0, 0.0998, 0, 0.995, 0, 0, 0, 1]);
    const sampler = document
      .createAnimationSampler()
      .setInput(times)
      .setOutput(document.createAccessor().setType("VEC4").setArray(values).setBuffer(buffer))
      .setInterpolation("LINEAR");
    animation
      .addSampler(sampler)
      .addChannel(document.createAnimationChannel().setTargetNode(node).setTargetPath("rotation").setSampler(sampler));
  }
  return (await gltfIO()).writeBinary(document);
}
