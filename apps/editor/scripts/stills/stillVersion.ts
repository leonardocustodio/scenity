// SPDX-License-Identifier: Apache-2.0
/**
 * The version of the still renderer: the hash of the files of the still page and of the capture values. The stills
 * script and the dev server (where the editor page draws the stills) give the same version, so the stamps of one are
 * current for the other. The file also gives the WASM decoders that the still page loads under `/decoders/`.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STILL_QUALITY, STILL_SCALE } from "../../src/still/stillCapture.ts";

/** The folder of the editor app. */
const APP = join(import.meta.dirname, "../..");

/** The files of the still page, relative to the app folder: the renderer version is their hash. */
const PAGE_FILES = [
  "still.html",
  "src/still/main.ts",
  "src/still/views.ts",
  "src/still/still.css",
  // The page reads the assets of the scene page through the manifest.
  "src/scene/assets.ts",
  "src/scene/project.ts",
] as const;

/**
 * The version of the renderer: the hash of the page files and the capture values (16 hex characters). The capture
 * values go into the hash as text, so `stillCapture.ts` is not one of the page files.
 */
export function rendererVersion(): string {
  const hash = createHash("sha256").update(`scale ${String(STILL_SCALE)} quality ${String(STILL_QUALITY)}`);
  for (const file of PAGE_FILES) hash.update(file).update(readFileSync(join(APP, file)));
  return hash.digest("hex").slice(0, 16);
}

/** The WASM decoders of three.js that the still page loads: the Basis transcoder and the Draco decoder. */
export const STILL_DECODERS: Readonly<Record<string, string>> = {
  "/decoders/basis_transcoder.wasm": "three/examples/jsm/libs/basis/basis_transcoder.wasm",
  "/decoders/draco_decoder.wasm": "three/examples/jsm/libs/draco/gltf/draco_decoder.wasm",
};
