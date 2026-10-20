// SPDX-License-Identifier: Apache-2.0
/**
 * The frame index of the host: the store of files under the state folder, the job queue, the content hash of the
 * open checkout, the `index.*` requests, the binary frames of the renderers, the routes `GET /index/<key>`,
 * `GET /index/take/<contentHash>/<take>` and `GET /index/manifest/<contentHash>/<take>`, and the `index.progress`
 * events. The server checks the token and the sign-in before a route runs (server.ts). The routes serve only names
 * of hex characters inside the index folder, so no path of the denylist goes through them.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { sendBridgeCall, URL_CALL } from "@scenity/bridge";
import { ContentHasher, fsContentReader, type ContentConfig, type FsLike } from "@scenity/labs-platform/contentHash";
import { carries, changedFamilies, type ContentSnapshot } from "@scenity/labs-platform/contentParts";
import { frameKey, isFrameKey } from "@scenity/labs-platform/frameKey";
import type { FrameIndexSource } from "@scenity/labs-platform/indexSource";
import { takeIndexOf } from "@scenity/labs-platform/indexRead";
import {
  INDEX_MIMES,
  IndexStore,
  type IndexHit,
  type IndexMime,
  type IndexPut,
} from "@scenity/labs-platform/indexStore";
import { isDenied } from "../denylist";
import { INDEX_PATH, readIndexFrame, type IndexFrameData } from "../indexProtocol";
import type { BridgeEvent, HostEvent, SurfaceWhere } from "../protocol";
import type { Router } from "../router";
import type { SurfacePort } from "../tools/context";
import { builtInIndexSource } from "../plugins";
import type { PageClient } from "../server";
import { fileBackend } from "./files";
import { focusOfUrl, IndexQueue, wireJob, type IndexJob } from "./queue";

/** The largest picture of a job: a 1280 px frame is about 110 KB of WebP. */
const MAX_FRAME_BYTES = 8 * 1024 * 1024;
/** The most jobs of one `index.next`. */
const MAX_TAKE = 64;
/** `index.shadow` waits this long for the shadow frame before it answers "not ready" (ms). */
const SHADOW_WAIT_MS = 100;
/** The snapshots of the content hashes that the host keeps (the newest first) for the carry of frames. */
const SNAPSHOTS = 16;

export interface HostIndexOptions {
  readonly stateDir: string;
  readonly broadcast: (event: HostEvent) => void;
  /** The open checkout: the content hash reads its workspace files (the repo root). */
  readonly checkout: () => string;
  /**
   * The frame index source of the project of the open checkout: its content config and the plans that
   * the host fills with no page (default: the lab of this checkout, with no plans).
   */
  readonly source?: () => FrameIndexSource;
  /** The ID of the surface that fills the index (the index capability). Absent: each surface (a test). */
  readonly surface?: () => string | null;
  readonly limitBytes?: number;
  readonly now?: () => number;
}

const nodeFs: FsLike = { readdirSync, readFileSync, statSync, existsSync };

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The content hash of a checkout: the files of `<checkout>` that a frame depends on. */
export function checkoutHasher(checkout: string, content: ContentConfig = builtInIndexSource().content): ContentHasher {
  const reader = fsContentReader(nodeFs, checkout, content);
  // The denylist applies to every file that the host reads; contentHash.ts leaves the same files out.
  return new ContentHasher({ ...reader, files: () => reader.files().filter((path) => !isDenied(path)) }, sha256);
}

function needNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error(`${name} must be a whole number.`);
  return value;
}

function isIndexMime(value: unknown): value is IndexMime {
  return typeof value === "string" && Object.hasOwn(INDEX_MIMES, value);
}

/** The reads of an `index.done`: a list of family names, else null (unknown). */
function readsOf(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length > 256) return null;
  return value.every((item) => typeof item === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(item))
    ? (value as string[])
    : null;
}

export class HostIndex {
  readonly store: IndexStore;
  readonly queue: IndexQueue;
  readonly #options: HostIndexOptions;
  readonly #hashers = new Map<string, ContentHasher>();
  /** The snapshots of the content hashes, the newest first (Map order: the oldest first). */
  readonly #snapshots = new Map<string, ContentSnapshot>();
  /** The frames that moved to a new content hash with no render. */
  #carried = 0;
  /** The bytes of each renderer page, by job, until its `index.done`. */
  readonly #pending = new Map<number, Map<number, IndexFrameData>>();

  constructor(options: HostIndexOptions) {
    this.#options = options;
    const now = options.now === undefined ? {} : { now: options.now };
    this.store = new IndexStore(fileBackend(options.stateDir), {
      ...now,
      ...(options.limitBytes === undefined ? {} : { limitBytes: options.limitBytes }),
    });
    this.queue = new IndexQueue(now);
  }

  /** The current content hash of the open checkout. A change makes the jobs of the old hash stale. */
  contentHash(): string {
    return this.#checkHash().hash;
  }

  /** The current content hash, and the jobs of the new hash after a change (else none). */
  #checkHash(): { readonly hash: string; readonly added: readonly IndexJob[] } {
    const checkout = this.#options.checkout();
    let hasher = this.#hashers.get(checkout);
    if (hasher === undefined) {
      hasher = checkoutHasher(checkout, this.#source().content);
      this.#hashers.set(checkout, hasher);
    }
    const hash = hasher.hash();
    // The snapshot of a new hash (the digests and the family parts) for the carry of frames.
    if (!this.#snapshots.has(hash)) {
      const snapshot = hasher.snapshot();
      this.#snapshots.set(snapshot.hash, snapshot);
      for (const old of this.#snapshots.keys()) {
        if (this.#snapshots.size <= SNAPSHOTS) break;
        this.#snapshots.delete(old);
      }
    }
    if (this.queue.contentHash === hash) return { hash, added: [] };
    // The plans of the source (the scenes and the sequences of a project), read again for each content hash.
    // A source with no plans (the lab) waits for the first plan of the page.
    const base = this.#source().plans();
    if (this.queue.contentHash === null && base.length === 0) return { hash, added: [] };
    this.queue.setBase(base);
    return { hash, added: this.queue.setContentHash(hash) };
  }

  /** The frame index source of the open checkout. */
  #source(): FrameIndexSource {
    return this.#options.source?.() ?? builtInIndexSource();
  }

  /**
   * After an edit, the queue plans the jobs of the new content hash again, in the background. The jobs that the
   * store has (an undo of the edit) are done immediately. Until then, the readers show the old frames with a stale mark.
   */
  async #rebuild(): Promise<void> {
    const { added } = this.#checkHash();
    if (added.length === 0) return;
    await this.#settle(added);
    this.#progress();
  }

  /**
   * The new jobs of a plan or of an edit: a job whose frame the store has is done. A job whose frame the store has
   * under an older content hash is also done when the later edits changed only families that the frame does not read.
   * Then the frame moves to the new hash with no render (`#carry`).
   */
  async #settle(added: readonly IndexJob[]): Promise<void> {
    const changes = new Map<string, ReadonlySet<string> | null>();
    for (const job of added) {
      if ((await this.store.has(job.key, job.size)) || (await this.#carry(job, changes))) this.queue.done(job.id);
    }
  }

  /**
   * Keep the frame of a job from an older content hash when the families that differ since then are not in the
   * reads of that frame (contentParts.ts `carries`). The newest snapshot with such a frame wins. `changes` keeps the
   * changed families of each source hash during one settle.
   */
  async #carry(job: IndexJob, changes: Map<string, ReadonlySet<string> | null>): Promise<boolean> {
    const target = this.#snapshots.get(job.input.contentHash);
    if (target === undefined) return false;
    for (const source of [...this.#snapshots.values()].reverse()) {
      if (source.hash === target.hash) continue;
      let changed = changes.get(source.hash);
      if (changed === undefined) {
        changed = changedFamilies(source, target);
        changes.set(source.hash, changed);
      }
      if (changed === null) continue;
      const key = frameKey({ ...job.input, contentHash: source.hash });
      if (!(await this.store.has(key, job.size))) continue;
      const hit = await this.store.get(key, job.size);
      if (hit === null || !carries(hit.frame.reads, changed)) continue;
      await this.store.put({
        input: job.input,
        size: job.size,
        mime: hit.frame.mime,
        bytes: hit.bytes,
        metrics: hit.frame.metrics,
        reads: hit.frame.reads ?? null,
      });
      this.#carried += 1;
      return true;
    }
    return false;
  }

  #progress(): void {
    this.#options.broadcast({ type: "index.progress", ...this.queue.progress() });
  }

  /** The `index.*` requests. */
  register(router: Router): void {
    router
      .on("index.plan", async (params) => {
        if (!Array.isArray(params.takes)) throw new Error("index.plan needs a list of takes.");
        // The current hash of the files also keeps their snapshot.
        const filesHash = this.contentHash();
        const contentHash = params.contentHash ?? filesHash;
        if (!isFrameKey(contentHash)) throw new Error("The content hash must be 32 hex characters.");
        const added = this.queue.plan(params.takes, contentHash);
        await this.#settle(added);
        this.#progress();
        return { contentHash, jobs: this.queue.progress().queued };
      })
      .on("index.next", async (params) => {
        await this.#rebuild();
        const max = Math.min(MAX_TAKE, params.max ?? 1);
        return { jobs: this.queue.take(max, params.sizes).map(wireJob) };
      })
      .on("index.done", (params, client) => this.#done(params, client))
      .on("index.fail", (params) => {
        this.queue.fail(needNumber(params.job, "job"));
        return null;
      })
      .on("index.status", async () => {
        // A status after an edit already counts the jobs of the new content hash.
        await this.#rebuild();
        return { ...this.queue.progress(), usage: await this.store.usage(), carried: this.#carried };
      })
      .on("index.shadow", () => this.#keepShadow());
  }

  /** The port of the shadow frame (the agent loop gives it after its start). */
  #shadow: (() => SurfacePort) | null = null;

  /** Give the port of the shadow frame of the lab; a call starts the shadow or keeps it and waits for it. */
  useShadow(port: () => SurfacePort): void {
    this.#shadow = port;
  }

  /** A frame of the store for the tools (`ToolIndex`). */
  get(key: string, size?: number): Promise<IndexHit | null> {
    return this.store.get(key, size);
  }

  /** Keep a frame of a tool (a `lab_frame` miss on demand). */
  put(item: IndexPut): Promise<unknown> {
    return this.store.put(item);
  }

  /** Start or keep the shadow; ready when it answers within SHADOW_WAIT_MS. */
  async #keepShadow(): Promise<{ ready: boolean }> {
    const port = this.#shadow;
    if (port === null) return { ready: false };
    const kept = sendBridgeCall(URL_CALL, (name, args) => port().call(name, args)).then(
      () => true,
      () => false,
    );
    const late = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), SHADOW_WAIT_MS));
    return { ready: await Promise.race([kept, late]) };
  }

  async #done(
    params: {
      job: number;
      bytes: number;
      mime: string;
      metrics?: Readonly<Record<string, number>> | null;
      reads?: readonly string[] | null;
    },
    client: PageClient,
  ): Promise<{ stored: boolean }> {
    const id = needNumber(params.job, "job");
    const frame = this.#pending.get(client.id)?.get(id);
    this.#pending.get(client.id)?.delete(id);
    if (frame?.bytes.length !== params.bytes) throw new Error(`The bytes of job ${String(id)} did not come.`);
    if (!isIndexMime(params.mime) || frame.mime !== params.mime)
      throw new Error("The picture type is not WebP, JPEG or PNG.");
    const job = this.queue.job(id);
    // A stale job (an older content hash) or an unknown job stores nothing.
    if (job === null || job.state === "done") return { stored: false };
    await this.store.put({
      input: job.input,
      size: job.size,
      mime: params.mime,
      bytes: frame.bytes.slice(),
      metrics: params.metrics ?? null,
      reads: readsOf(params.reads),
    });
    this.queue.done(id);
    this.#progress();
    return { stored: true };
  }

  /** A binary message of a page: true when it is an index frame (kept until its `index.done`). */
  bytes(client: PageClient, data: Uint8Array): boolean {
    const frame = readIndexFrame(data);
    if (frame === null) return false;
    if (frame.bytes.length > MAX_FRAME_BYTES) return true;
    let pending = this.#pending.get(client.id);
    if (pending === undefined) {
      pending = new Map();
      this.#pending.set(client.id, pending);
    }
    pending.set(frame.job, frame);
    return true;
  }

  /** Forget the bytes of a page that closed. */
  dropClient(client: PageClient): void {
    this.#pending.delete(client.id);
  }

  /** A user action in the visible frame of the index surface (a seek, an open item, a take): its jobs come first. */
  onSurfaceEvent(surface: string, where: SurfaceWhere, event: BridgeEvent): void {
    const indexed = this.#options.surface === undefined ? surface : this.#options.surface();
    if (surface !== indexed || where !== "visible") return;
    if (event.event !== "url" && event.event !== "ready") return;
    const focus = focusOfUrl(event.url);
    if (focus !== null) this.queue.setFocus(focus);
  }

  /** The routes `GET /index/<key>[?size=<px>]`, `GET /index/take/…` and `GET /index/manifest/…`, else null. */
  async http(request: Request, url: URL): Promise<Response | null> {
    if (!url.pathname.startsWith(INDEX_PATH) || request.method !== "GET") return null;
    const rest = url.pathname.slice(INDEX_PATH.length).split("/");
    if (rest[0] === "take" && rest.length === 3) {
      // The current frames of a take and the newest stale frames.
      const [, contentHash = "", take = ""] = rest;
      if (!isFrameKey(contentHash) || !/^[0-9a-f]{16}$/.test(take)) return new Response("No take.", { status: 404 });
      return Response.json(await takeIndexOf(this.store, contentHash, take));
    }
    if (rest[0] === "manifest" && rest.length === 3) {
      const [, contentHash = "", take = ""] = rest;
      const manifest =
        isFrameKey(contentHash) && /^[0-9a-f]{16}$/.test(take) ? await this.store.manifestAt(contentHash, take) : null;
      return manifest === null ? new Response("No manifest.", { status: 404 }) : Response.json(manifest);
    }
    const key = rest.length === 1 ? (rest[0] ?? "") : "";
    const size = url.searchParams.has("size") ? Number(url.searchParams.get("size")) : undefined;
    const hit =
      isFrameKey(key) && (size === undefined || Number.isSafeInteger(size)) ? await this.store.get(key, size) : null;
    if (hit === null) return new Response("No frame.", { status: 404 });
    return new Response(new Uint8Array(hit.bytes), {
      headers: {
        "content-type": hit.frame.mime,
        // The key holds every input of the frame: a frame never changes.
        "cache-control": "private, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        "x-index-sim-ms": String(hit.frame.timeMs),
      },
    });
  }

  /** Write the manifests (the stop of the host). */
  close(): Promise<void> {
    return this.store.flush();
  }
}
