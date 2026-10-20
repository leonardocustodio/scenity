// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
// The built lab and the render pool: the build after a change of the sources, the static server behind the sign-in
// gate, the token of the API, the warm pages and their leases, the job requests and the picture body. The test of the
// stale pictures of `labs stills` is in the plugin.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LAB_KEY_HEADER } from "@scenity/labs-platform/labKey";
import { afterAll, describe, expect, it } from "vitest";
import { poolApi } from "../../scripts/lab/pool/api";
import { BuiltLab, sourceStamp } from "../../scripts/lab/pool/builtLab";
import { jobSpec, runJob } from "../../scripts/lab/pool/jobs";
import type { LabShooter } from "../../scripts/lab/shooter";
import { hostStateDir, readPool, writePool, clearPool } from "../../scripts/lab/pool/paths";
import { PagePool } from "../../scripts/lab/pool/pages";
import { startBuiltLabServer } from "../../scripts/lab/pool/staticServer";
import { packPicture, unpackPicture } from "@scenity/labs-platform/poolWire";
import { fakeBrowser, fakeBuilder, SPEC } from "./poolFakes";

const made: string[] = [];
function temp(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `labs-pool-${name}-`));
  made.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A source folder and a built lab with a fake build. */
function builtLab() {
  const sources = temp("src");
  writeFileSync(join(sources, "main.ts"), "one");
  const builder = fakeBuilder();
  const built = new BuiltLab({ cacheDir: temp("cache"), sources: [sources], build: builder.build });
  return { sources, builder, built };
}

describe("the built lab", () => {
  it("builds once for the same sources and again after a change", async () => {
    const { sources, builder, built } = builtLab();
    const first = await built.ensure();
    expect(await built.ensure()).toBe(first);
    expect(builder.count()).toBe(1);
    writeFileSync(join(sources, "main.ts"), "two");
    utimesSync(join(sources, "main.ts"), new Date(), new Date(Date.now() + 5_000));
    const second = await built.ensure();
    expect(second.id).toBe(first.id + 1);
    expect(builder.count()).toBe(2);
  });

  it("a failed build keeps the last good build; the next change builds again", async () => {
    const { sources, builder, built } = builtLab();
    const good = await built.ensure();
    builder.failNext();
    writeFileSync(join(sources, "main.ts"), "broken");
    utimesSync(join(sources, "main.ts"), new Date(), new Date(Date.now() + 9_000));
    expect(await built.ensure()).toBe(good);
    expect(built.error).toContain("fake build failed");
  });

  it("the stamp changes with a new file and skips outputs and dependencies", () => {
    const sources = temp("stamp");
    writeFileSync(join(sources, "a.ts"), "a");
    const before = sourceStamp([sources]);
    mkdirSync(join(sources, "node_modules"));
    writeFileSync(join(sources, "node_modules", "x.js"), "x");
    expect(sourceStamp([sources])).toBe(before);
    writeFileSync(join(sources, "b.ts"), "b");
    expect(sourceStamp([sources])).not.toBe(before);
  });
});

describe("the static server of the built lab", () => {
  it("needs the secret or a sign-in for a page; the modules stay open; no path leaves the build", async () => {
    const { built } = builtLab();
    const server = await startBuiltLabServer({ root: () => built.current?.dir ?? null, key: "k".repeat(43) });
    const page = { "sec-fetch-dest": "document", accept: "text/html" };
    try {
      expect((await fetch(`${server.origin}/`, { headers: page })).status).toBe(401);
      expect((await fetch(`${server.origin}/`)).status).toBe(503);
      await built.ensure();
      const keyed = await fetch(`${server.origin}/?take=walk`, {
        headers: { ...page, [LAB_KEY_HEADER]: "k".repeat(43) },
      });
      expect(keyed.status).toBe(200);
      expect(await keyed.text()).toContain("built lab");
      const asset = await fetch(`${server.origin}/assets/app.js`);
      expect(asset.headers.get("cache-control")).toContain("immutable");
      expect(asset.headers.get("content-type")).toContain("text/javascript");
      expect((await fetch(`${server.origin}/assets/missing.js`)).status).toBe(404);
      // A path out of the build never gives the file.
      const out = await fetch(`${server.origin}/..%2f..%2f..%2fetc%2fpasswd`);
      expect(out.status).toBe(404);
      expect((await fetch(`${server.origin}/..%2f..%2fetc%2fhosts.txt`)).status).toBe(404);
    } finally {
      await server.stop();
    }
  });

  it("the API needs the token, but for the health", async () => {
    const { built } = builtLab();
    await built.ensure();
    const pages = new PagePool({
      origin: "http://127.0.0.1:1",
      pages: 1,
      build: () => built.ensure(),
      lock: () => Promise.resolve(() => undefined),
    });
    const token = "a".repeat(64);
    const server = await startBuiltLabServer({
      root: () => built.current?.dir ?? null,
      key: null,
      api: poolApi({ token, pages, built }),
    });
    try {
      expect(await (await fetch(`${server.origin}/__pool/health`)).json()).toEqual({ ok: true, build: 1, pages: 1 });
      expect((await fetch(`${server.origin}/__pool/status`)).status).toBe(401);
      expect(
        (await fetch(`${server.origin}/__pool/status`, { headers: { authorization: `Bearer ${"b".repeat(64)}` } }))
          .status,
      ).toBe(401);
      const status = await fetch(`${server.origin}/__pool/build`, { headers: { authorization: `Bearer ${token}` } });
      expect(((await status.json()) as { id: number }).id).toBe(1);
    } finally {
      await server.stop();
    }
  });
});

describe("the warm pages", () => {
  function pool(pages = 1) {
    const browser = fakeBrowser();
    let build = 1;
    const locks = { taken: 0, released: 0 };
    const pagePool = new PagePool({
      origin: "http://127.0.0.1:9",
      pages,
      build: () => Promise.resolve({ id: build, dir: "/b", stamp: "s", ms: 1, at: "now" }),
      lock: () => {
        locks.taken += 1;
        return Promise.resolve(() => (locks.released += 1));
      },
      launch: () => Promise.resolve(browser.browser),
    });
    return { browser, pagePool, locks, nextBuild: () => (build += 1) };
  }

  it("a second lease of the same spec gets the warm page without a page load; a free page freezes", async () => {
    const { browser, pagePool, locks } = pool();
    const first = await pagePool.lease(SPEC, 0, "overview");
    expect(first.warm).toBe(false);
    await pagePool.release(first.id);
    const second = await pagePool.lease(SPEC, 9000, "chest");
    expect(second.warm).toBe(true);
    await pagePool.release(second.id);
    expect(browser.gotos).toHaveLength(1);
    expect(browser.gotos[0]).toContain("take=greet");
    expect(browser.lifecycle.at(-1)).toBe("frozen");
    expect(locks).toEqual({ taken: 2, released: 2 });
  });

  it("another spec, a new build or a script in the page loads the page again; a new size makes a new page", async () => {
    const { browser, pagePool, nextBuild } = pool();
    await pagePool.release((await pagePool.lease(SPEC, 0, "overview")).id);
    await pagePool.release((await pagePool.lease({ ...SPEC, take: "walk" }, 0, "overview")).id);
    expect(browser.gotos).toHaveLength(2);
    expect(browser.contexts).toBe(1);
    nextBuild();
    await pagePool.release((await pagePool.lease({ ...SPEC, take: "walk" }, 0, "overview")).id);
    expect(browser.gotos).toHaveLength(3);
    const dirty = await pagePool.lease({ ...SPEC, take: "walk" }, 0, "overview");
    dirty.dirty = true;
    await pagePool.release(dirty.id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The page of a script loads again in the background with the same spec.
    expect(browser.gotos).toHaveLength(4);
    await pagePool.release(
      (await pagePool.lease({ ...SPEC, take: "walk", width: 640, height: 400 }, 0, "overview")).id,
    );
    expect(browser.contexts).toBe(2);
  });

  it("leases at the same time share one GPU lock; a lease waits for a free page", async () => {
    const { pagePool, locks } = pool(1);
    const first = await pagePool.lease(SPEC, 0, "overview");
    let done = false;
    const waiting = pagePool.lease(SPEC, 0, "overview").then((lease) => {
      done = true;
      return lease;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(done).toBe(false);
    await pagePool.release(first.id);
    const second = await waiting;
    await pagePool.release(second.id);
    expect(locks.taken).toBe(locks.released);
    const two = pool(2);
    const a = await two.pagePool.lease(SPEC, 0, "overview");
    const b = await two.pagePool.lease({ ...SPEC, take: "walk" }, 0, "overview");
    expect(two.locks.taken).toBe(1);
    await two.pagePool.release(a.id);
    expect(two.locks.released).toBe(0);
    await two.pagePool.release(b.id);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(two.locks.released).toBe(1);
  });

  it("a GPU lock that times out fails one lease and holds nothing; the next lease takes the lock again", async () => {
    let fail = true;
    let held = 0;
    const pagePool = new PagePool({
      origin: "http://127.0.0.1:9",
      pages: 1,
      build: () => Promise.resolve({ id: 1, dir: "/b", stamp: "s", ms: 1, at: "now" }),
      lock: () => {
        if (fail) {
          fail = false;
          return Promise.reject(new Error("The GPU lock stayed with process 1."));
        }
        held += 1;
        return Promise.resolve(() => (held -= 1));
      },
      launch: () => Promise.resolve(fakeBrowser().browser),
    });
    await expect(pagePool.lease(SPEC, 0, "overview")).rejects.toThrow("GPU lock");
    const lease = await pagePool.lease(SPEC, 0, "overview");
    expect(held).toBe(1);
    await pagePool.release(lease.id);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(held).toBe(0);
  });
});

describe("the jobs and the files of the pool", () => {
  it("a job URL gives the page spec, the cameras and the other parameters", () => {
    const { spec, cameras } = jobSpec({
      url: "/?take=walk&rec=abc&tier=low&worker=1&assets=0&camera=chest&tune=pose.x:1&t=500&paused=1",
      action: "shot",
      times: [5650],
      out: "/tmp/out",
      size: "640x400",
    });
    expect(spec).toMatchObject({
      take: "walk",
      rec: "abc",
      tier: "low",
      worker: true,
      assets: false,
      width: 640,
      height: 400,
    });
    expect(spec.extra).toEqual({ tune: "pose.x:1" });
    expect(cameras).toEqual(["chest"]);
    // A URL with no take gets the default take of the project, else no take.
    const job = { url: "/?tier=low", action: "shot", times: [0], out: "/tmp/out" } as const;
    expect(jobSpec(job, "greet").spec.take).toBe("greet");
    expect(jobSpec(job).spec.take).toBe("");
    expect(() => jobSpec({ url: "take=greet", action: "shot", times: [], out: "/tmp" })).toThrow("times");
    expect(() => jobSpec({ url: "take=greet", action: "shot", times: [1], out: "relative" })).toThrow("absolute");
  });

  /** The smallest still WebP form for the animation: RIFF, WEBP and one VP8 chunk of 4 bytes. */
  const STILL_WEBP = Buffer.concat([
    Buffer.from("RIFF"),
    Buffer.from([16, 0, 0, 0]),
    Buffer.from("WEBPVP8 "),
    Buffer.from([4, 0, 0, 0, 1, 2, 3, 4]),
  ]);

  it("a clip job makes the video of the page; format webp keeps the animated WebP", async () => {
    const shots: number[] = [];
    const shooter = {
      options: { ...SPEC, origin: "http://127.0.0.1:9" },
      page: {
        evaluate: () =>
          Promise.resolve({
            data: Buffer.from("webm-bytes").toString("base64"),
            mime: "video/webm",
            path: "webcodecs",
            codec: "vp09",
            width: 640,
            height: 400,
            times: [0, 100],
            durationMs: 200,
            timings: { readyMs: 0, stepMs: 0, encodeMs: 0, muxMs: 0, totalMs: 0 },
          }),
      },
      shot: (at: number) => {
        shots.push(at);
        return Promise.resolve({
          png: Buffer.from("png"),
          simMs: at,
          camera: "chest",
          frame: { stats: null },
          metrics: [],
        });
      },
      webp: () => Promise.resolve({ bytes: STILL_WEBP, width: 2, height: 1 }),
      sheet: () => Promise.resolve(Buffer.from("")),
      close: () => Promise.resolve(),
    } as unknown as LabShooter;
    const out = temp("clip");
    const video = await runJob(shooter, { url: "take=walk", action: "clip", times: [4000, 5000], out });
    expect(video.files).toEqual(["clip.webm"]);
    expect(readFileSync(join(out, "clip.webm"), "utf8")).toBe("webm-bytes");
    expect(shots).toEqual([]);
    const old = await runJob(shooter, { url: "take=walk", action: "clip", times: [4000, 5000], out, format: "webp" });
    expect(old.files).toEqual(["clip.webp"]);
    expect(shots).toEqual([4000, 5000]);
  });

  it("a picture body keeps its head and its bytes", () => {
    const body = packPicture({ ref: "s1", simMs: 5650 }, new Uint8Array([1, 2, 3]));
    const { head, bytes } = unpackPicture(body);
    expect(head).toEqual({ ref: "s1", simMs: 5650 });
    expect([...bytes]).toEqual([1, 2, 3]);
    expect(() => unpackPicture(new Uint8Array([1, 2]))).toThrow();
  });

  it("the state folder is the one of the workbench host; pool.json and the token go and come back", () => {
    const hash = createHash("sha256").update("/repo").digest("hex").slice(0, 16);
    expect(hostStateDir("/repo", "darwin", "/Users/a")).toBe(
      `/Users/a/Library/Application Support/org.scenity.editor/host/${hash}`,
    );
    expect(hostStateDir("/repo", "linux", "/home/a", {})).toBe(`/home/a/.local/state/org.scenity.editor/host/${hash}`);
    const dir = temp("state");
    const info = {
      version: 1,
      pid: process.pid,
      origin: "http://127.0.0.1:7",
      checkout: "/repo",
      pages: 2,
      started: "now",
    } as const;
    writePool(dir, info, "f".repeat(64));
    expect(readPool(dir)).toEqual({ info, token: "f".repeat(64) });
    clearPool(dir);
    expect(readPool(dir)).toBeNull();
  });
});
