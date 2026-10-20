// SPDX-License-Identifier: Apache-2.0
/**
 * The frame index of the lab page. It has the reader of the open take for the strip, the hover preview and the
 * overview strip. It also has the fill of the lab page alone and the parts of the bridge calls of the workbench
 * (`indexPlan`, `indexJob`, `indexInput`, `indexChanged`, bridgeCalls.ts).
 *
 * The frames of the open take come from the current content hash. Where a current frame is missing, a frame of the
 * newest older content hash shows with a stale mark. The lab page alone reads and fills its own store. In a frame of
 * the workbench, the page reads the store of the host, and the host queue gives the jobs to the shadow frame.
 */
import { bridgeOrigin } from "@scenity/bridge";
import { takeKeyOf, type FrameKeyInput, type FrameView, type RendererBackend } from "@scenity/labs-platform/frameKey";
import { FpsMeter, pageHost, type IdleRunner, type IdleState } from "@scenity/labs-platform/idle";
import { EMPTY_TAKE_INDEX, TakeFrames, type IndexedFrame } from "@scenity/labs-platform/indexRead";
import type { IndexStore } from "@scenity/labs-platform/indexStore";
import {
  computed,
  inject,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
  type ComputedRef,
  type InjectionKey,
  type Ref,
  type ShallowRef,
} from "vue";
import type { LabContext } from "../labContext";
import type { ViewHandle } from "../useLabStats";
import { openBrowserIndex } from "./browserIndex";
import { contentHash } from "./contentHash";
import { frameViewOfCamera, INDEX_SIZES, labFrameInput, STEP_MS, type LabKeyState } from "./frameInput";
import { indexDuration, momentTimes, PictureUrls, takePlan, type TakePlan } from "./indexPlan";
import { setActiveLabIndex } from "./activeIndex";
import { browserReader, parentReader, type IndexReader } from "./reader";
import { renderJob, type JobParts, type RenderedJob } from "./renderJob";
import { QUIET_MS, startSelfFill, type FillParts } from "./selfFill";

export interface LabIndex {
  readonly reader: ShallowRef<IndexReader | null>;
  /** The frames of the open take and view (current and stale). */
  readonly frames: ShallowRef<TakeFrames>;
  /** The view of the readers: the camera of the page. */
  readonly view: ComputedRef<FrameView>;
  /** The length of the take in the index (ms). */
  readonly durationMs: ComputedRef<number>;
  /** The state of the fill of the lab page alone ("off" in the workbench or without a store). */
  readonly fillState: Ref<IdleState | "off">;
  /** The input of the frame of the page at a time (null: a live session or the runtime renderer). */
  pageInput(timeMs?: number, view?: FrameView): FrameKeyInput | null;
  /** The frame nearest to a time (on the 100 ms steps), the small size first, or null. */
  lookup(timeMs: number, options?: { readonly size?: number; readonly maxGapMs?: number }): IndexedFrame | null;
  /** The object URL of the picture of a frame (the cache of the index owns it: never revoke it). */
  picture(frame: IndexedFrame["frame"]): Promise<string | null>;
  /** The picture of a frame as a Blob, or null. */
  blob(frame: IndexedFrame["frame"]): Promise<Blob | null>;
  /** Read the frames of the open take again. */
  refresh(): Promise<void>;
  /** The plan of the open take (the bridge call `indexPlan`). */
  plan(): TakePlan[];
  /** Render one job of the host (the bridge call `indexJob`). */
  job(input: FrameKeyInput, size: number): Promise<RenderedJob>;
  readonly runner: () => IdleRunner | null;
}

/** The lab index for the readers of the page (the strip, the time line). */
export const LAB_INDEX: InjectionKey<LabIndex> = Symbol("room3d-lab-index");

/** The lab index of the page, or null (a component outside the lab page, a test). */
export function useInjectedLabIndex(): LabIndex | null {
  return inject(LAB_INDEX, null);
}

export interface LabIndexParts {
  readonly lab: LabContext;
  readonly backend: () => RendererBackend | null;
  /** The runtime renderer (`runtime=1`): no index renders. */
  readonly runtime: boolean;
}

/** True in a frame of the workbench (the bridge is on): the host keeps the index. */
function inWorkbench(): boolean {
  return bridgeOrigin(globalThis.location.search) !== null && globalThis.parent !== globalThis.window;
}

/** True when the scene shows its frame with its assets (no loading fog), as the strip checks it. */
function sceneShown(): boolean {
  const room = document.querySelector('[data-testid="room-view"]');
  return (
    room?.getAttribute("data-ready") === "true" &&
    room.getAttribute("data-assets") !== "loading" &&
    room.querySelector('[data-testid="room-3d-fog"]') === null &&
    // The models of the scratch props are in the scene.
    room.closest('[data-scratch="loading"]') === null
  );
}

function keyState(parts: LabIndexParts): LabKeyState | null {
  const { lab } = parts;
  if (lab.mock !== null || parts.runtime || lab.renderer.frozen) return null;
  return {
    take: lab.take.base.value,
    track: lab.trackName,
    events: lab.take.events.value,
    tunes: lab.renderer.tunes.value,
    debug: lab.renderer.debug.value,
    assets: lab.renderer.useAssets.value,
    reduced: lab.renderer.reduced.value,
    tier: lab.renderer.tier.value,
    backend: parts.backend(),
    scratch: lab.renderer.scratch?.value ?? "",
  };
}

/** Track the last input of the user (the fill waits QUIET_MS after it). */
function useQuiet(): () => boolean {
  let last = performance.now();
  const mark = (): void => {
    last = performance.now();
  };
  const kinds = ["pointerdown", "keydown", "wheel"] as const;
  onMounted(() => {
    for (const kind of kinds) globalThis.addEventListener(kind, mark, { passive: true, capture: true });
  });
  onBeforeUnmount(() => {
    for (const kind of kinds) globalThis.removeEventListener(kind, mark, { capture: true });
  });
  return () => performance.now() - last >= QUIET_MS;
}

/** The frame of a time from the frames of a take: the step of 100 ms, else the nearest within the gap. */
export function lookupFrame(
  frames: TakeFrames,
  view: FrameView,
  timeMs: number,
  options: { readonly size?: number; readonly maxGapMs?: number } = {},
): IndexedFrame | null {
  const near = Math.round(timeMs / STEP_MS) * STEP_MS;
  const gap = options.maxGapMs ?? STEP_MS;
  for (const size of options.size === undefined ? INDEX_SIZES : [options.size]) {
    const found = frames.at(near, view, size) ?? frames.nearest(timeMs, view, size, gap);
    if (found !== null) return found;
  }
  return null;
}

/** The frames of the open take. A new read occurs after a change of the take key, and soon after a store change. */
function useTakeFrames(reader: ShallowRef<IndexReader | null>, pageInput: () => FrameKeyInput | null) {
  const frames = shallowRef(new TakeFrames(EMPTY_TAKE_INDEX));
  let reading = 0;
  async function refresh(): Promise<void> {
    const input = pageInput();
    const current = reader.value;
    if (input === null || current === null) return;
    const ticket = ++reading;
    const index = await current.takeIndex(input);
    if (ticket === reading) frames.value = new TakeFrames(index);
  }
  let pending: ReturnType<typeof setTimeout> | null = null;
  const refreshSoon = (): void => {
    pending ??= setTimeout(() => {
      pending = null;
      void refresh();
    }, 250);
  };
  watch(
    () => {
      const input = pageInput();
      return input === null ? "" : `${input.contentHash}/${takeKeyOf(input)}/${JSON.stringify(input.view)}`;
    },
    () => void refresh(),
  );
  onBeforeUnmount(() => {
    if (pending !== null) clearTimeout(pending);
  });
  return { frames, refresh, refreshSoon };
}

/** The reader of the page: the store of the host through the workbench page, else the store of the page alone. */
async function openReader(): Promise<{ readonly reader: IndexReader; readonly store: IndexStore | null } | null> {
  if (inWorkbench()) return { reader: parentReader(bridgeOrigin(globalThis.location.search) ?? ""), store: null };
  const opened = await openBrowserIndex();
  return opened === null ? null : { reader: browserReader(opened.store), store: opened.store };
}

/**
 * False when the URL has `indexFill=0`. The perf harness (`labs bench`) stops the idle fill with it. The fill draws
 * frames when the clock is stopped, and it changes the paused and strip measurements. The reader stays on.
 */
export function idleFillAllowed(search: string = globalThis.location.search): boolean {
  return new URLSearchParams(search).get("indexFill") !== "0";
}

/** Start the fill of the lab page alone (selfFill.ts) with the frame rate of the page and of the scene. */
function startPageFill(
  parts: Omit<FillParts, "fps" | "onState" | "stored" | "quiet">,
  lab: LabContext,
  reader: IndexReader,
  fillState: Ref<IdleState | "off">,
  quiet: () => boolean,
): { readonly runner: IdleRunner; readonly meter: FpsMeter } {
  const meter = new FpsMeter(pageHost());
  meter.start();
  const runner = startSelfFill({
    ...parts,
    quiet,
    // The frames of the worker when the clock runs, and the animation frames of the page.
    fps: () => {
      const page = meter.fps();
      const scene = lab.clock.running.value ? lab.stats.shownFps.value : null;
      return page === null ? scene : scene === null ? page : Math.min(page, scene);
    },
    stored: () => {
      reader.changed();
    },
    onState: (next) => {
      fillState.value = next;
    },
  });
  return { runner, meter };
}

/** The plan of the open take and the window of the open item (the bridge call `indexPlan`). */
function planOf(lab: LabContext, input: FrameKeyInput | null, durationMs: number): TakePlan[] {
  if (input === null) return [];
  const item = lab.browser?.item.value ?? null;
  const window = lab.browser?.window.value ?? null;
  const open = item !== null && window !== null ? { id: item.key, from: window.from, to: window.to } : null;
  return [takePlan(input, durationMs, momentTimes(lab.take.base.value), open)];
}

export function useLabIndex(parts: LabIndexParts): LabIndex {
  const { lab } = parts;
  const reader = shallowRef<IndexReader | null>(null);
  const fillState = ref<IdleState | "off">("off");
  const state = computed(() => keyState(parts));
  const view = computed(() => frameViewOfCamera(lab.camera.name.value, lab.camera.settled.value));
  const durationMs = computed(() =>
    indexDuration(lab.take.base.value, lab.take.events.value, lab.track.value?.duration ?? null),
  );
  const pageInput = (timeMs = 0, at: FrameView = view.value): FrameKeyInput | null =>
    state.value === null ? null : labFrameInput(state.value, timeMs, at, contentHash.value);
  const { frames, refresh, refreshSoon } = useTakeFrames(reader, () => pageInput());
  const quiet = useQuiet();
  const jobParts: JobParts = {
    view: () => lab.renderer.view.value,
    page: () => pageInput() ?? labFrameInput(EMPTY_STATE, 0, null, ""),
    track: () =>
      lab.trackName !== null && lab.track.value !== null ? { name: lab.trackName, track: lab.track.value } : null,
    ready: sceneShown,
  };
  let urls: PictureUrls | null = null;
  let fill: { readonly runner: IdleRunner; readonly meter: FpsMeter } | null = null;
  onMounted(() => {
    void openReader().then((opened) => {
      if (opened === null) return;
      opened.reader.onChange(refreshSoon);
      reader.value = opened.reader;
      urls = new PictureUrls((frame) => opened.reader.picture(frame));
      void refresh();
      if (opened.store === null || state.value === null || !idleFillAllowed()) return;
      const render = (input: FrameKeyInput, size: number) => renderJob(jobParts, input, size);
      const fillParts = { store: opened.store, page: () => pageInput(), render };
      fill = startPageFill(
        { ...fillParts, durationMs: () => durationMs.value, clockMs: () => lab.clock.simNow() },
        lab,
        opened.reader,
        fillState,
        quiet,
      );
    });
  });
  const index: LabIndex = {
    reader,
    frames,
    view,
    durationMs,
    fillState,
    pageInput,
    lookup: (timeMs, options) => lookupFrame(frames.value, view.value, timeMs, options),
    picture: (frame) => urls?.url(frame) ?? Promise.resolve(null),
    blob: (frame) => reader.value?.picture(frame) ?? Promise.resolve(null),
    refresh,
    plan: () => planOf(lab, pageInput(), durationMs.value),
    job: (input, size) => renderJob(jobParts, input, size),
    runner: () => fill?.runner ?? null,
  };
  onBeforeUnmount(() => {
    fill?.runner.stop();
    fill?.meter.stop();
    urls?.clear();
    setActiveLabIndex(null, index);
  });
  setActiveLabIndex(index);
  // The lab index and the view of the page, for the end-to-end tests.
  globalThis.__room3dLabIndex = { index, view: () => lab.renderer.view.value };
  return index;
}

declare global {
  // The lab index of the page and its view, for the end-to-end tests.
  var __room3dLabIndex: { readonly index: LabIndex; view(): ViewHandle | null } | undefined;
}

/** The state of a page without an index (a job of it is always refused). */
const EMPTY_STATE: LabKeyState = {
  take: null,
  track: null,
  events: [],
  tunes: {},
  debug: [],
  assets: false,
  reduced: false,
  tier: "",
};
