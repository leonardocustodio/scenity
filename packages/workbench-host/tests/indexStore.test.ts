// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the frame index of the host: the shared store suite on the files of the state folder, and the protocol
 * over a real WebSocket. The protocol tests use a plan, a job, its binary frame, `index.done`, the route
 * `GET /index/<key>` with the token, the `index.progress` events and a content hash change.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { frameKey } from "@scenity/labs-platform/frameKey";
import { contentSource } from "@scenity/labs-platform/indexSource";
import { IndexStore } from "@scenity/labs-platform/indexStore";
import { indexStoreSuite } from "@scenity/labs-platform/testing/indexStore";
import { fileBackend } from "../src/index/files";
import { HostIndex } from "../src/index/hostIndex";
import { encodeIndexFrame, TOKEN_HEADER, type IndexJobWire } from "../src/protocol";
import { Router } from "../src/router";
import { startServer, type HostServer } from "../src/server";
import { cleanup, FakePage, rejectsWith, tempDir } from "./helpers";

const folders: string[] = [];
afterAll(() => cleanup(...folders));

function folder(prefix: string): string {
  const path = tempDir(prefix);
  folders.push(path);
  return path;
}

indexStoreSuite("host files", { describe, test, expect }, (options) => {
  const root = folder("index");
  return Promise.resolve({
    store: new IndexStore(fileBackend(root), options),
    reopen: () => new IndexStore(fileBackend(root), options),
  });
});

describe("the files of the host index", () => {
  test("a path with .. or an odd part is refused", async () => {
    const backend = fileBackend(folder("index"));
    await rejectsWith(backend.write("index/../x", new Uint8Array(1)), "refuses");
    await rejectsWith(backend.read("/etc/passwd"), "refuses");
    await rejectsWith(backend.removeTree(".."), "refuses");
  });
});

/** The content root of a fake plugin and its pose families (the frame index source of the rig). */
const ROOM_SRC = "plugins/demo/room/src";
const SOURCE = contentSource({
  roots: [ROOM_SRC],
  manifest: null,
  excluded: [],
  families: { dir: `${ROOM_SRC}/model/families/`, registryName: "FAMILY_POSES" },
});

/** A checkout with one content file in its workspace (the repo root). */
function checkout(): string {
  const root = folder("index-checkout");
  mkdirSync(join(root, ROOM_SRC), { recursive: true });
  writeFileSync(join(root, ROOM_SRC, "core.ts"), "export const A = 1;\n");
  return root;
}

interface Rig {
  readonly index: HostIndex;
  readonly server: HostServer;
  readonly page: FakePage;
  readonly repo: string;
  readonly state: string;
}

const servers: HostServer[] = [];
const pages: FakePage[] = [];
afterAll(async () => {
  for (const page of pages) page.close();
  await Promise.all(servers.map((server) => server.stop()));
});

async function rig(): Promise<Rig> {
  const repo = checkout();
  const state = folder("index-state");
  const token = "t".repeat(64);
  const router = new Router();
  const late: { server?: HostServer } = {};
  const index = new HostIndex({
    stateDir: state,
    broadcast: (event) => late.server?.broadcast(event),
    checkout: () => repo,
    source: () => SOURCE,
  });
  index.register(router);
  const server = startServer({
    port: 0,
    token,
    onMessage: (client, text) => router.dispatch(text, client),
    onBinary: (client, data) => void index.bytes(client, data),
    http: (request, url) => index.http(request, url),
  });
  late.server = server;
  servers.push(server);
  const page = await FakePage.open({ origin: server.origin, token });
  pages.push(page);
  return { index, server, page, repo, state };
}

/** The files of a small pose model: a shared pose module, the registry, the idle and the access families. */
const FAMILY_FILE = {
  pose: `${ROOM_SRC}/model/pose.ts`,
  registry: `${ROOM_SRC}/model/families/index.ts`,
  idle: `${ROOM_SRC}/model/families/idle.ts`,
  access: `${ROOM_SRC}/model/families/access.ts`,
  accessArm: `${ROOM_SRC}/model/families/accessArm.ts`,
} as const;

const FAMILY_TREE: Readonly<Record<string, string>> = {
  [FAMILY_FILE.pose]: 'import { FAMILY_POSES } from "./families";\nexport const P = 1;\n',
  [FAMILY_FILE.registry]: [
    'import { accessPose } from "./access";',
    'import { idlePose } from "./idle";',
    "",
    "export const FAMILY_POSES = {",
    "  access: accessPose,",
    "  idle: idlePose,",
    "};",
    "",
  ].join("\n"),
  [FAMILY_FILE.idle]: "export function idlePose(): object {\n  return {};\n}\n",
  [FAMILY_FILE.access]:
    'import { armStep } from "./accessArm";\nexport function accessPose(): object {\n  return { lean: armStep() };\n}\n',
  [FAMILY_FILE.accessArm]: "export function armStep(): number {\n  return 1;\n}\n",
};

const TAKE = {
  source: "take:greet",
  events: [],
  tunes: {},
  renderer: { assets: true },
  tier: "high",
  durationMs: 1000,
  moments: [],
  views: ["chest"],
};

describe("the index protocol of the host", () => {
  test("plan, take a job, give its frame as bytes, read it at GET /index/<key> with the token", async () => {
    const { page, server, state } = await rig();
    const planned = (await page.call("index.plan", { takes: [TAKE] })) as { contentHash: string; jobs: number };
    expect(planned.jobs).toBe(22);
    const { jobs } = (await page.call("index.next", { renderer: "test", max: 2, sizes: [160] })) as {
      jobs: IndexJobWire[];
    };
    const [job] = jobs;
    expect(job?.size).toBe(160);
    expect(job?.key).toBe(frameKey(job!.input));
    expect(job?.input.contentHash).toBe(planned.contentHash);
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    page.sendBinary(encodeIndexFrame(job!.job, "image/webp", bytes));
    const done = await page.call("index.done", {
      job: job!.job,
      bytes: 5,
      mime: "image/webp",
      metrics: { "ik.reachError": 0 },
    });
    expect(done).toEqual({ stored: true });
    const progress = await page.waitEvent((event) => event.type === "index.progress" && event.done === 1);
    expect(progress).toMatchObject({ total: 22, done: 1, leased: 1 });
    const url = `${server.origin}/index/${job!.key}?size=160`;
    expect((await fetch(url)).status).toBe(401);
    const response = await fetch(url, { headers: { [TOKEN_HEADER]: "t".repeat(64) } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3, 4, 5]);
    const bad = await fetch(`${server.origin}/index/..%2F..%2Fetc`, { headers: { [TOKEN_HEADER]: "t".repeat(64) } });
    expect(bad.status).toBe(404);
    await page.call("index.status");
    await server.stop();
    expect(readdirSync(join(state, "index"))).toEqual([planned.contentHash]);
  });

  test("an index.done without its bytes fails; a second plan skips the frames of the store", async () => {
    const { page, index } = await rig();
    await page.call("index.plan", { takes: [TAKE] });
    const { jobs } = (await page.call("index.next", { renderer: "test", max: 1 })) as { jobs: IndexJobWire[] };
    const answer = await page.request("index.done", { job: jobs[0]!.job, bytes: 3, mime: "image/webp" });
    expect(answer.ok).toBe(false);
    page.sendBinary(encodeIndexFrame(jobs[0]!.job, "image/jpeg", new Uint8Array(3)));
    await page.call("index.done", { job: jobs[0]!.job, bytes: 3, mime: "image/jpeg" });
    await index.store.flush();
    const again = (await page.call("index.plan", { takes: [TAKE] })) as { jobs: number };
    expect(again.jobs).toBe(21);
  });

  test("an edit of a content file makes the jobs stale: a stale answer stores nothing", async () => {
    const { page, repo } = await rig();
    const first = (await page.call("index.plan", { takes: [TAKE] })) as { contentHash: string };
    const { jobs } = (await page.call("index.next", { renderer: "test" })) as { jobs: IndexJobWire[] };
    writeFileSync(join(repo, ROOM_SRC, "core.ts"), "export const A = 2;\n");
    const next = (await page.call("index.next", { renderer: "test" })) as { jobs: IndexJobWire[] };
    expect(next.jobs[0]?.input.contentHash).not.toBe(first.contentHash);
    const stale = (await page.call("index.status")) as { stale: number };
    expect(stale.stale).toBeGreaterThan(0);
    page.sendBinary(encodeIndexFrame(jobs[0]!.job, "image/webp", new Uint8Array(2)));
    expect(await page.call("index.done", { job: jobs[0]!.job, bytes: 2, mime: "image/webp" })).toEqual({
      stored: false,
    });
  });

  test("an edit after a full index plans the take again in the background; an undo finds the old frames", async () => {
    const { page, repo } = await rig();
    const file = join(repo, ROOM_SRC, "core.ts");
    const first = (await page.call("index.plan", { takes: [{ ...TAKE, durationMs: 0 }] })) as { jobs: number };
    // Render the whole take: every job of the plan.
    for (let left = first.jobs; left > 0; left -= 1) {
      const { jobs } = (await page.call("index.next", { renderer: "test" })) as { jobs: IndexJobWire[] };
      page.sendBinary(encodeIndexFrame(jobs[0]!.job, "image/webp", new Uint8Array(2)));
      await page.call("index.done", { job: jobs[0]!.job, bytes: 2, mime: "image/webp" });
    }
    expect(await page.call("index.status")).toMatchObject({ queued: 0, done: first.jobs });
    writeFileSync(file, "export const A = 3;\n");
    // No plan and no index.next: the status alone sees the edit, and the queue has the jobs of the new hash.
    expect(await page.call("index.status")).toMatchObject({ queued: first.jobs, done: 0 });
    writeFileSync(file, "export const A = 1;\n");
    expect(await page.call("index.status")).toMatchObject({ queued: 0, done: first.jobs });
  });

  test("an edit of a family that a frame does not read keeps the frame; a shared edit or no reads does not", async () => {
    const { page, repo, index } = await rig();
    const web = repo;
    for (const [path, text] of Object.entries(FAMILY_TREE)) {
      mkdirSync(join(web, path, ".."), { recursive: true });
      writeFileSync(join(web, path), text);
    }
    const hash0 = index.contentHash();
    const first = (await page.call("index.plan", { takes: [{ ...TAKE, durationMs: 200 }] })) as { jobs: number };
    expect(first.jobs).toBe(6);
    // The frame at 0 ms calls idle; at 100 ms idle and access (the arm clip); at 200 ms the renderer gave no reads.
    const readsAt = (time: number) => (time === 0 ? ["idle"] : time === 100 ? ["access", "idle"] : undefined);
    const jobs: IndexJobWire[] = [];
    for (let left = first.jobs; left > 0; left -= 1) {
      const job = ((await page.call("index.next", { renderer: "test" })) as { jobs: IndexJobWire[] }).jobs[0]!;
      jobs.push(job);
      page.sendBinary(encodeIndexFrame(job.job, "image/webp", new Uint8Array([job.job, 7])));
      const reads = readsAt(job.input.timeMs);
      await page.call("index.done", { job: job.job, bytes: 2, mime: "image/webp", ...(reads ? { reads } : {}) });
    }
    // An edit of the arm clip (a file of the access part): the frames at 0 ms move to the new hash.
    writeFileSync(join(web, FAMILY_FILE.accessArm), "export function armStep(): number {\n  return 2;\n}\n");
    expect(await page.call("index.status")).toMatchObject({ queued: 4, done: 2, carried: 2 });
    const hash1 = index.contentHash();
    expect(hash1).not.toBe(hash0);
    for (const job of jobs.filter((item) => item.input.timeMs === 0)) {
      const key = frameKey({ ...job.input, contentHash: hash1 });
      const hit = await index.get(key, job.size);
      expect(hit?.bytes).toEqual(new Uint8Array([job.job, 7]));
      expect(hit?.frame.reads).toEqual(["idle"]);
    }
    // An edit of the idle pose (read by every frame) keeps none; an edit of a shared file keeps none.
    writeFileSync(join(web, FAMILY_FILE.idle), "export function idlePose(): object {\n  return { lean: 1 };\n}\n");
    expect(await page.call("index.status")).toMatchObject({ queued: 6, done: 0, carried: 2 });
    writeFileSync(join(web, FAMILY_FILE.idle), FAMILY_TREE[FAMILY_FILE.idle]!);
    writeFileSync(join(web, FAMILY_FILE.pose), 'import { FAMILY_POSES } from "./families";\nexport const P = 2;\n');
    expect(await page.call("index.status")).toMatchObject({ queued: 6, done: 0, carried: 2 });
  });

  test("a seek of the visible lab moves its window first", async () => {
    const { page, index } = await rig();
    await page.call("index.plan", { takes: [{ ...TAKE, durationMs: 20_000 }] });
    index.onSurfaceEvent("lab", "visible", {
      workbench: 1,
      event: "url",
      url: "http://127.0.0.1:5175/?take=greet&t=15000",
    });
    index.onSurfaceEvent("lab", "shadow", {
      workbench: 1,
      event: "url",
      url: "http://127.0.0.1:5175/?take=greet&t=0",
    });
    const { jobs } = (await page.call("index.next", { renderer: "test", max: 3 })) as { jobs: IndexJobWire[] };
    expect(jobs.map((job) => job.input.timeMs)).toEqual([15_000, 14_900, 15_100]);
  });
});
