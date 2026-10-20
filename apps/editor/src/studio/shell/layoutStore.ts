// SPDX-License-Identifier: Apache-2.0
/**
 * The store of the dock layout of the editor window: the layout of the person, kept in the browser storage of the
 * page. If there is no storage (a private window), the store keeps nothing, and each start uses the default layout.
 * The workspaces and the copy in the user state of the studio host use this store.
 */

/** The storage key of the layout (one per person and browser). */
export const LAYOUT_KEY = "scenity.studio.layout";

export interface LayoutStore {
  read(): unknown;
  write(layout: unknown): void;
  clear(): void;
}

/** A layout store over a key of a storage. */
export function storageLayoutStore(key: string = LAYOUT_KEY, storage: () => Storage = () => localStorage): LayoutStore {
  return {
    read: () => {
      try {
        const text = storage().getItem(key);
        return text === null ? null : (JSON.parse(text) as unknown);
      } catch {
        return null;
      }
    },
    write: (layout) => {
      try {
        storage().setItem(key, JSON.stringify(layout));
      } catch {
        // No storage: the layout stays for this page only.
      }
    },
    clear: () => {
      try {
        storage().removeItem(key);
      } catch {
        // No storage.
      }
    },
  };
}

/** A layout store in memory (the tests). */
export function memoryLayoutStore(initial: unknown = null): LayoutStore & { value: unknown } {
  const store = {
    value: initial,
    read: () => store.value,
    write: (layout: unknown) => {
      store.value = layout;
    },
    clear: () => {
      store.value = null;
    },
  };
  return store;
}
