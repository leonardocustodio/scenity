// SPDX-License-Identifier: Apache-2.0
/**
 * The calls of the host into the surface frames. The host sends a `surface.request` event to the page that shows a
 * frame. The page posts the call into the frame and answers with `surface.call`.
 *
 * An edit can reload the page of a frame (the worker, or a module that Vite cannot replace). A call that the old page
 * got never gets an answer. A call that comes while the page loads can reach a page without a bridge. Thus a call
 * waits for the `ready` event of a frame that reloads (at most RELOAD_WAIT_MS). A call that a reload hit (the `reload`
 * event, or a `ready` event after the call) goes into the new page once more. The first answer of the two tries is
 * the answer of the call.
 */
import type { PageClient } from "./server";
import { isBytesMarker, type PictureFrame, type SurfaceWhere } from "./protocol";

/** The time that a call waits for the `ready` event of a frame that reloads (ms). */
export const RELOAD_WAIT_MS = 20_000;

/** One call of a tool: one or two requests to the page (the first try and the try after a reload). */
interface CallGroup {
  readonly id: string;
  readonly where: SurfaceWhere;
  readonly call: string;
  readonly args: unknown[];
  readonly timeoutMs: number;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly requests: Set<number>;
  settled: boolean;
  retried: boolean;
}

interface Pending {
  readonly client: PageClient;
  readonly group: CallGroup;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly sentAt: number;
}

/** The load state of one frame: a reload started, and the waits for the next `ready`. */
interface FrameLoad {
  reloading: boolean;
  readonly waiters: Set<() => void>;
}

export interface SurfaceCallsOptions {
  /** The page that shows a frame, or undefined. */
  shown(id: string, where: SurfaceWhere): PageClient | undefined;
  /** The words of a call that timed out. */
  timeoutText(id: string, call: string, timeoutMs: number): string;
  readonly now?: () => number;
  /** The wait for the `ready` of a frame that reloads (ms; default RELOAD_WAIT_MS). */
  readonly reloadWaitMs?: number;
}

/** The open calls into the frames and the reload state of each frame. */
export class SurfaceCalls {
  readonly #options: SurfaceCallsOptions;
  readonly #now: () => number;
  readonly #pending = new Map<number, Pending>();
  readonly #frames = new Map<string, FrameLoad>();
  /** The picture bytes of a request that wait for its answer. */
  readonly #bytes = new Map<number, PictureFrame>();
  #nextRequest = 1;

  constructor(options: SurfaceCallsOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
  }

  #frame(id: string, where: SurfaceWhere): FrameLoad {
    const key = `${id}/${where}`;
    let frame = this.#frames.get(key);
    if (frame === undefined) this.#frames.set(key, (frame = { reloading: false, waiters: new Set() }));
    return frame;
  }

  /** Send a call into a frame. The promise gives the first answer, or rejects (no page, a timeout, an error). */
  call(id: string, where: SurfaceWhere, call: string, args: readonly unknown[], timeoutMs: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const group: CallGroup = {
        ...{ id, where, call, args: [...args], timeoutMs, resolve, reject },
        requests: new Set(),
        settled: false,
        retried: false,
      };
      void this.#send(group);
    });
  }

  /** Wait for the next `ready` of a frame that reloads. */
  #ready(frame: FrameLoad, group: CallGroup): Promise<void> {
    const waitMs = this.#options.reloadWaitMs ?? RELOAD_WAIT_MS;
    return new Promise((resolve, reject) => {
      const done = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        frame.waiters.delete(done);
        reject(new Error(`The surface ${group.id} reloaded and was not ready in ${String(waitMs)} ms.`));
      }, waitMs);
      frame.waiters.add(done);
    });
  }

  async #send(group: CallGroup): Promise<void> {
    const frame = this.#frame(group.id, group.where);
    if (frame.reloading) {
      try {
        await this.#ready(frame, group);
      } catch (error) {
        this.#settle(group, { error: error as Error });
        return;
      }
    }
    if (group.settled) return;
    const client = this.#options.shown(group.id, group.where);
    if (client === undefined) {
      if (group.requests.size > 0) return;
      const text = `No workbench page shows the surface ${group.id} (${group.where}).`;
      this.#settle(group, { error: new Error(text) });
      return;
    }
    const request = this.#nextRequest++;
    const timer = setTimeout(
      () => this.#drop(request, this.#options.timeoutText(group.id, group.call, group.timeoutMs)),
      group.timeoutMs,
    );
    this.#pending.set(request, { client, group, timer, sentAt: this.#now() });
    group.requests.add(request);
    const { id: surface, where, call, args } = group;
    client.send({ type: "surface.request", request, surface, where, call, args });
  }

  /** End one request. The call fails when it has no other request. */
  #drop(request: number, error: string): void {
    const pending = this.#pending.get(request);
    if (pending === undefined) return;
    clearTimeout(pending.timer);
    this.#pending.delete(request);
    this.#bytes.delete(request);
    pending.group.requests.delete(request);
    if (pending.group.requests.size === 0 && !pending.group.settled) {
      this.#settle(pending.group, { error: new Error(error) });
    }
  }

  #settle(group: CallGroup, outcome: { result: unknown } | { error: Error }): void {
    if (group.settled) return;
    group.settled = true;
    for (const request of group.requests) {
      const pending = this.#pending.get(request);
      if (pending !== undefined) clearTimeout(pending.timer);
      this.#pending.delete(request);
      this.#bytes.delete(request);
    }
    group.requests.clear();
    if ("error" in outcome) group.reject(outcome.error);
    else group.resolve(outcome.result);
  }

  /** The open request of a page, or an error (an unknown request, or a request of another page). */
  #pendingOf(client: PageClient, request: number): Pending {
    const pending = this.#pending.get(request);
    if (pending === undefined) throw new Error(`No open surface request ${String(request)}.`);
    if (pending.client.id !== client.id) throw new Error("The request went to another page.");
    return pending;
  }

  /**
   * The picture bytes of a request (a binary frame of the page). The page sends them immediately before the
   * `surface.call` of the same request, on the same socket. That answer gets them.
   */
  bytes(client: PageClient, frame: PictureFrame): void {
    this.#pendingOf(client, frame.request);
    this.#bytes.set(frame.request, frame);
  }

  /** The answer of a frame to a request (`surface.call`). An error of the first try waits for the second try. */
  answer(client: PageClient, params: { request: number; result?: unknown; error?: unknown }): void {
    const pending = this.#pendingOf(client, params.request);
    const frame = this.#bytes.get(params.request);
    this.#bytes.delete(params.request);
    if (typeof params.error === "string") {
      this.#drop(params.request, params.error);
      return;
    }
    let result = params.result;
    if (isBytesMarker(result)) {
      // The JSON result names the byte count. The binary frame of the same request has the bytes.
      if (frame?.bytes.length !== result.bytes) {
        this.#drop(params.request, "The picture bytes of the frame did not come with its answer.");
        return;
      }
      result = { ...result, bytes: frame.bytes, mime: typeof result.mime === "string" ? result.mime : frame.mime };
    }
    this.#settle(pending.group, { result });
  }

  /** Send the call of a group once more (a reload hit it). */
  #retry(group: CallGroup): void {
    if (group.retried || group.settled) return;
    group.retried = true;
    void this.#send(group);
  }

  /** The `reload` event of a frame: the calls that the old page got go to the new page after its `ready`. */
  reloading(id: string, where: SurfaceWhere): void {
    this.#frame(id, where).reloading = true;
    for (const pending of [...this.#pending.values()]) {
      if (pending.group.id === id && pending.group.where === where) this.#retry(pending.group);
    }
  }

  /** The `ready` event of a frame: the waiting calls go, and a call that the page got before the event goes again. */
  ready(id: string, where: SurfaceWhere): void {
    const frame = this.#frame(id, where);
    const at = this.#now();
    const old = [...this.#pending.values()].filter(
      (pending) => pending.group.id === id && pending.group.where === where && pending.sentAt < at,
    );
    frame.reloading = false;
    for (const done of [...frame.waiters]) done();
    frame.waiters.clear();
    for (const pending of old) this.#retry(pending.group);
  }

  /** Fail the calls of a page that closed. */
  dropClient(client: PageClient, error: string): void {
    for (const [request, pending] of [...this.#pending])
      if (pending.client.id === client.id) this.#drop(request, error);
  }

  /** Fail every call (the stop of the host). */
  close(error: string): void {
    for (const pending of [...this.#pending.values()]) this.#settle(pending.group, { error: new Error(error) });
  }
}
