// SPDX-License-Identifier: Apache-2.0
/**
 * The WebGPU probe of the worker context. The render worker draws in a worker, so the page asks a worker of the same
 * kind if WebGPU is available there. This module is small and has no imports: the page starts it before the renderer
 * chunks load. The worker entry (`@scenity/runtime/gpuProbeWorker`,
 * worker/entries/gpuProbe.ts) calls `startGpuProbe(self)`. Load the entry with a same-origin URL (the CSP has
 * worker-src 'self'):
 *
 *     import gpuProbeUrl from "@scenity/runtime/gpuProbeWorker?worker&url";
 *
 * The page posts `{ type: "gpuProbe" }`, and the worker answers `{ type: "gpuProbe", gpu, adapter }`.
 */

interface ProbeGpu {
  requestAdapter(): Promise<unknown>;
}

interface ProbeScope {
  readonly navigator?: { readonly gpu?: ProbeGpu };
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: unknown): void;
}

/** The answer of the worker: WebGPU in the worker, and an adapter there. */
async function probe(scope: ProbeScope): Promise<{ readonly gpu: boolean; readonly adapter: boolean }> {
  const gpu = scope.navigator?.gpu;
  if (gpu === undefined) return { gpu: false, adapter: false };
  try {
    return { gpu: true, adapter: (await gpu.requestAdapter()) !== null };
  } catch {
    return { gpu: true, adapter: false };
  }
}

/** Answer the probe messages of the page in the worker scope (the `self` of the worker). */
export function startGpuProbe(workerScope: unknown): void {
  const scope = workerScope as ProbeScope;
  scope.addEventListener("message", (event) => {
    if ((event.data as { type?: unknown } | null)?.type !== "gpuProbe") return;
    void probe(scope).then((answer) => {
      scope.postMessage({ type: "gpuProbe", ...answer });
    });
  });
}
