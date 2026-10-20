<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts" generic="Input">
/**
 * The generic view of a scene. A plugin wraps it with its own props and overlays.
 *
 * - The canvas goes to the render worker of the renderer factory (or to the main-thread core). The view sends the
 *   scene input when it changes, the size, the flags and the pointer; the renderer sends the projected points (after
 *   a walk or a new size) and the hit tests.
 * - Paused: the scene dims and stops. Reduced motion: still poses, one frame per change.
 * - The fallback ladder: a failure of the render worker (it does not start, or it throws) starts the same core on
 *   the main thread on a new canvas. A failure of the WebGPU backend starts it once with WebGL. The view emits
 *   `failed` after a second failure, a lost context that the browser does not restore, or no first frame. Then the
 *   host shows its fallback.
 * - Assets: the poster image shows at once and fades out at the first frame. While the files load, a light fog
 *   covers the scene, so the objects do not appear one by one.
 * - The adaptive quality (adaptive.ts) lowers the render scale, then the tier, then uses still poses, then fails.
 * - The default slot is the overlay of the host (HTML over the scene, for example cards). It gets the hovered object.
 *
 * The test IDs keep the names of the room view (`room-3d-…`), so the tests and the lab find the same elements.
 */
import type { Cadence } from "@scenity/runtime/adapt";
import type { BackendChoice } from "@scenity/runtime/backend";
import type { SceneClient } from "@scenity/runtime/client";
import type { AssetReport, PointerKind, ProjectedFrame, SceneFlags, SceneStats, Tier } from "@scenity/runtime/protocol";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { useAdaptiveQuality } from "./adaptive";
import { useAssetState } from "./assetState";
import type { PosterImage, SceneAssets, SceneQuality, SceneRendererFactory } from "./types";

const props = withDefaults(
  defineProps<{
    /** The scene input of the plugin. A new value goes to the renderer. */
    input: Input;
    /** The factory of the renderer: the runtime client of a plugin, or a labs renderer. */
    createRenderer: SceneRendererFactory<Input>;
    paused: boolean;
    getSimMs?: (() => number | null) | null;
    /** The reduced-motion setting of the system or of the host: still poses, one frame per change. */
    reducedMotion?: boolean;
    /** The first quality tier of the GPU probe. */
    tier?: Tier;
    /** The URL of the render worker, or null for the main-thread core. */
    workerUrl?: string | null;
    /** The URL of the render worker of the WebGPU backend, or null. */
    gpuWorkerUrl?: string | null;
    /** Adapt the quality to the frame rate. The visual tests disable it for fixed frames. */
    adaptive?: boolean;
    /**
     * The frame cadence of a second view of the page, or null without a measurement. The adaptive quality uses it.
     */
    getSecondCadence?: (() => Cadence | null) | null;
    /** The built assets of a tier, or null for no asset files (the graybox only). */
    assets?: SceneAssets | null;
    /** The poster image at the default camera, or null without one. */
    poster?: PosterImage | null;
    /** The text of the loading state over the fog. */
    loadingLabel?: string;
    /** Measure the GPU time of each frame. A change starts or stops the timer of the renderer. */
    gpuTimer?: boolean;
    /**
     * The name of a User Timing mark for the frame statistics of each window (the statistics in its detail), or null
     * for no mark. A performance harness reads them.
     */
    statsMark?: string | null;
    /** The renderer backend of the chooser, or null when the page did not choose. */
    backend?: BackendChoice | null;
  }>(),
  {
    getSimMs: null,
    reducedMotion: false,
    tier: "medium",
    workerUrl: null,
    gpuWorkerUrl: null,
    adaptive: true,
    getSecondCadence: null,
    assets: null,
    poster: null,
    loadingLabel: "",
    gpuTimer: false,
    statsMark: null,
    backend: null,
  },
);

defineSlots<{
  /** The overlay of the host over the scene. `hovered` is the ID of the object under the pointer, or null. */
  default?(scope: { hovered: string | null; ready: boolean }): unknown;
}>();

const emit = defineEmits<{
  failed: [reason: string];
  /** The hit test of a pointer event: the ID of the object under the pointer, or null. */
  hit: [id: string | null, kind: PointerKind];
  /** New projected points of the scene (after a walk, a new camera or a new size). */
  frame: [frame: ProjectedFrame];
  /** A new asset state of the renderer, with the load state of each asset. */
  assets: [report: AssetReport];
}>();

const root = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const renderer = shallowRef<SceneClient<Input> | null>(null);
const ready = ref(false);
const hovered = ref<string | null>(null);
const size = ref<{ width: number; height: number }>({ width: 0, height: 0 });
const pageVisible = ref(typeof document === "undefined" || document.visibilityState !== "hidden");
const inView = ref(true);
let failed = false;

function fail(reason: string): void {
  if (failed) return;
  failed = true;
  emit("failed", reason);
}

const simNow = (): number | null => props.getSimMs?.() ?? null;
const visible = (): boolean => pageVisible.value && inView.value;

const { level, forcedStill } = useAdaptiveQuality<Input>({
  renderer,
  ready,
  visible,
  tier: () => props.tier,
  adaptive: () => props.adaptive,
  statsMark: () => props.statsMark,
  paused: () => props.paused,
  reducedMotion: () => props.reducedMotion,
  secondCadence: () => props.getSecondCadence?.() ?? null,
  simNow,
  fail,
});
const assetState = useAssetState<Input>(renderer, (report) => emit("assets", report));

/**
 * The poster fits the view: the aspect of the view is within POSTER_FIT of the aspect of the poster. The camera of the
 * live frames fits its field of view to the aspect of the view, so a poster of another aspect shows the scene from
 * another camera, and the scene seems to move at the first frame. Then the view shows no
 * poster, and the fog covers the start.
 */
const POSTER_FIT = 1.15;
const posterFits = computed(() => {
  const poster = props.poster;
  if (poster === null || size.value.width <= 0 || size.value.height <= 0) return false;
  const ratio = size.value.width / size.value.height / (poster.width / poster.height);
  return ratio < POSTER_FIT && ratio > 1 / POSTER_FIT;
});
/**
 * The fog over the scene: the view wants the asset files and they still load. The fog also shows while the renderer
 * did not send the state.
 */
const fogged = computed(
  () => props.assets !== null && (!assetState.reported.value || assetState.state.value === "loading"),
);

const flags = computed<SceneFlags>(() => ({
  reducedMotion: props.reducedMotion || forcedStill.value,
  paused: props.paused,
  visible: visible(),
}));

watch(
  () => props.input,
  (next) => renderer.value?.setInput(next),
);
watch(flags, (next) => renderer.value?.setFlags(next));
watch(
  () => props.gpuTimer,
  (on) => renderer.value?.setGpuTimer(on),
);

function surface(): { width: number; height: number; dpr: number } {
  return { ...size.value, dpr: typeof devicePixelRatio === "number" ? devicePixelRatio : 1 };
}

// ---------------------------------------------------------------------------------------------
// The renderer, its watchdogs and the observers of size and visibility.

/** No first frame after this time: the host shows its fallback. */
const READY_TIMEOUT_MS = 15_000;
/** A lost context that the browser does not restore after this time: the host shows its fallback. */
const CONTEXT_TIMEOUT_MS = 5_000;
let readyTimer: ReturnType<typeof setTimeout> | null = null;
let contextTimer: ReturnType<typeof setTimeout> | null = null;
let resize: ResizeObserver | null = null;
let intersection: IntersectionObserver | null = null;

function onVisibility(): void {
  pageVisible.value = document.visibilityState !== "hidden";
}

function onContext(lost: boolean): void {
  if (contextTimer !== null) clearTimeout(contextTimer);
  contextTimer = lost
    ? setTimeout(() => {
        fail("context_lost");
      }, CONTEXT_TIMEOUT_MS)
    : null;
}

/** The canvas element: a new one after a failure of the render worker (the old one went to the worker). */
const canvasKey = ref(0);
/** True after the render worker failed: the core draws on the main thread. */
let mainThreadOnly = false;
/**
 * The backend after a failure of the WebGPU backend: WebGL with the reason
 * `device_lost`, once. Null: the backend of the page.
 */
let backendAfterFailure: BackendChoice | null = null;

function startReadyTimer(): void {
  if (readyTimer !== null) clearTimeout(readyTimer);
  readyTimer = setTimeout(() => {
    if (!ready.value) fail("timeout");
  }, READY_TIMEOUT_MS);
}

/** Give the state of the view to a new renderer: the props can change while the renderer starts. */
function syncRenderer(made: SceneClient<Input>): void {
  made.setInput(props.input);
  made.setSurface(surface());
  // The flags can change while the renderer starts (reduced motion from an attribute of the page, a pause, a hidden
  // tab); the watch of the flags had no renderer then.
  made.setFlags(flags.value);
  // The GPU timer can change while the renderer starts, as the flags can.
  made.setGpuTimer(props.gpuTimer);
  if (level.value.scale !== 1) made.setScale(level.value.scale);
}

/** Create the renderer on the current canvas: the render worker first, the main-thread core after its failure. */
async function startRenderer(): Promise<void> {
  const target = canvas.value;
  if (target === null) return;
  try {
    const made = await props.createRenderer(target, {
      workerUrl: mainThreadOnly ? null : props.workerUrl,
      gpuWorkerUrl: mainThreadOnly ? null : props.gpuWorkerUrl,
      getSimMs: simNow,
      surface: surface(),
      tier: level.value.tier,
      flags: flags.value,
      assets: props.assets === null ? null : props.assets(level.value.tier),
      gpuTimer: props.gpuTimer,
      backend: backendAfterFailure ?? props.backend,
      onReady: () => {
        ready.value = true;
      },
      onAnchors: (next) => emit("frame", next),
      onHit,
      onContext,
      onAssets: assetState.onAssets,
      onFailure: onRendererFailure,
      onBackendFailure,
    });
    if (failed || root.value === null) {
      made.dispose();
      return;
    }
    renderer.value = made;
    syncRenderer(made);
  } catch (error) {
    fail(error instanceof Error ? error.message : "start");
  }
}

/**
 * The render worker did not start or threw: the same core on the main thread, on a new canvas, because
 * the old canvas belongs to the worker. A failure on the main thread gives the fallback of the host.
 */
function onRendererFailure(reason: string): void {
  if (mainThreadOnly || failed) {
    fail(reason);
    return;
  }
  mainThreadOnly = true;
  restartRenderer();
}

/**
 * The WebGPU backend failed (no device, a GPU error in the first frame, a lost device): the same renderer with the
 * WebGL backend on a new canvas, once. The client remembered the loss.
 */
function onBackendFailure(reason: string): void {
  if (backendAfterFailure !== null || failed) {
    onRendererFailure(reason);
    return;
  }
  backendAfterFailure = { backend: "webgl", reason: "device_lost", adapter: props.backend?.adapter ?? null, ms: 0 };
  restartRenderer();
}

/** Start the renderer again on a new canvas: the old canvas belongs to the old renderer. */
function restartRenderer(): void {
  renderer.value?.dispose();
  renderer.value = null;
  ready.value = false;
  if (contextTimer !== null) clearTimeout(contextTimer);
  contextTimer = null;
  canvasKey.value += 1;
  startReadyTimer();
  assetState.watchAssets();
  void nextTick(startRenderer);
}

onMounted(async () => {
  const host = root.value;
  const target = canvas.value;
  if (host === null || target === null) return;
  size.value = { width: host.clientWidth, height: host.clientHeight };
  if (typeof ResizeObserver === "function") {
    resize = new ResizeObserver(() => {
      size.value = { width: host.clientWidth, height: host.clientHeight };
      renderer.value?.setSurface(surface());
    });
    resize.observe(host);
  }
  if (typeof IntersectionObserver === "function") {
    intersection = new IntersectionObserver((entries) => {
      inView.value = entries.some((entry) => entry.isIntersecting);
    });
    intersection.observe(host);
  }
  document.addEventListener("visibilitychange", onVisibility);
  startReadyTimer();
  await startRenderer();
});

onBeforeUnmount(() => {
  renderer.value?.dispose();
  renderer.value = null;
  resize?.disconnect();
  intersection?.disconnect();
  document.removeEventListener("visibilitychange", onVisibility);
  if (readyTimer !== null) clearTimeout(readyTimer);
  if (contextTimer !== null) clearTimeout(contextTimer);
});

// ---------------------------------------------------------------------------------------------
// Pointer: one move per animation frame. The renderer returns the hit test as `hit`.

let pendingMove: { x: number; y: number } | null = null;
let moveFrame: number | null = null;

function local(event: PointerEvent): { x: number; y: number } {
  const box = canvas.value?.getBoundingClientRect();
  return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) };
}

function onPointer(event: PointerEvent, kind: PointerKind): void {
  const at = local(event);
  if (kind === "move") {
    pendingMove = at;
    moveFrame ??= requestAnimationFrame(() => {
      moveFrame = null;
      if (pendingMove !== null) renderer.value?.pointer(pendingMove.x, pendingMove.y, "move");
      pendingMove = null;
    });
    return;
  }
  renderer.value?.pointer(at.x, at.y, kind);
}

function onHit(id: string | null, kind: PointerKind): void {
  hovered.value = kind === "leave" ? null : id;
  emit("hit", id, kind);
}

defineExpose({
  /** The frame statistics of the renderer (the frame-budget measurement reads them). */
  stats: (reset = false): Promise<SceneStats> | null => renderer.value?.stats(reset) ?? null,
  quality: (): SceneQuality => ({ ...level.value, still: forcedStill.value }),
  /** The renderer that draws now, or null before its start: a host calls its methods. */
  renderer: (): SceneClient<Input> | null => renderer.value,
  element: (): HTMLElement | null => root.value,
});
</script>

<template>
  <div
    ref="root"
    :class="[
      'scene-view relative size-full overflow-hidden rounded-card bg-surface-sunken select-none',
      hovered !== null && 'cursor-pointer',
    ]"
    :data-paused="props.paused || undefined"
    :data-ready="ready || undefined"
    :data-renderer="renderer?.mode"
    :data-tier="level.tier"
    :data-scale="level.scale"
    :data-still="forcedStill || undefined"
    :data-assets="assetState.state.value"
    data-mode="3d"
    data-testid="scene-view"
  >
    <div :class="['absolute inset-0', props.paused && 'opacity-(--sc-opacity-stale)']" aria-hidden="true">
      <canvas
        :key="canvasKey"
        ref="canvas"
        class="scene-view__canvas absolute inset-0 size-full"
        tabindex="-1"
        data-testid="room-3d-canvas"
        @pointermove="onPointer($event, 'move')"
        @pointerdown="onPointer($event, 'down')"
        @pointerleave="onPointer($event, 'leave')"
      />
      <img
        v-if="props.poster !== null && posterFits"
        :src="props.poster.url"
        :width="props.poster.width"
        :height="props.poster.height"
        alt=""
        decoding="async"
        fetchpriority="high"
        :class="[
          'pointer-events-none absolute inset-0 size-full object-cover transition-opacity duration-scene motion-reduce:transition-none',
          ready && 'opacity-0',
        ]"
        :data-shown="!ready || undefined"
        data-testid="room-3d-poster"
      />
      <!-- The type: the fog waits for its fade, not for its endless drift. -->
      <Transition name="scene-view-fog" type="transition">
        <div v-if="fogged" class="scene-view__fog pointer-events-none absolute inset-0" data-testid="room-3d-fog" />
      </Transition>
      <div class="scene-view__vignette pointer-events-none absolute inset-0" />
    </div>
    <!-- The message of the loading scene, over the fog: a status, outside the hidden layer. -->
    <Transition name="scene-view-fog">
      <p
        v-if="fogged"
        class="scene-view__loading pointer-events-none absolute inset-x-0 top-1/2 m-0 flex -translate-y-1/2 justify-center"
        role="status"
        data-testid="room-3d-loading"
      >
        <span
          class="inline-flex items-center gap-2 rounded-pill bg-surface-overlay px-4 py-2 text-label text-text-primary shadow-overlay"
        >
          <span class="scene-view__spinner" aria-hidden="true" />
          {{ props.loadingLabel }}
        </span>
      </p>
    </Transition>
    <slot :hovered="hovered" :ready="ready" />
  </div>
</template>

<style scoped src="./sceneView.css"></style>
