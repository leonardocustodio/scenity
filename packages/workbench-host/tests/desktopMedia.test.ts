// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the desktop fast path of the host:
 * - the WebP signal of a new JPEG, and the store that serves the WebP of the shell under the ID of the JPEG;
 * - the MP4 of a clip in the store, and its route;
 * - the native snapshot of the tools, with its browser fallback;
 * - the frame URL of the indexer window.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { clipRequest, clipsHttp } from "../src/desktopClips";
import { PictureStore } from "../src/pictures";
import { CLIP_MP4_PATH, NO_NATIVE_MP4, NO_NATIVE_SNAPSHOT, SNAPSHOT_CALL } from "../src/protocol";
import { shellWebp, webpSignal } from "../src/shellWebp";
import type { SurfaceRegistry } from "../src/surfaces";
import { indexerDefaults } from "../src/surfaces";
import type { SurfacePort } from "../src/tools/context";
import { isNoNativeSnapshot, nativeShot } from "../src/tools/nativeShot";
import { cleanup, rejectsWith, tempDir } from "./helpers";

const made: string[] = [];
afterAll(() => cleanup(...made));

function folder(): string {
  const dir = tempDir("desktop-media");
  made.push(dir);
  return dir;
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 9, 9]);

describe("the WebP of the shell", () => {
  test("the signal names the JPEG file; only a shell that asks for it gets one", () => {
    expect(webpSignal("/s/pictures/a.jpg")).toBe('WORKBENCH_SIGNAL {"webp":"/s/pictures/a.jpg"}');
    const lines: string[] = [];
    const write = (line: string): void => {
      lines.push(line);
    };
    expect(shellWebp({}, write)).toBeUndefined();
    expect(shellWebp({ SCENITY_WORKBENCH_SIGNALS: "1" }, write)).toBeUndefined();
    expect(shellWebp({ SCENITY_WORKBENCH_WEBP: "1" }, write)).toBeUndefined();
    shellWebp({ SCENITY_WORKBENCH_SIGNALS: "1", SCENITY_WORKBENCH_WEBP: "1" }, write)?.("/s/pictures/b.jpg");
    expect(lines).toEqual(['WORKBENCH_SIGNAL {"webp":"/s/pictures/b.jpg"}\n']);
  });

  test("the store tells each new JPEG once, and serves the WebP of the shell under the same ID", async () => {
    const jpegs: string[] = [];
    const store = new PictureStore(folder(), { onJpeg: (file) => jpegs.push(file) });
    const id = store.put(JPEG, "image/jpeg");
    expect(store.put(JPEG, "image/jpeg")).toBe(id);
    store.put(WEBP, "image/webp");
    expect(jpegs).toEqual([join(store.dir, `${id}.jpg`)]);
    // The shell: the WebP next to the JPEG, then the JPEG goes (webp_store.rs).
    writeFileSync(join(store.dir, `${id}.webp.tmp`), WEBP);
    renameSync(join(store.dir, `${id}.webp.tmp`), join(store.dir, `${id}.webp`));
    rmSync(join(store.dir, `${id}.jpg`));
    expect(store.read(id)?.mime).toBe("image/webp");
    expect([...(store.read(id)?.bytes ?? [])]).toEqual([...WEBP]);
    // The same JPEG again writes nothing and tells nothing: the ID has its WebP.
    expect(store.put(JPEG, "image/jpeg")).toBe(id);
    expect(existsSync(join(store.dir, `${id}.jpg`))).toBe(false);
    expect(jpegs).toHaveLength(1);
    const response = store.http(new Request("http://h/pictures/x"), new URL(`http://h/pictures/${id}`));
    expect(response?.headers.get("content-type")).toBe("image/webp");
    expect(new Uint8Array(await (response?.arrayBuffer() ?? Promise.resolve(new ArrayBuffer(0))))).toEqual(WEBP);
  });
});

/** A registry with one lab surface whose `clipMp4` call gives `answer`. */
function fakeSurfaces(answer: () => Promise<unknown>, calls: unknown[][] = []): () => SurfaceRegistry {
  const registry = {
    scene: () => "lab",
    call: (id: string, call: string, args: readonly unknown[]) => {
      calls.push([id, call, ...args]);
      return answer();
    },
  };
  return () => registry as unknown as SurfaceRegistry;
}

function post(body: unknown): [Request, URL] {
  const url = new URL(`http://127.0.0.1${CLIP_MP4_PATH}`);
  return [new Request(url, { method: "POST", body: JSON.stringify(body) }), url];
}

describe("the MP4 of a clip in the labs app", () => {
  test("a clip request has a range, a rate and even sides", () => {
    expect(clipRequest({ from: 4000, to: 7950, fps: 15, camera: "chest", width: 641 })).toEqual({
      from: 4000,
      to: 7950,
      fps: 15,
      camera: "chest",
      width: 640,
      height: 400,
      take: null,
    });
    expect(() => clipRequest({ from: 10, to: 5 })).toThrow("range");
    expect(() => clipRequest(null)).toThrow("JSON object");
    expect(clipRequest({ from: 0, to: 1, fps: 500 }).fps).toBe(60);
  });

  test("the route keeps the MP4 of the page in the store and gives its ID", async () => {
    const store = new PictureStore(folder());
    const mp4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]);
    const calls: unknown[][] = [];
    const route = clipsHttp({
      surfaces: fakeSurfaces(() => Promise.resolve({ mime: "video/mp4", bytes: mp4, frames: 60, width: 640 }), calls),
      pictures: store,
    });
    const response = await route(...post({ from: 4000, to: 7950, fps: 15, camera: "chest", width: 640 }));
    expect(response?.status).toBe(200);
    const body = (await response?.json()) as { id: string; bytes: number; frames: number };
    expect(body.bytes).toBe(8);
    expect(body.frames).toBe(60);
    expect(calls[0]?.slice(0, 2)).toEqual(["lab", "clipMp4"]);
    expect(readdirSync(store.dir)).toEqual([`${body.id}.mp4`]);
    // The route serves the clip; `read` gives pictures only.
    const file = store.http(new Request("http://h/"), new URL(`http://h/pictures/${body.id}`));
    expect(file?.headers.get("content-type")).toBe("video/mp4");
    expect(store.read(body.id)).toBeNull();
  });

  test("a browser page gives 501, so the tool keeps MediaRecorder; a bad request 400; another path null", async () => {
    const browser = clipsHttp({
      surfaces: fakeSurfaces(() => Promise.reject(new Error(`${NO_NATIVE_MP4}: a browser`))),
      pictures: new PictureStore(folder()),
    });
    expect((await browser(...post({ from: 0, to: 1000 })))?.status).toBe(501);
    expect((await browser(...post({ from: 5, to: 1 })))?.status).toBe(400);
    expect(await browser(new Request("http://h/x"), new URL("http://h/x"))).toBeNull();
  });
});

/** A port whose `snapshot` call gives `snapshot`, and whose other calls give `other`. */
function fakePort(snapshot: () => Promise<unknown>, calls: string[]): SurfacePort {
  const port: SurfacePort = {
    call: (call) => {
      calls.push(call);
      return call === SNAPSHOT_CALL ? snapshot() : Promise.resolve(null);
    },
  };
  return port;
}

describe("the native snapshot of the tools", () => {
  test("the labs app gives the picture and the times of the shell", async () => {
    const calls: string[] = [];
    const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
    const answer = {
      simMs: null,
      width: 1280,
      height: 742,
      mime: "image/webp",
      bytes,
      ms: { snapshot: 5.1, encode: 9.8, page: 18 },
    };
    const native = await nativeShot(
      fakePort(() => Promise.resolve(answer), calls),
      1280,
    );
    expect(native?.shot.width).toBe(1280);
    expect(native?.ms).toEqual({ snapshot: 5.1, encode: 9.8, page: 18 });
    expect(calls).toEqual([SNAPSHOT_CALL]);
  });

  test("a browser, a hidden frame and an old page give null: the tool keeps the canvas capture", async () => {
    const calls: string[] = [];
    const browser = () => Promise.reject(new Error(`${NO_NATIVE_SNAPSHOT}: the page has no native snapshot`));
    expect(await nativeShot(fakePort(browser, calls), 640)).toBeNull();
    expect(isNoNativeSnapshot(new Error('No call "snapshot". Calls: capture, url.'))).toBe(true);
    expect(isNoNativeSnapshot(new Error("The frame did not answer."))).toBe(false);
    await rejectsWith(
      nativeShot(
        fakePort(() => Promise.reject(new Error("boom")), calls),
        640,
      ),
      "boom",
    );
  });
});

describe("the frame of the indexer window", () => {
  test("the built lab without the panel and the dock, a fixed quality, the worker and a stopped clock", () => {
    const url = new URL(indexerDefaults("http://127.0.0.1:5199/?workbench=tauri%3A%2F%2Flocalhost") ?? "");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      workbench: "tauri://localhost",
      worker: "1",
      panel: "0",
      dock: "0",
      adaptive: "0",
      paused: "1",
      t: "0",
    });
    expect(indexerDefaults(null)).toBeNull();
  });
});
