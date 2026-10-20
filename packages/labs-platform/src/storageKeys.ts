// SPDX-License-Identifier: Apache-2.0
/**
 * The browser storage keys of Scenity. The keys start with `scenity.`. Before the rename, they started with
 * `codeblue.`. A read of a new key that finds no value reads the old key once, moves its value to the new key and
 * removes the old key. Thus the saved layouts of the owner stay.
 *
 * Browser code without a framework. A test gives a fake storage.
 */

/** The parts of `localStorage` or `sessionStorage` that the move uses. Without the write parts, the read only reads. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem?(key: string, value: string): void;
  removeItem?(key: string): void;
}

/** The prefix of the keys. */
export const STORAGE_PREFIX = "scenity.";
/** The prefix of the old keys. */
export const OLD_STORAGE_PREFIX = "codeblue.";

/** The old key of a key: `scenity.x` gives `codeblue.x`. Another key gives null. */
export function oldStorageKey(key: string): string | null {
  return key.startsWith(STORAGE_PREFIX) ? `${OLD_STORAGE_PREFIX}${key.slice(STORAGE_PREFIX.length)}` : null;
}

/**
 * The value of a key. When the key has no value and its old key has one, the value moves to the key. A storage that
 * refuses the write still gives the old value.
 */
export function storageItem(storage: StorageLike, key: string): string | null {
  const value = storage.getItem(key);
  if (value !== null) return value;
  const old = oldStorageKey(key);
  const oldValue = old === null ? null : storage.getItem(old);
  if (old === null || oldValue === null) return null;
  try {
    if (storage.setItem === undefined || storage.removeItem === undefined) return oldValue;
    storage.setItem(key, oldValue);
    storage.removeItem(old);
  } catch {
    // A full or blocked storage keeps the old key. The next read moves it again.
  }
  return oldValue;
}
