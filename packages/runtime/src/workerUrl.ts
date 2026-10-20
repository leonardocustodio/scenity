// SPDX-License-Identifier: Apache-2.0
/**
 * The same-origin rules of the render worker: the Trusted Types policy of the worker
 * URL, the absolute URLs of the built assets, the check for a worker canvas and the WebGPU probe of the worker context.
 */
import type { WorkerGpu } from "./host/backend";
import type { ManifestRef, SceneLoad } from "./protocol";

interface ScriptUrlPolicy {
  createScriptURL(input: string): unknown;
}

interface TrustedTypesFactory {
  createPolicy(name: string, rules: { createScriptURL(input: string): string }): ScriptUrlPolicy;
}

let workerPolicy: ScriptUrlPolicy | null = null;

function sameOrigin(input: string): string {
  const checked = new URL(input, globalThis.location.href);
  if (checked.origin !== globalThis.location.origin) {
    throw new TypeError("The 3D room worker must come from the origin of the page.");
  }
  return checked.href;
}

/** The worker URL for the Worker constructor, through the Trusted Types policy "scenity-worker". */
export function trustedWorkerUrl(url: string): string {
  const resolved = sameOrigin(url);
  const factory = (globalThis as { trustedTypes?: TrustedTypesFactory }).trustedTypes;
  if (factory === undefined) return resolved;
  workerPolicy ??= factory.createPolicy("scenity-worker", { createScriptURL: sameOrigin });
  // The Worker constructor accepts a TrustedScriptURL. For this code, its type is a string.
  return workerPolicy.createScriptURL(resolved) as string;
}

/**
 * The manifest reference with absolute same-origin URLs (the manifest, each file and the transcoder): the worker
 * resolves a relative URL against the URL of the worker module, not of the page.
 */
export function absoluteAssets(assets: ManifestRef | null | undefined): ManifestRef | null {
  if (assets === null || assets === undefined) return null;
  return {
    ...assets,
    manifest: sameOrigin(assets.manifest),
    files: Object.fromEntries(Object.entries(assets.files).map(([name, url]) => [name, sameOrigin(url)])),
    decoders: { basisWasm: sameOrigin(assets.decoders.basisWasm) },
  };
}

/**
 * A "load" payload with absolute same-origin file and decoder URLs: the worker resolves a relative
 * URL against the URL of the worker module, not of the page.
 */
export function absoluteLoad(load: SceneLoad): SceneLoad {
  const out: { -readonly [K in keyof SceneLoad]: SceneLoad[K] } = { ...load };
  if (load.files !== undefined) {
    out.files = Object.fromEntries(Object.entries(load.files).map(([name, url]) => [name, sameOrigin(url)]));
  }
  if (load.decoders !== undefined) {
    const { basisWasm, dracoWasm } = load.decoders;
    out.decoders = {
      ...(basisWasm === undefined ? {} : { basisWasm: sameOrigin(basisWasm) }),
      ...(dracoWasm === undefined ? {} : { dracoWasm: sameOrigin(dracoWasm) }),
    };
  }
  return out;
}

/** True when the browser can run the worker client on this canvas. */
export function canUseSceneWorker(canvas: HTMLCanvasElement): boolean {
  return (
    typeof Worker === "function" &&
    typeof OffscreenCanvas === "function" &&
    typeof canvas.transferControlToOffscreen === "function"
  );
}

/**
 * The probe of the worker context: a small same-origin worker (worker/gpuProbe.ts) tells if WebGPU and an adapter are
 * available. A worker that does not start answers "no WebGPU". The time limit of the chooser covers a worker that does
 * not answer.
 */
export function workerGpuProbe(url: string): () => Promise<WorkerGpu> {
  return () =>
    new Promise<WorkerGpu>((resolve) => {
      let worker: Worker;
      try {
        worker = new Worker(trustedWorkerUrl(url), { type: "module", name: "scenity-room3d-gpu-probe" });
      } catch {
        resolve({ gpu: false, adapter: false });
        return;
      }
      const finish = (answer: WorkerGpu): void => {
        worker.terminate();
        resolve(answer);
      };
      worker.addEventListener("message", (event: MessageEvent<{ type?: string; gpu?: unknown; adapter?: unknown }>) => {
        if (event.data.type === "gpuProbe")
          finish({ gpu: event.data.gpu === true, adapter: event.data.adapter === true });
      });
      worker.addEventListener("error", (event) => {
        event.preventDefault();
        finish({ gpu: false, adapter: false });
      });
      worker.postMessage({ type: "gpuProbe" });
    });
}
