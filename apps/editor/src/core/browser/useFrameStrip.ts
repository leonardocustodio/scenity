// SPDX-License-Identifier: Apache-2.0
/**
 * The frame strip and the clip lanes of the dock: small pictures of the scene at 8, 16 or 32 times across the window
 * of the play bar, and the clip that each member draws across the window.
 *
 * - While the clock plays, the strip fills itself. When the clock passes a slot time, the renderer captures the frame
 *   that it draws (`ViewHandle.capture`, at most one capture in each 100 ms). There is no seek, so the scene shows
 *   what the person sees.
 * - `fill` seeks to each empty slot, captures its frame, and restores the clock. The dock calls it immediately when an
 *   item opens (`autoFill`), so the strip is full before the item plays.
 * - A frame is a function of the take, the events, the time, the camera, the tune values and the renderer options.
 *   The cache keeps it under a key of these values (stripCache.ts).
 * - The lanes of a take without events of the panel come from the sweep (generated/takeLanes.json). The lanes of a
 *   changed take come from the captures (each capture gives the clips of the members).
 */
import { computed, onBeforeUnmount, ref, shallowRef, watch, type ComputedRef, type Ref, type ShallowRef } from "vue";
import type { LabContext } from "../labContext";
import { lanesOf, type LaneSample, type Lanes } from "../lanes";
import { takeLanesIn, takeLength, takeNamed, takeSwept } from "../sequence";
import { contentHash } from "../index/contentHash";
import { slotsFromIndex } from "../index/stripFromIndex";
import { stripKey } from "../index/stripKey";
import { useInjectedLabIndex } from "../index/useLabIndex";
import { dropFrames, readFrame, writeFrame } from "./stripCache";

/** The width of a frame picture (CSS pixels, 4:3 or the aspect of the scene). */
const FRAME_WIDTH = 160;
/** While the clock plays, at most one capture occurs in this time (ms). */
const CAPTURE_GAP_MS = 100;
/** The step of the lane samples of a fill (ms of the simulation). */
const LANE_STEP_MS = 100;

export interface StripSlot {
  readonly index: number;
  /** The time of the slot (ms of the take). */
  readonly at: number;
  /** The picture (an object URL), or null. */
  readonly url: string | null;
  /** The time of the frame of the picture (near `at` for a frame of a clock that runs). */
  readonly simMs: number | null;
  /** The picture is a frame of the index of an older content hash (the fill draws it again). */
  readonly stale?: boolean;
}

export interface FrameStrip {
  readonly range: ComputedRef<{ readonly from: number; readonly to: number }>;
  readonly slots: ShallowRef<readonly StripSlot[]>;
  readonly lanes: ComputedRef<Lanes>;
  /** "take": the lanes of the sweep; "live": the lanes of the captures of this page. */
  readonly lanesSource: ComputedRef<"take" | "live">;
  readonly filling: Ref<boolean>;
  readonly fill: () => Promise<void>;
  /** Fill the strip of a new item: after the slots of its key and the assets of the scene are ready. */
  readonly autoFill: () => Promise<void>;
  readonly refresh: () => Promise<void>;
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait until the scene is ready and shows its assets (no load fog), for a maximum of `timeoutMs`. A frame of a scene
 * that loads must not go into the cache. Returns false when the scene is not ready in time.
 */
async function sceneReady(lab: LabContext, timeoutMs = 30_000): Promise<boolean> {
  const end = performance.now() + timeoutMs;
  while (performance.now() < end) {
    const room = document.querySelector('[data-testid="room-view"]');
    const shown =
      room?.getAttribute("data-ready") === "true" &&
      room.getAttribute("data-assets") !== "loading" &&
      room.querySelector('[data-testid="room-3d-fog"]') === null &&
      // The models of the scratch props are in the scene.
      room.closest('[data-scratch="loading"]') === null;
    const stats = shown ? await (lab.renderer.view.value?.stats(false) ?? Promise.resolve(null)) : null;
    if (stats !== null && stats.assets !== "loading") return true;
    await sleep(100);
  }
  return false;
}

/** A small WebP of a captured picture. */
async function encode(bitmap: ImageBitmap): Promise<Blob | null> {
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext("bitmaprenderer")?.transferFromImageBitmap(bitmap);
    return await canvas.convertToBlob({ type: "image/webp", quality: 0.8 });
  } catch {
    bitmap.close();
    return null;
  }
}

/** The times of the slots across a range. */
export function slotTimes(from: number, to: number, count: number): number[] {
  const step = (to - from) / count;
  return Array.from({ length: count }, (_, index) => Math.round(from + (index + 0.5) * step));
}

/**
 * The key of the frames of a strip: the scene, the camera, the renderer options, the range and the code. The camera
 * is the view at the end of its last move. Thus an orbit changes the key of the strip one time, when the pointer
 * releases. The content hash identifies the code (not the start of the dev server), so the frames stay valid after a
 * restart.
 */
function keyOf(lab: LabContext, range: { from: number; to: number }, count: number): string {
  const { take, camera, renderer } = lab;
  return stripKey({
    take: take.base.value ?? "",
    events: take.events.value,
    range,
    count,
    view: camera.settled.value ?? camera.name.value,
    tunes: renderer.tunes.value,
    debug: renderer.debug.value,
    assets: renderer.useAssets.value,
    tier: renderer.tier.value,
    contentHash: contentHash.value,
    scratch: renderer.scratch?.value ?? "",
  });
}

/** True while the camera moves (an orbit, a walk). Its frames are not frames of the key. */
function cameraMoves(lab: LabContext): boolean {
  return lab.camera.view.value !== lab.camera.settled.value;
}

/** The bucket of a lane sample: one sample for each LANE_STEP_MS of the take. */
function laneBucket(at: number): number {
  return Math.round(at / LANE_STEP_MS);
}

/**
 * The lane samples with one more sample. There is one sample for each bucket in the range. Thus the list has at most
 * one sample for each LANE_STEP_MS of the range, for all durations of the clock.
 */
export function withSample(
  samples: readonly LaneSample[],
  sample: LaneSample,
  range: { readonly from: number; readonly to: number },
): readonly LaneSample[] {
  if (sample.at < range.from - LANE_STEP_MS || sample.at > range.to + LANE_STEP_MS) return samples;
  const bucket = laneBucket(sample.at);
  return [...samples.filter((item) => laneBucket(item.at) !== bucket), sample];
}

/** True when a capture adds nothing: no empty slot is near the clock, and the lanes have the sample. */
function needless(
  slot: StripSlot | undefined,
  plainTake: boolean,
  samples: readonly LaneSample[],
  sim: number,
): boolean {
  if (slot !== undefined) return false;
  return plainTake || samples.some((item) => laneBucket(item.at) === laneBucket(sim));
}

/** The take of the lab without events of the panel: its lanes come from the sweep. */
function isPlainTake(lab: LabContext): boolean {
  const base = lab.take.base.value;
  if (base === null || !takeSwept(base)) return false;
  return JSON.stringify(lab.take.events.value) === JSON.stringify(takeNamed(base)?.events ?? []);
}

/** The slots of a strip and their pictures (object URLs that the strip revokes when it removes them). */
function useSlots() {
  const slots = shallowRef<readonly StripSlot[]>([]);
  function set(index: number, patch: Partial<StripSlot>): void {
    slots.value = slots.value.map((slot) => {
      if (slot.index !== index) return slot;
      if (patch.url !== undefined && slot.url !== null && slot.url !== patch.url) URL.revokeObjectURL(slot.url);
      return { ...slot, ...patch };
    });
  }
  function reset(times: readonly number[]): void {
    for (const slot of slots.value) if (slot.url !== null) URL.revokeObjectURL(slot.url);
    slots.value = times.map((at, index) => ({ index, at, url: null, simMs: null }));
  }
  return { slots, set, reset };
}

/** The slots of a strip key from the strip cache. The frames of an earlier fill return. */
async function slotsFromCache(
  key: string,
  slots: readonly StripSlot[],
  current: () => boolean,
  set: (index: number, patch: Partial<StripSlot>) => void,
): Promise<void> {
  for (const slot of slots) {
    const frame = await readFrame(`${key}:${String(slot.index)}`);
    if (frame !== null && current()) set(slot.index, { url: URL.createObjectURL(frame.blob), simMs: frame.simMs });
  }
}

/**
 * The empty slots get the frames of the frame index, and then the fill draws only the misses. New frames of the index
 * fill more slots. Returns the function that fills the slots of a strip key.
 */
function useStripIndex(
  slots: ShallowRef<readonly StripSlot[]>,
  set: (index: number, patch: Partial<StripSlot>) => void,
  stripKey: ComputedRef<string>,
): (key: string) => Promise<number> {
  const labIndex = useInjectedLabIndex();
  const fromIndex = (key: string): Promise<number> =>
    slotsFromIndex(
      labIndex,
      slots.value,
      () => stripKey.value === key,
      (slot, patch) => {
        set(slot, patch);
      },
    );
  if (labIndex !== null) watch(labIndex.frames, () => void fromIndex(stripKey.value));
  return fromIndex;
}

/** Start the play loop when the strip shows and the clock runs. This also occurs at the page start. */
function whilePlaying(active: Ref<boolean>, running: Ref<boolean>, tick: () => void): void {
  let frame = 0;
  const loop = (): void => {
    frame = 0;
    if (!active.value || !running.value) return;
    tick();
    frame = requestAnimationFrame(loop);
  };
  watch(
    [active, running],
    () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = active.value && running.value ? requestAnimationFrame(loop) : 0;
    },
    { immediate: true },
  );
  onBeforeUnmount(() => {
    if (frame !== 0) cancelAnimationFrame(frame);
  });
}

export function useFrameStrip(lab: LabContext, active: Ref<boolean>): FrameStrip {
  const { clock, take, renderer } = lab;
  const filling = ref(false);
  const { slots, set, reset } = useSlots();
  const samples = shallowRef<readonly LaneSample[]>([]);
  let lastCapture = 0;
  const range = computed(() => lab.browser?.window.value ?? { from: 0, to: takeLength(take.base.value ?? "idle") });
  const count = computed(() => lab.browser?.slots.value ?? 16);
  const stripKey = computed(() => keyOf(lab, range.value, count.value));
  const plainTake = computed(() => isPlainTake(lab));

  /** New slots for a new key. The frames of the cache return. */
  async function load(): Promise<void> {
    const key = stripKey.value;
    reset(slotTimes(range.value.from, range.value.to, count.value));
    samples.value = [];
    await slotsFromCache(key, slots.value, () => stripKey.value === key, set);
    await fromIndex(key);
  }

  const fromIndex = useStripIndex(slots, set, stripKey);

  /** Capture the current frame. Keep its picture for a slot and its clips for the lanes. */
  async function capture(index: number | null): Promise<void> {
    const key = stripKey.value;
    const shot = (await renderer.view.value?.capture(index === null ? 0 : FRAME_WIDTH)) ?? null;
    // A frame of a camera that moves is not a frame of the key.
    if (shot?.simMs == null || stripKey.value !== key || cameraMoves(lab)) {
      shot?.bitmap?.close();
      return;
    }
    samples.value = withSample(samples.value, { at: Math.round(shot.simMs), members: shot.members }, range.value);
    if (index === null || shot.bitmap === null) return;
    const blob = await encode(shot.bitmap);
    if (blob === null || stripKey.value !== key) return;
    void writeFrame(`${key}:${String(index)}`, { blob, simMs: shot.simMs });
    set(index, { url: URL.createObjectURL(blob), simMs: shot.simMs, stale: false });
  }

  // While the clock plays, capture the empty slot nearest to the clock and a lane sample. This occurs at most one time
  // in each CAPTURE_GAP_MS. No capture occurs while the camera moves, or when the strip is full and the lanes have the
  // sample.
  whilePlaying(active, clock.running, () => {
    const now = performance.now();
    if (now - lastCapture < CAPTURE_GAP_MS || filling.value || cameraMoves(lab)) return;
    const sim = clock.simNow();
    const spacing = (range.value.to - range.value.from) / count.value;
    const slot = slots.value.find((item) => item.url === null && Math.abs(sim - item.at) < spacing * 0.5);
    if (needless(slot, plainTake.value, samples.value, sim)) return;
    lastCapture = now;
    void capture(slot?.index ?? null);
  });
  let loading: Promise<void> = Promise.resolve();
  watch(
    stripKey,
    () => {
      loading = load();
    },
    { immediate: true },
  );
  const fill = (): Promise<void> =>
    fillBySeeks(lab, filling, slots, plainTake.value ? null : range.value, capture, () => stripKey.value);
  onBeforeUnmount(() => reset([]));

  return {
    range,
    slots,
    lanes: computed(() => stripLanes(plainTake.value ? (take.base.value ?? "") : null, range.value, samples.value)),
    lanesSource: computed(() => (plainTake.value ? "take" : "live")),
    filling,
    fill,
    autoFill: () => fillWhenReady(lab, { active, filling, slots, loading: () => loading, fill }),
    async refresh() {
      await dropFrames(stripKey.value);
      await load();
    },
  };
}

/** The lanes of a strip: from the sweep of a take without events of the panel, else from the captures. */
function stripLanes(
  plainTake: string | null,
  range: { readonly from: number; readonly to: number },
  samples: readonly LaneSample[],
): Lanes {
  if (plainTake !== null) return takeLanesIn(plainTake, range.from, range.to);
  return lanesOf(
    [...samples].sort((a, b) => a.at - b.at),
    LANE_STEP_MS,
  );
}

/** The fill of a new item (autoFill). It starts after the key, the frames of the cache and the assets of the scene. */
async function fillWhenReady(
  lab: LabContext,
  strip: {
    readonly active: Ref<boolean>;
    readonly filling: Ref<boolean>;
    readonly slots: ShallowRef<readonly StripSlot[]>;
    readonly loading: () => Promise<void>;
    readonly fill: () => Promise<void>;
  },
): Promise<void> {
  // First the events of the new item change the key. Then the frames of the cache return.
  await nextPaint();
  while (strip.filling.value) await sleep(50);
  await strip.loading();
  if (!strip.active.value || !(await sceneReady(lab))) return;
  if (strip.slots.value.some((slot) => slot.url === null || slot.stale === true)) await strip.fill();
}

/** Seek to each empty slot and capture it (and the lane samples of a changed take). Then restore the clock. */
async function fillBySeeks(
  lab: LabContext,
  filling: Ref<boolean>,
  slots: ShallowRef<readonly StripSlot[]>,
  lanes: { readonly from: number; readonly to: number } | null,
  capture: (index: number | null) => Promise<void>,
  keyNow: () => string,
): Promise<void> {
  const { clock, take } = lab;
  if (filling.value || lab.renderer.view.value === null) return;
  filling.value = true;
  // Another item can open during the fill. Then the fill stops, and the clock stays with the new item.
  const key = keyNow();
  const back = clock.simNow();
  const running = clock.running.value;
  clock.pause();
  const at = async (ms: number, index: number | null): Promise<void> => {
    clock.seek(ms);
    take.refresh();
    await nextPaint();
    await capture(index);
  };
  try {
    // A stale frame of the index is also a miss, so the fill draws it again.
    for (const slot of slots.value.filter((item) => item.url === null || item.stale === true)) {
      if (keyNow() !== key) break;
      await at(slot.at, slot.index);
    }
    if (lanes !== null) {
      for (let ms = lanes.from; ms <= lanes.to && keyNow() === key; ms += LANE_STEP_MS) await at(ms, null);
    }
  } finally {
    if (keyNow() === key) {
      clock.seek(back);
      take.refresh();
      if (running) clock.play();
    }
    filling.value = false;
  }
}
