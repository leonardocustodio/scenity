// SPDX-License-Identifier: Apache-2.0
/**
 * The indexer window as a WebKit page of the render pool. The host
 * gives the indexer page the worker paths of the pool (`SurfaceState.indexerWorker`: the origin and the worker token).
 * The page asks the pool for commands (`POST /__pool/webkit/poll`, a long poll) and answers each one
 * (`POST /__pool/webkit/answer`, a body of the picture form `CBP1` of `@scenity/labs-platform/poolWire`):
 *
 * - `open`: the indexer loop lends the frame (indexerLoop.ts `lend`), and the frame loads the lab of the tool (the
 *   built lab of the indexer with the query of the tool). A frame that has the same lab of the same build is warm.
 * - `shot`: seek, camera, `frame()`, `measure()` and a PNG `capture` at the size of the tool, through the bridge.
 * - `close`: the frame goes back to the indexer loop.
 *
 * Thus `labs shot --engine webkit` draws in WKWebView, the real engine of the app. This module has no framework, so a
 * test gives the parts.
 */
/** A free camera view of the lab (`CameraView` of the runtime; the page passes it to the bridge as it is). */
type CameraView = Readonly<Record<string, unknown>>;

/** The worker paths of the pool (`SurfaceState.indexerWorker`). */
export interface PoolWorkerEndpoint {
  readonly origin: string;
  readonly token: string;
}

/** A command of the pool (apps/editor `scripts/lab/pool/webkit.ts` `WorkerCommand`). */
export type PoolCommand =
  | {
      readonly id: number;
      readonly kind: "open";
      readonly lease: string;
      readonly query: string;
      readonly key: string;
      readonly build: number;
    }
  | {
      readonly id: number;
      readonly kind: "shot";
      readonly lease: string;
      readonly at: number;
      readonly camera: string | CameraView;
      readonly width: number;
      readonly height: number;
    }
  | { readonly id: number; readonly kind: "close"; readonly lease: string };

export interface PoolWorkerParts {
  /** The worker paths of the pool now, or null (no pool, or a host without them). */
  endpoint(): PoolWorkerEndpoint | null;
  /** The URL of the built lab of the indexer (`SurfaceState.indexerUrl`), or null. */
  baseUrl(): string | null;
  /** Take the frame from the indexer loop (it ends its step first). */
  lend(): Promise<void>;
  /** Give the frame back to the indexer loop. */
  giveBack(): void;
  /** Load the lab frame at a URL and wait until its scene is ready. */
  load(url: string): Promise<void>;
  /** The URL of the lab frame now, or null. */
  frameSrc(): string | null;
  /** A call of the workbench bridge into the lab frame. */
  callFrame(call: string, args: readonly unknown[], timeoutMs?: number): Promise<unknown>;
  fetch(url: string, init: RequestInit): Promise<Response>;
  sleep(ms: number): Promise<void>;
  /** The user agent of the page. */
  readonly agent: string;
}

/** The wait after a poll that failed (no pool, a restart of the pool) (ms). */
export const RETRY_MS = 2_000;
/** The wait without worker paths (ms). */
const NO_POOL_MS = 2_000;
/** The time limit of a bridge call of a shot (ms): a frame of a scene that settles its assets. */
const CALL_TIMEOUT_MS = 60_000;
const MAGIC = "CBP1";

/** The URL of the lab of a tool: the built lab of the indexer (its secret, its bridge) with the query of the tool. */
export function leaseUrl(base: string, query: string): string {
  const url = new URL(base);
  for (const [name, value] of new URLSearchParams(query)) url.searchParams.set(name, value);
  return url.toString();
}

/** An answer in the picture form of the pool: `CBP1`, the JSON head length (u32, big endian), the head, the bytes. */
export function packAnswer(
  head: Record<string, unknown>,
  bytes: Uint8Array = new Uint8Array(0),
): Uint8Array<ArrayBuffer> {
  const json = new TextEncoder().encode(JSON.stringify(head));
  const out = new Uint8Array(8 + json.byteLength + bytes.byteLength);
  out.set(new TextEncoder().encode(MAGIC), 0);
  new DataView(out.buffer).setUint32(4, json.byteLength, false);
  out.set(json, 8);
  out.set(bytes, 8 + json.byteLength);
  return out;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The bytes of the picture of a `capture` answer. */
function captureBytes(value: unknown): Uint8Array {
  const result = (typeof value === "object" && value !== null ? value : {}) as { bytes?: unknown; mime?: unknown };
  if (!(result.bytes instanceof ArrayBuffer)) throw new Error("capture gave no picture.");
  if (result.mime !== "image/png") throw new Error(`capture gave ${String(result.mime)}, not a PNG.`);
  return new Uint8Array(result.bytes);
}

export class PoolWorker {
  readonly #parts: PoolWorkerParts;
  readonly id = `wk-${Math.random().toString(36).slice(2, 12)}`;
  #stopped = false;
  #running: Promise<void> | null = null;
  /** The lease that has the frame, or null. */
  #lease: string | null = null;
  /** The lab key with the build and the URL of the last load of a lease, or null. */
  #loaded: { readonly key: string; readonly url: string } | null = null;
  /** The commands done (the page shows them). */
  done = 0;

  constructor(parts: PoolWorkerParts) {
    this.#parts = parts;
  }

  /** The lease that has the frame now, or null. */
  get lease(): string | null {
    return this.#lease;
  }

  start(): void {
    if (this.#running !== null) return;
    this.#stopped = false;
    this.#running = (async () => {
      while (!this.#stopped) await this.step();
    })();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#lease !== null) this.#parts.giveBack();
    this.#lease = null;
    await this.#running;
    this.#running = null;
  }

  #url(endpoint: PoolWorkerEndpoint, path: string, extra: Record<string, string> = {}): string {
    const query = new URLSearchParams({ worker: this.id, ...extra });
    return `${endpoint.origin}/__pool/webkit/${path}?${query.toString()}`;
  }

  /** One poll and its command. */
  async step(): Promise<void> {
    const parts = this.#parts;
    const endpoint = parts.endpoint();
    if (endpoint === null) {
      // No pool: a frame of a lease that is gone goes back to the indexer.
      if (this.#lease !== null) this.#close();
      await parts.sleep(NO_POOL_MS);
      return;
    }
    let command: PoolCommand | null;
    try {
      const response = await parts.fetch(this.#url(endpoint, "poll"), {
        method: "POST",
        headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/json" },
        body: JSON.stringify({ agent: parts.agent, place: "indexer" }),
      });
      if (!response.ok) throw new Error(`poll: ${String(response.status)}`);
      command = ((await response.json()) as { command?: PoolCommand | null }).command ?? null;
    } catch {
      await parts.sleep(RETRY_MS);
      return;
    }
    if (command === null) return;
    let answer: Uint8Array<ArrayBuffer>;
    try {
      answer = await this.run(command);
    } catch (error) {
      answer = packAnswer({ ok: false, error: errorText(error) });
    }
    await parts
      .fetch(this.#url(endpoint, "answer", { command: String(command.id) }), {
        method: "POST",
        headers: { authorization: `Bearer ${endpoint.token}`, "content-type": "application/octet-stream" },
        body: answer,
      })
      .catch(() => null);
    this.done += 1;
  }

  #close(): void {
    this.#lease = null;
    this.#parts.giveBack();
  }

  /** Run one command; give the body of its answer. */
  async run(command: PoolCommand): Promise<Uint8Array<ArrayBuffer>> {
    const parts = this.#parts;
    if (command.kind === "close") {
      if (this.#lease === command.lease) this.#close();
      return packAnswer({ ok: true });
    }
    if (command.kind === "open") {
      const base = parts.baseUrl();
      if (base === null) throw new Error("The built lab of the indexer is not ready.");
      const started = performance.now();
      const fresh = this.#lease === null;
      if (fresh) await parts.lend();
      this.#lease = command.lease;
      const key = `${command.key}#${String(command.build)}`;
      // Warm: the frame has the lab of this key and build, and the indexer did not load its own lab since.
      const loaded = this.#loaded;
      const warm = loaded !== null && loaded.key === key && parts.frameSrc() === loaded.url;
      if (!warm) {
        this.#loaded = null;
        const url = leaseUrl(base, command.query);
        try {
          await parts.load(url);
        } catch (error) {
          this.#close();
          throw error;
        }
        this.#loaded = { key, url };
      }
      return packAnswer({ ok: true, warm, ms: Math.round(performance.now() - started) });
    }
    if (this.#lease !== command.lease) throw new Error(`The frame is not lent to lease ${command.lease}.`);
    const call = (name: string, args: readonly unknown[] = []): Promise<unknown> =>
      parts.callFrame(name, args, CALL_TIMEOUT_MS);
    await call("seek", [command.at]);
    await call("camera", [command.camera]);
    const frame = (await call("frame", [])) as { simMs: number | null } | null;
    const metrics = await call("measure", []);
    const picture = await call("capture", [command.width, 1, command.height, { mime: "image/png" }]);
    return packAnswer({ ok: true, simMs: frame?.simMs ?? null, frame, metrics }, captureBytes(picture));
  }
}
