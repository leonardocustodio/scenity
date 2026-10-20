// SPDX-License-Identifier: Apache-2.0
/**
 * The picture store of the host: the pictures that a page shows (the
 * before and after of a turn, the sheets of a turn and of the picker, the pictures of the chat) as files
 * `<state>/pictures/<id>.<ext>`. The ID is the start of the SHA-256 of the bytes, so one picture is one file. The page
 * reads a picture at `GET /pictures/<id>` with the token header (server.ts checks the token and the sign-in) and shows
 * it as an object URL. No `data:` URL goes to the page.
 *
 * The route serves only a name of 32 hex characters in this folder, so no path of the denylist can go through it.
 * The store keeps at most `maxFiles` pictures. The oldest by modification time go first. A read touches a picture.
 *
 * In the labs app, the desktop shell re-encodes a stored JPEG as WebP (`onJpeg`). It writes `<id>.webp` and removes
 * `<id>.jpg`. The ID stays the ID of the JPEG bytes, and after that the store serves the WebP. The store also keeps
 * the MP4 of a clip of the labs app (`video/mp4`). `read` gives only pictures, and the route serves both.
 */
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  CAPTURE_MIMES,
  isPictureId,
  PICTURE_EXTENSIONS,
  PICTURE_PATH,
  type Capture,
  type CaptureMime,
  type PictureRef,
} from "./protocol";

/** The most pictures of the store: about 100 turns with 4 pictures each, the picker and a long chat. */
export const MAX_PICTURES = 4_000;
/** The store checks its size after this count of new pictures. */
const PRUNE_EVERY = 32;
const NAME = /^([0-9a-f]{32})\.(webp|jpg|png|mp4)$/;

/** The types of the store: the pictures, and the MP4 of a clip of the labs app. */
export const STORE_MIMES = [...CAPTURE_MIMES, "video/mp4"] as const;
export type StoreMime = (typeof STORE_MIMES)[number];
const STORE_EXTENSIONS: Readonly<Record<StoreMime, string>> = { ...PICTURE_EXTENSIONS, "video/mp4": "mp4" };

/** The options of a store. */
export interface PictureStoreOptions {
  readonly maxFiles?: number;
  /** Called with the path of each new JPEG file (the labs app re-encodes it as WebP). */
  readonly onJpeg?: (file: string) => void;
}

/** The ID of the bytes of a picture: the first 32 hex characters of their SHA-256. */
export function pictureId(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 32);
}

/** The bytes and the type of a stored picture. */
export interface StoredPicture {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly mime: CaptureMime;
}

export class PictureStore {
  readonly dir: string;
  readonly #maxFiles: number;
  readonly #onJpeg: ((file: string) => void) | null;
  #added = 0;

  constructor(stateDir: string, options: PictureStoreOptions = {}) {
    this.dir = join(stateDir, "pictures");
    this.#maxFiles = options.maxFiles ?? MAX_PICTURES;
    this.#onJpeg = options.onJpeg ?? null;
  }

  #file(id: string, mime: StoreMime): string {
    return join(this.dir, `${id}.${STORE_EXTENSIONS[mime]}`);
  }

  /** Store the bytes of a picture or a clip (once per content) and give its ID. */
  put(bytes: Uint8Array, mime: StoreMime): string {
    const id = pictureId(bytes);
    const file = this.#file(id, mime);
    // The WebP of a JPEG keeps the ID of the JPEG: any file of the ID is this content.
    if (this.#find(id, STORE_MIMES) !== null) return id;
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const temporary = `${file}.${randomBytes(4).toString("hex")}.tmp`;
    writeFileSync(temporary, bytes, { mode: 0o600 });
    renameSync(temporary, file);
    if (mime === "image/jpeg") this.#onJpeg?.(file);
    this.#added += 1;
    if (this.#added % PRUNE_EVERY === 0) this.prune();
    return id;
  }

  /** Store a capture and give its reference for the page. */
  ref(capture: Capture): PictureRef {
    const { simMs, width, height, mime } = capture;
    return { id: this.put(capture.bytes, mime), simMs, width, height, mime };
  }

  /** The reference of a capture, or null for no capture. */
  refOrNull(capture: Capture | null): PictureRef | null {
    return capture === null ? null : this.ref(capture);
  }

  /** True when the store has the picture. */
  has(id: string): boolean {
    return this.#find(id, STORE_MIMES) !== null;
  }

  #find<M extends StoreMime>(id: string, mimes: readonly M[]): { file: string; mime: M } | null {
    if (!isPictureId(id)) return null;
    for (const mime of mimes) {
      const file = this.#file(id, mime);
      if (existsSync(file)) return { file, mime };
    }
    return null;
  }

  /**
   * The bytes of a file of the store, or null. A read makes the file new for the pruning. The shell can
   * remove the JPEG between the find and the read (its WebP is then there), so a failed read tries again once.
   */
  #read<M extends StoreMime>(id: string, mimes: readonly M[]): { bytes: Uint8Array<ArrayBuffer>; mime: M } | null {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const found = this.#find(id, mimes);
      if (found === null) return null;
      const now = new Date();
      try {
        utimesSync(found.file, now, now);
      } catch {
        // A read-only store keeps its times.
      }
      try {
        return { bytes: readFileSync(found.file), mime: found.mime };
      } catch {
        // The file is gone (a WebP replaced it): try again.
      }
    }
    return null;
  }

  /** The bytes of a picture, or null (an MP4 is not a picture). */
  read(id: string): StoredPicture | null {
    return this.#read(id, CAPTURE_MIMES);
  }

  /** Delete the oldest pictures above `maxFiles`. */
  prune(): void {
    if (!existsSync(this.dir)) return;
    const files = readdirSync(this.dir).filter((name) => NAME.test(name));
    if (files.length <= this.#maxFiles) return;
    const dated = files.map((name) => ({ name, at: statSync(join(this.dir, name)).mtimeMs }));
    dated.sort((a, b) => a.at - b.at);
    for (const item of dated.slice(0, files.length - this.#maxFiles))
      rmSync(join(this.dir, item.name), { force: true });
  }

  /** The route `GET /pictures/<id>`: the bytes with their type, 404 for an unknown ID. Null for another path. */
  http(request: Request, url: URL): Response | null {
    if (!url.pathname.startsWith(PICTURE_PATH) || request.method !== "GET") return null;
    const id = url.pathname.slice(PICTURE_PATH.length);
    const picture = isPictureId(id) ? this.#read(id, STORE_MIMES) : null;
    if (picture === null) return new Response("No picture.", { status: 404 });
    return new Response(picture.bytes, {
      headers: {
        "content-type": picture.mime,
        // The ID is the content: a picture never changes.
        "cache-control": "private, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  }
}
