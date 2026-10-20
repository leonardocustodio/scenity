// SPDX-License-Identifier: Apache-2.0
/**
 * The readers of the frame index in the host:
 * - the route `GET /index/take/<hash>/<take>` with the stale frames of an older content hash;
 * - the request `index.shadow`;
 * - the tools `lab_frame` and `lab_sheet` from the index (a hit draws nothing, and a miss of `lab_frame` keeps its
 *   picture on demand);
 * - the tune sheets of the picker from the index.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import { frameKey, takeKeyOf, type FrameKeyInput } from "@scenity/labs-platform/frameKey";
import { IndexStore } from "@scenity/labs-platform/indexStore";
import { encodePng } from "@scenity/labs-platform/sheetRaster";
import { fileBackend } from "../src/index/files";
import { HostIndex } from "../src/index/hostIndex";
import { Picker } from "../src/picker";
import { TOKEN_HEADER, type HostEvent, type PickSheet } from "../src/protocol";
import { Router } from "../src/router";
import { startServer, type HostServer } from "../src/server";
import { makeToolContext, type ToolContext } from "../src/tools/context";
import { handleToolRequest } from "../src/tools/index";
import type { ToolResult } from "../src/tools/kit";
import { fakeLab, labAnswers, REPO_ROOT } from "./fakeLab";
import { cleanup, FakePage, tempDir } from "./helpers";

const folders: string[] = [];
const servers: HostServer[] = [];
const pages: FakePage[] = [];
afterAll(async () => {
  for (const page of pages) page.close();
  await Promise.all(servers.map((server) => server.stop()));
  cleanup(...folders);
});

function folder(prefix: string): string {
  const path = tempDir(prefix);
  folders.push(path);
  return path;
}

const OLD = "a".repeat(32);
const NOW = "b".repeat(32);

/** The input of a frame of the fake lab (the bridge call `indexInput`). */
function frameInput(timeMs: number, contentHash = NOW, view = "side"): FrameKeyInput {
  return {
    source: "take:greet",
    events: [],
    timeMs,
    view,
    tunes: {},
    renderer: { debug: [], assets: true, reduced: false },
    tier: "high",
    backend: "webgl",
    contentHash,
  };
}

/** A small WebP picture (16:10). */
async function webp(width: number, shade: number): Promise<Uint8Array> {
  const height = Math.round(width / 1.6);
  const data = new Uint8Array(width * height * 4).map((_, index) => (index % 4 === 3 ? 255 : shade));
  const png = encodePng({ width, height, data }, (bytes) => new Uint8Array(deflateSync(bytes)));
  return new Bun.Image(png).webp({ quality: 80 }).bytes();
}

describe("the routes and requests of the readers", () => {
  test("GET /index/take gives the frames of now and the stale frames; index.shadow says when the shadow is ready", async () => {
    const state = folder("index-readers");
    const token = "t".repeat(64);
    const router = new Router();
    const index = new HostIndex({ stateDir: state, broadcast: () => undefined, checkout: () => folder("checkout") });
    index.register(router);
    const server = startServer({
      port: 0,
      token,
      onMessage: (client, text) => router.dispatch(text, client),
      http: (r, u) => index.http(r, u),
    });
    servers.push(server);
    for (const [hash, time] of [
      [OLD, 0],
      [OLD, 1000],
      [NOW, 0],
    ] as const) {
      await index.store.put({
        input: frameInput(time, hash),
        size: 160,
        mime: "image/webp",
        bytes: new Uint8Array([1, 2]),
      });
    }
    const take = takeKeyOf(frameInput(0));
    const response = await fetch(`${server.origin}/index/take/${NOW}/${take}`, { headers: { [TOKEN_HEADER]: token } });
    const body = (await response.json()) as {
      current: { frames: unknown[] } | null;
      stale: { contentHash: string } | null;
    };
    expect(body.current?.frames).toHaveLength(1);
    expect(body.stale?.contentHash).toBe(OLD);
    expect((await fetch(`${server.origin}/index/take/${NOW}/xyz`, { headers: { [TOKEN_HEADER]: token } })).status).toBe(
      404,
    );
    expect((await fetch(`${server.origin}/index/take/${NOW}/${take}`)).status).toBe(401);

    const page = await FakePage.open({ origin: server.origin, token });
    pages.push(page);
    expect(await page.call("index.shadow")).toEqual({ ready: false });
    index.useShadow(() => ({ call: () => Promise.resolve("url") }));
    expect(await page.call("index.shadow")).toEqual({ ready: true });
    index.useShadow(() => ({ call: () => new Promise((resolve) => setTimeout(resolve, 1000)) }));
    expect(await page.call("index.shadow")).toEqual({ ready: false });
  });
});

function textOf(result: ToolResult): string {
  return result.content.map((block) => (block.type === "text" ? block.text : `[image ${block.mimeType}]`)).join("\n");
}

/** A tool context round the fake lab with the frame index of a store. */
function indexContext(store: IndexStore, answers = labAnswers()): { ctx: ToolContext; calls: { call: string }[] } {
  const lab = fakeLab({
    ...answers,
    indexInput: (args: readonly unknown[]) => {
      const target = args[0] as { t: number; camera?: string };
      return frameInput(target.t, NOW, target.camera ?? "side");
    },
  });
  const ctx = makeToolContext({
    surface: () => lab.port,
    checkout: REPO_ROOT,
    index: { get: (key, size) => store.get(key, size), put: (item) => store.put(item) },
  });
  return { ctx, calls: lab.calls };
}

describe("lab_frame from the index", () => {
  test("a miss renders and keeps the frame; the same call then answers from the index without a draw", async () => {
    const store = new IndexStore(fileBackend(folder("index-frame")));
    const bytes = await webp(640, 90);
    const answers = { ...labAnswers(), capture: { simMs: 6350, width: 640, height: 400, mime: "image/webp", bytes } };
    const miss = indexContext(store, answers);
    const first = await handleToolRequest("lab_frame", { t: 6350, camera: "side", width: 640 }, miss.ctx);
    expect(miss.calls.map((item) => item.call)).toContain("capture");
    expect(textOf(first)).not.toContain("from the frame index");
    const kept = await store.get(frameKey(frameInput(6350)), 640);
    expect(kept?.frame.metrics).toEqual({ "bo|ik.reachError|m": 0.0123, "scene|members.overlap|m": 0 });

    const hit = indexContext(store, answers);
    const start = performance.now();
    const second = await handleToolRequest("lab_frame", { t: 6350, camera: "side", width: 640 }, hit.ctx);
    const ms = performance.now() - start;
    expect(hit.calls.map((item) => item.call)).toEqual(["indexInput", "camera", "pause", "seek", "url"]);
    expect(textOf(second)).toContain("from the frame index");
    expect(textOf(second)).toContain("bo: ik.reachError 0.012 m");
    expect(second.content.at(-1)).toMatchObject({ type: "image", mimeType: "image/webp" });
    expect(ms).toBeLessThan(100);
  });

  test("a call that changes the scene first does not read the index", async () => {
    const store = new IndexStore(fileBackend(folder("index-frame-scene")));
    const { ctx, calls } = indexContext(store);
    await handleToolRequest("lab_frame", { take: "storm", t: 100 }, ctx);
    expect(calls.map((item) => item.call)).not.toContain("indexInput");
  });
});

describe("lab_sheet from the index", () => {
  test("a sheet of the scene of now from the index: no shadow call, under 100 ms", async () => {
    const store = new IndexStore(fileBackend(folder("index-sheet")));
    const times = [6000, 6250, 6500, 6750, 7000, 7250, 7500, 7750];
    for (const [index, at] of times.entries()) {
      await store.put({
        input: frameInput(at),
        size: 640,
        mime: "image/webp",
        bytes: await webp(640, 40 + index * 20),
      });
    }
    const { ctx, calls } = indexContext(store);
    const start = performance.now();
    const result = await handleToolRequest("lab_sheet", { from: 6000, to: 7750, step: 250 }, ctx);
    const ms = performance.now() - start;
    expect(calls.map((item) => item.call)).toEqual(["indexInput"]);
    expect(textOf(result)).toContain("from the frame index");
    expect(result.content.at(-1)).toMatchObject({ type: "image", mimeType: "image/jpeg" });
    console.log(`lab_sheet from the index: 8 cells in ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(100);
  });

  test("a miss goes to the shadow frame as before", async () => {
    const store = new IndexStore(fileBackend(folder("index-sheet-miss")));
    const { ctx, calls } = indexContext(store, {
      ...labAnswers(),
      sheet: {
        mime: "image/webp",
        bytes: new Uint8Array(4),
        width: 4,
        height: 4,
        cameras: ["side"],
        take: "greet",
        lanes: null,
      },
    });
    await handleToolRequest("lab_sheet", { from: 6000, to: 6500, step: 250 }, ctx);
    expect(calls.map((item) => item.call)).toEqual(["indexInput", "sheet"]);
  });
});

describe("the picker from the index", () => {
  test("a tune sheet comes from the index when the shadow state has every cell; a miss draws it", async () => {
    const store = new IndexStore(fileBackend(folder("index-picker")));
    const window = { take: "greet", from: 6000, to: 7000, step: 500, cameras: ["side", "chest"] };
    for (const at of [6000, 6500, 7000]) {
      for (const view of window.cameras) {
        // The shadow sheet of three columns asks for 640 px cells (960 px wide).
        await store.put({
          input: frameInput(at, NOW, view),
          size: 640,
          mime: "image/webp",
          bytes: await webp(640, 90),
        });
      }
    }
    const calls: string[] = [];
    const tunes: number[] = [];
    const shadow = {
      call(call: string, args: readonly unknown[] = []) {
        calls.push(call);
        if (call === "tune") tunes.push(args[1] as number);
        if (call === "resetTunes") tunes.length = 0;
        if (call === "indexInput") {
          const target = args[0] as { t: number; camera?: string };
          const input = frameInput(target.t, NOW, target.camera ?? "side");
          return Promise.resolve(tunes.length === 0 ? input : { ...input, tunes: { "x.y": tunes[0] } });
        }
        return Promise.resolve(call === "sheet" ? { bytes: new Uint8Array([1, 2, 3]), mime: "image/webp" } : null);
      },
    };
    const events: HostEvent[] = [];
    const puts: string[] = [];
    const picker = new Picker({
      pictures: { put: (bytes, mime) => `${mime} ${String(puts.push(String(bytes.length)))}` },
      shadow: () => shadow,
      labUrl: () => null,
      runs: { running: () => null, startRun: () => Promise.reject(new Error("no run")) },
      worktrees: () => [],
      isCheckout: () => Promise.resolve(false),
      current: () => REPO_ROOT,
      emit: (event) => events.push(event),
      index: { get: (key, size) => store.get(key, size), put: (item) => store.put(item) },
    });
    const candidates = [
      { id: "defaults", label: "Defaults", kind: "tune" as const, tune: "" },
      { id: "lower", label: "Lower", kind: "tune" as const, tune: "x.y:0.5" },
    ];
    await picker.sheets(window, candidates);
    const deadline = Date.now() + 5000;
    while (events.length < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    const sheets = events.map((event) => (event as { sheet: PickSheet }).sheet);
    expect(sheets.map((sheet) => [sheet.candidate, sheet.mime, sheet.error])).toEqual([
      ["defaults", "image/jpeg", null],
      ["lower", "image/webp", null],
    ]);
    // The defaults come from the index (no `sheet` call); the tune values of "lower" miss and the shadow draws them.
    expect(calls.filter((call) => call === "sheet")).toHaveLength(1);
  });
});
