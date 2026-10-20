// SPDX-License-Identifier: Apache-2.0
/**
 * The desktop fast path of the workbench page, with a fake shell. The relay answers `snapshot` and `clipMp4` itself,
 * and a browser answers NO_NATIVE_…. The native snapshot reads the framed answer of the shell. The MP4 clip steps the
 * frame and gives each JPEG with its sim time. The main page reports its frame pace only while the indexer is active.
 */
import { CLIP_MP4_CALL, NO_NATIVE_MP4, NO_NATIVE_SNAPSHOT, SNAPSHOT_CALL } from "@scenity/workbench-host/protocol";
import type { RequestParams } from "@scenity/workbench-host/protocol";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { paceOf, startFramePace } from "../../src/desktop/framePace";
import { desktopLocalCalls } from "../../src/desktop/localCalls";
import { clipTimes, makeMp4Clip } from "../../src/desktop/mp4Clip";
import { readFramed, shellFeature, type ShellWindow } from "../../src/desktop/shell";
import { nativeSnapshot, regionOf } from "../../src/desktop/snapshot";
import { createRelay, type FrameTarget, type RelayPicture } from "../../src/surfaces/relay";

/** A framed answer of the shell (`raw.rs`): a u32 length, the JSON header, the bytes. */
function framed(header: Record<string, unknown>, bytes: number[]): ArrayBuffer {
  const text = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(4 + text.length + bytes.length);
  new DataView(out.buffer).setUint32(0, text.length, true);
  out.set(text, 4);
  out.set(bytes, 4 + text.length);
  return out.buffer;
}

interface Invoked {
  readonly command: string;
  readonly args: unknown;
  readonly headers?: Record<string, string> | undefined;
}

/** A fake window of the labs app with the shell features and a script of command answers. */
function fakeShell(features: string[], answer: (command: string, args: unknown) => unknown) {
  const invoked: Invoked[] = [];
  let callback: ((message: unknown) => void) | null = null;
  const win: ShellWindow = {
    __SCENITY_SHELL__: { features },
    __TAURI_INTERNALS__: {
      invoke: (command, args, options) => {
        invoked.push({ command, args, headers: options?.headers });
        if (command === "plugin:event|listen") return Promise.resolve(7);
        return Promise.resolve(answer(command, args));
      },
      transformCallback: (handler) => {
        callback = handler;
        return 1;
      },
    },
  };
  return { win, invoked, emit: (payload: unknown) => callback?.({ payload }) };
}

describe("the shell helpers", () => {
  test("a framed answer gives its header and its bytes; other data throws", () => {
    const { header, bytes } = readFramed(framed({ width: 2 }, [1, 2, 3]));
    expect(header).toEqual({ width: 2 });
    expect([...bytes]).toEqual([1, 2, 3]);
    expect(() => readFramed("text")).toThrow("no bytes");
    expect(() => readFramed(new Uint8Array([200, 0, 0, 0, 1]).buffer)).toThrow("cut");
  });

  test("a feature counts only with the internals of the app", () => {
    expect(shellFeature("snapshot", fakeShell(["snapshot"], () => null).win)).toBe(true);
    expect(shellFeature("mp4", fakeShell(["snapshot"], () => null).win)).toBe(false);
    expect(shellFeature("snapshot", { __SCENITY_SHELL__: { features: ["snapshot"] } })).toBe(false);
  });
});

describe("the native snapshot", () => {
  test("asks the shell for the region at a width and gives a capture answer with the times", async () => {
    const shell = fakeShell(["snapshot"], () =>
      framed({ width: 1280, height: 742, mime: "image/webp", ms: { snapshot: 4.6, encode: 9.9 } }, [82, 73]),
    );
    let clock = 100;
    const shot = await nativeSnapshot({ x: 0, y: 48, width: 900, height: 522 }, 1280, {
      win: shell.win,
      now: () => (clock += 7),
    });
    expect(shell.invoked[0]).toEqual({
      command: "snapshot_surface",
      args: { request: { rect: { x: 0, y: 48, width: 900, height: 522 }, width: 1280 } },
      headers: undefined,
    });
    expect(shot).toMatchObject({ simMs: null, width: 1280, height: 742, mime: "image/webp", source: "window" });
    expect(shot.ms).toEqual({ snapshot: 4.6, encode: 9.9, page: 7 });
    expect(new Uint8Array(shot.bytes)).toEqual(new Uint8Array([82, 73]));
  });

  test("an element without a size has no region", () => {
    const element = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 10 }) } as unknown as Element;
    expect(regionOf(element)).toBeNull();
    expect(regionOf(null)).toBeNull();
  });
});

class FakeFrame implements FrameTarget {
  readonly origin = "http://127.0.0.1:5400";
  readonly posted: Record<string, unknown>[] = [];
  readonly window = {
    postMessage: (message: unknown) => {
      this.posted.push(message as Record<string, unknown>);
    },
  };
}

function relayWith(local: ReturnType<typeof desktopLocalCalls>) {
  const answers: { params: RequestParams<"surface.call">; picture: RelayPicture | undefined }[] = [];
  const relay = createRelay({
    answer: (params, picture) => answers.push({ params, picture }),
    report: () => undefined,
    local,
  });
  const frame = new FakeFrame();
  relay.attach("lab", "visible", frame);
  return { relay, frame, answers };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

describe("the calls that the page answers itself", () => {
  test("a snapshot of the labs app goes to the shell, never into the frame, and back as a picture", async () => {
    const shell = fakeShell(["snapshot"], () => framed({ width: 640, height: 400, mime: "image/webp", ms: {} }, [9]));
    const element = { getBoundingClientRect: () => ({ left: 10, top: 40, width: 800, height: 500 }) } as Element;
    const { relay, frame, answers } = relayWith(desktopLocalCalls({ win: shell.win, frameElement: () => element }));
    relay.request({ request: 5, surface: "lab", where: "visible", call: SNAPSHOT_CALL, args: [{ width: 640 }] });
    await settle();
    expect(frame.posted).toEqual([]);
    expect(answers[0]?.params).toMatchObject({ request: 5, result: { width: 640, mime: "image/webp", bytes: 1 } });
    expect(answers[0]?.picture?.mime).toBe("image/webp");
  });

  test("a browser, a hidden tab and the shadow frame answer NO_NATIVE_SNAPSHOT; other calls go into the frame", async () => {
    const browser = relayWith(desktopLocalCalls({ win: {} }));
    browser.relay.request({ request: 1, surface: "lab", where: "visible", call: SNAPSHOT_CALL, args: [] });
    browser.relay.request({ request: 2, surface: "lab", where: "visible", call: "seek", args: [1] });
    await settle();
    expect(browser.answers[0]?.params).toMatchObject({ request: 1 });
    expect(String((browser.answers[0]?.params as { error?: string }).error)).toContain(NO_NATIVE_SNAPSHOT);
    expect(browser.frame.posted).toEqual([{ workbench: 1, id: 1, call: "seek", args: [1] }]);
    const shell = fakeShell(["snapshot"], () => null);
    const app = relayWith(desktopLocalCalls({ win: shell.win, frameElement: () => null }));
    app.relay.setHidden("lab", true);
    app.relay.request({ request: 3, surface: "lab", where: "visible", call: SNAPSHOT_CALL, args: [] });
    app.relay.request({ request: 4, surface: "lab", where: "shadow", call: SNAPSHOT_CALL, args: [] });
    await settle();
    expect(app.answers.map((answer) => String((answer.params as { error?: string }).error))).toEqual([
      expect.stringContaining("not on the screen"),
      expect.stringContaining("not on the screen"),
    ]);
    expect(shell.invoked.filter((item) => item.command === "snapshot_surface")).toEqual([]);
  });

  test("an MP4 in a browser answers NO_NATIVE_MP4", async () => {
    const { relay, answers } = relayWith(desktopLocalCalls({ win: {} }));
    relay.request({ request: 9, surface: "lab", where: "visible", call: CLIP_MP4_CALL, args: [{}] });
    await settle();
    expect(String((answers[0]?.params as { error?: string }).error)).toContain(NO_NATIVE_MP4);
  });
});

describe("the MP4 of a clip", () => {
  test("the frame times run from `from` to `to` at the rate", () => {
    expect(clipTimes(4000, 4200, 15)).toEqual([4000, 4067, 4133, 4200]);
    expect(clipTimes(0, 50, 10)).toEqual([0]);
  });

  test("steps the frame, gives each JPEG with the sim time of its frame, and gives the MP4 of the shell", async () => {
    const calls: unknown[][] = [];
    let clock = 0;
    const frameCall = (call: string, args: readonly unknown[] = []): Promise<unknown> => {
      calls.push([call, ...args]);
      if (call === "capture") return Promise.resolve({ simMs: clock, mime: "image/jpeg", bytes: new ArrayBuffer(3) });
      if (call === "seek") clock = Number(args[0]) + 1;
      return Promise.resolve(null);
    };
    const shell = fakeShell(["mp4"], (command) => {
      if (command === "clip_mp4_begin") return 4;
      if (command === "clip_mp4_frame") return { decode: 2, append: 1 };
      return framed(
        { mime: "video/mp4", width: 320, height: 200, frames: 3, codec: "avc1", ms: { decode: 6 } },
        [0, 1],
      );
    });
    const request = { from: 1000, to: 1200, fps: 10, camera: "chest", width: 320, height: 200, take: "wave" };
    const clip = await makeMp4Clip(frameCall, request, { win: shell.win });
    expect(calls.slice(0, 3)).toEqual([["pause"], ["load", "wave"], ["camera", "chest"]]);
    expect(calls.find((call) => call[0] === "capture")).toEqual(["capture", 320, null, 200]);
    const frames = shell.invoked.filter((item) => item.command === "clip_mp4_frame");
    expect(frames.map((item) => item.headers)).toEqual([
      { "x-clip-session": "4", "x-sim-ms": "1001" },
      { "x-clip-session": "4", "x-sim-ms": "1101" },
      { "x-clip-session": "4", "x-sim-ms": "1201" },
    ]);
    expect(frames[0]?.args).toBeInstanceOf(ArrayBuffer);
    expect(shell.invoked.at(-1)).toMatchObject({ command: "clip_mp4_end", args: { session: 4 } });
    expect(clip).toMatchObject({ mime: "video/mp4", frames: 3, width: 320, codec: "avc1", durationMs: 200 });
    expect(clip.ms.decode).toBe(6);
  });

  test("a lab page with the index calls draws each sim time without a seek (no URL write)", async () => {
    const calls: unknown[][] = [];
    const frameCall = (call: string, args: readonly unknown[] = []): Promise<unknown> => {
      calls.push([call, ...args]);
      if (call === "indexInput") return Promise.resolve({ source: "take:wave", timeMs: 0, view: "chest" });
      if (call === "indexJob") {
        const [input] = args as [{ timeMs: number }];
        return Promise.resolve({ simMs: input.timeMs, mime: "image/jpeg", bytes: new ArrayBuffer(4) });
      }
      return Promise.resolve(null);
    };
    const shell = fakeShell(["mp4"], (command, args) => {
      if (command === "clip_mp4_begin") return args === undefined ? null : 2;
      if (command === "clip_mp4_frame") return { decode: 1, append: 1 };
      return framed({ mime: "video/mp4", width: 640, height: 400, frames: 2 }, [0]);
    });
    const request = { from: 4000, to: 4100, fps: 10, camera: "chest", width: 640, height: 360, take: null };
    const clip = await makeMp4Clip(frameCall, request, { win: shell.win });
    expect(calls.map((call) => call[0])).toEqual(["pause", "camera", "indexInput", "indexJob", "indexJob"]);
    expect(calls[2]).toEqual(["indexInput", { t: 4000, camera: "chest" }]);
    expect(calls[3]).toEqual(["indexJob", { source: "take:wave", timeMs: 4000, view: "chest" }, 640]);
    // The index draws at 16:10, so the MP4 is 640 × 400 for all heights that the call asks.
    expect(shell.invoked[0]).toMatchObject({
      command: "clip_mp4_begin",
      args: { request: { width: 640, height: 400 } },
    });
    expect(clip.frames).toBe(2);
  });

  test("a frame that is not a JPEG ends the session of the shell and fails", async () => {
    const shell = fakeShell(["mp4"], (command) => (command === "clip_mp4_begin" ? 1 : null));
    const frameCall = (call: string): Promise<unknown> =>
      Promise.resolve(call === "capture" ? { simMs: 1, mime: "image/webp", bytes: new ArrayBuffer(1) } : null);
    const request = { from: 0, to: 0, fps: 10, camera: null, width: 64, height: 40, take: null };
    await expect(makeMp4Clip(frameCall, request, { win: shell.win })).rejects.toThrow("not a JPEG");
    expect(shell.invoked.at(-1)?.command).toBe("clip_mp4_end");
  });
});

describe("the frame pace of the main window", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("the pace of a report window: the frames, the p95 and the rate; nothing drawn gives nulls", () => {
    expect(paceOf({ frames: 58, intervalP95: 17.9 }, 1000)).toEqual({ frames: 58, p95Ms: 17.9, fps: 58 });
    expect(paceOf({ frames: 0, intervalP95: 0 }, 1000)).toEqual({ frames: 0, p95Ms: null, fps: null });
    expect(paceOf(null, 1000)).toEqual({ frames: 0, p95Ms: null, fps: null });
  });

  test("reports once per second only while the indexer is active", async () => {
    const shell = fakeShell([], () => null);
    let reads = 0;
    let clock = 0;
    const stop = startFramePace(
      () => {
        reads += 1;
        return Promise.resolve({ frames: 60, intervalP95: 16.9 });
      },
      { win: shell.win, now: () => clock },
    );
    await settle();
    await vi.advanceTimersByTimeAsync(3000);
    expect(reads).toBe(0);
    shell.emit({ active: true });
    clock = 0;
    await vi.advanceTimersByTimeAsync(0);
    clock = 1000;
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    const paces = shell.invoked.filter((item) => item.command === "frame_pace").map((item) => item.args);
    expect(paces).toEqual([{ pace: { frames: 60, p95Ms: 16.9, fps: 60 } }]);
    shell.emit({ active: false });
    const before = reads;
    await vi.advanceTimersByTimeAsync(3000);
    expect(reads).toBe(before);
    stop();
  });
});
