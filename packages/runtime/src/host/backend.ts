// SPDX-License-Identifier: Apache-2.0
/**
 * The choice of the renderer backend of the 3D room. The lab and the game use the same rule: WebGPU on a device that
 * passes each check, the classic WebGL renderer on all other devices. The page makes the choice one time, before the
 * renderer loads.
 *
 * The checks, in order: the server switch `room3d.backend` (`webgl` stops here, with no GPU call), the URL
 * override of the lab, a device loss of the last 7 days, WebGPU in the page, a hardware adapter, the blocklist, a
 * compressed texture family of the KTX2 transcode, the limits of the scene, a device, and WebGPU in the worker context
 * (a probe worker). A step that does not answer before the time limit gives WebGL with the reason `timeout`.
 *
 * A "webgpu" choice runs WebGPU. The client runs WebGL with the reason `entry_not_built` when the page gives no WebGPU
 * worker. A WebGPU choice also gives the first quality tier from the adapter (`classifyAdapter`). A WebGL choice keeps
 * the tier of the WebGL probe.
 */
import {
  BACKEND_BLOCKLIST,
  BACKEND_MIN_LIMITS,
  BACKEND_TEXTURE_FEATURES,
  blockedBy,
  browserEngine,
  type AdapterFacts,
  type BackendBlockRule,
  type BrowserEngine,
  type BackendReason,
  type BackendSwitch,
  type SceneBackend,
} from "./backendRules";
import type { Tier } from "../protocol";
import { classifyAdapter } from "./probe";

/** The parts of a `GPUDevice` that the chooser uses. */
export interface GpuDeviceLike {
  destroy(): void;
}

/** The parts of a `GPUAdapter` that the chooser uses. */
export interface GpuAdapterLike {
  readonly features: { has(name: string): boolean };
  readonly limits: object;
  readonly info?: Partial<AdapterFacts> & { readonly isFallbackAdapter?: boolean };
  /** The flag on the adapter, for browsers that do not give `GPUAdapterInfo.isFallbackAdapter`. */
  readonly isFallbackAdapter?: boolean;
  requestDevice(): Promise<GpuDeviceLike>;
}

/** The parts of `navigator.gpu` that the chooser uses. */
export interface GpuLike {
  requestAdapter(): Promise<GpuAdapterLike | null>;
}

/** The answer of the probe worker (worker/gpuProbe.ts). */
export interface WorkerGpu {
  readonly gpu: boolean;
  readonly adapter: boolean;
}

/** The parts of `localStorage` that the device loss memory uses. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The decision of the chooser. */
export interface BackendChoice {
  readonly backend: SceneBackend;
  readonly reason: BackendReason;
  /** The vendor and the architecture of the adapter (the lab shows them), or null without an adapter. */
  readonly adapter: string | null;
  /** The time of the choice in ms. */
  readonly ms: number;
  /** The first quality tier from the adapter, or null/absent without a WebGPU choice. */
  readonly tier?: Tier | null;
}

/** The backend that runs and the reason. `chosen` is the decision of the chooser. */
export interface RunningBackend {
  readonly backend: SceneBackend;
  readonly reason: BackendReason;
  readonly chosen: SceneBackend;
}

export interface ChooseBackendOptions {
  /** The server switch `room3d.backend`. Default `auto`. */
  readonly serverSwitch?: BackendSwitch;
  /** The URL override of the lab (`backend=webgpu|webgl`). The game gives none. The chooser ignores other values. */
  readonly override?: string | null;
  /** `navigator.gpu` (the tests give a fake). Default: the one of the page. Null: no WebGPU. */
  readonly gpu?: GpuLike | null;
  /** The probe of the worker context. Null or absent: the renderer draws in the page (the main-thread core). */
  readonly workerProbe?: (() => Promise<WorkerGpu>) | null;
  /** The device loss memory. Default: `localStorage` where the page can use it. */
  readonly storage?: StorageLike | null;
  readonly now?: () => number;
  /** The time limit of the GPU steps in ms. Default 1500. */
  readonly timeoutMs?: number;
  readonly blocklist?: readonly BackendBlockRule[];
  /** The user agent text for the engine of a blocklist rule. Default: the one of the page. */
  readonly userAgent?: string;
}

/** The backends that have renderer entries in the runtime. */
export const BUILT_BACKENDS: readonly SceneBackend[] = ["webgl", "webgpu"];

const LOSS_KEY = "scenity.room3d.webgpuLost";
/** After a device loss, the chooser gives WebGL for 7 days. */
export const DEVICE_LOSS_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 1500;

/** `localStorage`, or null where the page cannot use it (a private window, blocked site data). */
function pageStorage(): StorageLike | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/** Remember a lost WebGPU device: the chooser gives WebGL for 7 days. The function ignores errors of the storage. */
export function rememberDeviceLoss(storage: StorageLike | null = pageStorage(), now: number = Date.now()): void {
  try {
    storage?.setItem(LOSS_KEY, String(now));
  } catch {
    // Without a storage, the next page chooses again.
  }
}

/** True while a device loss of the last 7 days is in the storage. The function removes an expired entry. */
export function deviceLossRemembered(storage: StorageLike | null = pageStorage(), now: number = Date.now()): boolean {
  try {
    const at = Number(storage?.getItem(LOSS_KEY) ?? Number.NaN);
    if (!Number.isFinite(at)) return false;
    if (now - at < DEVICE_LOSS_MS && at <= now) return true;
    storage?.removeItem(LOSS_KEY);
    return false;
  } catch {
    return false;
  }
}

/** The backend that runs for a choice. Null without a choice (the caller did not choose). */
export function runningBackend(choice: BackendChoice | null): RunningBackend | null {
  if (choice === null) return null;
  if (!BUILT_BACKENDS.includes(choice.backend)) {
    return { backend: "webgl", reason: "entry_not_built", chosen: "webgpu" };
  }
  return { backend: choice.backend, reason: choice.reason, chosen: choice.backend };
}

const TIMEOUT = Symbol("timeout");

/** One time limit for all the GPU steps of a choice. */
function deadline(ms: number): {
  within<T>(promise: Promise<T>): Promise<T | typeof TIMEOUT>;
  clear(): void;
} {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => {
      resolve(TIMEOUT);
    }, ms);
  });
  return {
    within: (promise) => Promise.race([promise, expired]),
    clear: () => {
      clearTimeout(timer);
    },
  };
}

function facts(adapter: GpuAdapterLike): AdapterFacts {
  const info = adapter.info ?? {};
  return {
    vendor: info.vendor ?? "",
    architecture: info.architecture ?? "",
    device: info.device ?? "",
    description: info.description ?? "",
  };
}

function limitsMet(limits: object): boolean {
  const values = limits as Readonly<Record<string, unknown>>;
  return Object.entries(BACKEND_MIN_LIMITS).every(([name, least]) => {
    const value = values[name];
    return typeof value === "number" && value >= least;
  });
}

interface AdapterResult {
  readonly reason: BackendReason;
  readonly adapter: string | null;
  /** The first tier from the adapter when the adapter passes the checks. */
  readonly tier?: Tier;
}

/** The device memory of the page in GB (`navigator.deviceMemory`), or null. */
function deviceMemory(): number | null {
  const memory = (globalThis.navigator as { deviceMemory?: unknown } | undefined)?.deviceMemory;
  return typeof memory === "number" ? memory : null;
}

/** The checks of the adapter and the device in the page. */
async function adapterChecks(
  gpu: GpuLike,
  limit: ReturnType<typeof deadline>,
  blocklist: readonly BackendBlockRule[],
  engine: BrowserEngine,
): Promise<AdapterResult> {
  const adapter = await limit.within(gpu.requestAdapter().catch(() => null));
  if (adapter === TIMEOUT) return { reason: "timeout", adapter: null };
  if (adapter === null) return { reason: "no_adapter", adapter: null };
  const found = facts(adapter);
  const label = [found.vendor, found.architecture].filter((part) => part !== "").join(" ") || null;
  const fail = (reason: BackendReason): AdapterResult => ({ reason, adapter: label });
  if (adapter.info?.isFallbackAdapter === true || adapter.isFallbackAdapter === true) return fail("fallback_adapter");
  if (blockedBy(found, blocklist, engine) !== null) return fail("blocklist");
  if (!BACKEND_TEXTURE_FEATURES.some((feature) => adapter.features.has(feature))) {
    return fail("no_texture_compression");
  }
  if (!limitsMet(adapter.limits)) return fail("limits");
  const pending = adapter.requestDevice().catch(() => null);
  const device = await limit.within(pending);
  if (device === TIMEOUT) {
    // A late device is not used: destroy it when it comes.
    void pending.then((late) => late?.destroy());
    return fail("timeout");
  }
  if (device === null) return fail("device_failed");
  device.destroy();
  const limits = adapter.limits as { readonly maxTextureDimension2D?: unknown };
  const largest = typeof limits.maxTextureDimension2D === "number" ? limits.maxTextureDimension2D : null;
  return { reason: "supported", adapter: label, tier: classifyAdapter(found, largest, deviceMemory()) };
}

function pageGpu(): GpuLike | null {
  return (globalThis.navigator as { gpu?: GpuLike } | undefined)?.gpu ?? null;
}

/** Choose the renderer backend of the 3D room. It never throws. */
export async function chooseBackend(options: ChooseBackendOptions = {}): Promise<BackendChoice> {
  const started = performance.now();
  const done = (backend: SceneBackend, reason: BackendReason, adapter: string | null = null): BackendChoice => ({
    backend,
    reason,
    adapter,
    ms: Math.round((performance.now() - started) * 10) / 10,
  });
  // The kill switch makes no GPU call: a defect of WebGPU itself cannot reach a learner.
  if ((options.serverSwitch ?? "auto") === "webgl") return done("webgl", "server_switch");
  const override = options.override ?? null;
  if (override === "webgpu" || override === "webgl") return done(override, "url_override");
  const storage = options.storage === undefined ? pageStorage() : options.storage;
  if (deviceLossRemembered(storage, (options.now ?? Date.now)())) return done("webgl", "device_lost");
  const gpu = options.gpu === undefined ? pageGpu() : options.gpu;
  if (gpu === null) return done("webgl", "no_webgpu");
  const limit = deadline(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    // The worker starts immediately, so its start occurs at the same time as the checks of the page.
    const probe = options.workerProbe ?? null;
    const worker =
      probe === null ? null : limit.within(probe().catch((): WorkerGpu => ({ gpu: false, adapter: false })));
    const browser = globalThis.navigator as { readonly userAgent?: string } | undefined;
    const userAgent = options.userAgent ?? browser?.userAgent ?? "";
    const page = await adapterChecks(gpu, limit, options.blocklist ?? BACKEND_BLOCKLIST, browserEngine(userAgent));
    if (page.reason !== "supported") return done("webgl", page.reason, page.adapter);
    const answer = worker === null ? null : await worker;
    if (answer === TIMEOUT) return done("webgl", "timeout", page.adapter);
    if (answer !== null && !(answer.gpu && answer.adapter)) return done("webgl", "no_worker_webgpu", page.adapter);
    return { ...done("webgpu", "supported", page.adapter), tier: page.tier ?? null };
  } finally {
    limit.clear();
  }
}
