// SPDX-License-Identifier: Apache-2.0
/**
 * The HTTP API of the render pool under `/__pool/` on the origin of the built lab, on 127.0.0.1 only. Each path other
 * than `health` needs the token of the pool (`authorization: Bearer <token>`). The token file is under the state
 * folder, mode 600.
 *
 *   GET    /__pool/health                 {ok, build, pages}: the pool runs (no token)
 *   GET    /__pool/status                 the pages, the leases, the current build
 *   GET    /__pool/build                  the build of the current sources (it builds first when a source changed)
 *   POST   /__pool/jobs                   a job (jobs.ts): {url, action, times, …, out} → its result JSON
 *   POST   /__pool/lease                  {spec, at, camera} → {lease, warm}: a page for the calls of one tool run
 *   POST   /__pool/lease/<id>/shot        {at, camera} → the PNG and its frame (`poolWire`)
 *   POST   /__pool/lease/<id>/evaluate    {source, arg} → {value}: a function of the tool in the lab page
 *   POST   /__pool/lease/<id>/sheet       {cells, columns, cellWidth, lanes} → the PNG of the sheet
 *   POST   /__pool/lease/<id>/webp        {png | ref, width, quality} → the WebP and its size (`poolWire`)
 *   DELETE /__pool/lease/<id>             the end of the lease
 *   POST   /__pool/webkit/poll | answer   the indexer windows of the app (webkitApi.ts; the worker token)
 *
 * A lease or a job with `engine: "webkit"` goes to the WebKit engine (webkit.ts): the frame of an indexer
 * window of Scenity. Without a WebKit page the answer is 503 with the code `no-webkit-worker`.
 *
 * A lease runs the methods of the `Shooter` (shooter.ts) on a warm page, so the tools give the same files with the
 * pool as without it. A cell or a WebP frame names the PNG of a shot of the same lease (`ref`), so a picture crosses
 * the loopback only once.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import type { CameraView } from "@scenity/runtime/framing";
import type { SheetLanes } from "../shooter";
import type { BuiltLab } from "./builtLab";
import { jobSpec, runJob, type JobRequest } from "./jobs";
import type { Lease, PagePool, PageSpec } from "./pages";
import { POOL_ENGINES, PoolRefusal, type PoolEngine, type WebKitPages } from "./webkit";
import { webkitApi } from "./webkitApi";
import { packPicture } from "@scenity/labs-platform/poolWire";

/** The largest body of a request (a sheet of 400 PNG cells without refs stays under it). */
const MAX_BODY = 256 * 1024 * 1024;

export interface PoolApiOptions {
  readonly token: string;
  readonly pages: PagePool;
  readonly built: BuiltLab;
  /** The WebKit engine (the indexer windows of the app), or none. */
  readonly webkit?: WebKitPages;
  /** The token of the worker paths, or none (the paths are disabled). */
  readonly workerToken?: string | null;
  /** The take of a job URL with no take (the default take of the project), or none. */
  readonly defaultTake?: string;
}

/** The engine of a request: `chromium` (default) or `webkit`. Throw on another value. */
export function engineOf(value: unknown): PoolEngine {
  if (value === undefined || value === null) return "chromium";
  if (typeof value === "string" && (POOL_ENGINES as readonly string[]).includes(value)) return value as PoolEngine;
  throw new Error(`"engine" must be one of ${POOL_ENGINES.join(", ")}.`);
}

/** The leases of both engines. */
interface Engines {
  lease(engine: PoolEngine, spec: PageSpec, at: number, camera: string): Promise<Lease>;
  get(id: string): Lease | null;
  release(id: string): Promise<void>;
}

function enginesOf(pages: PagePool, webkit: WebKitPages | undefined): Engines {
  return {
    lease: (engine, spec, at, camera) => {
      if (engine === "chromium") return pages.lease(spec, at, camera);
      if (webkit === undefined) throw new PoolRefusal("no-webkit-worker", "This pool has no WebKit engine.", 503);
      return webkit.lease(spec, at, camera);
    },
    get: (id) => pages.get(id) ?? webkit?.get(id) ?? null,
    release: async (id) => {
      await pages.release(id);
      await webkit?.release(id);
    },
  };
}

function digest(text: string): Buffer {
  return createHash("sha256").update(text, "utf8").digest();
}

/** True when the request has the token (the compare takes the same time for each value). */
export function hasToken(request: IncomingMessage, token: string): boolean {
  const header = request.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  return timingSafeEqual(digest(header.slice("Bearer ".length)), digest(token));
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > MAX_BODY) {
        reject(new Error("The body is too large."));
        request.destroy();
      } else chunks.push(chunk);
    });
    request.once("end", () => resolve(Buffer.concat(chunks)));
    request.once("error", reject);
  });
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readBody(request);
  const value: unknown = body.byteLength === 0 ? {} : JSON.parse(body.toString("utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("The body is not a JSON object.");
  return value as Record<string, unknown>;
}

function send(response: ServerResponse, status: number, body: Buffer | string, type: string): void {
  response.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "content-length": String(Buffer.byteLength(body)),
  });
  response.end(body);
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  send(response, status, JSON.stringify(value), "application/json");
}

function numberOf(params: Record<string, unknown>, name: string, fallback?: number): number {
  const value = params[name] ?? fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`"${name}" must be a number.`);
  return value;
}

function cameraOf(params: Record<string, unknown>): string | CameraView {
  const camera: unknown = params.camera ?? "overview";
  if (typeof camera === "string" || (typeof camera === "object" && camera !== null))
    return camera as string | CameraView;
  throw new Error('"camera" must be a name or a view.');
}

/** The PNG of a cell or a frame: a shot of the lease (`ref`) or the bytes (`png`, base64). */
function pngOf(shots: ReadonlyMap<string, Buffer>, item: Record<string, unknown>): Buffer {
  if (typeof item.ref === "string") {
    const png = shots.get(item.ref);
    if (png === undefined) throw new Error(`No shot ${item.ref} in the lease.`);
    return png;
  }
  if (typeof item.png === "string") return Buffer.from(item.png, "base64");
  throw new Error('A picture needs "ref" or "png".');
}

/** The calls of one lease. */
async function leaseCall(
  pages: Engines,
  id: string,
  call: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const lease = pages.get(id);
  if (lease === null) {
    sendJson(response, 404, { error: `No lease ${id}.` });
    return;
  }
  const params = await readJson(request);
  const { shooter } = lease;
  switch (call) {
    case "shot": {
      const shot = await shooter.shot(numberOf(params, "at"), cameraOf(params));
      const ref = `s${String(lease.shots.size + 1)}`;
      lease.shots.set(ref, shot.png);
      const head = { ref, simMs: shot.simMs, camera: shot.camera, frame: shot.frame, metrics: shot.metrics };
      send(response, 200, packPicture(head, shot.png), "application/octet-stream");
      return;
    }
    case "evaluate": {
      if (typeof params.source !== "string" || params.source.length > 200_000)
        throw new Error('"source" must be a function text.');
      // A script can change the take, the events or the tunes of the page: the page loads again after the lease.
      lease.dirty = true;
      const value: unknown = await shooter.page.evaluate(`(${params.source})(${JSON.stringify(params.arg ?? null)})`);
      sendJson(response, 200, { value: value ?? null });
      return;
    }
    case "sheet": {
      const items = Array.isArray(params.cells) ? (params.cells as Record<string, unknown>[]) : [];
      const cells = items.map((item) => ({
        png: pngOf(lease.shots, item),
        label: typeof item.label === "string" ? item.label : "",
      }));
      const lanes = (params.lanes ?? null) as SheetLanes | null;
      const png = await shooter.sheet(cells, numberOf(params, "columns"), numberOf(params, "cellWidth"), lanes);
      send(response, 200, png, "image/png");
      return;
    }
    case "webp": {
      const done = await shooter.webp(
        pngOf(lease.shots, params),
        numberOf(params, "width"),
        numberOf(params, "quality", 0.85),
      );
      send(
        response,
        200,
        packPicture({ width: done.width, height: done.height }, done.bytes),
        "application/octet-stream",
      );
      return;
    }
    default:
      sendJson(response, 404, { error: `No call ${call}.` });
  }
}

/** A lease for a job, the job, and the end of the lease. */
async function job(
  pages: Engines,
  request: IncomingMessage,
  response: ServerResponse,
  defaultTake: string,
): Promise<void> {
  const params = (await readJson(request)) as unknown as JobRequest;
  const { spec, cameras } = jobSpec(params, defaultTake);
  const engine = engineOf(params.engine);
  const lease = await pages.lease(engine, spec, params.times[0] ?? 0, cameras[0] ?? "overview");
  try {
    // A script in the page (the numbers, the video of a clip): the page loads again after the job.
    if (params.action === "measure" || params.action === "sweep" || params.action === "clip") lease.dirty = true;
    sendJson(response, 200, await runJob(lease.shooter, params));
  } finally {
    await pages.release(lease.id);
  }
}

/** The handler of the API (staticServer.ts `api`). */
export function poolApi(options: PoolApiOptions) {
  const { pages, built, token, webkit } = options;
  const engines = enginesOf(pages, webkit);
  const workers = webkit === undefined ? null : webkitApi(webkit, options.workerToken ?? null);
  return async (request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> => {
    const path = url.pathname.slice("/__pool/".length).split("/");
    const method = request.method ?? "GET";
    // The paths of the indexer windows have their own token.
    if (path[0] === "webkit" && workers !== null) return workers(request, response, url);
    if (path[0] === "health" && method === "GET") {
      sendJson(response, 200, { ok: true, build: built.current?.id ?? null, pages: pages.status().pages.length });
      return true;
    }
    if (!hasToken(request, token)) {
      sendJson(response, 401, { error: "The pool needs its token." });
      return true;
    }
    try {
      if (path[0] === "status" && method === "GET")
        sendJson(response, 200, {
          ...pages.status(),
          webkit: webkit?.status() ?? null,
          build: built.current,
          error: built.error,
        });
      else if (path[0] === "build" && method === "GET") sendJson(response, 200, await built.ensure());
      else if (path[0] === "jobs" && method === "POST")
        await job(engines, request, response, options.defaultTake ?? "");
      else if (path[0] === "lease" && path.length === 1 && method === "POST") {
        const params = await readJson(request);
        const spec = params.spec as PageSpec | null | undefined;
        if (typeof spec !== "object" || spec === null || typeof spec.take !== "string")
          throw new Error('"spec" is not a page spec.');
        const at = numberOf(params, "at", 0);
        const camera = typeof params.camera === "string" ? params.camera : "overview";
        const lease = await engines.lease(engineOf(params.engine), spec, at, camera);
        sendJson(response, 200, { lease: lease.id, warm: lease.warm, lockMs: lease.lockMs, openMs: lease.openMs });
      } else if (path[0] === "lease" && path.length === 2 && method === "DELETE") {
        await engines.release(path[1] ?? "");
        sendJson(response, 200, { ok: true });
      } else if (path[0] === "lease" && path.length === 3 && method === "POST") {
        await leaseCall(engines, path[1] ?? "", path[2] ?? "", request, response);
      } else return false;
    } catch (error) {
      if (response.headersSent) return true;
      if (error instanceof PoolRefusal) sendJson(response, error.status, { error: error.message, code: error.code });
      else sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  };
}
