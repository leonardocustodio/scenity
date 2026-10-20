// SPDX-License-Identifier: Apache-2.0
/**
 * The shadow surface: a hidden second frame of the lab server for the tools that
 * seek the clock many times (`lab_sheet`, `where: "shadow"`). The owner's frame stays still.
 *
 * The host shows the shadow on the first call: it sets `shadowUrl` of the surface to the URL state of the visible
 * frame with `panel=0&dock=0`, and the page mounts a hidden frame (SurfaceView.vue). The calls wait for the `ready`
 * event of that frame. After an idle time without calls, the host removes the shadow again, so its WebGL context
 * does not take GPU time. A shadow that a tool changed (a take, an item, events, tunes) or that has an old URL state
 * opens again with the URL state of the visible frame. This occurs at the next call after a short quiet time.
 *
 * When the built lab of the checkout is ready, the shadow loads it (no HMR, about 40 modules in place of 957).
 * Each call first asks for the build of the current sources. A shadow of an older build opens again with the new one
 * (the `labsBuild` URL parameter), so a tool never measures old sources.
 */
import type { BridgeEvent, SurfaceWhere } from "./protocol";
import { BRIDGE_PARAM } from "./protocol";
import type { CallOptions } from "./surfaces";

/** The parameters of a lab URL that only move the clock: a shadow with another clock is still the same scene. */
const CLOCK_PARAMS = ["t", "paused", "freeze", BRIDGE_PARAM, "labsBuild"];
/** The calls that change the scene of a frame: after one, the shadow differs from the visible URL state. */
const SCENE_CALLS = new Set([
  "load",
  "open",
  "setEvents",
  "push",
  "act",
  "phase",
  "set",
  "tune",
  "resetTunes",
  "debug",
]);

/** The URL of the shadow frame: the URL state of the visible frame without the panel and the dock. */
export function shadowUrlOf(visible: string): string {
  const url = new URL(visible);
  url.searchParams.delete(BRIDGE_PARAM);
  url.searchParams.set("panel", "0");
  url.searchParams.set("dock", "0");
  return url.toString();
}

/** The scene of a URL state: the URL without the clock parameters, with sorted parameters. */
export function sceneKey(url: string): string {
  const parsed = new URL(url);
  for (const name of CLOCK_PARAMS) parsed.searchParams.delete(name);
  parsed.searchParams.sort();
  return `${parsed.origin}${parsed.pathname}?${parsed.searchParams.toString()}`;
}

/** What the shadow needs from the surface registry. */
export interface ShadowRegistry {
  /** The URL of the visible frame, or null before the server is ready. */
  visibleUrl(surface: string): string | null;
  setShadow(surface: string, url: string | null): void;
  call(surface: string, call: string, args: readonly unknown[], options: CallOptions): Promise<unknown>;
  /**
   * The ID of the build of the built lab that the shadow loads (after a change of the sources, it waits for the new
   * build), or null when the shadow uses the dev server.
   */
  build?(surface: string): Promise<string | null>;
}

/** The URL parameter of the build of the built lab in a shadow URL. A new build gives a new URL (a reload). */
export const BUILD_PARAM = "labsBuild";

export interface ShadowOptions {
  readonly registry: ShadowRegistry;
  /** The time without calls before the host removes the shadow (ms; default 90 s). */
  readonly idleMs?: number;
  /** The time for the `ready` event of a new shadow (ms; default 60 s). */
  readonly readyTimeoutMs?: number;
  /** The quiet time before a shadow with an old scene opens again (ms; default 2 s). */
  readonly quietMs?: number;
  readonly now?: () => number;
}

interface ShadowEntry {
  /** The scene of the visible URL state at the start of the shadow. */
  key: string;
  ready: Promise<void>;
  markReady: () => void;
  fail: (error: Error) => void;
  readyTimer: ReturnType<typeof setTimeout>;
  idle: ReturnType<typeof setTimeout> | null;
  busy: number;
  lastUse: number;
  /** True after a call that changed the scene. */
  changed: boolean;
  /** The build of the built lab in the shadow, or null for the dev server. */
  build: string | null;
}

/** The shadow frames of the surfaces. */
export class ShadowFrames {
  readonly #options: ShadowOptions;
  readonly #now: () => number;
  readonly #entries = new Map<string, ShadowEntry>();

  constructor(options: ShadowOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
  }

  /** True while the surface has a shadow. */
  has(surface: string): boolean {
    return this.#entries.has(surface);
  }

  /** Handle a bridge event of a frame: the `ready` of the shadow frame. */
  onEvent(surface: string, where: SurfaceWhere, event: BridgeEvent): void {
    if (where === "shadow" && event.event === "ready") this.#entries.get(surface)?.markReady();
  }

  /** Send a call to the shadow frame of a surface. The shadow starts first when it is not there. */
  async call(
    surface: string,
    call: string,
    args: readonly unknown[] = [],
    options: CallOptions = {},
  ): Promise<unknown> {
    const { registry } = this.#options;
    // Without a built lab the shadow starts in the same tick as the call (no wait).
    const build = registry.build === undefined ? null : await registry.build(surface);
    const entry = this.#ensure(surface, build);
    entry.busy += 1;
    this.#clearIdle(entry);
    try {
      await entry.ready;
      if (SCENE_CALLS.has(call)) entry.changed = true;
      return await this.#options.registry.call(surface, call, args, { ...options, where: "shadow" });
    } finally {
      entry.busy -= 1;
      entry.lastUse = this.#now();
      if (entry.busy === 0) this.#scheduleIdle(surface, entry);
    }
  }

  /** Remove the shadow of a surface immediately. */
  close(surface: string): void {
    const entry = this.#entries.get(surface);
    if (entry === undefined) return;
    this.#clearIdle(entry);
    clearTimeout(entry.readyTimer);
    entry.fail(new Error(`The shadow frame of ${surface} closed.`));
    this.#entries.delete(surface);
    this.#options.registry.setShadow(surface, null);
  }

  /** Remove every shadow (the stop of the host). */
  closeAll(): void {
    for (const surface of [...this.#entries.keys()]) this.close(surface);
  }

  #ensure(surface: string, build: string | null): ShadowEntry {
    const visible = this.#options.registry.visibleUrl(surface);
    if (visible === null) throw new Error(`The surface ${surface} has no URL yet: the dev server is not ready.`);
    const key = sceneKey(visible);
    const entry = this.#entries.get(surface);
    if (entry !== undefined) {
      // A new build of the built lab (a change of the sources) replaces an idle shadow immediately.
      const rebuilt = entry.build !== build && entry.busy === 0;
      const stale = entry.changed || entry.key !== key;
      const quiet = entry.busy === 0 && this.#now() - entry.lastUse >= (this.#options.quietMs ?? 2_000);
      if (!rebuilt && (!stale || !quiet)) return entry;
      this.close(surface);
    }
    return this.#start(surface, visible, key, build);
  }

  #start(surface: string, visible: string, key: string, build: string | null): ShadowEntry {
    let markReady: () => void = () => undefined;
    let fail: (error: Error) => void = () => undefined;
    const ready = new Promise<void>((resolve, reject) => {
      markReady = resolve;
      fail = reject;
    });
    ready.catch(() => undefined);
    const timeout = this.#options.readyTimeoutMs ?? 60_000;
    const entry: ShadowEntry = {
      key,
      ready,
      markReady: () => {
        clearTimeout(entry.readyTimer);
        markReady();
      },
      fail,
      readyTimer: setTimeout(() => {
        fail(new Error(`The shadow frame of ${surface} was not ready in ${String(timeout)} ms (no workbench page?).`));
        if (this.#entries.get(surface) === entry) this.close(surface);
      }, timeout),
      idle: null,
      busy: 0,
      lastUse: this.#now(),
      changed: false,
      build,
    };
    this.#entries.set(surface, entry);
    const url = new URL(shadowUrlOf(visible));
    if (build === null) url.searchParams.delete(BUILD_PARAM);
    else url.searchParams.set(BUILD_PARAM, build);
    this.#options.registry.setShadow(surface, url.toString());
    return entry;
  }

  #clearIdle(entry: ShadowEntry): void {
    if (entry.idle !== null) clearTimeout(entry.idle);
    entry.idle = null;
  }

  #scheduleIdle(surface: string, entry: ShadowEntry): void {
    this.#clearIdle(entry);
    entry.idle = setTimeout(() => {
      if (this.#entries.get(surface) === entry && entry.busy === 0) this.close(surface);
    }, this.#options.idleMs ?? 90_000);
  }
}
