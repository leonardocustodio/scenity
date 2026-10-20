// SPDX-License-Identifier: Apache-2.0
/**
 * The content hash of the page: the hash of the working-tree files that a frame depends on. The Vite plugin
 * `labsContentHash` (scripts/labsContentHash.ts) gives it. An edit of such a file sends the new hash (the HMR event
 * `labs:content-hash`) before the update of the file. Thus a key of a frame of the new code never has the old hash.
 * The value is a Vue ref: a key that reads it changes with it.
 */
import { shallowRef } from "vue";
import { contentHash as initialHash } from "virtual:labs-content-hash";

/** The custom HMR event of the plugin (scripts/labsContentHash.ts `CONTENT_HASH_EVENT`). */
export const CONTENT_HASH_EVENT = "labs:content-hash";

export const contentHash = shallowRef(initialHash);

/** Take a new hash (the HMR event; a test). */
export function setContentHash(next: string): void {
  contentHash.value = next;
}

if (import.meta.hot) {
  import.meta.hot.on(CONTENT_HASH_EVENT, (data: { contentHash?: unknown }) => {
    if (typeof data.contentHash === "string") setContentHash(data.contentHash);
  });
}
