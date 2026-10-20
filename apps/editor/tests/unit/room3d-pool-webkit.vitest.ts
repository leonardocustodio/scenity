// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
// The WebKit engine of the render pool: the shared GPU lock of both engines, the WebKit pages (the indexer windows of
// the app) and their commands, and the route of a lease or a job by its engine. Also the worker paths (their token,
// CORS for the page of the app), and the refusal without a WebKit page.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { engineOf, poolApi } from "../../scripts/lab/pool/api";
import { BuiltLab } from "../../scripts/lab/pool/builtLab";
import { PoolClient } from "../../scripts/lab/pool/client";
import { PagePool } from "../../scripts/lab/pool/pages";
import { startBuiltLabServer } from "../../scripts/lab/pool/staticServer";
import {
  NO_WEBKIT_WORKER,
  NOT_ON_WEBKIT,
  PoolRefusal,
  sharedLock,
  WebKitPages,
  workerAnswer,
  type WorkerCommand,
} from "../../scripts/lab/pool/webkit";
import { fakeBrowser, fakeBuilder, SPEC } from "./poolFakes";

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const BUILD = () => Promise.resolve({ id: 3, dir: "/b", stamp: "s", ms: 1, at: "now" });

/** A lock that counts its takes and releases. */
function countedLock() {
  const counts = { taken: 0, released: 0 };
  const take = () => {
    counts.taken += 1;
    return Promise.resolve(() => (counts.released += 1));
  };
  return { counts, take };
}

/** The answer of a fake indexer page to a command. */
function answerOf(command: WorkerCommand): Buffer {
  if (command.kind === "open") return workerAnswer({ ok: true, warm: false, ms: 5 });
  if (command.kind === "close") return workerAnswer({ ok: true });
  const frame = { simMs: command.at, stats: { drawCalls: 7 } };
  return workerAnswer({ ok: true, simMs: command.at, frame, metrics: [] }, PNG);
}

/** A fake indexer page in the process: it polls the engine and answers each command. */
function inProcessWorker(pages: WebKitPages, id = "wk-test-1") {
  const seen: WorkerCommand[] = [];
  const run = { on: true };
  void (async () => {
    while (run.on) {
      const command = await pages.poll(id, { agent: "AppleWebKit/625 (test)", place: "indexer" }, 50);
      if (command === null) continue;
      seen.push(command);
      pages.answer(id, command.id, answerOf(command));
    }
  })();
  return { seen, stop: () => (run.on = false) };
}

describe("one GPU lock for both engines", () => {
  it("the first holder takes the lock, the last one gives it back; a failed take holds nothing", async () => {
    const { counts, take } = countedLock();
    const lock = sharedLock(take);
    const a = await lock();
    const b = await lock();
    expect(counts.taken).toBe(1);
    a();
    a();
    expect(counts.released).toBe(0);
    b();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(counts).toEqual({ taken: 1, released: 1 });
    let fail = true;
    const flaky = sharedLock(() => {
      if (fail) {
        fail = false;
        return Promise.reject(new Error("The GPU lock stayed with process 1."));
      }
      return take();
    });
    await expect(flaky()).rejects.toThrow("GPU lock");
    (await flaky())();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(counts).toEqual({ taken: 2, released: 2 });
  });
});

describe("the WebKit pages", () => {
  it("a lease opens the lab of the spec in the frame of the page, draws a shot and gives the frame back", async () => {
    const { counts, take } = countedLock();
    const pages = new WebKitPages({ build: BUILD, lock: take, workerWaitMs: 500 });
    const worker = inProcessWorker(pages);
    try {
      const lease = await pages.lease({ ...SPEC, take: "walk" }, 4000, "chest");
      const shot = await lease.shooter.shot(4000, "chest");
      expect(shot.png.equals(PNG)).toBe(true);
      expect(shot.frame.simMs).toBe(4000);
      expect(shot.camera).toBe("chest");
      await expect(lease.shooter.page.evaluate(() => 1)).rejects.toThrow("no script");
      await expect(lease.shooter.webp(PNG, 320)).rejects.toMatchObject({ code: NOT_ON_WEBKIT });
      expect(pages.status().workers).toEqual([{ id: "wk-test-1", agent: "AppleWebKit/625 (test)", busy: true }]);
      await pages.release(lease.id);
      expect(worker.seen.map((command) => command.kind)).toEqual(["open", "shot", "close"]);
      const opened = worker.seen[0];
      if (opened?.kind !== "open") throw new Error("no open");
      const query = new URLSearchParams(opened.query);
      expect(
        Object.fromEntries(["take", "freeze", "camera", "panel", "dock", "worker"].map((n) => [n, query.get(n)])),
      ).toEqual({ take: "walk", freeze: "4000", camera: "chest", panel: "0", dock: "0", worker: "0" });
      expect(opened.build).toBe(3);
      const drawn = worker.seen[1];
      expect(drawn).toMatchObject({ kind: "shot", width: 1280, height: 800, at: 4000 });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(counts).toEqual({ taken: 1, released: 1 });
      expect(pages.status().workers[0]?.busy).toBe(false);
    } finally {
      worker.stop();
      await pages.stop();
    }
  });

  it("without a WebKit page a lease is refused with its code; a second lease waits for the one page", async () => {
    const { counts, take } = countedLock();
    const pages = new WebKitPages({ build: BUILD, lock: take, workerWaitMs: 50 });
    await expect(pages.lease(SPEC, 0, "overview")).rejects.toMatchObject({ code: NO_WEBKIT_WORKER, status: 503 });
    expect(counts.taken).toBe(0);
    const worker = inProcessWorker(pages);
    try {
      const first = await pages.lease(SPEC, 0, "overview");
      let second = false;
      const waiting = pages.lease(SPEC, 0, "overview").then((lease) => {
        second = true;
        return lease;
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(second).toBe(false);
      await pages.release(first.id);
      await pages.release((await waiting).id);
      expect(worker.seen.map((command) => command.kind)).toEqual(["open", "close", "open", "close"]);
    } finally {
      worker.stop();
      await pages.stop();
    }
  });

  it("a page that refuses the load fails the lease, gets its frame back and holds no lock", async () => {
    const { counts, take } = countedLock();
    const pages = new WebKitPages({ build: BUILD, lock: take, workerWaitMs: 500 });
    const kinds: string[] = [];
    const run = { on: true };
    void (async () => {
      while (run.on) {
        const command = await pages.poll("wk-bad-1", { agent: "a", place: "indexer" }, 50);
        if (command === null) continue;
        kinds.push(command.kind);
        const body =
          command.kind === "open" ? workerAnswer({ ok: false, error: "no ready in 90 s" }) : workerAnswer({ ok: true });
        pages.answer("wk-bad-1", command.id, body);
      }
    })();
    try {
      await expect(pages.lease(SPEC, 0, "overview")).rejects.toThrow("no ready in 90 s");
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(kinds).toEqual(["open", "close"]);
      expect(counts.taken).toBe(counts.released);
      expect(pages.status().workers[0]?.busy).toBe(false);
    } finally {
      run.on = false;
      await pages.stop();
    }
  });

  it("an answer of another worker or of an unknown command counts for nothing", () => {
    const pages = new WebKitPages({ build: BUILD, lock: countedLock().take });
    expect(pages.answer("wk-x-1", 99, workerAnswer({ ok: true }))).toBe(false);
  });
});

describe("the routing of the pool API by engine", () => {
  async function server() {
    const cache = mkdtempSync(join(tmpdir(), "labs-pool-webkit-"));
    const sources = mkdtempSync(join(tmpdir(), "labs-pool-webkit-src-"));
    made.push(cache, sources);
    const built = new BuiltLab({ cacheDir: cache, sources: [sources], build: fakeBuilder().build });
    await built.ensure();
    const browser = fakeBrowser();
    const lock = sharedLock(countedLock().take);
    const pages = new PagePool({
      origin: "http://127.0.0.1:9",
      pages: 1,
      build: () => built.ensure(),
      lock,
      launch: () => Promise.resolve(browser.browser),
    });
    const webkit = new WebKitPages({ build: () => built.ensure(), lock, workerWaitMs: 100 });
    const token = "a".repeat(64);
    const workerToken = "c".repeat(64);
    const lab = await startBuiltLabServer({
      root: () => built.current?.dir ?? null,
      key: null,
      api: poolApi({ token, pages, built, webkit, workerToken }),
    });
    const client = new PoolClient(
      { version: 1, pid: process.pid, origin: lab.origin, checkout: "/repo", pages: 1, started: "now" },
      token,
    );
    return { lab, client, browser, webkit, token, workerToken };
  }

  /** A fake indexer page over HTTP: the poll and the answer paths with the worker token. */
  function httpWorker(origin: string, token: string) {
    const seen: string[] = [];
    const run = { on: true };
    const headers = { authorization: `Bearer ${token}`, origin: "tauri://localhost" };
    void (async () => {
      while (run.on) {
        const response = await fetch(`${origin}/__pool/webkit/poll?worker=wk-http-1`, {
          method: "POST",
          headers,
          body: JSON.stringify({ agent: "AppleWebKit/625", place: "indexer" }),
        }).catch(() => null);
        if (response === null) break;
        const { command } = (await response.json()) as { command: WorkerCommand | null };
        if (command === null) continue;
        seen.push(command.kind);
        await fetch(`${origin}/__pool/webkit/answer?worker=wk-http-1&command=${String(command.id)}`, {
          method: "POST",
          headers,
          body: new Uint8Array(answerOf(command)),
        });
      }
    })();
    return { seen, stop: () => (run.on = false) };
  }

  it("engine webkit leases the WebKit page; no engine leases a Chromium page; another engine is refused", async () => {
    const { lab, client, browser, webkit, workerToken } = await server();
    const worker = httpWorker(lab.origin, workerToken);
    try {
      const remote = await client.open({ ...SPEC, origin: lab.origin }, 4000, "chest", "webkit");
      const shot = await remote.shot(4000, "chest");
      expect(shot.png.equals(PNG)).toBe(true);
      expect(shot.frame.stats?.drawCalls).toBe(7);
      await remote.close();
      expect(worker.seen).toEqual(["open", "shot", "close"]);
      // The default engine is Chromium: a page load of the fake browser, no command to the WebKit page.
      const chromium = await client.open({ ...SPEC, origin: lab.origin }, 0, "overview");
      await chromium.close();
      expect(browser.gotos).toHaveLength(1);
      expect(worker.seen).toHaveLength(3);
      const status = await client.json<{ webkit: { workers: unknown[] } }>("GET", "status");
      expect(status.webkit.workers).toHaveLength(1);
      await expect(
        client.json("POST", "lease", { spec: SPEC, at: 0, camera: "overview", engine: "firefox" }),
      ).rejects.toThrow('"engine" must be one of chromium, webkit');
      expect(engineOf(undefined)).toBe("chromium");
    } finally {
      worker.stop();
      await webkit.stop();
      await lab.stop();
    }
  });

  it("without a WebKit page the client gets the refusal with its code (the tool then uses Playwright WebKit)", async () => {
    const { lab, client, webkit } = await server();
    try {
      const refused = await client
        .open({ ...SPEC, origin: lab.origin }, 0, "overview", "webkit")
        .catch((e: unknown) => e);
      expect(refused).toBeInstanceOf(PoolRefusal);
      expect(refused).toMatchObject({ code: NO_WEBKIT_WORKER, status: 503 });
    } finally {
      await webkit.stop();
      await lab.stop();
    }
  });

  it("the worker paths need the worker token (not the token of the tools) and answer CORS for the app page", async () => {
    const { lab, token, workerToken, webkit } = await server();
    try {
      const poll = (bearer: string) =>
        fetch(`${lab.origin}/__pool/webkit/poll?worker=wk-auth-1`, {
          method: "POST",
          headers: { authorization: `Bearer ${bearer}`, origin: "tauri://localhost" },
        });
      expect((await poll(token)).status).toBe(401);
      expect((await poll("d".repeat(64))).status).toBe(401);
      const preflight = await fetch(`${lab.origin}/__pool/webkit/poll`, {
        method: "OPTIONS",
        headers: { origin: "tauri://localhost" },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
      const other = await fetch(`${lab.origin}/__pool/webkit/poll`, {
        method: "OPTIONS",
        headers: { origin: "https://example.com" },
      });
      expect(other.headers.get("access-control-allow-origin")).toBeNull();
      // The worker token gives no path of the tools.
      const tools = await fetch(`${lab.origin}/__pool/status`, { headers: { authorization: `Bearer ${workerToken}` } });
      expect(tools.status).toBe(401);
      const unknown = await fetch(`${lab.origin}/__pool/webkit/answer?worker=wk-auth-1&command=5`, {
        method: "POST",
        headers: { authorization: `Bearer ${workerToken}` },
        body: new Uint8Array(workerAnswer({ ok: true })),
      });
      expect(unknown.status).toBe(404);
      // A poll of the right token ends with no command after its wait (here: at the stop of the engine).
      const waiting = poll(workerToken);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await webkit.stop();
      const answer = await waiting;
      expect(answer.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
      expect(await answer.json()).toEqual({ command: null });
    } finally {
      await webkit.stop();
      await lab.stop();
    }
  });
});
