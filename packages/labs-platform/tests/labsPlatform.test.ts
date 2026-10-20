// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the platform capabilities. Each capability has a test of its browser path with the desktop flags off (no
 * Tauri object, no shell features), with fakes of the browser parts. The desktop flags have tests of their own.
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  detectLabsPlatform,
  detectOpfs,
  detectWebCodecs,
  detectWebgpu,
  detectWebpEncode,
  isTauriOrigin,
  labsPlatform,
  markPlatform,
  PLATFORM_MARK,
  resetLabsPlatform,
  settle,
  type CanvasLike,
  type GpuAdapterLike,
  type PlatformEnv,
} from "../src/index";

afterEach(() => {
  resetLabsPlatform();
});

/** A canvas class whose blobs have the given type. */
function offscreen(type: string): NonNullable<PlatformEnv["OffscreenCanvas"]> {
  return class {
    convertToBlob(): Promise<{ type: string }> {
      return Promise.resolve({ type });
    }
  };
}

/** A document whose canvas gives blobs of the given type. */
function documentWith(type: string): NonNullable<PlatformEnv["document"]> {
  return {
    createElement(): CanvasLike {
      return {
        width: 0,
        height: 0,
        toBlob(callback) {
          callback({ type });
        },
      };
    },
  };
}

function gpu(adapter: GpuAdapterLike | null | Error): NonNullable<NonNullable<PlatformEnv["navigator"]>["gpu"]> {
  return {
    requestAdapter: () => (adapter instanceof Error ? Promise.reject(adapter) : Promise.resolve(adapter)),
  };
}

/** A browser with every capability (Chromium on a Mac): no desktop flags. */
const CHROMIUM: PlatformEnv = {
  location: { href: "http://127.0.0.1:5175/?take=greet" },
  navigator: { gpu: gpu({ info: { isFallbackAdapter: false } }), storage: { getDirectory: () => Promise.resolve({}) } },
  indexedDB: {},
  VideoEncoder: { isConfigSupported: () => Promise.resolve({ supported: true }) },
  OffscreenCanvas: offscreen("image/webp"),
  HTMLCanvasElement: { prototype: { transferControlToOffscreen: () => undefined } },
};

describe("the browser path (desktop flags off)", () => {
  test("a lab page alone in Chromium: a browser, no host, every web capability, no native feature", async () => {
    expect(await detectLabsPlatform("lab", CHROMIUM)).toEqual({
      page: "lab",
      kind: "browser",
      host: false,
      opfs: true,
      indexedDb: true,
      webCodecs: { vp9: true, av1: true },
      webpEncode: true,
      webgpu: true,
      nativeSnapshot: false,
      nativeWindows: false,
      offscreenCanvas: true,
    });
  });

  test("an empty environment has no capability and does not fail", async () => {
    const platform = await detectLabsPlatform("workbench", {});
    expect(platform).toMatchObject({ kind: "browser", host: false, opfs: false, indexedDb: false, webgpu: false });
    expect(platform.webCodecs).toEqual({ vp9: false, av1: false });
    expect(platform.webpEncode).toBe(false);
    expect(platform.offscreenCanvas).toBe(false);
  });

  test("host: the lab page in a frame of a browser workbench, and the workbench page with ?host=", async () => {
    const lab = { ...CHROMIUM, location: { href: "http://127.0.0.1:5175/?workbench=http%3A%2F%2F127.0.0.1%3A4800" } };
    expect(await detectLabsPlatform("lab", lab)).toMatchObject({ kind: "browser", host: true });
    const page = { location: { href: "http://127.0.0.1:5180/?host=http://127.0.0.1:4800" } };
    expect(await detectLabsPlatform("workbench", page)).toMatchObject({ kind: "browser", host: true });
    expect(await detectLabsPlatform("workbench", page, { host: false })).toMatchObject({ host: false });
  });

  test("the shell features of a browser page count for nothing without the Tauri object", async () => {
    const env = { ...CHROMIUM, __SCENITY_SHELL__: { features: ["snapshot"] } };
    expect(await detectLabsPlatform("workbench", env)).toMatchObject({ nativeSnapshot: false, nativeWindows: false });
  });

  test("OPFS: a folder, a refusal, a missing method", async () => {
    expect(await detectOpfs(CHROMIUM)).toBe(true);
    const refused = { navigator: { storage: { getDirectory: () => Promise.reject(new Error("SecurityError")) } } };
    expect(await detectOpfs(refused)).toBe(false);
    const throws = {
      navigator: {
        storage: {
          getDirectory: () => {
            throw new Error("no");
          },
        },
      },
    };
    expect(await detectOpfs(throws)).toBe(false);
    expect(await detectOpfs({ navigator: { storage: {} } })).toBe(false);
  });

  test("WebCodecs: each codec on its own, and an encoder that refuses", async () => {
    const asked: string[] = [];
    const env: PlatformEnv = {
      VideoEncoder: {
        isConfigSupported: (config) => {
          asked.push(`${config.codec}@${String(config.width)}x${String(config.height)}`);
          return Promise.resolve({ supported: config.codec.startsWith("vp09") });
        },
      },
    };
    expect(await detectWebCodecs(env)).toEqual({ vp9: true, av1: false });
    expect(asked.sort()).toEqual(["av01.0.04M.08@1280x800", "vp09.00.10.08@1280x800"]);
    const failing: PlatformEnv = { VideoEncoder: { isConfigSupported: () => Promise.reject(new TypeError("bad")) } };
    expect(await detectWebCodecs(failing)).toEqual({ vp9: false, av1: false });
  });

  test("WebP encode: real WebP, the PNG of WebKit, the canvas of the document", async () => {
    expect(await detectWebpEncode({ OffscreenCanvas: offscreen("image/webp") })).toBe(true);
    expect(await detectWebpEncode({ OffscreenCanvas: offscreen("image/png") })).toBe(false);
    expect(await detectWebpEncode({ document: documentWith("image/webp") })).toBe(true);
    expect(await detectWebpEncode({ document: documentWith("image/png") })).toBe(false);
  });

  test("WebP encode gives the canvas a context first (Chromium refuses a canvas without one)", async () => {
    const env: PlatformEnv = {
      OffscreenCanvas: class {
        context = false;
        getContext(): unknown {
          this.context = true;
          return {};
        }
        convertToBlob(): Promise<{ type: string }> {
          return this.context
            ? Promise.resolve({ type: "image/webp" })
            : Promise.reject(new Error("InvalidStateError"));
        }
      },
    };
    expect(await detectWebpEncode(env)).toBe(true);
  });

  test("WebP encode is checked once per environment", async () => {
    let encodes = 0;
    const env: PlatformEnv = {
      OffscreenCanvas: class {
        convertToBlob(): Promise<{ type: string }> {
          encodes += 1;
          return Promise.resolve({ type: "image/png" });
        }
      },
    };
    await detectLabsPlatform("lab", env);
    await detectLabsPlatform("workbench", env);
    expect(encodes).toBe(1);
  });

  test("WebGPU: a hardware adapter, no adapter, a fallback adapter, a failure", async () => {
    expect(await detectWebgpu({ navigator: { gpu: gpu({}) } })).toBe(true);
    expect(await detectWebgpu({ navigator: { gpu: gpu(null) } })).toBe(false);
    expect(await detectWebgpu({ navigator: { gpu: gpu({ info: { isFallbackAdapter: true } }) } })).toBe(false);
    expect(await detectWebgpu({ navigator: { gpu: gpu({ isFallbackAdapter: true }) } })).toBe(false);
    expect(await detectWebgpu({ navigator: { gpu: gpu(new Error("lost")) } })).toBe(false);
    expect(await detectWebgpu({ navigator: {} })).toBe(false);
  });

  test("OffscreenCanvas needs the class and the transfer of a canvas", async () => {
    const noTransfer = { ...CHROMIUM, HTMLCanvasElement: { prototype: {} } };
    expect((await detectLabsPlatform("lab", noTransfer)).offscreenCanvas).toBe(false);
  });

  test("settle gives the fallback after the time limit or a failure", async () => {
    expect(await settle(new Promise<boolean>(() => undefined), false, 5)).toBe(false);
    expect(await settle(Promise.reject(new Error("x")), "fallback", 50)).toBe("fallback");
    expect(await settle(Promise.resolve("value"), "fallback", 50)).toBe("value");
  });
});

describe("the desktop flags", () => {
  test("the workbench page in the app: desktop, a host, native windows, a snapshot when the shell gives it", async () => {
    const env: PlatformEnv = {
      ...CHROMIUM,
      location: { href: "tauri://localhost/" },
      __TAURI_INTERNALS__: {},
      __SCENITY_SHELL__: { features: ["snapshot"] },
    };
    expect(await detectLabsPlatform("workbench", env)).toMatchObject({
      kind: "desktop",
      host: true,
      nativeSnapshot: true,
      nativeWindows: true,
    });
    const before = { ...env, __SCENITY_SHELL__: {} };
    expect(await detectLabsPlatform("workbench", before)).toMatchObject({ nativeSnapshot: false, nativeWindows: true });
  });

  test("the lab page in a frame of the app: desktop and a host, the native features stay with the workbench", async () => {
    const env = { ...CHROMIUM, location: { href: "http://127.0.0.1:5175/?workbench=tauri%3A%2F%2Flocalhost" } };
    expect(await detectLabsPlatform("lab", env)).toMatchObject({
      kind: "desktop",
      host: true,
      nativeSnapshot: false,
      nativeWindows: false,
    });
  });

  test("the origins of the app on each system", () => {
    expect(isTauriOrigin("tauri://localhost")).toBe(true);
    expect(isTauriOrigin("http://tauri.localhost")).toBe(true);
    expect(isTauriOrigin("https://tauri.localhost")).toBe(true);
    expect(isTauriOrigin("http://127.0.0.1:4800")).toBe(false);
    expect(isTauriOrigin("http://tauri.localhost.example.com")).toBe(false);
  });
});

describe("the page's own object", () => {
  test("labsPlatform keeps one answer per page, and markPlatform puts it on the time line", async () => {
    expect(labsPlatform("lab")).toBe(labsPlatform("lab"));
    const platform = await markPlatform("lab");
    expect(platform.kind).toBe("browser");
    const mark = performance.getEntriesByName(PLATFORM_MARK).at(-1) as PerformanceMark | undefined;
    expect(mark?.detail).toEqual(platform);
  });
});
