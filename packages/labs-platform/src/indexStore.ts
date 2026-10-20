// SPDX-License-Identifier: Apache-2.0
/**
 * The frame index store: the pictures of the time line at fixed steps, kept under their frame key, with a manifest
 * per take (the frames, their metrics and the clip lanes). One core with one interface for two places:
 *
 * - the host: files under its state folder (`packages/workbench-host/src/index/`), limit 2 GB;
 * - the lab page alone in a browser: OPFS, or IndexedDB where OPFS is missing (`apps/editor/src/core/index/`), 200 MB.
 *
 * The layout: `index/<contentHash>/<take key>/<step>/<time>-<view>-<size>.<ext>` and
 * `index/<contentHash>/<take key>/manifest.json`. Above the limit the store trims the content hashes that were used
 * longest ago first (an old content hash is old code), then the oldest frames of the last content hash.
 *
 * The module is pure: each place gives an `IndexBackend` of its files.
 */
import { frameKey, isFrameKey, keyTime, takeKeyOf, viewKeyOf, type FrameKeyInput } from "./frameKey";

/** The picture types of the index. */
export const INDEX_MIMES = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" } as const;
export type IndexMime = keyof typeof INDEX_MIMES;

/** The limits of the store: 2 GB in the host, 200 MB in the lab page alone. */
export const HOST_INDEX_LIMIT = 2 * 1024 ** 3;
export const BROWSER_INDEX_LIMIT = 200 * 1024 ** 2;

/** The files of a store, by relative path with `/`. Each method may be async. */
export interface IndexBackend {
  read(path: string): Promise<Uint8Array | null>;
  write(path: string, bytes: Uint8Array): Promise<void>;
  /** Remove a file; no error when it is gone. */
  remove(path: string): Promise<void>;
  /** Remove a folder and everything in it; no error when it is gone. */
  removeTree(path: string): Promise<void>;
  /** Every file under a folder (recursive), as paths relative to the store; empty when the folder is gone. */
  list(path: string): Promise<string[]>;
}

/** A frame of the index. */
export interface IndexFrame {
  readonly key: string;
  readonly timeMs: number;
  /** The step of the time line that the frame belongs to: 1000, 100, or 1 for a free time (a moment). */
  readonly step: number;
  /** The view in the file name (`viewKeyOf`). */
  readonly view: string;
  /** The width in px (160, 640; 1280 on demand). */
  readonly size: number;
  readonly mime: IndexMime;
  readonly bytes: number;
  /** The file, relative to the store. */
  readonly file: string;
  /** The metric values of the frame, or null. */
  readonly metrics: Readonly<Record<string, number>> | null;
  /**
   * The pose families that the renderer called for the frame, or null (absent) when the renderer did not record them.
   * A frame with its reads can move to a new content hash (contentParts.ts).
   */
  readonly reads?: readonly string[] | null;
  used: number;
}

/** The manifest of one take under one content hash. */
export interface TakeManifest {
  readonly version: 1;
  readonly contentHash: string;
  /** The take key (`takeKeyOf`). */
  readonly take: string;
  /** The source of the take (`take:<name>` or `track:<name>`), for the readers. */
  readonly source: string;
  used: number;
  frames: IndexFrame[];
  /** The clip lanes of the members over the take, or null. */
  lanes: unknown;
}

/** A frame to keep. */
export interface IndexPut {
  readonly input: FrameKeyInput;
  readonly size: number;
  readonly mime: IndexMime;
  readonly bytes: Uint8Array;
  readonly metrics?: Readonly<Record<string, number>> | null;
  /** The pose families that the renderer called for the frame (IndexFrame.reads). */
  readonly reads?: readonly string[] | null;
}

/** A frame of the index with its bytes. */
export interface IndexHit {
  readonly frame: IndexFrame;
  readonly bytes: Uint8Array;
}

/** The use of one content hash. */
export interface ContentUse {
  readonly contentHash: string;
  readonly bytes: number;
  readonly frames: number;
  readonly used: number;
}

/** The interface of both stores (the host and the lab page alone). */
export interface FrameIndexStore {
  /** Keep a frame; give its record. A frame with the same key and size replaces the old one. */
  put(frame: IndexPut): Promise<IndexFrame>;
  /** The frame of a key at a size (absent: the smallest size), or null. A hit makes the frame and its take new. */
  get(key: string, size?: number): Promise<IndexHit | null>;
  has(key: string, size?: number): Promise<boolean>;
  /** The manifest of a take: by the input of any frame of the take (its time and view do not matter). */
  manifest(input: FrameKeyInput): Promise<TakeManifest | null>;
  /** Set the clip lanes of a take. */
  setLanes(input: FrameKeyInput, lanes: unknown): Promise<void>;
  /** The bytes of all frames. */
  usage(): Promise<number>;
  /** The content hashes in the store, the newest use first. */
  contents(): Promise<ContentUse[]>;
  /** Write the changed manifests at once. */
  flush(): Promise<void>;
  /** Remove every frame. */
  clear(): Promise<void>;
}

export interface IndexStoreOptions {
  /** The byte limit; the default is the host limit. */
  readonly limitBytes?: number;
  /** The clock of the use times (a test gives a counter). */
  readonly now?: () => number;
  /** Write the changed manifests after this delay (ms); 0 writes at each change. */
  readonly flushDelayMs?: number;
}

const ROOT = "index";

/** The step of a time: 1000 for a whole second, 100 for a step of 100 ms, else 1 (a moment). */
export function stepOf(timeMs: number): number {
  const time = keyTime(timeMs);
  if (time % 1000 === 0) return 1000;
  return time % 100 === 0 ? 100 : 1;
}

function takeDir(contentHash: string, take: string): string {
  return `${ROOT}/${contentHash}/${take}`;
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function isManifest(value: unknown): value is TakeManifest {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Partial<TakeManifest>;
  return (
    item.version === 1 && isFrameKey(item.contentHash) && typeof item.take === "string" && Array.isArray(item.frames)
  );
}

/** The core of both stores over a backend of files. */
export class IndexStore implements FrameIndexStore {
  readonly #backend: IndexBackend;
  readonly #limit: number;
  readonly #now: () => number;
  readonly #flushDelay: number;
  /** The manifests by `<contentHash>/<take>`. */
  readonly #takes = new Map<string, TakeManifest>();
  /** The frames by key, then by size. */
  readonly #frames = new Map<string, Map<number, { take: string; frame: IndexFrame }>>();
  readonly #dirty = new Set<string>();
  #total = 0;
  #loading: Promise<void> | null = null;
  #lock: Promise<unknown> = Promise.resolve();
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(backend: IndexBackend, options: IndexStoreOptions = {}) {
    this.#backend = backend;
    this.#limit = options.limitBytes ?? HOST_INDEX_LIMIT;
    this.#now = options.now ?? Date.now;
    this.#flushDelay = options.flushDelayMs ?? 250;
  }

  /** Run one change at a time (a put, a trim, a clear). */
  #locked<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#lock.then(work, work);
    this.#lock = next.catch(() => undefined);
    return next;
  }

  #load(): Promise<void> {
    this.#loading ??= (async () => {
      for (const path of await this.#backend.list(ROOT)) {
        if (!path.endsWith("/manifest.json")) continue;
        const bytes = await this.#backend.read(path);
        let value: unknown = null;
        try {
          value = bytes === null ? null : JSON.parse(decoder.decode(bytes));
        } catch {
          // A broken manifest: its frames are lost; the indexer makes them again.
        }
        if (isManifest(value)) this.#adopt(value);
      }
    })();
    return this.#loading;
  }

  #adopt(manifest: TakeManifest): void {
    const id = `${manifest.contentHash}/${manifest.take}`;
    this.#takes.set(id, manifest);
    for (const frame of manifest.frames) this.#index(id, frame);
  }

  #index(take: string, frame: IndexFrame): void {
    let sizes = this.#frames.get(frame.key);
    if (sizes === undefined) {
      sizes = new Map();
      this.#frames.set(frame.key, sizes);
    }
    sizes.set(frame.size, { take, frame });
    this.#total += frame.bytes;
  }

  #unindex(frame: IndexFrame): void {
    const sizes = this.#frames.get(frame.key);
    if (sizes?.get(frame.size)?.frame !== frame) return;
    sizes.delete(frame.size);
    if (sizes.size === 0) this.#frames.delete(frame.key);
    this.#total -= frame.bytes;
  }

  #takeOf(input: FrameKeyInput): TakeManifest {
    const take = takeKeyOf(input);
    const id = `${input.contentHash}/${take}`;
    let manifest = this.#takes.get(id);
    if (manifest === undefined) {
      manifest = {
        version: 1,
        contentHash: input.contentHash,
        take,
        source: input.source,
        used: 0,
        frames: [],
        lanes: null,
      };
      this.#takes.set(id, manifest);
    }
    return manifest;
  }

  #touch(manifest: TakeManifest, frame?: IndexFrame): void {
    const now = this.#now();
    manifest.used = now;
    if (frame !== undefined) frame.used = now;
    this.#dirty.add(`${manifest.contentHash}/${manifest.take}`);
    this.#schedule();
  }

  #schedule(): void {
    if (this.#flushDelay <= 0) {
      void this.flush();
      return;
    }
    this.#timer ??= setTimeout(() => {
      this.#timer = null;
      void this.flush();
    }, this.#flushDelay);
  }

  put(item: IndexPut): Promise<IndexFrame> {
    if (!isFrameKey(item.input.contentHash))
      return Promise.reject(new Error("The content hash must be 32 hex characters."));
    if (!Number.isInteger(item.size) || item.size <= 0)
      return Promise.reject(new Error("The size must be a whole px count."));
    return this.#locked(async () => {
      await this.#load();
      const manifest = this.#takeOf(item.input);
      const key = frameKey(item.input);
      const time = keyTime(item.input.timeMs);
      const step = stepOf(time);
      const view = viewKeyOf(item.input.view);
      const file = `${takeDir(manifest.contentHash, manifest.take)}/${String(step)}/${String(time)}-${view}-${String(item.size)}.${INDEX_MIMES[item.mime]}`;
      const old = this.#frames.get(key)?.get(item.size);
      if (old !== undefined) await this.#drop(old.frame);
      await this.#backend.write(file, item.bytes);
      const frame: IndexFrame = {
        key,
        timeMs: time,
        step,
        view,
        size: item.size,
        mime: item.mime,
        bytes: item.bytes.length,
        file,
        metrics: item.metrics ?? null,
        ...(item.reads === undefined || item.reads === null ? {} : { reads: [...item.reads].sort() }),
        used: 0,
      };
      manifest.frames.push(frame);
      this.#index(`${manifest.contentHash}/${manifest.take}`, frame);
      this.#touch(manifest, frame);
      await this.#trim(manifest.contentHash);
      return frame;
    });
  }

  /** Remove one frame: its file, its record and its place in the manifest. */
  async #drop(frame: IndexFrame): Promise<void> {
    const found = this.#frames.get(frame.key)?.get(frame.size);
    this.#unindex(frame);
    if (found !== undefined) {
      const manifest = this.#takes.get(found.take);
      if (manifest !== undefined) {
        manifest.frames = manifest.frames.filter((item) => item !== frame);
        this.#dirty.add(found.take);
      }
    }
    await this.#backend.remove(frame.file);
  }

  /** Remove every frame of a content hash. */
  async #dropContent(contentHash: string): Promise<void> {
    for (const [id, manifest] of [...this.#takes]) {
      if (manifest.contentHash !== contentHash) continue;
      for (const frame of manifest.frames) this.#unindex(frame);
      this.#takes.delete(id);
      this.#dirty.delete(id);
    }
    await this.#backend.removeTree(`${ROOT}/${contentHash}`);
  }

  /** Above the limit: the oldest content hashes go first, then the oldest frames of `keep` (the newest put). */
  async #trim(keep: string): Promise<void> {
    if (this.#total <= this.#limit) return;
    for (const use of this.#uses().reverse()) {
      if (this.#total <= this.#limit) return;
      if (use.contentHash !== keep) await this.#dropContent(use.contentHash);
    }
    const frames = [...this.#takes.values()].flatMap((manifest) => manifest.frames);
    frames.sort((a, b) => a.used - b.used);
    for (const frame of frames) {
      if (this.#total <= this.#limit) return;
      await this.#drop(frame);
    }
  }

  #uses(): ContentUse[] {
    const uses = new Map<string, { bytes: number; frames: number; used: number }>();
    for (const manifest of this.#takes.values()) {
      const use = uses.get(manifest.contentHash) ?? { bytes: 0, frames: 0, used: 0 };
      for (const frame of manifest.frames) use.bytes += frame.bytes;
      use.frames += manifest.frames.length;
      use.used = Math.max(use.used, manifest.used);
      uses.set(manifest.contentHash, use);
    }
    return [...uses].map(([contentHash, use]) => ({ contentHash, ...use })).sort((a, b) => b.used - a.used);
  }

  async get(key: string, size?: number): Promise<IndexHit | null> {
    await this.#load();
    const found = this.#find(key, size);
    if (found === null) return null;
    const bytes = await this.#backend.read(found.frame.file);
    if (bytes === null) return null;
    const manifest = this.#takes.get(found.take);
    if (manifest !== undefined) this.#touch(manifest, found.frame);
    return { frame: found.frame, bytes };
  }

  #find(key: string, size?: number): { take: string; frame: IndexFrame } | null {
    const sizes = this.#frames.get(key);
    if (sizes === undefined) return null;
    if (size !== undefined) return sizes.get(size) ?? null;
    const smallest = Math.min(...sizes.keys());
    return sizes.get(smallest) ?? null;
  }

  async has(key: string, size?: number): Promise<boolean> {
    await this.#load();
    return this.#find(key, size) !== null;
  }

  async manifest(input: FrameKeyInput): Promise<TakeManifest | null> {
    await this.#load();
    return this.#takes.get(`${input.contentHash}/${takeKeyOf(input)}`) ?? null;
  }

  /** The manifest of a take by its content hash and take key (the route of the host), or null. */
  async manifestAt(contentHash: string, take: string): Promise<TakeManifest | null> {
    await this.#load();
    return this.#takes.get(`${contentHash}/${take}`) ?? null;
  }

  setLanes(input: FrameKeyInput, lanes: unknown): Promise<void> {
    return this.#locked(async () => {
      await this.#load();
      const manifest = this.#takeOf(input);
      manifest.lanes = lanes;
      this.#touch(manifest);
    });
  }

  async usage(): Promise<number> {
    await this.#load();
    return this.#total;
  }

  async contents(): Promise<ContentUse[]> {
    await this.#load();
    return this.#uses();
  }

  flush(): Promise<void> {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    return this.#locked(async () => {
      for (const id of [...this.#dirty]) {
        this.#dirty.delete(id);
        const manifest = this.#takes.get(id);
        if (manifest === undefined) continue;
        const [contentHash = "", take = ""] = id.split("/");
        await this.#backend.write(
          `${takeDir(contentHash, take)}/manifest.json`,
          encoder.encode(JSON.stringify(manifest)),
        );
      }
    });
  }

  clear(): Promise<void> {
    return this.#locked(async () => {
      await this.#load();
      this.#takes.clear();
      this.#frames.clear();
      this.#dirty.clear();
      this.#total = 0;
      await this.#backend.removeTree(ROOT);
    });
  }
}
