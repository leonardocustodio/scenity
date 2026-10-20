// SPDX-License-Identifier: Apache-2.0
/**
 * Fakes of OPFS and IndexedDB for the tests of the frame index of the lab page: happy-dom has neither. Each
 * fake keeps its files in a map that a second store can open again (a restart of the page).
 */
import type { DirectoryLike, FileLike } from "../../src/core/index/backends";

/** The files of a fake OPFS: folders are maps, files are bytes. */
export type Tree = Map<string, Tree | Uint8Array>;

function fakeFile(parent: Tree, name: string): FileLike {
  return {
    kind: "file",
    name,
    getFile() {
      const bytes = parent.get(name);
      if (!(bytes instanceof Uint8Array)) return Promise.reject(new Error("NotFoundError"));
      return Promise.resolve(new Blob([bytes.slice()]));
    },
    createWritable() {
      const parts: Uint8Array[] = [];
      return Promise.resolve({
        write(data: Uint8Array) {
          parts.push(data.slice());
          return Promise.resolve();
        },
        close() {
          const length = parts.reduce((total, part) => total + part.length, 0);
          const bytes = new Uint8Array(length);
          let offset = 0;
          for (const part of parts) {
            bytes.set(part, offset);
            offset += part.length;
          }
          parent.set(name, bytes);
          return Promise.resolve();
        },
      });
    },
  };
}

/** A fake OPFS folder over a tree in memory. */
export function fakeOpfs(tree: Tree = new Map(), name = ""): DirectoryLike {
  return {
    kind: "directory",
    name,
    getDirectoryHandle(child, options) {
      let found = tree.get(child);
      if (found === undefined && options?.create === true) {
        found = new Map();
        tree.set(child, found);
      }
      if (!(found instanceof Map)) return Promise.reject(new Error("NotFoundError"));
      return Promise.resolve(fakeOpfs(found, child));
    },
    getFileHandle(child, options) {
      const found = tree.get(child);
      if (found instanceof Map) return Promise.reject(new Error("TypeMismatchError"));
      if (found === undefined) {
        if (options?.create !== true) return Promise.reject(new Error("NotFoundError"));
        tree.set(child, new Uint8Array(0));
      }
      return Promise.resolve(fakeFile(tree, child));
    },
    removeEntry(child, options) {
      const found = tree.get(child);
      if (found === undefined) return Promise.reject(new Error("NotFoundError"));
      if (found instanceof Map && found.size > 0 && options?.recursive !== true) {
        return Promise.reject(new Error("InvalidModificationError"));
      }
      tree.delete(child);
      return Promise.resolve();
    },
    async *values() {
      for (const [child, value] of [...tree]) {
        yield await Promise.resolve(value instanceof Map ? fakeOpfs(value, child) : fakeFile(tree, child));
      }
    },
  };
}

/** A request that succeeds on the next task, as IndexedDB does. */
function request<T>(work: () => T): IDBRequest<T> {
  const fake = { result: undefined as T, error: null, onsuccess: null, onerror: null } as unknown as IDBRequest<T> & {
    result: T;
  };
  setTimeout(() => {
    fake.result = work();
    fake.onsuccess?.call(fake, new Event("success"));
  }, 0);
  return fake;
}

/** A fake IndexedDB factory: one object store per database, the values by key, kept in `data`. */
export function fakeIndexedDb(data = new Map<string, Map<string, unknown>>()): IDBFactory {
  const open = (name: string): IDBOpenDBRequest => {
    const fresh = !data.has(name);
    if (fresh) data.set(name, new Map());
    const rows = data.get(name)!;
    const names = new Set<string>(fresh ? [] : ["files"]);
    const objectStore = {
      get: (key: string) => request(() => rows.get(key)),
      put: (value: unknown, key: string) => request(() => void rows.set(key, value)),
      delete: (key: string) => request(() => void rows.delete(key)),
      getAllKeys: () => request(() => [...rows.keys()]),
    };
    const db = {
      objectStoreNames: { contains: (store: string) => names.has(store) },
      createObjectStore: (store: string) => names.add(store),
      transaction: () => ({ objectStore: () => objectStore }),
    };
    const fake = {
      result: db,
      error: null,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
    } as unknown as IDBOpenDBRequest;
    setTimeout(() => {
      if (fresh) fake.onupgradeneeded?.call(fake, new Event("upgradeneeded") as IDBVersionChangeEvent);
      fake.onsuccess?.call(fake, new Event("success"));
    }, 0);
    return fake;
  };
  return { open } as unknown as IDBFactory;
}
