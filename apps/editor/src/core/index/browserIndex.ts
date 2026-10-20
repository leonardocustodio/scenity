// SPDX-License-Identifier: Apache-2.0
/**
 * The frame index of the lab page alone. The store of the host has the same interface (`FrameIndexStore`), thus a
 * reader does not know which store it has. Without the workbench host, the lab keeps a smaller index (200 MB). The
 * index is in OPFS, or in IndexedDB where OPFS is missing or cannot write.
 */
import { BROWSER_INDEX_LIMIT, IndexStore, type IndexStoreOptions } from "@scenity/labs-platform/indexStore";
import { idbBackend, opfsBackend, openIndexDb, type DirectoryLike } from "./backends";

/** The name of the OPFS folder and of the IndexedDB database. */
export const BROWSER_INDEX_NAME = "room3d-lab-index";

/** The parts of the page that the store needs: a test gives fakes. */
export interface BrowserIndexEnv {
  readonly navigator?: { readonly storage?: { getDirectory?(): Promise<unknown> } };
  readonly indexedDB?: IDBFactory;
}

/** The kind of files under the store. */
export type BrowserIndexKind = "opfs" | "indexeddb";

/** The OPFS folder of the index, when OPFS exists and a file can be written (WebKit before 26 has no `createWritable`). */
async function opfsFolder(env: BrowserIndexEnv): Promise<DirectoryLike | null> {
  try {
    const root = (await env.navigator?.storage?.getDirectory?.()) as DirectoryLike | undefined;
    if (root === undefined) return null;
    const folder = await root.getDirectoryHandle(BROWSER_INDEX_NAME, { create: true });
    const probe = await folder.getFileHandle(".probe", { create: true });
    if (typeof probe.createWritable !== "function") return null;
    return folder;
  } catch {
    return null;
  }
}

/** Open the index of the lab page alone; null when the page has neither OPFS nor IndexedDB. */
export async function openBrowserIndex(
  env: BrowserIndexEnv = globalThis,
  options: IndexStoreOptions = {},
): Promise<{ readonly store: IndexStore; readonly kind: BrowserIndexKind } | null> {
  const settings = { limitBytes: BROWSER_INDEX_LIMIT, ...options };
  const folder = await opfsFolder(env);
  if (folder !== null) return { store: new IndexStore(opfsBackend(folder), settings), kind: "opfs" };
  if (env.indexedDB === undefined) return null;
  try {
    const db = await openIndexDb(env.indexedDB, BROWSER_INDEX_NAME);
    return { store: new IndexStore(idbBackend(db), settings), kind: "indexeddb" };
  } catch {
    return null;
  }
}
