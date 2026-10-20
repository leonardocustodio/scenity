// SPDX-License-Identifier: Apache-2.0
/**
 * The client of the render pool for the tools. `findPool()` reads `pool.json` and the token of the checkout (paths.ts)
 * and asks the pool for its health. Without a running pool it gives null, and the tool starts its own server and
 * browser. `PoolClient.open` leases a warm page and gives a `RemoteShooter`. It has the same methods as the `Shooter`,
 * and the pool runs them on its page, so the files of a tool are the same with and without the pool.
 */
import type { CameraView } from "@scenity/runtime/framing";
import type { LabShooter, SheetLanes, ShooterOptions, Shot } from "../shooter";
import type { JobRequest, JobResult } from "./jobs";
import type { PageSpec } from "./pages";
import { poolDir, POOL_USE_ENV, readPool, alive, type PoolInfo } from "./paths";
import { PoolRefusal, type PoolEngine } from "./webkit";
import { unpackPicture } from "@scenity/labs-platform/poolWire";
import { envValue } from "@scenity/labs-platform/envNames";

/** The longest wait for the health answer of a pool (ms). */
const HEALTH_MS = 1_000;

type Head = Omit<Shot, "png"> & { readonly ref: string };

/** What the pool says of a lease: a warm page, the wait for the GPU lock and the time to make the page ready (ms). */
export interface LeaseInfo {
  readonly warm: boolean;
  readonly lockMs: number;
  readonly openMs: number;
}

export class PoolClient {
  /** The last lease of this client (the measurements of poolBench.ts). */
  lastLease: LeaseInfo | null = null;

  constructor(
    readonly info: PoolInfo,
    private readonly token: string,
  ) {}

  get origin(): string {
    return this.info.origin;
  }

  /** A request to the API; throw with the error text of the pool on a status other than 200. */
  async request(method: string, path: string, body?: unknown): Promise<Response> {
    const init = {
      method,
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      // A lease waits for the GPU lock as long as the tool did before the pool: no time limit of Bun's fetch (300 s).
      timeout: false,
    };
    const response = await fetch(`${this.origin}/__pool/${path}`, init);
    if (response.ok) return response;
    const text = await response.text();
    let message = text;
    let code: string | null = null;
    try {
      const body = JSON.parse(text) as { error?: string; code?: string };
      message = body.error ?? text;
      code = typeof body.code === "string" ? body.code : null;
    } catch {
      // A text answer.
    }
    const full = `The render pool refused ${method} ${path}: ${message}`;
    // A refusal with a code (no WebKit page) lets the tool choose another path.
    throw code === null ? new Error(full) : new PoolRefusal(code, full, response.status);
  }

  async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    return (await (await this.request(method, path, body)).json()) as T;
  }

  /**
   * Lease a page with the lab of the options at a first time and camera: a Chromium page, or with `engine: "webkit"`
   * the frame of an indexer window of Scenity.
   */
  async open(
    options: ShooterOptions,
    at: number,
    camera: string,
    engine: PoolEngine = "chromium",
  ): Promise<RemoteShooter> {
    const spec: PageSpec = Object.fromEntries(
      Object.entries(options).filter(([key, value]) => key !== "origin" && key !== "labPath" && value !== undefined),
    ) as unknown as PageSpec;
    const body = { spec, at, camera, ...(engine === "chromium" ? {} : { engine }) };
    const answer = await this.json<LeaseInfo & { lease: string }>("POST", "lease", body);
    this.lastLease = { warm: answer.warm, lockMs: answer.lockMs, openMs: answer.openMs };
    return new RemoteShooter(this, answer.lease, { ...options, origin: this.origin });
  }

  /** Run a job (jobs.ts) and give its result. */
  job(job: JobRequest): Promise<JobResult> {
    return this.json<JobResult>("POST", "jobs", job);
  }
}

/** A page of the pool with the methods of a `Shooter` (LabShooter). */
export class RemoteShooter implements LabShooter {
  /** The shot reference of each PNG that came from the pool. */
  readonly #refs = new WeakMap<Buffer, string>();
  readonly page: Pick<LabShooter["page"], "evaluate">;

  constructor(
    private readonly client: PoolClient,
    private readonly lease: string,
    readonly options: ShooterOptions,
  ) {
    const evaluate = async (fn: unknown, arg?: unknown): Promise<unknown> => {
      if (typeof fn !== "function") throw new Error("The pool runs only a function in the page.");
      const { value } = await this.client.json<{ value: unknown }>("POST", `lease/${lease}/evaluate`, {
        source: fn.toString(),
        arg: arg ?? null,
      });
      return value;
    };
    this.page = { evaluate: evaluate as LabShooter["page"]["evaluate"] };
  }

  #picture(png: Buffer): { ref: string } | { png: string } {
    const ref = this.#refs.get(png);
    return ref === undefined ? { png: png.toString("base64") } : { ref };
  }

  async shot(simMs: number, camera: string | CameraView): Promise<Shot> {
    const response = await this.client.request("POST", `lease/${this.lease}/shot`, { at: simMs, camera });
    const { head: raw, bytes } = unpackPicture(new Uint8Array(await response.arrayBuffer()));
    const head = raw as Head;
    const png = Buffer.from(bytes);
    this.#refs.set(png, head.ref);
    return { png, simMs: head.simMs, camera: head.camera, frame: head.frame, metrics: head.metrics };
  }

  async sheet(
    cells: readonly { readonly png: Buffer; readonly label: string }[],
    columns: number,
    cellWidth: number,
    lanes: SheetLanes | null = null,
  ): Promise<Buffer> {
    const items = cells.map((cell) => ({ ...this.#picture(cell.png), label: cell.label }));
    const response = await this.client.request("POST", `lease/${this.lease}/sheet`, {
      cells: items,
      columns,
      cellWidth,
      lanes,
    });
    return Buffer.from(await response.arrayBuffer());
  }

  async webp(png: Buffer, width: number, quality = 0.85): Promise<{ bytes: Buffer; width: number; height: number }> {
    const response = await this.client.request("POST", `lease/${this.lease}/webp`, {
      ...this.#picture(png),
      width,
      quality,
    });
    const { head: raw, bytes } = unpackPicture(new Uint8Array(await response.arrayBuffer()));
    const head = raw as { width: number; height: number };
    return { bytes: Buffer.from(bytes), width: head.width, height: head.height };
  }

  async close(): Promise<void> {
    await this.client.request("DELETE", `lease/${this.lease}`).catch(() => null);
  }
}

/** The running pool of this checkout, or null (no pool, a pool without pages, or `SCENITY_LABS_POOL=0`). */
export async function findPool(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<PoolClient | null> {
  if (envValue(POOL_USE_ENV, env) === "0") return null;
  const pool = readPool(poolDir(env));
  if (pool === null || pool.info.pages < 1 || !alive(pool.info.pid)) return null;
  try {
    const response = await fetch(`${pool.info.origin}/__pool/health`, { signal: AbortSignal.timeout(HEALTH_MS) });
    if (!response.ok) return null;
  } catch {
    return null;
  }
  return new PoolClient(pool.info, pool.token);
}
