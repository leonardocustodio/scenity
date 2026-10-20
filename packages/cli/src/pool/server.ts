// SPDX-License-Identifier: Apache-2.0
/**
 * The scene pool process of `scenity pool`: one headless Chromium with N warm player pages (the generic warm pages of
 * `@scenity/labs-platform/warmPages` with the player target of target.ts), and an HTTP API on 127.0.0.1. Every path
 * except `health` needs the token of the pool (`authorization: Bearer <token>`):
 *
 *   GET    /__pool/health                {ok, kind: "scene", pages}: the pool runs (no token)
 *   GET    /__pool/status                the pages and the leases
 *   POST   /__pool/lease                 {spec} → {lease, warm, lockMs, openMs}: a page with the spec
 *   POST   /__pool/lease/<id>/seek       {at} → {ok}: the clock of the player
 *   POST   /__pool/lease/<id>/shot       → the PNG of a screenshot that stays the same (the picture form of poolWire)
 *   POST   /__pool/lease/<id>/drawn      → {backend, renderer}
 *   POST   /__pool/lease/<id>/evaluate   {source, arg} → {value}: a function of the tool in the page (the page is
 *                                        cold after the lease)
 *   DELETE /__pool/lease/<id>            the end of the lease
 *   POST   /__pool/stop                  {ok}: the pool stops
 *
 * The pool writes `pool.json` and the token into its folder (files.ts); a second pool of the same folder does not
 * start. It takes the GPU lock of the labs tools while a lease runs. A lease without a call for two minutes ends (a
 * tool that stopped).
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Page } from "@playwright/test";
import { clearPool, poolRuns, writePool } from "./files";
import { packPicture } from "@scenity/labs-platform/poolWire";
import { WarmPages, type WarmLease } from "@scenity/labs-platform/warmPages";
import { launchChromium } from "../page/browser";
import { gpuLock } from "../page/lock";
import { drawnBy, errorLine, seekPlayer, stableShot } from "../page/player";
import { checkoutRoot } from "../workspace";
import { SCENE_POOL_PREFIX, scenePoolDir } from "./client";
import { playerTarget, readSpec, type PlayerSpec } from "./target";

/** The time without a call before the pool ends a lease (ms). */
const LEASE_IDLE_MS = 120_000;

interface SceneLease extends WarmLease {
  readonly page: Page;
}

export interface ScenePoolOptions {
  readonly pages: number;
  /** The pool folder (default `scenePoolDir()`). */
  readonly dir?: string;
  /** The GPU lock file (default the lock of the labs tools). */
  readonly lock?: string;
  readonly log?: (text: string) => void;
}

/** A running scene pool. */
export interface ScenePool {
  readonly origin: string;
  readonly dir: string;
  /** The end of the pool: a stop call, SIGINT or SIGTERM. */
  readonly stopped: Promise<void>;
  stop(): Promise<void>;
}

function json(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function authorized(request: Request, token: string): boolean {
  const given = Buffer.from(request.headers.get("authorization") ?? "", "utf8");
  const want = Buffer.from(`Bearer ${token}`, "utf8");
  return given.length === want.length && timingSafeEqual(given, want);
}

/** The answer of one call of a lease. */
async function leaseCall(lease: SceneLease, call: string, request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (call === "seek") {
    if (typeof body.at !== "number") return json(400, { error: "seek needs `at` (ms)." });
    await seekPlayer(lease.page, body.at);
    return json(200, { ok: true });
  }
  if (call === "shot")
    return new Response(new Uint8Array(packPicture({ mime: "image/png" }, await stableShot(lease.page))));
  if (call === "drawn") return json(200, await drawnBy(lease.page));
  if (call === "evaluate") {
    if (typeof body.source !== "string") return json(400, { error: "evaluate needs `source`." });
    lease.dirty = true;
    const value: unknown = await lease.page.evaluate(`(${body.source})(${JSON.stringify(body.arg ?? null)})`);
    return json(200, { value });
  }
  return json(404, { error: `no lease call "${call}"` });
}

/** The fetch handler of the API. */
function poolApi(pages: WarmPages<PlayerSpec, Page, null, SceneLease>, token: string, stop: () => void) {
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    if (!path.startsWith(SCENE_POOL_PREFIX)) return json(404, { error: "not found" });
    const rest = path.slice(SCENE_POOL_PREFIX.length);
    if (rest === "health") return json(200, { ok: true, kind: "scene", pages: pages.status().pages.length });
    if (!authorized(request, token)) return json(401, { error: "the token of the pool is missing or wrong" });
    try {
      if (rest === "status" && request.method === "GET") return json(200, pages.status());
      if (rest === "stop" && request.method === "POST") {
        stop();
        return json(200, { ok: true });
      }
      if (rest === "lease" && request.method === "POST") {
        const spec = readSpec(((await request.json()) as { spec?: unknown }).spec);
        const lease = await pages.lease(spec, null);
        return json(200, { lease: lease.id, warm: lease.warm, lockMs: lease.lockMs, openMs: lease.openMs });
      }
      const match = /^lease\/([0-9a-f-]+)(?:\/([a-z]+))?$/.exec(rest);
      const lease = match?.[1] === undefined ? null : pages.get(match[1]);
      if (match === null || lease === null) return json(404, { error: "no such lease" });
      if (request.method === "DELETE" && match[2] === undefined) {
        await pages.release(lease.id);
        return json(200, { ok: true });
      }
      if (request.method === "POST" && match[2] !== undefined) return await leaseCall(lease, match[2], request);
      return json(404, { error: "not found" });
    } catch (error) {
      return json(500, { error: errorLine(error) });
    }
  };
}

/** Start the scene pool. Throw when a pool of the folder runs. */
export async function startScenePool(options: ScenePoolOptions): Promise<ScenePool> {
  const dir = options.dir ?? scenePoolDir();
  if (poolRuns(dir)) throw new Error(`A scene pool runs in ${dir}: stop it first (scenity pool stop).`);
  const log = options.log ?? (() => undefined);
  const target = playerTarget();
  const pages = new WarmPages<PlayerSpec, Page, null, SceneLease>({
    pages: options.pages,
    target,
    lock: () => gpuLock({ ...(options.lock === undefined ? {} : { path: options.lock }), log }),
    launch: () => launchChromium(),
    makeLease: (page, _spec, base) => ({ ...base, page }),
    log,
  });
  // The browser starts at this point, so the first lease does not wait for it.
  await pages.browser();
  const token = randomBytes(32).toString("hex");
  let done: () => void = () => undefined;
  const stopped = new Promise<void>((resolve) => (done = resolve));
  let stopping: Promise<void> | null = null;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    fetch: poolApi(pages, token, () => void stop()),
  });
  const expiry = setInterval(() => void pages.expire(LEASE_IDLE_MS), 10_000);
  const stop = (): Promise<void> =>
    (stopping ??= (async () => {
      clearInterval(expiry);
      clearPool(dir);
      await pages.stop();
      target.stop();
      void server.stop(true);
      done();
    })());
  const origin = `http://127.0.0.1:${String(server.port)}`;
  writePool(
    dir,
    {
      version: 1,
      pid: process.pid,
      origin,
      checkout: checkoutRoot() ?? "",
      pages: options.pages,
      started: new Date().toISOString(),
    },
    token,
  );
  return { origin, dir, stopped, stop };
}
