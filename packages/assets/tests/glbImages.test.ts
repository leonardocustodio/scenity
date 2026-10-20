// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import { extensionProblems, ktx2Images, ktx2Problems } from "../src/build/glbImages";

const KTX2_ID = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];

/** A KTX2 header of 16 bytes with this vkFormat (the rest of the file is not read). */
function ktx2(vkFormat: number): Uint8Array {
  const bytes = new Uint8Array(16);
  bytes.set(KTX2_ID);
  new DataView(bytes.buffer).setUint32(12, vkFormat, true);
  return bytes;
}

/** A GLB file with these images in its binary chunk and these glTF extensions. */
function glb(images: readonly Uint8Array[], extensionsUsed: readonly string[] = []): Uint8Array {
  const bin = new Uint8Array(images.reduce((total, image) => total + image.byteLength, 0));
  const bufferViews: { buffer: number; byteOffset: number; byteLength: number }[] = [];
  let at = 0;
  for (const image of images) {
    bin.set(image, at);
    bufferViews.push({ buffer: 0, byteOffset: at, byteLength: image.byteLength });
    at += image.byteLength;
  }
  const gltf = {
    asset: { version: "2.0" },
    extensionsUsed,
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews,
    images: images.map((_, index) => ({ mimeType: "image/ktx2", bufferView: index, name: `t${String(index)}` })),
  };
  let json = new TextEncoder().encode(JSON.stringify(gltf));
  json = Uint8Array.from([...json, ...new Array<number>((4 - (json.byteLength % 4)) % 4).fill(0x20)]);
  const out = new Uint8Array(12 + 8 + json.byteLength + 8 + bin.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.byteLength, true);
  view.setUint32(12, json.byteLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(json, 20);
  view.setUint32(20 + json.byteLength, bin.byteLength, true);
  view.setUint32(24 + json.byteLength, 0x004e4942, true);
  out.set(bin, 28 + json.byteLength);
  return out;
}

describe("the KTX2 images of a built GLB file", () => {
  it("read the vkFormat of each image", () => {
    expect(ktx2Images(glb([ktx2(0), ktx2(37)])).map((image) => image.vkFormat)).toEqual([0, 37]);
  });

  it("accept Basis Universal images only", () => {
    expect(ktx2Problems(glb([ktx2(0), ktx2(0)]))).toEqual([]);
    const problems = ktx2Problems(glb([ktx2(0), ktx2(37)]));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("t1 has vkFormat 37");
  });

  it("give an image that is not KTX2 as unreadable", () => {
    expect(ktx2Problems(glb([new Uint8Array(16)]))[0]).toContain("cannot be read");
  });
});

describe("the glTF extensions of a built GLB file", () => {
  it("accept the four extensions of the trimmed GLTFLoader and the skin variants", () => {
    const used = [
      "EXT_meshopt_compression",
      "KHR_mesh_quantization",
      "KHR_texture_basisu",
      "KHR_texture_transform",
      "KHR_materials_variants",
    ];
    expect(extensionProblems(glb([], used))).toEqual([]);
    expect(extensionProblems(glb([]))).toEqual([]);
  });

  it("give each other extension as a problem", () => {
    const problems = extensionProblems(
      glb([], ["KHR_texture_basisu", "KHR_materials_emissive_strength", "KHR_draco_mesh_compression"]),
    );
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("KHR_materials_emissive_strength");
    expect(problems[1]).toContain("KHR_draco_mesh_compression");
  });
});
