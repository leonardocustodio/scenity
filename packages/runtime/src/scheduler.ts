// SPDX-License-Identifier: Apache-2.0
/**
 * The frame loop of a renderer core: requestAnimationFrame of the page or of the worker, or a 60 Hz timer
 * where a worker has none.
 */

/** The frame loop of a core: requestAnimationFrame of the page or of the worker. */
export interface FrameScheduler {
  request(callback: () => void): number;
  cancel(handle: number): void;
}

/**
 * The part of a dedicated worker scope that a worker handler uses. `In` is the type of the messages to the worker,
 * `Out` the type of the messages from it.
 */
export interface WorkerScopeLike<In = unknown, Out = unknown> {
  addEventListener(type: "message", listener: (event: MessageEvent<In>) => void): void;
  postMessage(message: Out): void;
  requestAnimationFrame?: (callback: (time: number) => void) => number;
  cancelAnimationFrame?: (handle: number) => void;
}

/** The frame functions of a scope: requestAnimationFrame and cancelAnimationFrame, when the scope has them. */
export type FrameSourceScope = Pick<WorkerScopeLike, "requestAnimationFrame" | "cancelAnimationFrame">;

/** requestAnimationFrame of the worker, or a 60 Hz timer where a worker has none. */
export function workerScheduler(scope: FrameSourceScope): FrameScheduler {
  const raf = scope.requestAnimationFrame?.bind(scope);
  const caf = scope.cancelAnimationFrame?.bind(scope);
  if (raf !== undefined && caf !== undefined) {
    return { request: (callback) => raf(() => callback()), cancel: caf };
  }
  return {
    request: (callback) => setTimeout(callback, 1000 / 60) as unknown as number,
    cancel: (handle) => {
      clearTimeout(handle);
    },
  };
}
