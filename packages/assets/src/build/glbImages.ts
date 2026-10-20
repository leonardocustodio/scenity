// SPDX-License-Identifier: Apache-2.0
/**
 * The KTX2 images and the glTF extensions of a built GLB file.
 *
 * The render worker has no Zstandard decoder: three.js needs it only for a KTX2 image that is not Basis Universal (a
 * vkFormat other than 0) with Zstandard supercompression. The Basis transcoder decodes the Zstandard of a UASTC image
 * itself. Thus all KTX2 images of a built file must be Basis (vkFormat 0). The build checks (checks.ts) give an error
 * for all other images.
 *
 * The trimmed GLTFLoader reads only the extensions of GLTF_EXTENSIONS and the data extensions of GLTF_DATA_EXTENSIONS
 * (trimGltf.ts). Thus the build checks give an error for a built file with another extension in `extensionsUsed`.
 */
import { GLTF_DATA_EXTENSIONS, GLTF_EXTENSIONS } from "./trimGltf";

const KNOWN_EXTENSIONS: readonly string[] = [...GLTF_EXTENSIONS, ...GLTF_DATA_EXTENSIONS];

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
/** The identifier of a KTX2 file: «KTX 20»\r\n\x1A\n. */
const KTX2_ID = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];

interface GltfJson {
  readonly extensionsUsed?: readonly string[];
  readonly images?: readonly { readonly mimeType?: string; readonly bufferView?: number; readonly name?: string }[];
  readonly bufferViews?: readonly {
    readonly buffer: number;
    readonly byteOffset?: number;
    readonly byteLength: number;
  }[];
  readonly buffers?: readonly { readonly uri?: string }[];
}

/** A KTX2 image of a GLB file: its index, its name and its vkFormat (0: Basis Universal), or null when unreadable. */
export interface Ktx2Image {
  readonly index: number;
  readonly name: string;
  readonly vkFormat: number | null;
}

/** The JSON and the binary chunk of a GLB file. Throws when the bytes are not a GLB file. */
function chunks(glb: Uint8Array): { json: GltfJson; bin: Uint8Array | null } {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  if (glb.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC) throw new Error("not a GLB file");
  let json: GltfJson | null = null;
  let bin: Uint8Array | null = null;
  for (let at = 12; at + 8 <= glb.byteLength;) {
    const length = view.getUint32(at, true);
    const type = view.getUint32(at + 4, true);
    const body = glb.subarray(at + 8, at + 8 + length);
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(body)) as GltfJson;
    else if (type === CHUNK_BIN) bin = body;
    at += 8 + length;
  }
  if (json === null) throw new Error("a GLB file without a JSON chunk");
  return { json, bin };
}

/** The KTX2 images of a GLB file with their vkFormat. */
export function ktx2Images(glb: Uint8Array): Ktx2Image[] {
  const { json, bin } = chunks(glb);
  const out: Ktx2Image[] = [];
  (json.images ?? []).forEach((image, index) => {
    if (image.mimeType !== "image/ktx2") return;
    const name = image.name ?? `image ${String(index)}`;
    const bufferView = image.bufferView === undefined ? undefined : json.bufferViews?.[image.bufferView];
    // The binary chunk is the buffer without a URI.
    const inBin = bufferView !== undefined && json.buffers?.[bufferView.buffer]?.uri === undefined;
    if (bufferView === undefined || !inBin || bin === null) {
      out.push({ index, name, vkFormat: null });
      return;
    }
    const start = bufferView.byteOffset ?? 0;
    const bytes = bin.subarray(start, start + bufferView.byteLength);
    const isKtx2 = bytes.byteLength >= 16 && KTX2_ID.every((value, at) => bytes[at] === value);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    out.push({ index, name, vkFormat: isKtx2 ? view.getUint32(12, true) : null });
  });
  return out;
}

/** The problems of the KTX2 images of a GLB file: an image that is not Basis Universal, or that cannot be read. */
export function ktx2Problems(glb: Uint8Array): string[] {
  return ktx2Images(glb)
    .filter((image) => image.vkFormat !== 0)
    .map((image) =>
      image.vkFormat === null
        ? `the KTX2 image ${image.name} cannot be read`
        : `the KTX2 image ${image.name} has vkFormat ${String(image.vkFormat)}: the render worker reads Basis Universal only (vkFormat 0)`,
    );
}

/**
 * The problems of the glTF extensions of a GLB file: an extension that the GLTFLoader of the 3D room cannot read. A
 * project can name more extensions that its loader reads (`extra`).
 */
export function extensionProblems(glb: Uint8Array, extra: readonly string[] = []): string[] {
  const known = [...KNOWN_EXTENSIONS, ...extra];
  return (chunks(glb).json.extensionsUsed ?? [])
    .filter((name) => !known.includes(name))
    .map(
      (name) =>
        `the file uses the glTF extension ${name}: the GLTFLoader of the 3D room reads only ${known.join(", ")}`,
    );
}
