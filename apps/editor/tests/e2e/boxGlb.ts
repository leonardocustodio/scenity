// SPDX-License-Identifier: Apache-2.0
// A GLB file of a box for the import tests. The promote spec (scene-promote.spec.ts) uses it.
/** A GLB file of a 0.4 m box (positions, normals, indices; no texture), written by hand. */
export function boxGlb(): Buffer {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const axes = [0, 1, 2] as const;
  for (const n of axes) {
    for (const sign of [1, -1]) {
      const [a, b] = axes.filter((axis) => axis !== n) as [number, number];
      const base = positions.length / 3;
      for (const [u, v] of [
        [-0.2, -0.2],
        [0.2, -0.2],
        [0.2, 0.2],
        [-0.2, 0.2],
      ] as const) {
        const point = [0, 0, 0];
        point[a] = u;
        point[b] = v;
        point[n] = sign * 0.2;
        positions.push(point[0] ?? 0, (point[1] ?? 0) + 0.2, point[2] ?? 0);
        const normal = [0, 0, 0];
        normal[n] = sign;
        normals.push(...normal);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const bin = Buffer.concat([
    Buffer.from(new Float32Array(positions).buffer),
    Buffer.from(new Float32Array(normals).buffer),
    Buffer.from(new Uint16Array(indices).buffer),
  ]);
  const padded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const vertexBytes = positions.length * 4;
  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "box" }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2 }] }],
    buffers: [{ byteLength: padded.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: vertexBytes, target: 34962 },
      { buffer: 0, byteOffset: vertexBytes, byteLength: vertexBytes, target: 34962 },
      { buffer: 0, byteOffset: vertexBytes * 2, byteLength: indices.length * 2, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 24, type: "VEC3", min: [-0.2, 0, -0.2], max: [0.2, 0.4, 0.2] },
      { bufferView: 1, componentType: 5126, count: 24, type: "VEC3" },
      { bufferView: 2, componentType: 5123, count: indices.length, type: "SCALAR" },
    ],
  };
  const text = Buffer.from(JSON.stringify(json));
  const jsonChunk = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const chunk = (data: Buffer, type: number): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32LE(data.length, 0);
    head.writeUInt32LE(type, 4);
    return Buffer.concat([head, data]);
  };
  const body = Buffer.concat([chunk(jsonChunk, 0x4e4f534a), chunk(padded, 0x004e4942)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + body.length, 8);
  return Buffer.concat([header, body]);
}
