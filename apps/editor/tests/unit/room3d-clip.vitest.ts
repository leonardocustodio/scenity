// SPDX-License-Identifier: Apache-2.0
/**
 * The clip of the lab with fakes of WebCodecs, MediaRecorder and the page. The encoder gets the frames in order, with a
 * key frame each `keyEvery` frames and timestamps from the sim times (never the wall clock). The fallback choice takes
 * VP9, then AV1, then VP8, then MediaRecorder. `makeClip` steps the frames and returns the clock to its first state.
 */
import { describe, expect, it, vi } from "vitest";
import { chooseClipPath, type ClipEnv } from "../../src/core/clip/choose";
import { av1cOf, batchSize, encodeClip, type EncodeDeps, type SourceFrame } from "../../src/core/clip/encoder";
import { clipTimes, makeClip, type ClipParts } from "../../src/core/clip/labClip";
import { recordClip, type RecordDeps } from "../../src/core/clip/recorder";
import { readWebm } from "@scenity/labs-platform/webm";
import type { ClipCodec } from "../../src/core/clip/choose";

const VP9: ClipCodec = { name: "vp9", codec: "vp09.00.10.08", webm: "V_VP9" };

function bitmap(width = 640, height = 401): ImageBitmap & { closed: boolean } {
  const item = { width, height, closed: false, close: () => (item.closed = true) };
  return item;
}

interface Encoded {
  timestamp: number;
  keyFrame: boolean;
  rect: DOMRectInit | undefined;
}

/** A fake WebCodecs: each encode gives one chunk at the flush; the clock moves 1 ms per call of `now`. */
function fakeCodecs(log: { encoded: Encoded[]; flushes: number; configs: VideoEncoderConfig[] }): EncodeDeps {
  let clock = 0;
  class FakeFrame {
    constructor(
      readonly image: ImageBitmap,
      readonly init: VideoFrameInit,
    ) {}
    close() {
      return undefined;
    }
  }
  class FakeEncoder {
    readonly pending: Encoded[] = [];
    constructor(readonly init: VideoEncoderInit) {}
    configure(config: VideoEncoderConfig) {
      log.configs.push(config);
    }
    encode(frame: FakeFrame, options?: VideoEncoderEncodeOptions) {
      const item = {
        timestamp: frame.init.timestamp ?? -1,
        keyFrame: options?.keyFrame === true,
        rect: frame.init.visibleRect,
      };
      log.encoded.push(item);
      this.pending.push(item);
    }
    flush() {
      log.flushes += 1;
      for (const item of this.pending.splice(0)) {
        const chunk = {
          type: item.keyFrame ? "key" : "delta",
          timestamp: item.timestamp,
          byteLength: 3,
          copyTo: (target: Uint8Array) => target.set([1, 2, 3]),
        };
        this.init.output(chunk as unknown as EncodedVideoChunk, {});
      }
      return Promise.resolve();
    }
    close() {
      return undefined;
    }
  }
  return {
    VideoEncoder: FakeEncoder as unknown as EncodeDeps["VideoEncoder"],
    VideoFrame: FakeFrame,
    now: () => (clock += 1),
  };
}

describe("encodeClip", () => {
  it("encodes the frames in order with key frames each keyEvery and timestamps from the sim times", async () => {
    const log = { encoded: [] as Encoded[], flushes: 0, configs: [] as VideoEncoderConfig[] };
    const times = clipTimes(4000, 5000, 12);
    const bitmaps: ReturnType<typeof bitmap>[] = [];
    const step = (simMs: number): Promise<SourceFrame> => {
      const item = bitmap();
      bitmaps.push(item);
      return Promise.resolve({ bitmap: item, simMs });
    };
    const request = { codec: VP9, width: 640, height: 400, fps: 12, times, keyEvery: 5 };
    const out = await encodeClip(step, request, fakeCodecs(log));
    expect(log.encoded.map((item) => item.timestamp)).toEqual(times.map((at) => (at - 4000) * 1000));
    expect(log.encoded.filter((item) => item.keyFrame).map((item) => item.timestamp / 1000)).toEqual([0, 417, 833]);
    expect(out.frames.map((item) => item.timestampUs)).toEqual(log.encoded.map((item) => item.timestamp));
    expect(out.frames.filter((item) => item.key)).toHaveLength(3);
    // The odd height of the pictures is cut to the even size of the video.
    expect(log.encoded[0]?.rect).toEqual({ x: 0, y: 0, width: 640, height: 400 });
    expect(log.configs[0]).toMatchObject({ codec: "vp09.00.10.08", width: 640, height: 400, framerate: 12 });
    expect(bitmaps.every((item) => item.closed)).toBe(true);
    expect(out.frameUs).toBe(83_333);
    expect(out.stepMs).toBeGreaterThan(0);
    expect(out.encodeMs).toBeGreaterThan(0);
  });

  it("gives the same timestamps on a slower or faster page (no wall clock)", async () => {
    const run = async (slow: number) => {
      const log = { encoded: [] as Encoded[], flushes: 0, configs: [] as VideoEncoderConfig[] };
      const deps = fakeCodecs(log);
      let wall = 0;
      const out = await encodeClip(
        (simMs) => Promise.resolve({ bitmap: bitmap(), simMs }),
        { codec: VP9, width: 640, height: 400, fps: 15, times: clipTimes(0, 2000, 15), keyEvery: 15 },
        { ...deps, now: () => (wall += slow) },
      );
      return out.frames.map((item) => [item.timestampUs, item.key]);
    };
    expect(await run(1)).toEqual(await run(97));
  });

  it("encodes in batches that hold at most BATCH_BYTES of pictures", async () => {
    const log = { encoded: [] as Encoded[], flushes: 0, configs: [] as VideoEncoderConfig[] };
    const times = clipTimes(0, 10_000, 12);
    const size = batchSize(1920, 1080);
    await encodeClip(
      (simMs) => Promise.resolve({ bitmap: bitmap(1920, 1080), simMs }),
      { codec: VP9, width: 1920, height: 1080, fps: 12, times, keyEvery: 12 },
      fakeCodecs(log),
    );
    expect(size).toBe(32);
    expect(log.flushes).toBe(Math.ceil(times.length / size));
    expect(log.encoded).toHaveLength(times.length);
  });

  it("makes the av1C record of an AV1 codec string", () => {
    expect([...av1cOf("av01.0.04M.08")]).toEqual([0x81, 0x04, 0x0c, 0]);
    expect([...av1cOf("av01.0.08H.10")]).toEqual([0x81, 0x08, 0xcc, 0]);
  });
});

/** A page with the encoders that `codecs` names and a recorder of the types in `types`. */
function env(codecs: readonly string[], types: readonly string[] | null, captureStream = true): ClipEnv {
  return {
    VideoEncoder: {
      isConfigSupported: (config: VideoEncoderConfig) =>
        Promise.resolve({ supported: codecs.includes(config.codec), config }),
    },
    ...(types === null ? {} : { MediaRecorder: { isTypeSupported: (type: string) => types.includes(type) } }),
    captureStream,
  };
}

describe("chooseClipPath", () => {
  const size = { width: 640, height: 400, fps: 12 };
  const name = async (given: ClipEnv, format: "webm" | "mp4" = "webm", force?: "webcodecs" | "mediarecorder") => {
    const path = await chooseClipPath(given, format, size, force);
    return path.kind === "webcodecs" ? path.codec.name : path.kind === "mediarecorder" ? path.mime : "none";
  };

  it("takes VP9 first, AV1 second and VP8 last", async () => {
    expect(await name(env(["vp09.00.10.08", "av01.0.04M.08", "vp8"], null))).toBe("vp9");
    expect(await name(env(["av01.0.04M.08", "vp8"], null))).toBe("av1");
    expect(await name(env(["vp8"], null))).toBe("vp8");
  });

  it("falls back to MediaRecorder without a WebCodecs encoder, and to none without a recorder", async () => {
    expect(await name(env([], ["video/webm;codecs=vp8", "video/webm"]))).toBe("video/webm;codecs=vp8");
    expect(await name({ captureStream: true, MediaRecorder: { isTypeSupported: () => true } })).toBe(
      "video/webm;codecs=vp9",
    );
    expect(await name(env([], ["video/webm"], false))).toBe("none");
    expect(await name(env([], null))).toBe("none");
  });

  it("makes an MP4 only with MediaRecorder, never with WebCodecs H.264", async () => {
    expect(await name(env(["vp09.00.10.08"], ["video/mp4"]), "mp4")).toBe("video/mp4");
    expect(await name(env(["vp09.00.10.08"], ["video/webm"]), "mp4")).toBe("none");
    expect(await name(env(["vp09.00.10.08"], ["video/mp4"]), "mp4", "webcodecs")).toBe("none");
  });

  it("takes only the forced path", async () => {
    const both = env(["vp09.00.10.08"], ["video/webm"]);
    expect(await name(both, "webm", "mediarecorder")).toBe("video/webm");
    expect(await name(env([], ["video/webm"]), "webm", "webcodecs")).toBe("none");
  });

  it("counts an encoder check that throws as no support", async () => {
    const broken: ClipEnv = {
      VideoEncoder: { isConfigSupported: () => Promise.reject(new Error("hang")) },
      captureStream: false,
    };
    expect(await name(broken)).toBe("none");
  });
});

/** The page parts of a lab whose frames show `drift` ms off at the first capture of each time. */
function fakeLab(drift = 0) {
  const calls: string[] = [];
  let time = 2500;
  let running = true;
  let shown = 0;
  const late = drift;
  const parts: ClipParts = {
    seek(ms) {
      calls.push(`seek ${String(ms)}`);
      time = ms;
      shown = ms + late;
      return Promise.resolve();
    },
    camera(view) {
      calls.push(`camera ${typeof view === "string" ? view : "view"}`);
    },
    settle() {
      calls.push("settle");
      shown = time;
      return Promise.resolve();
    },
    capture(width) {
      return Promise.resolve({ simMs: shown, bitmap: bitmap(width, 401), members: [] });
    },
    clock: {
      time: () => time,
      running: () => running,
      pause: () => (running = false),
      play: () => (running = true),
    },
    env: env(["vp09.00.10.08"], null),
    encodeDeps: fakeCodecs({ encoded: [], flushes: 0, configs: [] }),
  };
  return { parts, calls, state: () => ({ time, running }) };
}

describe("makeClip", () => {
  it("steps the frames, writes a WebM file and gives the clock back", async () => {
    const lab = fakeLab();
    const clip = await makeClip(lab.parts, { from: 4000, to: 5000, fps: 12, camera: "chest", width: 640 });
    expect(clip.path).toBe("webcodecs");
    expect(clip.codec).toBe("vp9");
    expect(clip.mime).toBe("video/webm;codecs=vp9");
    expect([clip.width, clip.height]).toEqual([640, 400]);
    expect(clip.times).toEqual(clipTimes(4000, 5000, 12));
    // 13 frames, each one frame time long.
    expect(clip.durationMs).toBeCloseTo((13 * 1000) / 12, 6);
    const read = readWebm(new Uint8Array(clip.bytes));
    expect(read.blocks.map((block) => block.ms)).toEqual(clip.times.map((at) => at - 4000));
    expect(lab.calls[0]).toBe("camera chest");
    expect(lab.state()).toEqual({ time: 2500, running: true });
  });

  it("draws a frame again after a full settle when it shows another time, and fails when it still does", async () => {
    const lab = fakeLab(40);
    const clip = await makeClip(lab.parts, { from: 0, to: 500, fps: 10 });
    expect(clip.times).toHaveLength(6);
    expect(lab.calls.filter((call) => call === "settle").length).toBeGreaterThanOrEqual(2);
    const stuck = fakeLab();
    stuck.parts.capture = (width) => Promise.resolve({ simMs: 99_999, bitmap: bitmap(width), members: [] });
    await expect(makeClip(stuck.parts, { from: 0, to: 500, fps: 10 })).rejects.toThrow(/shows 99999 ms/);
    expect(stuck.state().running).toBe(true);
  });

  it("fails with the reason when the page has no encoder and no recorder", async () => {
    const lab = fakeLab();
    await expect(makeClip({ ...lab.parts, env: env([], null) }, { from: 0, to: 100, fps: 10 })).rejects.toThrow(
      /no WebCodecs encoder/,
    );
    await expect(makeClip(lab.parts, { from: 0, to: 100_000, fps: 30 })).rejects.toThrow(/too many/);
  });
});

describe("recordClip", () => {
  it("draws frame i at i / fps after the start (real time) and gives the recorded bytes", async () => {
    let wall = 1000;
    const drawn: number[] = [];
    const requested = vi.fn();
    const track = { requestFrame: requested, stop: vi.fn() };
    const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
    class FakeRecorder {
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      readonly mimeType = "video/webm;codecs=vp8";
      start() {
        return undefined;
      }
      stop() {
        this.ondataavailable?.({ data: new Blob([new Uint8Array([7, 8, 9])]) });
        this.onstop?.();
      }
    }
    const deps: RecordDeps = {
      canvas: () =>
        ({
          getContext: () => ({ drawImage: () => drawn.push(wall) }),
          captureStream: () => stream,
        }) as unknown as HTMLCanvasElement,
      MediaRecorder: FakeRecorder as unknown as RecordDeps["MediaRecorder"],
      now: () => wall,
      sleep: (ms) => {
        wall += ms;
        return Promise.resolve();
      },
    };
    const times = clipTimes(0, 400, 10);
    const out = await recordClip(
      (simMs) => {
        wall += 30;
        return Promise.resolve({ bitmap: bitmap(), simMs });
      },
      { mime: "video/webm;codecs=vp8", width: 640, height: 400, fps: 10, times, bitrate: 1_000_000 },
      deps,
    );
    expect(drawn.map((at) => at - 1000)).toEqual([30, 100, 200, 300, 400]);
    expect(requested).toHaveBeenCalledTimes(times.length);
    expect(new Uint8Array(out.bytes)).toEqual(new Uint8Array([7, 8, 9]));
    expect(out.mime).toBe("video/webm;codecs=vp8");
    expect(out.recordMs).toBe(500);
    expect(out.stepMs).toBe(150);
  });
});
