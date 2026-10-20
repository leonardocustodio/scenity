// SPDX-License-Identifier: Apache-2.0
// The choice of the renderer backend: one test for each check with a fake navigator.gpu and fake adapters, the device
// loss memory, the backend that runs and the tier from the adapter.
import { describe, expect, it } from "bun:test";
import {
  BUILT_BACKENDS,
  chooseBackend,
  DEVICE_LOSS_MS,
  deviceLossRemembered,
  rememberDeviceLoss,
  runningBackend,
  type ChooseBackendOptions,
  type GpuAdapterLike,
  type GpuLike,
  type StorageLike,
} from "../src/host/backend";
import { BACKEND_BLOCKLIST, BACKEND_REASONS, blockedBy, browserEngine } from "../src/host/backendRules";

interface FakeAdapter {
  features?: string[];
  limits?: Record<string, number>;
  info?: GpuAdapterLike["info"];
  isFallbackAdapter?: boolean;
  device?: "ok" | "fails" | "hangs";
}

const GOOD_LIMITS = {
  maxTextureDimension2D: 8192,
  maxBindGroups: 4,
  maxSampledTexturesPerShaderStage: 16,
  maxSamplersPerShaderStage: 16,
};

/** A fake navigator.gpu. `destroyed` counts the probe devices that the chooser destroyed. */
function fakeGpu(spec: FakeAdapter | null | "hangs" | "throws", destroyed = { count: 0 }): GpuLike {
  return {
    requestAdapter: () => {
      if (spec === "hangs") return new Promise<never>(() => undefined);
      if (spec === "throws") return Promise.reject(new Error("no"));
      if (spec === null) return Promise.resolve(null);
      const adapter: GpuAdapterLike = {
        features: new Set(spec.features ?? ["texture-compression-astc"]),
        limits: spec.limits ?? GOOD_LIMITS,
        ...(spec.info === undefined ? {} : { info: spec.info }),
        ...(spec.isFallbackAdapter === undefined ? {} : { isFallbackAdapter: spec.isFallbackAdapter }),
        requestDevice: () => {
          if (spec.device === "fails") return Promise.reject(new Error("device"));
          if (spec.device === "hangs") return new Promise<never>(() => undefined);
          return Promise.resolve({
            destroy: () => {
              destroyed.count += 1;
            },
          });
        },
      };
      return Promise.resolve(adapter);
    },
  };
}

function memory(): StorageLike & { readonly items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
}

function choose(options: ChooseBackendOptions): ReturnType<typeof chooseBackend> {
  return chooseBackend({ storage: memory(), timeoutMs: 50, ...options });
}

const APPLE = { vendor: "apple", architecture: "metal-3", device: "", description: "" };

/** User agent texts of the engines. */
const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";
const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
const CHROME_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/153.0 Mobile/15E148 Safari/604.1";
const FIREFOX_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:150.0) Gecko/20100101 Firefox/150.0";
const EDGE_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0";

describe("chooseBackend", () => {
  it("chooses WebGPU on a hardware adapter that passes every check, and destroys the probe device", async () => {
    const destroyed = { count: 0 };
    const choice = await choose({ gpu: fakeGpu({ info: APPLE }, destroyed) });
    expect(choice).toMatchObject({ backend: "webgpu", reason: "supported", adapter: "apple metal-3" });
    expect(destroyed.count).toBe(1);
  });

  it("the server switch webgl stops before any GPU call", async () => {
    let asked = false;
    const gpu: GpuLike = {
      requestAdapter: () => {
        asked = true;
        return Promise.resolve(null);
      },
    };
    const choice = await choose({ gpu, serverSwitch: "webgl", override: "webgpu" });
    expect(choice).toMatchObject({ backend: "webgl", reason: "server_switch" });
    expect(asked).toBe(false);
  });

  it("the URL override of the lab forces either backend", async () => {
    expect(await choose({ gpu: null, override: "webgpu" })).toMatchObject({
      backend: "webgpu",
      reason: "url_override",
    });
    expect(await choose({ gpu: fakeGpu({}), override: "webgl" })).toMatchObject({
      backend: "webgl",
      reason: "url_override",
    });
    expect(await choose({ gpu: fakeGpu({}), override: "vulkan" })).toMatchObject({ reason: "supported" });
  });

  it("no navigator.gpu in the page gives WebGL", async () => {
    expect(await choose({ gpu: null })).toMatchObject({ backend: "webgl", reason: "no_webgpu" });
  });

  it("no adapter, or an adapter request that throws, gives WebGL", async () => {
    expect(await choose({ gpu: fakeGpu(null) })).toMatchObject({ backend: "webgl", reason: "no_adapter" });
    expect(await choose({ gpu: fakeGpu("throws") })).toMatchObject({ backend: "webgl", reason: "no_adapter" });
  });

  it("a fallback (CPU) adapter gives WebGL, in the info or in the old place of the flag", async () => {
    const info = { ...APPLE, isFallbackAdapter: true };
    expect(await choose({ gpu: fakeGpu({ info }) })).toMatchObject({ reason: "fallback_adapter" });
    expect(await choose({ gpu: fakeGpu({ isFallbackAdapter: true }) })).toMatchObject({ reason: "fallback_adapter" });
  });

  it("an adapter of the blocklist gives WebGL", async () => {
    const blocklist = [{ vendor: "^apple$", architecture: "metal-3", why: "test" }];
    expect(await choose({ gpu: fakeGpu({ info: APPLE }), blocklist })).toMatchObject({
      backend: "webgl",
      reason: "blocklist",
    });
    const other = [{ vendor: "nvidia", why: "test" }];
    expect(await choose({ gpu: fakeGpu({ info: APPLE }), blocklist: other })).toMatchObject({ reason: "supported" });
  });

  it("a rule with a browser engine applies only to the pages of that engine", async () => {
    const blocklist = [{ vendor: "^apple$", engine: "chromium" as const, why: "test" }];
    const gpu = (): GpuLike => fakeGpu({ info: APPLE });
    expect(await choose({ gpu: gpu(), blocklist, userAgent: CHROME_MAC })).toMatchObject({ reason: "blocklist" });
    expect(await choose({ gpu: gpu(), blocklist, userAgent: SAFARI_MAC })).toMatchObject({ reason: "supported" });
    // A rule with only an engine applies to each adapter of that engine.
    const engineOnly = [{ engine: "webkit" as const, why: "test" }];
    expect(await choose({ gpu: gpu(), blocklist: engineOnly, userAgent: SAFARI_MAC })).toMatchObject({
      reason: "blocklist",
    });
    expect(await choose({ gpu: gpu(), blocklist: engineOnly, userAgent: CHROME_MAC })).toMatchObject({
      reason: "supported",
    });
  });

  it("an adapter without a compressed texture family of the KTX2 transcode gives WebGL", async () => {
    expect(await choose({ gpu: fakeGpu({ features: ["float32-filterable"] }) })).toMatchObject({
      reason: "no_texture_compression",
    });
    for (const feature of ["texture-compression-astc", "texture-compression-etc2", "texture-compression-bc"]) {
      expect(await choose({ gpu: fakeGpu({ features: [feature] }) })).toMatchObject({ reason: "supported" });
    }
  });

  it("an adapter below the limits of the scene gives WebGL", async () => {
    const small = { ...GOOD_LIMITS, maxTextureDimension2D: 2048 };
    expect(await choose({ gpu: fakeGpu({ limits: small }) })).toMatchObject({ reason: "limits" });
    const missing: Record<string, number> = { maxTextureDimension2D: 8192 };
    expect(await choose({ gpu: fakeGpu({ limits: missing }) })).toMatchObject({ reason: "limits" });
  });

  it("a device request that fails gives WebGL", async () => {
    expect(await choose({ gpu: fakeGpu({ device: "fails" }) })).toMatchObject({ reason: "device_failed" });
  });

  it("a step that does not answer in time gives WebGL with the reason timeout", async () => {
    expect(await choose({ gpu: fakeGpu("hangs") })).toMatchObject({ backend: "webgl", reason: "timeout" });
    expect(await choose({ gpu: fakeGpu({ device: "hangs" }) })).toMatchObject({ reason: "timeout" });
  });

  it("the worker context needs WebGPU and an adapter too", async () => {
    const gpu = fakeGpu({});
    const probe = (gpuThere: boolean, adapter: boolean) => () => Promise.resolve({ gpu: gpuThere, adapter });
    expect(await choose({ gpu, workerProbe: probe(true, true) })).toMatchObject({ backend: "webgpu" });
    expect(await choose({ gpu, workerProbe: probe(false, false) })).toMatchObject({ reason: "no_worker_webgpu" });
    expect(await choose({ gpu, workerProbe: probe(true, false) })).toMatchObject({ reason: "no_worker_webgpu" });
    const broken = () => Promise.reject(new Error("worker"));
    expect(await choose({ gpu, workerProbe: broken })).toMatchObject({ reason: "no_worker_webgpu" });
    const silent = () => new Promise<never>(() => undefined);
    expect(await choose({ gpu, workerProbe: silent })).toMatchObject({ reason: "timeout" });
  });

  it("a device loss of the last 7 days gives WebGL; an older one is forgotten", async () => {
    const storage = memory();
    rememberDeviceLoss(storage, 1_000);
    const gpu = fakeGpu({});
    const at = (now: number) => chooseBackend({ gpu, storage, now: () => now, timeoutMs: 50 });
    expect(await at(1_000 + DEVICE_LOSS_MS - 1)).toMatchObject({ backend: "webgl", reason: "device_lost" });
    expect(await at(1_000 + DEVICE_LOSS_MS)).toMatchObject({ backend: "webgpu" });
    expect(storage.items.size).toBe(0);
  });

  it("the device loss memory survives a storage that throws", () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => {
      rememberDeviceLoss(broken, 1);
    }).not.toThrow();
    expect(deviceLossRemembered(broken, 2)).toBe(false);
    expect(deviceLossRemembered(null, 2)).toBe(false);
  });
});

describe("runningBackend", () => {
  it("a WebGPU choice runs WebGPU", () => {
    expect(BUILT_BACKENDS).toEqual(["webgl", "webgpu"]);
    expect(runningBackend({ backend: "webgpu", reason: "supported", adapter: null, ms: 1 })).toEqual({
      backend: "webgpu",
      reason: "supported",
      chosen: "webgpu",
    });
  });

  it("a WebGL choice runs WebGL with its reason; no choice gives null", () => {
    expect(runningBackend({ backend: "webgl", reason: "no_adapter", adapter: null, ms: 1 })).toEqual({
      backend: "webgl",
      reason: "no_adapter",
      chosen: "webgl",
    });
    expect(runningBackend(null)).toBeNull();
  });
});

describe("the backend data", () => {
  it("the blocklist is empty, and a rule without a field matches nothing", () => {
    // WebGPU on each device that passes the checks. WebGL only where WebGPU is not supported.
    expect(BACKEND_BLOCKLIST).toEqual([]);
    expect(blockedBy({ ...APPLE }, BACKEND_BLOCKLIST, "chromium")).toBeNull();
    expect(blockedBy({ ...APPLE }, BACKEND_BLOCKLIST, "webkit")).toBeNull();
    expect(blockedBy({ ...APPLE }, BACKEND_BLOCKLIST, "gecko")).toBeNull();
    const nvidia = { vendor: "nvidia", architecture: "ampere", device: "", description: "" };
    expect(blockedBy(nvidia, BACKEND_BLOCKLIST, "chromium")).toBeNull();
    expect(blockedBy({ ...APPLE }, [{ why: "no field" }])).toBeNull();
  });

  it("the browser engine of a user agent text", () => {
    expect(browserEngine(CHROME_MAC)).toBe("chromium");
    expect(browserEngine(EDGE_WIN)).toBe("chromium");
    expect(browserEngine(SAFARI_MAC)).toBe("webkit");
    expect(browserEngine(CHROME_IOS)).toBe("webkit");
    expect(browserEngine(FIREFOX_MAC)).toBe("gecko");
    expect(browserEngine("Bun/1.4.2")).toBe("other");
  });

  it("the reason codes are unique snake_case words (the telemetry enumeration)", () => {
    expect(new Set(BACKEND_REASONS).size).toBe(BACKEND_REASONS.length);
    for (const reason of BACKEND_REASONS) expect(reason).toMatch(/^[a-z][a-z0-9_]*$/);
  });
});
