// SPDX-License-Identifier: Apache-2.0
/**
 * The fakes of the player tests: a fetch over the sample folders and in-memory files, a document client that
 * records its calls, a manual clock and manual animation frames, a canvas with no DOM and an audio player that
 * records its calls.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DocumentClient, DocumentClientOptions } from "@scenity/runtime/documentClient";
import type { SceneLoad, SceneStats } from "@scenity/runtime/protocol";
import type { AudioClock } from "@scenity/runtime/audio";
import type { PlayerAudio, PlayerDeps } from "../src/player";
import { loadContentInto } from "../src/documents";
import { checkEvent, pickDocument } from "../src/events";
import { loadContent } from "../src/project";
import { pageTimeline } from "../src/timeline";

export const SAMPLES = resolve(import.meta.dir, "..", "..", "..", "samples");
export const PAGE = "http://player.test/page/index.html";

/** A fetch of `http://player.test/projects/<name>/<path>` from the sample folders, and of extra in-memory files. */
export function sampleFetch(extra: Readonly<Record<string, string>> = {}, log: string[] = []) {
  return (url: string): Promise<Response> => {
    log.push(url);
    const json = { headers: { "Content-Type": "application/json" } };
    if (url in extra) return Promise.resolve(new Response(extra[url], json));
    const match = /^http:\/\/player\.test\/projects\/([a-z-]+)\/(.+)$/.exec(url);
    const file = match === null ? null : join(SAMPLES, match[1] ?? "", decodeURIComponent(match[2] ?? ""));
    if (file === null || !existsSync(file)) return Promise.resolve(new Response("not found", { status: 404 }));
    const type = file.endsWith(".json") ? json : {};
    return Promise.resolve(new Response(readFileSync(file), type));
  };
}

/** The calls that the fake client got. */
export interface ClientLog {
  options: DocumentClientOptions | null;
  loads: SceneLoad[];
  inputs: unknown[];
  cameras: (string | null)[];
  patches: number;
  disposed: boolean;
  /** The clock time of the core at each input message and each patch. */
  times: (number | null)[];
  /** The tier messages of the quality ladder. */
  tiers: string[];
}

/** A fake document client: each call resolves at once; the cameras of `cameras` exist. */
export function fakeClient(
  log: ClientLog,
  cameras: readonly string[] = ["front", "top"],
  mode: "worker" | "main" = "worker",
) {
  return (_canvas: HTMLCanvasElement, options: DocumentClientOptions): Promise<DocumentClient> => {
    log.options = options;
    const client: Partial<DocumentClient> = {
      mode,
      setInput: (input) => {
        log.inputs.push(input);
        log.times.push(options.getSimMs());
      },
      load: (load) => {
        log.loads.push(load);
        return Promise.resolve({ ok: true, entities: 1, warnings: [] });
      },
      patch: () => {
        log.patches += 1;
        log.times.push(options.getSimMs());
        return Promise.resolve({ ok: true, warnings: [] });
      },
      useCamera: (name) => {
        log.cameras.push(name);
        return Promise.resolve(name === null || cameras.includes(name));
      },
      pickEntity: () => Promise.resolve(null),
      setSurface: () => undefined,
      setTier: (tier) => {
        log.tiers.push(tier);
      },
      stats: () => Promise.resolve({ mode } as SceneStats),
      dispose: () => {
        log.disposed = true;
      },
    };
    return Promise.resolve(client as DocumentClient);
  };
}

export function emptyLog(): ClientLog {
  return { options: null, loads: [], inputs: [], cameras: [], patches: 0, disposed: false, times: [], tiers: [] };
}

/** A canvas with no DOM: the player reads its tag, its size and its listeners. */
export function fakeCanvas(remove: () => void = () => undefined): HTMLCanvasElement {
  return {
    tagName: "CANVAS",
    clientWidth: 640,
    clientHeight: 360,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    remove,
  } as unknown as HTMLCanvasElement;
}

/** The calls of the fake audio player. */
export interface AudioLog {
  syncs: AudioClock[];
  resumes: number;
  disposed: boolean;
}

/** The calls of the fake poster: "show <url>", "hide", "fail <reason>", "move", "dispose". */
export type PosterLog = string[];

/** A timer of the fake deps: the callback, its period and the repeat flag. */
export interface ManualTimer {
  readonly callback: () => void;
  readonly ms: number;
  readonly repeat: boolean;
}

/** The manual parts of a test: the wall clock, the animation frames and the audio log. */
export interface Manual {
  wall: number;
  frames: Map<number, () => void>;
  audio: AudioLog;
  /** The running timers (the watchdog of the first frame, the windows of the quality ladder). */
  timers: Set<ManualTimer>;
  poster: PosterLog;
  /** Move the wall clock and run the waiting animation frames. */
  advance(ms: number): void;
  /** Run each running timer of a period once (a repeat timer stays). */
  tick(ms: number): void;
}

/** The player deps over fakes, and the manual parts. */
export function fakeDeps(
  log: ClientLog,
  overrides: Partial<PlayerDeps> = {},
): { readonly deps: PlayerDeps; readonly manual: Manual } {
  let next = 1;
  const manual: Manual = {
    wall: 1000,
    frames: new Map(),
    audio: { syncs: [], resumes: 0, disposed: false },
    timers: new Set(),
    poster: [],
    advance(ms) {
      manual.wall += ms;
      const waiting = [...manual.frames.values()];
      manual.frames.clear();
      for (const callback of waiting) callback();
    },
    tick(ms) {
      for (const timer of [...manual.timers].filter((item) => item.ms === ms)) {
        if (!timer.repeat) manual.timers.delete(timer);
        timer.callback();
      }
    },
  };
  const deps: PlayerDeps = {
    content: loadContent,
    load: loadContentInto,
    checkEvent,
    pickAt: pickDocument,
    timeline: pageTimeline,
    fetch: sampleFetch(),
    page: PAGE,
    now: () => manual.wall,
    frame: (callback) => {
      const handle = next;
      next += 1;
      manual.frames.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle) => {
      manual.frames.delete(handle);
    },
    createClient: fakeClient(log),
    canUseWorker: () => true,
    chooseBackend: () => Promise.resolve({ backend: "webgpu", reason: "supported", adapter: null, ms: 0 }),
    workerUrl: "/assets/sceneWorker.js",
    loadPlugins: () => Promise.resolve([]),
    decoders: { basisWasm: "/basis.wasm" },
    createAudio: (clock): PlayerAudio => ({
      state: "running",
      started: [],
      frame: () => undefined,
      sync: () => {
        manual.audio.syncs.push(clock());
      },
      resume: () => {
        manual.audio.resumes += 1;
        return Promise.resolve();
      },
      dispose: () => {
        manual.audio.disposed = true;
      },
    }),
    makeCanvas: () => fakeCanvas(),
    replaceCanvas: () => fakeCanvas(),
    poster: () => ({
      show: (url) => manual.poster.push(`show ${url}`),
      hide: () => manual.poster.push("hide"),
      fail: (reason) => manual.poster.push(`fail ${reason}`),
      move: () => manual.poster.push("move"),
      dispose: () => manual.poster.push("dispose"),
    }),
    timer: (callback, ms, repeat = false) => {
      const timer = { callback, ms, repeat };
      manual.timers.add(timer);
      return () => {
        manual.timers.delete(timer);
      };
    },
    devicePixelRatio: () => 2,
    ...overrides,
  };
  return { deps, manual };
}
