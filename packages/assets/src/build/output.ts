// SPDX-License-Identifier: Apache-2.0
/**
 * The written output of the asset build: the built files in a folder and the manifest text in a file. The check mode
 * compares the bytes of a build in memory with the written files. The write mode removes the built files that the
 * build does not make. A build with no manifest (a project before manifest 2) gives no manifest path.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The files and the manifest text of a build. */
export interface WrittenOutput {
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly manifestText?: string;
}

/** The differences between the build and the written files. */
export function compareWithWritten(output: WrittenOutput, builtFolder: string, manifestPath?: string): string[] {
  const differences: string[] = [];
  const written = existsSync(builtFolder) ? readdirSync(builtFolder) : [];
  for (const [name, bytes] of output.files) {
    const path = join(builtFolder, name);
    if (!existsSync(path)) differences.push(`${name}: not written`);
    else if (!Buffer.from(readFileSync(path)).equals(Buffer.from(bytes))) differences.push(`${name}: other bytes`);
  }
  for (const name of written) if (!output.files.has(name)) differences.push(`${name}: not in the build`);
  if (manifestPath === undefined) return differences;
  const manifest = existsSync(manifestPath) ? readFileSync(manifestPath, "utf8") : "";
  if (manifest !== (output.manifestText ?? "")) differences.push("manifest.json: not current");
  return differences;
}

/** Write the built files and the manifest; remove built files that the build does not make. */
export function writeOutput(output: WrittenOutput, builtFolder: string, manifestPath?: string): void {
  mkdirSync(builtFolder, { recursive: true });
  for (const name of readdirSync(builtFolder)) {
    if (!output.files.has(name)) rmSync(join(builtFolder, name));
  }
  for (const [name, bytes] of output.files) writeFileSync(join(builtFolder, name), bytes);
  if (manifestPath !== undefined) writeFileSync(manifestPath, output.manifestText ?? "");
}

/** The size of a WebP image from its header (VP8, VP8L or VP8X), or null for another file. */
export function webpSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number): string => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (bytes.byteLength < 30 || tag(0) !== "RIFF" || tag(8) !== "WEBP") return null;
  const chunk = tag(12);
  if (chunk === "VP8X") {
    const width = 1 + (view.getUint16(24, true) | ((bytes[26] ?? 0) << 16));
    const height = 1 + (view.getUint16(27, true) | ((bytes[29] ?? 0) << 16));
    return { width, height };
  }
  if (chunk === "VP8L") {
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8 ") return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  return null;
}
