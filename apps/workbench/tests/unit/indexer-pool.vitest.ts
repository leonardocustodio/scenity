// SPDX-License-Identifier: Apache-2.0
/**
 * The indexer window as a WebKit page of the render pool: the URL of the lab of a tool, and the answer form. The
 * commands of the pool (open, shot, close), with a fake bridge and a fake pool. The warm frame. The lend of the frame
 * by the indexer loop: a wait ends at once, no job runs while the frame is lent, and a new load comes after.
 */
import type { IndexJobWire } from "@scenity/workbench-host/protocol";
import { describe, expect, test } from "vitest";
import { IndexerLoop, type IndexerParts } from "../../src/indexer/indexerLoop";
import { leaseUrl, packAnswer, PoolWorker, type PoolCommand, type PoolWorkerParts } from "../../src/indexer/poolWorker";

const BASE =
  "http://127.0.0.1:5199/?workbench=tauri%3A%2F%2Flocalhost&labsKey=secret&panel=0&dock=0&adaptive=0&paused=1&t=0";
const QUERY = "take=wave&freeze=4000&panel=0&dock=0&worker=0&tier=high&assets=1&camera=chest";

/** Split an answer of the page: the JSON head and the bytes. */
function unpack(body: Uint8Array): { head: Record<string, unknown>; bytes: Uint8Array } {
  expect(new TextDecoder().decode(body.subarray(0, 4))).toBe("CBP1");
  const size = new DataView(body.buffer, body.byteOffset).getUint32(4, false);
  const head = JSON.parse(new TextDecoder().decode(body.subarray(8, 8 + size))) as Record<string, unknown>;
  return { head, bytes: body.subarray(8 + size) };
}

/** A fake indexer page: the frame, the bridge, the lend of the loop and a pool that gives commands. */
function page(commands: PoolCommand[] = []) {
  const log: string[] = [];
  const answers: { url: string; body: Uint8Array }[] = [];
  let src: string | null = null;
  const parts: PoolWorkerParts = {
    endpoint: () => ({ origin: "http://127.0.0.1:7001", token: "w".repeat(64) }),
    baseUrl: () => BASE,
    lend: () => {
      log.push("lend");
      return Promise.resolve();
    },
    giveBack: () => log.push("give back"),
    load: (url) => {
      log.push(`load ${new URL(url).searchParams.get("take") ?? ""}`);
      src = url;
      return Promise.resolve();
    },
    frameSrc: () => src,
    callFrame: (call, args) => {
      log.push(`${call} ${JSON.stringify(args)}`);
      if (call === "frame") return Promise.resolve({ simMs: 4000, stats: { drawCalls: 9 } });
      if (call === "measure") return Promise.resolve([{ metric: "ik.reachError", member: "ada", value: 0.01 }]);
      if (call === "capture") return Promise.resolve({ mime: "image/png", bytes: new Uint8Array([1, 2, 3]).buffer });
      return Promise.resolve(null);
    },
    fetch: (url, init) => {
      if (url.includes("/poll?")) {
        log.push(`poll ${String((init.headers as Record<string, string>).authorization).slice(0, 9)}`);
        return Promise.resolve(Response.json({ command: commands.shift() ?? null }));
      }
      answers.push({ url, body: init.body as Uint8Array });
      return Promise.resolve(Response.json({ ok: true }));
    },
    sleep: () => Promise.resolve(),
    agent: "AppleWebKit/625 (test)",
  };
  return {
    parts,
    log,
    answers,
    setSrc: (url: string | null) => (src = url),
  };
}

const open = (id: number, lease = "w1", build = 1): PoolCommand => ({
  id,
  kind: "open",
  lease,
  query: QUERY,
  key: "spec-a",
  build,
});
const shot = (id: number, lease = "w1"): PoolCommand => ({
  id,
  kind: "shot",
  lease,
  at: 4000,
  camera: "chest",
  width: 1280,
  height: 800,
});
const close = (id: number, lease = "w1"): PoolCommand => ({ id, kind: "close", lease });

describe("the URL and the answer form", () => {
  test("the lab of a tool keeps the secret and the bridge of the indexer lab and takes the query of the tool", () => {
    const params = new URL(leaseUrl(BASE, QUERY)).searchParams;
    expect(params.get("labsKey")).toBe("secret");
    expect(params.get("workbench")).toBe("tauri://localhost");
    expect(params.get("take")).toBe("wave");
    expect(params.get("freeze")).toBe("4000");
    expect(params.get("camera")).toBe("chest");
    expect(params.get("adaptive")).toBe("0");
  });

  test("an answer has the head and the bytes of the picture form of the pool", () => {
    const { head, bytes } = unpack(packAnswer({ ok: true, simMs: 5 }, new Uint8Array([9, 8])));
    expect(head).toEqual({ ok: true, simMs: 5 });
    expect([...bytes]).toEqual([9, 8]);
  });
});

describe("the commands of the pool", () => {
  test("open lends the frame and loads the lab; shot draws through the bridge; close gives the frame back", async () => {
    const fake = page([open(1), shot(2), close(3)]);
    const worker = new PoolWorker(fake.parts);
    for (let step = 0; step < 3; step += 1) await worker.step();
    expect(fake.log).toEqual([
      "poll Bearer ww",
      "lend",
      "load wave",
      "poll Bearer ww",
      "seek [4000]",
      'camera ["chest"]',
      "frame []",
      "measure []",
      'capture [1280,1,800,{"mime":"image/png"}]',
      "poll Bearer ww",
      "give back",
    ]);
    expect(fake.answers.map((answer) => new URL(answer.url).searchParams.get("command"))).toEqual(["1", "2", "3"]);
    expect(new URL(fake.answers[0]?.url ?? "").searchParams.get("worker")).toBe(worker.id);
    const opened = unpack(fake.answers[0]?.body ?? new Uint8Array());
    expect(opened.head).toMatchObject({ ok: true, warm: false });
    const drawn = unpack(fake.answers[1]?.body ?? new Uint8Array());
    expect(drawn.head).toMatchObject({ ok: true, simMs: 4000, frame: { stats: { drawCalls: 9 } } });
    expect([...drawn.bytes]).toEqual([1, 2, 3]);
    expect(worker.lease).toBeNull();
    expect(worker.done).toBe(3);
  });

  test("the same lab of the same build is warm while the indexer did not load its own lab", async () => {
    const fake = page([open(1), close(2), open(3, "w2"), close(4, "w2"), open(5, "w3")]);
    const worker = new PoolWorker(fake.parts);
    for (let step = 0; step < 4; step += 1) await worker.step();
    expect(unpack(fake.answers[2]?.body ?? new Uint8Array()).head).toMatchObject({ warm: true });
    // The indexer loads its own lab: the next open loads again.
    fake.setSrc("http://127.0.0.1:5199/?tier=high");
    await worker.step();
    expect(unpack(fake.answers[4]?.body ?? new Uint8Array()).head).toMatchObject({ warm: false });
    expect(fake.log.filter((line) => line.startsWith("load"))).toEqual(["load wave", "load wave"]);
  });

  test("a new build loads again; a shot of another lease and a failed capture answer an error", async () => {
    const fake = page([open(1), close(2), open(3, "w2", 2), shot(4, "w9")]);
    const worker = new PoolWorker(fake.parts);
    for (let step = 0; step < 4; step += 1) await worker.step();
    expect(unpack(fake.answers[2]?.body ?? new Uint8Array()).head).toMatchObject({ warm: false });
    expect(unpack(fake.answers[3]?.body ?? new Uint8Array()).head).toEqual({
      ok: false,
      error: "The frame is not lent to lease w9.",
    });
    const jpeg = page([open(1), shot(2)]);
    jpeg.parts.callFrame = (call) =>
      Promise.resolve(call === "capture" ? { mime: "image/jpeg", bytes: new ArrayBuffer(2) } : null);
    const second = new PoolWorker(jpeg.parts);
    await second.step();
    await second.step();
    expect(unpack(jpeg.answers[1]?.body ?? new Uint8Array()).head).toMatchObject({ ok: false });
  });

  test("a frame that does not load goes back to the indexer; a stop gives a lent frame back", async () => {
    const fake = page([open(1)]);
    fake.parts.load = () => Promise.reject(new Error("no ready in 90 s"));
    const worker = new PoolWorker(fake.parts);
    await worker.step();
    expect(fake.log).toEqual(["poll Bearer ww", "lend", "give back"]);
    expect(unpack(fake.answers[0]?.body ?? new Uint8Array()).head).toEqual({ ok: false, error: "no ready in 90 s" });
    const lent = page([open(1)]);
    const other = new PoolWorker(lent.parts);
    await other.step();
    await other.stop();
    expect(lent.log.at(-1)).toBe("give back");
  });
});

/** A loop whose host queue gives one job, and whose idle wait ends only by a lend. */
function loopWorld(jobs: IndexJobWire[]) {
  const log: string[] = [];
  const parts: IndexerParts = {
    request: (type) => {
      if (type === "index.next") return Promise.resolve({ jobs: jobs.splice(0, 1) });
      return Promise.resolve({ stored: true });
    },
    sendIndexFrame: () => undefined,
    callFrame: () => Promise.resolve({ mime: "image/jpeg", bytes: new ArrayBuffer(5), metrics: {} }),
    baseUrl: () => BASE,
    load: () => {
      log.push("load");
      return Promise.resolve();
    },
    shellState: () => Promise.resolve({ run: true, reason: null, main: null, report: 0 }),
    // The wait for work never ends by itself: only a lend ends it.
    waitForWork: () => {
      log.push("wait");
      return new Promise(() => undefined);
    },
    sleep: () => Promise.resolve(),
    now: () => performance.now(),
  };
  return { parts, log };
}

describe("the lend of the frame", () => {
  test("a lend ends the idle wait at once; no job while lent; the frame loads again after the give back", async () => {
    const input = {
      source: "take:greet",
      events: [],
      timeMs: 0,
      view: "overview",
      tunes: {},
      renderer: { debug: [], assets: true, reduced: false },
      tier: "high",
      backend: "webgl" as const,
      contentHash: "0123456789abcdef0123456789abcdef",
    };
    const jobs: IndexJobWire[] = [{ job: 1, key: "f".repeat(32), size: 160, input }];
    const { parts, log } = loopWorld(jobs);
    const loop = new IndexerLoop(parts, { capFps: 1000 });
    loop.start();
    // The first job loads the frame; then the empty queue waits.
    for (let tries = 0; tries < 50 && !log.includes("wait"); tries += 1) await new Promise((r) => setTimeout(r, 5));
    expect(log).toEqual(["load", "wait"]);
    await loop.lend();
    expect(loop.lent).toBe(true);
    expect(loop.status.phase).toBe("lent");
    jobs.push({ job: 2, key: "e".repeat(32), size: 160, input });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(jobs).toHaveLength(1);
    loop.giveBack();
    for (let tries = 0; tries < 50 && jobs.length > 0; tries += 1) await new Promise((r) => setTimeout(r, 5));
    for (let tries = 0; tries < 50 && log.length < 4; tries += 1) await new Promise((r) => setTimeout(r, 5));
    // The pool loaded another lab: the next job loads the frame again.
    expect(log).toEqual(["load", "wait", "load", "wait"]);
    // A lend also ends the wait of the loop for the stop.
    await loop.lend();
    await loop.stop();
    expect(loop.status.phase).toBe("stopped");
  });
});
