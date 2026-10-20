// SPDX-License-Identifier: Apache-2.0
/**
 * The pictures of the host by ID: the before and after of a turn, the sheets, the pictures of the chat and of the
 * picker. The page reads a picture at `GET /pictures/<id>` with the token header (the host is another origin: CORS),
 * keeps it as a Blob and shows it as an object URL. No `data:` URL goes into the DOM.
 *
 * Each view that shows a picture acquires its URL and releases it when it stops. The cache revokes an object URL
 * `keepMs` after its last release. Thus a view that comes back soon (a tab, a turn list) loads nothing again. This
 * module has no framework. `PictureImg.vue` connects it to Vue.
 */
import { PICTURE_ID_PATTERN, PICTURE_PATH, TOKEN_HEADER, type HostEndpoint } from "@scenity/workbench-host/protocol";

/** The source of the object URLs of the pictures. */
export interface PictureSource {
  /** The object URL of a picture. Each call needs one `release`. */
  acquire(id: string): Promise<string>;
  release(id: string): void;
}

export interface PictureCacheOptions {
  readonly endpoint: HostEndpoint;
  readonly fetch?: typeof fetch;
  readonly createUrl?: (blob: Blob) => string;
  readonly revokeUrl?: (url: string) => void;
  /** The time that an unused picture stays (ms; default 30 s). */
  readonly keepMs?: number;
}

interface Entry {
  url: Promise<string>;
  count: number;
  timer: ReturnType<typeof setTimeout> | null;
  /** The object URL after the load, or null. */
  made: string | null;
}

/** The default time that an unused picture stays (ms). */
export const KEEP_MS = 30_000;

export class PictureCache implements PictureSource {
  readonly #options: PictureCacheOptions;
  readonly #entries = new Map<string, Entry>();

  constructor(options: PictureCacheOptions) {
    this.#options = options;
  }

  /** The count of pictures in the cache (the tests). */
  get size(): number {
    return this.#entries.size;
  }

  async #load(id: string, entry: () => Entry | undefined): Promise<string> {
    const { endpoint } = this.#options;
    const get = this.#options.fetch ?? fetch;
    const response = await get(`${endpoint.origin}${PICTURE_PATH}${id}`, {
      headers: { [TOKEN_HEADER]: endpoint.token },
    });
    if (!response.ok) throw new Error(`The host has no picture ${id} (${String(response.status)}).`);
    const url = this.#create(await response.blob());
    const kept = entry();
    if (kept === undefined) this.#revoke(url);
    else kept.made = url;
    return url;
  }

  acquire(id: string): Promise<string> {
    if (!PICTURE_ID_PATTERN.test(id)) return Promise.reject(new Error(`Not a picture ID: ${id}`));
    let entry = this.#entries.get(id);
    if (entry === undefined) {
      const made: Entry = { url: Promise.resolve(""), count: 0, timer: null, made: null };
      made.url = this.#load(id, () => (this.#entries.get(id) === made ? made : undefined));
      // A failed load leaves the cache, so a later view tries again.
      made.url.catch(() => {
        if (this.#entries.get(id) === made) this.#entries.delete(id);
      });
      this.#entries.set(id, made);
      entry = made;
    }
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.timer = null;
    entry.count += 1;
    return entry.url;
  }

  release(id: string): void {
    const entry = this.#entries.get(id);
    if (entry === undefined || entry.count === 0) return;
    entry.count -= 1;
    if (entry.count > 0) return;
    entry.timer = setTimeout(() => this.#drop(id, entry), this.#options.keepMs ?? KEEP_MS);
  }

  #drop(id: string, entry: Entry): void {
    if (this.#entries.get(id) !== entry || entry.count > 0) return;
    this.#entries.delete(id);
    if (entry.made !== null) this.#revoke(entry.made);
  }

  #create(blob: Blob): string {
    return this.#options.createUrl === undefined ? URL.createObjectURL(blob) : this.#options.createUrl(blob);
  }

  #revoke(url: string): void {
    if (this.#options.revokeUrl === undefined) URL.revokeObjectURL(url);
    else this.#options.revokeUrl(url);
  }

  /** Revoke every object URL (the client closes). */
  clear(): void {
    for (const [id, entry] of [...this.#entries]) {
      if (entry.timer !== null) clearTimeout(entry.timer);
      entry.count = 0;
      this.#drop(id, entry);
    }
  }
}

/** The source of the page now: the cache of the host client (one per page), or null before a client. */
let active: PictureSource | null = null;

/** Set the source of the page (the host client; a test gives a fake). */
export function setPictureSource(source: PictureSource | null): void {
  active = source;
}

/** The source of the page, or null. */
export function pictureSource(): PictureSource | null {
  return active;
}
