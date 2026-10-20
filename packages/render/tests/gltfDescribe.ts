// SPDX-License-Identifier: Apache-2.0
// The description of a loaded glTF file for the loader tests: two equal loads give the same text.
import { readFileSync } from "node:fs";
import {
  Color,
  Texture,
  Vector2,
  type BufferAttribute,
  type BufferGeometry,
  type InterleavedBufferAttribute,
  type Material,
  type Mesh,
  type SkinnedMesh,
} from "three";
import type { GLTF, GLTFLoaderPlugin, GLTFParser } from "three/examples/jsm/loaders/GLTFLoader.js";

interface TextureDefs {
  readonly textures?: readonly {
    readonly extensions?: { readonly KHR_texture_basisu?: { readonly source: number } };
  }[];
}

/**
 * A KHR_texture_basisu plugin without a transcoder, as the plugin of assets.ts: each image is an empty texture that
 * knows its source. The test compares the loaders, not the images.
 */
export function placeholderTextures(parser: GLTFParser): GLTFLoaderPlugin {
  parser.loadImageSource = (sourceIndex: number): Promise<Texture> => {
    const texture = new Texture();
    texture.userData.source = sourceIndex;
    return Promise.resolve(texture);
  };
  return {
    name: "KHR_texture_basisu",
    loadTexture: (textureIndex: number) => {
      const extension = (parser.json as TextureDefs).textures?.[textureIndex]?.extensions?.KHR_texture_basisu;
      if (extension === undefined) return null;
      return parser.loadTextureImage(textureIndex, extension.source, {} as never);
    },
  };
}

function bytesOf(array: ArrayLike<number> & { buffer: ArrayBufferLike; byteOffset: number; byteLength: number }) {
  return Bun.hash(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)).toString(16);
}

function attribute(value: BufferAttribute | InterleavedBufferAttribute): unknown {
  const values = Float64Array.from({ length: value.count * value.itemSize }, (_, at) =>
    value.getComponent(Math.floor(at / value.itemSize), at % value.itemSize),
  );
  return [value.itemSize, value.count, value.normalized, value.array.constructor.name, bytesOf(values)];
}

function geometry(value: BufferGeometry): unknown {
  return {
    index: value.index === null ? null : attribute(value.index),
    attributes: Object.entries(value.attributes).map(([name, item]) => [name, attribute(item)]),
    morph: Object.entries(value.morphAttributes).map(([name, items]) => [name, (items ?? []).map(attribute)]),
    groups: value.groups,
    box: value.boundingBox?.min.toArray().concat(value.boundingBox.max.toArray()),
    sphere:
      value.boundingSphere === null ? null : [...value.boundingSphere.center.toArray(), value.boundingSphere.radius],
  };
}

/** The own fields of a material, with a short form of each texture, color and vector. */
function material(value: Material): unknown {
  const out: Record<string, unknown> = { class: value.constructor.name };
  for (const [key, field] of Object.entries(value)) {
    if (key === "uuid" || key === "id" || key === "version") continue;
    if (field instanceof Texture) {
      out[key] = {
        source: field.userData.source as unknown,
        name: field.name,
        colorSpace: field.colorSpace,
        channel: field.channel,
        flipY: field.flipY,
        wrap: [field.wrapS, field.wrapT],
        filter: [field.magFilter, field.minFilter],
        transform: [...field.offset.toArray(), ...field.repeat.toArray(), field.rotation, ...field.center.toArray()],
        matrixAutoUpdate: field.matrixAutoUpdate,
      };
    } else if (field instanceof Color) out[key] = field.toArray();
    else if (field instanceof Vector2) out[key] = field.toArray();
    else if (typeof field !== "function") out[key] = field as unknown;
  }
  return out;
}

/** A description of a loaded file that two equal loads share. */
export function describeGltf(gltf: GLTF): string {
  const nodes: unknown[] = [];
  gltf.scene.traverse((object) => {
    const mesh = object as Partial<Mesh & SkinnedMesh>;
    nodes.push({
      name: object.name,
      type: object.type,
      matrix: object.matrix.elements,
      userData: object.userData,
      geometry: mesh.geometry === undefined ? null : geometry(mesh.geometry),
      materials: mesh.material === undefined ? null : [mesh.material].flat().map(material),
      bones: mesh.skeleton?.bones.map((bone) => bone.name) ?? null,
    });
  });
  const clips = gltf.animations.map((clip) => ({
    name: clip.name,
    duration: clip.duration,
    tracks: clip.tracks.map((track) => [track.name, track.ValueTypeName, bytesOf(track.times), bytesOf(track.values)]),
  }));
  return JSON.stringify({ nodes, clips, userData: gltf.userData });
}

/** The bytes of a file as an ArrayBuffer of its own. */
export function bufferOf(path: string): ArrayBuffer {
  const data = readFileSync(path);
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}
