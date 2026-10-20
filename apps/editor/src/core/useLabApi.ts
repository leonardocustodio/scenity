// SPDX-License-Identifier: Apache-2.0
/**
 * The script API of the 3D room lab, `globalThis.__room3dLab`. An agent, a test or a tool controls the lab with it,
 * without clicks. It loads a take, seeks, runs the clock, gives events as the panel does, and chooses a camera. It
 * reads the lab state and the frame statistics. It waits for a frame at the time of the clock (`frame`), thus a
 * screenshot after it shows that time. The performance harness reads `stats` and `quality`.
 *
 * Example (in the devtools of the page, or `page.evaluate` of Playwright):
 *   await __room3dLab.load("greet"); __room3dLab.seek(5650); __room3dLab.camera("front"); await __room3dLab.frame();
 */
import type { CameraView } from "@scenity/runtime/framing";
import type { SceneStats } from "@scenity/runtime/protocol";
import type { DebugLayer, InspectReport, PluginLabApi, SceneInput } from "../plugins";
import { type CaptureCheck, type Tunable, tunables, withTune } from "@scenity/runtime-dev";
import { nextTick, onBeforeUnmount, type Ref, type ShallowRef } from "vue";
import { cameraNames, isCameraName } from "./cameras";
import type { DockHeight } from "./browser/browserUrl";
import { applyHeight, heightOf } from "./browser/dockLayout";
import type { LabBrowser } from "./browser/useBrowser";
import type { Lanes, LaneSample } from "./lanes";
import { laneSample, reportsAt, sweepTimes, type SweepOptions, type SweepParts } from "./labSweep";
import { labClipParts, makeClip, type ClipRequest, type LabClip } from "./clip/labClip";
import type { ItemScene } from "./browser/tree";
import { takeList, type LabEvent, type LabState } from "./sequence";
import type { LabCamera } from "./useLabCamera";
import type { LabClock } from "./useLabClock";
import type { Quality, ViewHandle } from "./useLabStats";
import type { LabAction, LabTake } from "./useLabTake";
import { editorPlugin } from "./plugin";
import { editorRoom, editorScene, type SceneSource } from "./sceneSource";

/** The result of `frame`: the simulation time of the drawn frame and the frame statistics after it. */
export interface LabFrame {
  readonly simMs: number | null;
  readonly stats: SceneStats | null;
}

/** The script API of the editor core; the plugin adds its methods (`EditorPlugin.apiExtensions`). */
export interface CoreLabApi {
  /** The frame statistics of the renderer (`reset` starts a new window). */
  stats(reset?: boolean): Promise<SceneStats | null>;
  /** A new frame: its capture against a readback of its pixels. */
  captureCheck(): Promise<CaptureCheck | null>;
  /** The quality tier, the render scale and the still poses of the adaptive quality. */
  quality(): Quality | null;
  /** The names of the takes. */
  takes(): string[];
  /** Start again with a named take ("idle" for none) and no events of the panel. The clock does not move. */
  load(take: string): void;
  /** The events of the live take. */
  events(): LabEvent[];
  /** Replace the events of the panel (the events after the take). */
  setEvents(events: LabEvent[]): void;
  /** Add an event at the time of the clock, for example `{ kind: "act", member: "bo", binding: "wave" }`. */
  push(action: LabAction): void;
  /** The time of the clock (ms). */
  time(): number;
  /** Go to a time (ms). A running clock continues to run, and a stopped clock stays stopped. */
  seek(ms: number): void;
  play(): void;
  pause(): void;
  speed(value: number): void;
  /** A named camera, a view, or null for the framing of the room kit. */
  camera(view: string | CameraView | null): void;
  cameras(): string[];
  /** The lab state at the time of the clock. */
  state(): LabState;
  /** The asset failures of the scene. */
  errors(): Promise<string[]>;
  /** Wait until the scene and its assets are ready. Then draw a frame at the time of the clock and give its time. */
  frame(timeoutMs?: number): Promise<LabFrame>;
  /** The debug layers over the scene (`anchors`, `obstacles`, `paths`, `ik`, `points`, `frame`, `skeleton`). */
  debug(layers: string[]): void;
  /** What the last frame drew: poses, hand goals, joints, touch points. */
  inspect(): Promise<InspectReport | null>;
  /**
   * The inspect report at each time: the update-only sweep of the labs core, or with `{ render: true }` a seek and a
   * drawn frame at each time. The clock stays at the last time.
   */
  inspectAt(times: number[], options?: SweepOptions): Promise<(InspectReport | null)[]>;
  /**
   * What each member draws at each time from `from` to `to` at `step`: the catalog clip and the family of each member
   * from the inspect report of each time (`inspectAt`). The clock stays at the last time.
   */
  sweep(from: number, to: number, step: number, options?: SweepOptions): Promise<LaneSample[]>;
  /**
   * A video of `from` to `to` (clip/labClip.ts): WebCodecs VP9 or AV1 in WebM, or MediaRecorder (an MP4 where the
   * browser records it). The result has the bytes, the size and the timings. The clock returns to its time.
   */
  clip(request: ClipRequest): Promise<LabClip>;
  /**
   * The content browser: show a node of the tree in the grid (a path of keys, or "a/b/c"), and give its children.
   */
  browse(path: string | string[]): { key: string; title: string; kind: string; scene: boolean }[];
  /** Open an item of the browser by its key (a clip ID, `take:greet`, a member `ada`, a preset `PR-02`): its scene plays. */
  open(key: string, options?: { play?: boolean }): boolean;
  /** The open item of the browser and its scene, or null. */
  item(): { key: string; title: string; scene: ItemScene | null } | null;
  /**
   * The dock: "bar" (the timeline without the browser), "half" (the default height), "tall" (45 % of the window) or
   * "hidden". The result is the current state of the dock: "closed", "bar", "open" or "hidden".
   */
  dock(height?: DockHeight): "closed" | "bar" | "open" | "hidden";
  /**
   * The frame strip of the dock: its slots, and with `fill` the empty slots captured first. Null when the dock does not
   * show the strip.
   */
  strip(options?: {
    fill?: boolean;
  }): Promise<{ index: number; at: number; simMs: number | null; filled: boolean }[] | null>;
  /** The clip lanes of the window of the play bar: the sweep of the take, or the captures of a changed take. */
  lanes(): Lanes | null;
  /** The tuned numbers of the scene with their defaults. */
  tunables(): Tunable[];
  /** The current tune values: path → number. */
  tunes(): Record<string, number>;
  /** Tune one number (the next frame uses it); `null` sets it to its default again. */
  tune(path: string, value: number | null): void;
  /** Set every tuned number to its default again. */
  resetTunes(): void;
  /**
   * The source of the views: "take" (the lab state), "track:<name>" (a case of the engine) or the name of a live
   * session of the plugin ("mock").
   */
  source(): string;
  /** The names of the view tracks. */
  tracks(): string[];
}

/** The script API of the page: the methods of the core and of the plugin. */
export type Room3DLabApi = CoreLabApi & PluginLabApi;

/** What the methods of the plugin read of the page (`EditorPlugin.apiExtensions`). */
export interface ApiContext {
  readonly take: LabTake;
  readonly clock: LabClock;
  readonly view: ShallowRef<ViewHandle | null>;
  readonly source: SceneSource;
  /** The methods of the core (the clock, the sweeps). */
  readonly api: CoreLabApi;
  /**
   * The inspect report and the simulation time at each time, after the scene settles. The source is the update-only
   * sweep, or a drawn frame at each time with `{ render: true }`. The clock stays at the last time.
   */
  reportsAt(times: number[], options?: SweepOptions): Promise<{ simMs: number | null; report: InspectReport | null }[]>;
}

declare global {
  // The lab page sets it; the tools read it.
  var __room3dLab: Room3DLabApi | undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The longest wait for one frame of the scene (a mark): a scene that draws no frame fails the call. */
const MARK_TIMEOUT_MS = 15_000;

/** A frame at the clock time, or an error when the scene draws none in MARK_TIMEOUT_MS. */
function markFrame(view: ViewHandle | null): Promise<number | null> {
  const mark = view?.mark() ?? Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`The scene drew no frame in ${String(MARK_TIMEOUT_MS / 1000)} s.`));
    }, MARK_TIMEOUT_MS);
    void mark.then((simMs) => {
      clearTimeout(timer);
      resolve(simMs);
    });
  });
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * The longest wait of `frame()` for steady frame statistics (ms): 60 s, or the wait that a test sets on the page
 * (`globalThis.__room3dLabFrameWaitMs`: a slow CI runner without a GPU, tests/support/ci-timing.ts).
 */
function frameWaitMs(): number {
  const wait = (globalThis as { __room3dLabFrameWaitMs?: unknown }).__room3dLabFrameWaitMs;
  return typeof wait === "number" && wait > 0 ? wait : 60_000;
}

export function useLabApi(parts: {
  readonly take: LabTake;
  readonly clock: LabClock;
  readonly camera: LabCamera;
  readonly view: ShallowRef<ViewHandle | null>;
  readonly debug: Ref<DebugLayer[]>;
  readonly tunes: Ref<Record<string, number>>;
  /** The source of the views of the page (of the plugin). */
  readonly source: SceneSource;
  readonly root: () => HTMLElement | null;
  /** The content browser, or null (a fixed frame has none). */
  readonly browser: LabBrowser | null;
  /** The scene input at a time for the update-only sweep, or null (then the sweeps draw each time). */
  readonly inputAt?: ((at: number) => SceneInput) | null;
}): void {
  const { take, clock, camera, view } = parts;

  /** The page parts of the sweeps (labSweep.ts). */
  const sweepParts: SweepParts = {
    view: () => view.value,
    inputAt: parts.inputAt ?? null,
    seek: (at) => {
      clock.seek(at);
      take.refresh();
    },
    drawn: async () => {
      // The views of the new state reach the scene before the frame.
      await nextPaint();
      return markFrame(view.value);
    },
  };

  /** True when the page shows the scene: its first frame, its assets settled and no fog of the loading scene. */
  function shown(): boolean {
    const room = parts.root()?.querySelector('[data-testid="room-view"]');
    return (
      room?.getAttribute("data-ready") === "true" &&
      room.getAttribute("data-assets") !== "loading" &&
      room.querySelector('[data-testid="room-3d-fog"]') === null &&
      room.closest('[data-scratch="loading"]') === null // The models of the scratch props are in the scene.
    );
  }

  /**
   * Wait until the scene drew its first frame, its assets settled in the renderer, and the page shows them. The page
   * has its own asset state (from the statistics). The fog of the loading scene stays over the canvas until then.
   */
  async function settledStats(deadline: number): Promise<SceneStats> {
    for (;;) {
      const handle = view.value;
      if (handle !== null && shown()) {
        const stats = await handle.stats(false);
        if (stats !== null && stats.assets !== "loading") return stats;
      }
      if (performance.now() > deadline) throw new Error("The 3D room of the lab was not ready in time.");
      await sleep(100);
    }
  }

  /**
   * The view whose assets settled: `frame` asks the renderer for its asset state only at the first call of a view. A
   * new view (a reload, another tier, the assets on or off) asks again. `frame` checks the page attributes at each
   * call.
   */
  let settledView: ViewHandle | null = null;

  async function settled(deadline: number): Promise<void> {
    const handle = view.value;
    if (handle !== null && handle === settledView && shown()) return;
    await settledStats(deadline);
    settledView = view.value;
  }

  const api: CoreLabApi = {
    stats: (reset = false) => view.value?.stats(reset) ?? Promise.resolve(null),
    captureCheck: () => view.value?.captureCheck?.() ?? Promise.resolve(null),
    quality: () => view.value?.quality() ?? null,
    takes: () => takeList().map((item) => item.name),
    load(name) {
      const known = takeList().find((item) => item.name === name)?.name;
      if (known === undefined) throw new Error(`No take "${name}". Takes: ${api.takes().join(", ")}.`);
      take.loadTake(known === "idle" ? null : known);
    },
    events: () => [...take.events.value],
    setEvents(events) {
      take.setEvents(events);
    },
    push(action) {
      take.push(action);
    },
    time: () => clock.simNow(),
    seek(ms) {
      // The take refreshes its state at the seek.
      clock.seek(ms);
    },
    play() {
      clock.play();
    },
    pause() {
      clock.pause();
      take.refresh();
    },
    speed(value) {
      clock.setSpeed(value);
    },
    camera(next) {
      if (typeof next === "string") {
        if (!isCameraName(next)) throw new Error(`No camera "${next}". Cameras: ${cameraNames().join(", ")}.`);
        camera.setCamera(next);
      } else {
        camera.setView(next);
      }
    },
    cameras: () => cameraNames(),
    state: () => structuredClone(take.state.value),
    async errors() {
      const stats = await (view.value?.stats(false) ?? Promise.resolve(null));
      return [...(stats?.failures ?? [])];
    },
    async frame(timeoutMs = frameWaitMs()) {
      await settled(performance.now() + timeoutMs);
      // The views of the lab state at the time of the clock reach the renderer in the next flush of Vue, not after a
      // paint. The watchers of Vue send them before the mark.
      take.refresh();
      await nextTick();
      // The worker answers "drawn" with the simulation time of the frame that it drew.
      const simMs = await markFrame(view.value);
      // One paint of the page shows the canvas of the worker. The statistics come at the same time.
      const [stats] = await Promise.all([view.value?.stats(false) ?? Promise.resolve(null), nextPaint()]);
      return { simMs, stats };
    },
    debug(layers) {
      const known: readonly string[] = editorRoom().debugLayers;
      const unknown = layers.filter((layer) => !known.includes(layer));
      if (unknown.length > 0) throw new Error(`No debug layer ${unknown.join(", ")}. Layers: ${known.join(", ")}.`);
      parts.debug.value = layers as DebugLayer[];
    },
    inspect: () => view.value?.inspect() ?? Promise.resolve(null),
    tunables: () => tunables().map((item) => ({ ...item, value: parts.tunes.value[item.path] ?? item.default })),
    tunes: () => ({ ...parts.tunes.value }),
    tune(path, value) {
      if (!tunables().some((item) => item.path === path)) {
        throw new Error(`No tuned number "${path}". See __room3dLab.tunables().`);
      }
      parts.tunes.value = withTune(parts.tunes.value, path, value);
    },
    resetTunes() {
      parts.tunes.value = {};
    },
    source: () => parts.source.name,
    tracks: () => [...editorScene().trackNames],
    async inspectAt(times, options) {
      await settledStats(performance.now() + 60_000);
      return (await reportsAt(sweepParts, times, options)).map((item) => item.report);
    },
    browse(path) {
      const browser = parts.browser;
      if (browser === null) throw new Error("The lab has no content browser (a fixed frame).");
      browser.query.value = "";
      browser.browse(typeof path === "string" ? path.split("/").filter((key) => key !== "") : path);
      return browser.items.value.map((item) => ({
        key: item.key,
        title: item.title,
        kind: item.kind,
        scene: item.scene !== null,
      }));
    },
    open(key, options) {
      const browser = parts.browser;
      if (browser === null) throw new Error("The lab has no content browser (a fixed frame).");
      if (!browser.tree.byKey.has(key)) throw new Error(`No item "${key}" in the content browser.`);
      return browser.open(key, options ?? {});
    },
    item() {
      const item = parts.browser?.item.value ?? null;
      return item === null ? null : { key: item.key, title: item.title, scene: item.scene };
    },
    async strip(options) {
      const strip = parts.browser?.strip.value ?? null;
      if (strip === null) return null;
      if (options?.fill === true) await strip.fill();
      return strip.slots.value.map((slot) => ({
        index: slot.index,
        at: slot.at,
        simMs: slot.simMs,
        filled: slot.url !== null,
      }));
    },
    lanes: () => parts.browser?.strip.value?.lanes.value ?? null,
    dock(height) {
      const browser = parts.browser;
      if (browser === null) return "hidden";
      if (height === "hidden") browser.dock.value = "hidden";
      else if (height !== undefined) {
        if (browser.dock.value === "hidden") browser.dock.value = "auto";
        applyHeight(browser.layout, height);
      }
      return browser.dock.value === "hidden" ? "hidden" : heightOf(browser.layout);
    },
    async sweep(from, to, step, options) {
      await settledStats(performance.now() + 60_000);
      const times = sweepTimes(from, to, step);
      const out = await reportsAt(sweepParts, times, options);
      return out.map(({ report }, index): LaneSample => laneSample(times[index] ?? 0, report));
    },
    // The frames come from the capture of the labs renderer after a seek, as in the frame strip.
    clip: (request) =>
      makeClip(
        labClipParts({ clock, take, view, camera: (next) => api.camera(next), frame: () => api.frame() }),
        request,
      ),
  };
  // The plugin adds its methods (the events of its take model, the metrics and the checks, a live session).
  const full: Room3DLabApi = Object.assign(
    api,
    editorPlugin().apiExtensions({
      take,
      clock,
      view,
      source: parts.source,
      api,
      reportsAt: async (times, options) => {
        await settledStats(performance.now() + 60_000);
        return reportsAt(sweepParts, times, options);
      },
    }),
  );
  globalThis.__room3dLab = full;
  onBeforeUnmount(() => {
    if (globalThis.__room3dLab === full) globalThis.__room3dLab = undefined;
  });
}
