// SPDX-License-Identifier: Apache-2.0
/**
 * The content hash of the lab page, a Vite plugin. It computes the hash of the working-tree files that a frame
 * depends on (`@scenity/labs-platform/contentHash`). It gives the hash to the page as the virtual module
 * `virtual:labs-content-hash`. The host computes the same hash with the same function.
 *
 * On a change of a content file the plugin computes the hash again (only the changed files are read) and sends the
 * custom HMR event `labs:content-hash` before Vite sends the update of the file, so the page has the new hash before
 * it draws a frame of the new code. The hash never uses the clock: a restart of the server gives the same hash for the
 * same files, so the cached frames of the strip stay valid.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { relative, resolve, sep } from "node:path";
import type { Plugin } from "vite";
import {
  ContentHasher,
  fsContentReader,
  isContentFileIn,
  type ContentConfig,
} from "@scenity/labs-platform/contentHash";

export const CONTENT_HASH_MODULE = "virtual:labs-content-hash";
const RESOLVED = `\0${CONTENT_HASH_MODULE}`;
/** The custom HMR event with the new hash: `{ contentHash }`. */
export const CONTENT_HASH_EVENT = "labs:content-hash";

/** The repo root of this checkout (the Bun workspace). */
const WEB_ROOT = resolve(import.meta.dirname, "../../..");

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The current hash of the content files under `webRoot`, as the plugin and the host compute it. The editor plugin of
 * the lab gives the content config (its frame index source).
 */
export function contentHashNow(content: ContentConfig, webRoot = WEB_ROOT): string {
  return new ContentHasher(fsContentReader(fs, webRoot, content), sha256).hash();
}

/** The Vite plugin of the content hash. The editor plugin of the project gives the content config. */
export function labsContentHash(content: ContentConfig, webRoot = WEB_ROOT): Plugin {
  const hasher = new ContentHasher(fsContentReader(fs, webRoot, content), sha256);
  let hash: string | null = null;
  const current = (): string => (hash ??= hasher.hash());
  return {
    name: "scenity-labs-content-hash",
    resolveId(id) {
      return id === CONTENT_HASH_MODULE ? RESOLVED : null;
    },
    load(id) {
      return id === RESOLVED ? `export const contentHash = ${JSON.stringify(current())};\n` : null;
    },
    hotUpdate({ file }) {
      if (this.environment.name !== "client") return;
      const path = relative(webRoot, file).split(sep).join("/");
      if (!isContentFileIn(content, path)) return;
      const next = hasher.hash();
      if (next === hash) return;
      hash = next;
      // A new page load gets the new hash. The open pages get the event first.
      const module = this.environment.moduleGraph.getModuleById(RESOLVED);
      if (module !== undefined) this.environment.moduleGraph.invalidateModule(module);
      this.environment.hot.send({ type: "custom", event: CONTENT_HASH_EVENT, data: { contentHash: next } });
    },
  };
}
