// SPDX-License-Identifier: Apache-2.0
/**
 * The renderer fallbacks of the player. The module is pure: it gives the first renderer plan of the options and the
 * next plan after a failure.
 *
 * - The first plan: "webgpu" draws with the WebGPU core on the main thread (the generic scene worker is WebGL only).
 *   "webgl" draws with the generic scene worker when the browser can run it, else on the main thread. "auto" asks
 *   `chooseBackend()` of the runtime (the rule of the lab and of the plugin views). The worker draws when the browser
 *   can run it. A WebGPU choice then runs WebGL in the worker with the reason `entry_not_built` (client.ts).
 * - After a failure: a worker goes to the main thread with the same choice. WebGPU on the main thread goes to WebGL,
 *   in the worker when the worker did not fail. WebGL on the main thread is the last step: then no backend works.
 */
import type { BackendChoice } from "@scenity/runtime/backend";
import type { PlayerBackend, PlayerPath } from "./types";

/** The worker URL and the backend choice of one start of the document client. */
export interface RendererPlan {
  readonly workerUrl: string | null;
  readonly backend: BackendChoice | null;
}

/** The first plan, and the reason when the browser cannot run the worker that the options allow. */
export interface FirstPlan {
  readonly plan: RendererPlan;
  readonly noWorker: string | null;
}

/** What the first plan needs to know of the page. */
export interface PlanInput {
  readonly backend: PlayerBackend;
  /** The options allow the worker (`worker` is not false) and the build has a worker entry. */
  readonly workerAllowed: boolean;
  /** The browser can move the canvas to a worker (OffscreenCanvas and module workers). */
  readonly workerUsable: boolean;
  readonly workerUrl: string | null;
  readonly chooseBackend: () => Promise<BackendChoice>;
}

/** The reason of a fallback when the browser cannot move the canvas to a worker. */
export const NO_WORKER_CANVAS = "no_worker_canvas";
/** The reason of a fallback when the Worker constructor failed (the client drew on the main thread at once). */
export const WORKER_START = "worker_start";
/** The reason of a fallback when the core drew no first frame in time. */
export const NO_FIRST_FRAME = "timeout: no first frame";

/** The first renderer plan of the options (see the module comment). */
export async function firstPlan(input: PlanInput): Promise<FirstPlan> {
  const worker = input.workerAllowed && input.workerUsable ? input.workerUrl : null;
  const noWorker = input.workerAllowed && !input.workerUsable && input.backend !== "webgpu" ? NO_WORKER_CANVAS : null;
  if (input.backend === "webgpu") {
    return { plan: { workerUrl: null, backend: forced("webgpu") }, noWorker: null };
  }
  if (input.backend === "webgl") return { plan: { workerUrl: worker, backend: null }, noWorker };
  return { plan: { workerUrl: worker, backend: await input.chooseBackend() }, noWorker };
}

/** A backend that the options force. */
function forced(backend: "webgl" | "webgpu"): BackendChoice {
  return { backend, reason: "url_override", adapter: null, ms: 0 };
}

/** The path that a plan runs: the generic scene worker draws with WebGL only. */
export function pathOf(plan: RendererPlan, mode: "worker" | "main" = plan.workerUrl === null ? "main" : "worker") {
  const backend = mode === "worker" ? "webgl" : (plan.backend?.backend ?? "webgl");
  const path: PlayerPath = { renderer: mode, backend };
  return path;
}

/**
 * The plan after a failure of the path `ran`, or null when no backend is left. `workerUrl` is the worker that the
 * next plan can use: null when the options do not allow it, the browser cannot run it or it failed before.
 */
export function nextPlan(plan: RendererPlan, ran: PlayerPath, workerUrl: string | null): RendererPlan | null {
  if (ran.renderer === "worker") return { workerUrl: null, backend: plan.backend };
  if (ran.backend === "webgpu") {
    // The client remembers the device loss for 7 days, so a new choice gives WebGL too.
    const adapter = plan.backend?.adapter ?? null;
    return { workerUrl, backend: { backend: "webgl", reason: "device_lost", adapter, ms: 0 } };
  }
  return null;
}
