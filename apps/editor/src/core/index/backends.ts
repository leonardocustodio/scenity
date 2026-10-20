// SPDX-License-Identifier: Apache-2.0
/**
 * The files of the frame index of the lab page alone: the origin private file system (OPFS) where the browser has it,
 * else IndexedDB. The core of the store (`@scenity/labs-platform/indexStore`) is the same as in the host. Only these
 * backends are different. The Cache API fails on `tauri://`, thus the index does not use it.
 */
import type { IndexBackend } from "@scenity/labs-platform/indexStore";

/** The parts of an OPFS folder that the backend uses (the DOM types of TypeScript lack the async iterator). */
export interface DirectoryLike {
  readonly kind: "directory";
  readonly name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileLike>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  values(): AsyncIterable<DirectoryLike | FileLike>;
}

export interface FileLike {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<Blob>;
  createWritable(): Promise<{ write(data: Uint8Array<ArrayBuffer>): Promise<void>; close(): Promise<void> }>;
}

function partsOf(path: string): string[] {
  const parts = path.split("/").filter((part) => part !== "");
  if (parts.some((part) => part === "." || part === "..")) throw new Error(`The index refuses the path ${path}.`);
  return parts;
}

/** The folder of a path; null when a part is missing and `create` is false. */
async function folderOf(root: DirectoryLike, parts: readonly string[], create: boolean): Promise<DirectoryLike | null> {
  let folder = root;
  for (const part of parts) {
    try {
      folder = await folder.getDirectoryHandle(part, { create });
    } catch {
      return null;
    }
  }
  return folder;
}

async function walk(folder: DirectoryLike, path: string, out: string[]): Promise<void> {
  for await (const entry of folder.values()) {
    const child = `${path}/${entry.name}`;
    if (entry.kind === "directory") await walk(entry, child, out);
    else out.push(child);
  }
}

/** The backend in an OPFS folder. */
export function opfsBackend(root: DirectoryLike): IndexBackend {
  return {
    async read(path) {
      const parts = partsOf(path);
      const folder = await folderOf(root, parts.slice(0, -1), false);
      try {
        const file = await folder?.getFileHandle(parts.at(-1) ?? "");
        return file === undefined ? null : new Uint8Array(await (await file.getFile()).arrayBuffer());
      } catch {
        return null;
      }
    },
    async write(path, bytes) {
      const parts = partsOf(path);
      const folder = await folderOf(root, parts.slice(0, -1), true);
      const file = await folder?.getFileHandle(parts.at(-1) ?? "", { create: true });
      if (file === undefined) throw new Error(`The index cannot write ${path}.`);
      const writable = await file.createWritable();
      await writable.write(new Uint8Array(bytes));
      await writable.close();
    },
    async remove(path) {
      const parts = partsOf(path);
      const folder = await folderOf(root, parts.slice(0, -1), false);
      await folder?.removeEntry(parts.at(-1) ?? "").catch(() => undefined);
    },
    async removeTree(path) {
      const parts = partsOf(path);
      const folder = await folderOf(root, parts.slice(0, -1), false);
      await folder?.removeEntry(parts.at(-1) ?? "", { recursive: true }).catch(() => undefined);
    },
    async list(path) {
      const folder = await folderOf(root, partsOf(path), false);
      const out: string[] = [];
      if (folder !== null) await walk(folder, path, out);
      return out;
    },
  };
}

const STORE = "files";

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("IndexedDB failed."));
    };
  });
}

/** Open the IndexedDB database of the index (one object store of bytes by path). */
export function openIndexDb(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("IndexedDB did not open."));
    };
  });
}

/** The backend in IndexedDB, where OPFS is missing. */
export function idbBackend(db: IDBDatabase): IndexBackend {
  const store = (mode: IDBTransactionMode) => db.transaction(STORE, mode).objectStore(STORE);
  const under = async (path: string): Promise<string[]> => {
    partsOf(path);
    const keys = await done(store("readonly").getAllKeys());
    return keys.map(String).filter((key) => key.startsWith(`${path}/`));
  };
  return {
    async read(path) {
      partsOf(path);
      const value: unknown = await done(store("readonly").get(path));
      return value instanceof Uint8Array ? value : value instanceof ArrayBuffer ? new Uint8Array(value) : null;
    },
    async write(path, bytes) {
      partsOf(path);
      await done(store("readwrite").put(bytes.slice(), path));
    },
    async remove(path) {
      partsOf(path);
      await done(store("readwrite").delete(path));
    },
    async removeTree(path) {
      const keys = await under(path);
      // Send every delete in one transaction before the first wait. A transaction ends when it has no request.
      const objects = store("readwrite");
      await Promise.all(keys.map((key) => done(objects.delete(key))));
    },
    list: under,
  };
}
