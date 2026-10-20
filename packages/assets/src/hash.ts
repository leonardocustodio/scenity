// SPDX-License-Identifier: Apache-2.0
/**
 * The content hash of an asset: the SHA-256 of the bytes of the source file. A glTF file names other files
 * (buffers and images). Their bytes are part of the hash of a glTF asset, so a change of a texture changes the hash.
 */
import { createHash } from "node:crypto";
import { isObject, resolveFrom } from "@scenity/scene";
import { readBytesOrUndefined } from "./files";
import { join } from "node:path";

export interface SourceHash {
  /** The SHA-256 in hex, or undefined when the source file does not exist. */
  readonly hash: string | undefined;
  /** The project paths of the source and of each file that the source names, in sorted order. */
  readonly files: readonly string[];
  /** The project paths of the named files that do not exist. */
  readonly missing: readonly string[];
}

/** The SHA-256 of bytes in hex. */
export function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The project paths of the files that a glTF file names: the `uri` of each buffer and each image. A `data:` URI is
 * part of the glTF file and gives no path. A URI that is not a relative path gives no path.
 */
export function gltfFileRefs(gltfPath: string, text: string): string[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return [];
  }
  if (!isObject(json)) return [];
  const uris: string[] = [];
  for (const key of ["buffers", "images"]) {
    const list = json[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (isObject(item) && typeof item.uri === "string") uris.push(item.uri);
    }
  }
  const paths = new Set<string>();
  for (const uri of uris) {
    if (uri.startsWith("data:") || /^[a-z][a-z0-9+.-]*:/i.test(uri) || uri.startsWith("/")) continue;
    let decoded: string;
    try {
      decoded = decodeURIComponent(uri);
    } catch {
      continue;
    }
    paths.add(resolveFrom(gltfPath, decoded));
  }
  return [...paths].sort();
}

/**
 * The hash of the source of an asset. For a `.gltf` source, the hash covers the source and the named files: it is
 * the SHA-256 of a list of lines `<path> <sha256>`, one line for each file. The path of a named file is relative to
 * the source, so a move of the folder keeps the hash.
 */
export function hashSource(dir: string, sourcePath: string): SourceHash {
  const bytes = readBytesOrUndefined(join(dir, sourcePath));
  if (bytes === undefined) return { hash: undefined, files: [sourcePath], missing: [sourcePath] };
  if (!sourcePath.toLowerCase().endsWith(".gltf")) return { hash: sha256(bytes), files: [sourcePath], missing: [] };
  const refs = gltfFileRefs(sourcePath, new TextDecoder().decode(bytes));
  const base = sourcePath.slice(0, sourcePath.lastIndexOf("/") + 1);
  const lines = [`. ${sha256(bytes)}`];
  const missing: string[] = [];
  for (const ref of refs) {
    const refBytes = readBytesOrUndefined(join(dir, ref));
    const name = ref.startsWith(base) ? ref.slice(base.length) : ref;
    if (refBytes === undefined) missing.push(ref);
    lines.push(`${name} ${refBytes === undefined ? "missing" : sha256(refBytes)}`);
  }
  return { hash: sha256(lines.join("\n")), files: [sourcePath, ...refs].sort(), missing };
}
