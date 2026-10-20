// SPDX-License-Identifier: Apache-2.0
/**
 * The cache of the frame strip: the pictures of the frames in the memory of the page and in IndexedDB. IndexedDB keeps
 * 50 MB, and the frames with the most recent use stay. A key holds the content hash of the files that a frame uses
 * (index/stripKey.ts). Thus a frame of older code never shows, and the frames stay after a restart of the dev server.
 * Each read and write can fail (a private window), and then the strip uses only the memory. The memory keeps the last
 * MEMORY_FRAMES frames. A write adds to a total of the bytes, so it does not read the full store.
 */
const DB = { name: "room3d-lab-strip", store: "frames", version: 1 } as const;
const LIMIT_BYTES = 50 * 1024 * 1024;

/** A frame of the strip: its picture and the simulation time of the frame that the scene drew. */
export interface StripFrame {
  readonly blob: Blob;
  readonly simMs: number;
}

interface Row extends StripFrame {
  readonly key: string;
  readonly bytes: number;
  used: number;
}

/** The frames in the memory of the page, with the last used frame at the end (at most MEMORY_FRAMES). */
const memory = new Map<string, StripFrame>();
/** The frames that the memory of the page keeps: 8 strips of 32 frames. */
const MEMORY_FRAMES = 256;
let opening: Promise<IDBDatabase | null> | null = null;
/** The bytes in IndexedDB. The value is null until the first write reads the store. */
let stored: number | null = null;

/** Keep a frame in the memory as the last used frame. Above MEMORY_FRAMES, the least recently used frame goes. */
function remember(key: string, frame: StripFrame): void {
  memory.delete(key);
  memory.set(key, frame);
  for (const old of memory.keys()) {
    if (memory.size <= MEMORY_FRAMES) break;
    memory.delete(old);
  }
}

function open(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      const request = globalThis.indexedDB.open(DB.name, DB.version);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(DB.store, { keyPath: "key" });
      };
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        resolve(null);
      };
    } catch {
      resolve(null);
    }
  });
  return opening;
}

function done<T>(request: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      resolve(null);
    };
  });
}

/** A frame of the cache, or null. */
export async function readFrame(key: string): Promise<StripFrame | null> {
  const kept = memory.get(key);
  if (kept !== undefined) {
    remember(key, kept);
    return kept;
  }
  const db = await open();
  if (db === null) return null;
  try {
    const store = db.transaction(DB.store, "readwrite").objectStore(DB.store);
    const row = (await done(store.get(key))) as Row | undefined | null;
    if (row === undefined || row === null) return null;
    row.used = Date.now();
    store.put(row);
    const frame = { blob: row.blob, simMs: row.simMs };
    remember(key, frame);
    return frame;
  } catch {
    return null;
  }
}

/** Keep a frame in the memory (the last MEMORY_FRAMES) and in IndexedDB. Above the limit, the oldest frames go. */
export async function writeFrame(key: string, frame: StripFrame): Promise<void> {
  remember(key, frame);
  const db = await open();
  if (db === null) return;
  try {
    const store = db.transaction(DB.store, "readwrite").objectStore(DB.store);
    const row: Row = { key, ...frame, bytes: frame.blob.size, used: Date.now() };
    store.put(row);
    // A total of the bytes of the store, so a write does not read each row. The first write reads the store one time.
    // A total above the limit reads the store again (another tab can also write to it) and trims it.
    stored ??= await storedBytes(db);
    if (stored === null) return;
    // A frame that replaces a frame of the same key counts two times. Thus the total can be more than the bytes of the
    // store. The trim reads the true total.
    stored += row.bytes;
    if (stored > LIMIT_BYTES) stored = await trim(db);
  } catch {
    // The memory keeps the frame.
  }
}

/** The current bytes of the store (one read of each row), or null when the read fails. */
async function storedBytes(db: IDBDatabase): Promise<number | null> {
  const store = db.transaction(DB.store, "readonly").objectStore(DB.store);
  const rows = (await done(store.getAll())) as Row[] | null;
  return rows === null ? null : rows.reduce((sum, row) => sum + row.bytes, 0);
}

/** Remove the least recently used frames until the store is in the limit. Returns the bytes that stay. */
async function trim(db: IDBDatabase): Promise<number | null> {
  const store = db.transaction(DB.store, "readwrite").objectStore(DB.store);
  const rows = ((await done(store.getAll())) ?? []) as Row[];
  let total = rows.reduce((sum, row) => sum + row.bytes, 0);
  if (total <= LIMIT_BYTES) return total;
  const write = db.transaction(DB.store, "readwrite").objectStore(DB.store);
  for (const row of rows.sort((a, b) => a.used - b.used)) {
    if (total <= LIMIT_BYTES) break;
    write.delete(row.key);
    total -= row.bytes;
  }
  return total;
}

/** Remove the frames whose key starts with `prefix` (Refresh frames). */
export async function dropFrames(prefix: string): Promise<void> {
  for (const key of [...memory.keys()]) if (key.startsWith(prefix)) memory.delete(key);
  const db = await open();
  if (db === null) return;
  try {
    const store = db.transaction(DB.store, "readwrite").objectStore(DB.store);
    const keys = ((await done(store.getAllKeys())) ?? []) as string[];
    const write = db.transaction(DB.store, "readwrite").objectStore(DB.store);
    for (const key of keys) if (key.startsWith(prefix)) write.delete(key);
    // The next write reads the total of the store again.
    stored = null;
  } catch {
    // Nothing to remove.
  }
}
