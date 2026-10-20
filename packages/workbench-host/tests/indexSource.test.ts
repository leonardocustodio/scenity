// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the frame index source in the host:
 * - the queue makes the jobs of a plan in the order of `planJobs`;
 * - the plans of the source of a project come before the plans of the page;
 * - the focus of the scene page;
 * - the index of a copy of the showroom fills with no page plan (a renderer gives each frame).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { planJobs, type IndexPlan } from "@scenity/labs-platform/indexSource";
import { HostIndex } from "../src/index/hostIndex";
import { focusOfUrl, IndexQueue, INDEX_SIZES } from "../src/index/queue";
import { loadHostProject } from "../src/project";
import { encodeIndexFrame, type IndexJobWire, type IndexProgress } from "../src/protocol";
import { Router } from "../src/router";
import { startServer, type HostServer } from "../src/server";
import { cleanup, FakePage, tempDir } from "./helpers";

const SAMPLES = resolve(import.meta.dir, "../../../samples");
const HASH = "0123456789abcdef0123456789abcdef";
const folders: string[] = [];
const servers: HostServer[] = [];
const pages: FakePage[] = [];
afterAll(async () => {
  for (const page of pages) page.close();
  await Promise.all(servers.map((server) => server.stop()));
  cleanup(...folders);
});

const PLAN: IndexPlan = {
  source: "take:demo",
  events: [{ at: 0, kind: "x" }],
  tunes: {},
  renderer: { assets: true },
  tier: "high",
  durationMs: 500,
  moments: [250, 300],
  views: ["a", [0, 1, 2, 0, 0, 0, 45]],
  items: [{ id: "item", from: 100, to: 260 }],
};

describe("the queue and the plans", () => {
  test("the jobs of a plan come in the order of planJobs, with the same keys, moments and items", () => {
    const queue = new IndexQueue({ now: () => 0 });
    const added = queue.plan([PLAN], HASH);
    const jobs = planJobs(PLAN, HASH, INDEX_SIZES);
    expect(added.map((job) => [job.key, job.size, job.moment, [...job.items]])).toEqual(
      jobs.map((job) => [job.key, job.size, job.moment, [...job.items]]),
    );
    expect(added.length).toBe(7 * 2 * 2);
  });

  test("the plans of the source come before the plans of the page", () => {
    const queue = new IndexQueue({ now: () => 0 });
    const base = { ...PLAN, source: "scene:scenes/a.scene.json", durationMs: 0, moments: [0], items: [] };
    queue.setBase([base]);
    const added = queue.plan([PLAN], HASH);
    expect(added[0]?.input.source).toBe(base.source);
    expect(added.filter((job) => job.input.source === base.source).length).toBe(4);
    expect(added.at(-1)?.input.source).toBe(PLAN.source);
  });

  test("the focus of a URL of the scene page is its sequence, else its scene", () => {
    const page = "http://127.0.0.1:5175/scene.html?project=characters";
    expect(focusOfUrl(`${page}&sequence=sequences/walk.sequence.json&t=1200`)).toEqual({
      source: "sequence:sequences/walk.sequence.json",
      timeMs: 1200,
      item: null,
    });
    expect(focusOfUrl(`${page}&scene=scenes/main.scene.json`)?.source).toBe("scene:scenes/main.scene.json");
    expect(focusOfUrl("http://127.0.0.1:5175/?take=greet&t=5")?.source).toBe("take:greet");
    expect(focusOfUrl("http://127.0.0.1:5175/?scene=scenes/main.scene.json")?.source).toBeNull();
  });
});

/** A host index over a copy of a sample project (the folder is its own checkout). */
async function rig(
  name: string,
): Promise<{ readonly page: FakePage; readonly index: HostIndex; readonly dir: string }> {
  const dir = tempDir(`index-${name}`);
  folders.push(dir);
  cpSync(join(SAMPLES, name), dir, { recursive: true });
  const project = await loadHostProject(dir);
  const state = tempDir("index-state");
  folders.push(state);
  const router = new Router();
  const late: { server?: HostServer } = {};
  const index = new HostIndex({
    stateDir: state,
    broadcast: (event) => late.server?.broadcast(event),
    checkout: () => dir,
    source: () => project.index,
  });
  index.register(router);
  const token = "t".repeat(64);
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
  return { page, index, dir };
}

/** Take each job of the queue and give a picture for it, as a renderer does. */
async function fill(page: FakePage): Promise<IndexJobWire[]> {
  const drawn: IndexJobWire[] = [];
  for (;;) {
    const { jobs } = (await page.call("index.next", { renderer: "test", max: 8 })) as { jobs: IndexJobWire[] };
    if (jobs.length === 0) return drawn;
    for (const job of jobs) {
      page.sendBinary(encodeIndexFrame(job.job, "image/png", new Uint8Array([job.job & 0xff, 1, 2])));
      expect(await page.call("index.done", { job: job.job, bytes: 3, mime: "image/png" })).toEqual({ stored: true });
      drawn.push(job);
    }
  }
}

describe("the index fills for a scene project", () => {
  test("the showroom: the host plans its scene with no page plan, and a renderer fills every job", async () => {
    const { page, index } = await rig("showroom");
    const start = (await page.call("index.status")) as IndexProgress;
    expect(start).toMatchObject({ total: 4, queued: 4, done: 0 });
    const drawn = await fill(page);
    expect(drawn.map((job) => [job.input.source, job.input.view, job.size])).toEqual([
      ["scene:scenes/main.scene.json", "front", 160],
      ["scene:scenes/main.scene.json", "top", 160],
      ["scene:scenes/main.scene.json", "front", 640],
      ["scene:scenes/main.scene.json", "top", 640],
    ]);
    const end = (await page.call("index.status")) as IndexProgress;
    expect(end).toMatchObject({ total: 4, done: 4, queued: 0 });
    for (const job of drawn) expect(await index.store.has(job.key, job.size)).toBe(true);
  });

  test("the characters: one plan per sequence; a new marker of a sequence plans its time again", async () => {
    const { page, dir } = await rig("characters");
    const start = (await page.call("index.status")) as IndexProgress;
    expect(start.total).toBeGreaterThan(1000);
    const path = join(dir, "sequences/table-walk.sequence.json");
    const sequence = JSON.parse(readFileSync(path, "utf8")) as { markers: Record<string, number> };
    sequence.markers.extra = 1234;
    writeFileSync(path, `${JSON.stringify(sequence, null, 2)}\n`);
    const { jobs } = (await page.call("index.next", { renderer: "test", max: 64 })) as { jobs: IndexJobWire[] };
    expect(jobs[0]?.input.contentHash).not.toBe(start.contentHash);
    const after = (await page.call("index.status")) as IndexProgress;
    // The new moment adds one time with the two cameras of the table scene, in two sizes.
    expect(after.total).toBe(start.total + 4);
  });
});
