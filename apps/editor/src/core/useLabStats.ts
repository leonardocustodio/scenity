// SPDX-License-Identifier: Apache-2.0
/**
 * The frame statistics of the 3D room lab. Once per second (each 5 s when the clock is stopped), the page reads the
 * statistics and the quality of the renderer. The read does not reset the window: the adaptive quality of the view
 * resets it. The readout on the scene shows the frame rate, and its card shows the rows of `frameRows`. The labels,
 * the hints and the units are Fluent messages of `src/i18n/en-US/lab-core.ftl`.
 */
import { TIER_ORDER } from "@scenity/runtime/adapt";
import type { IndexShot, InspectReport } from "../plugins";
import { type SceneStats, type Tier } from "@scenity/runtime/protocol";
import {
  type CaptureCheck,
  type CaptureTarget,
  type FrameCapture,
  type GhostSpec,
  type GhostView,
  type HideSpec,
  type OnionSpec,
  type OnionView,
  type OverlaySpec,
  type OverlayView,
  type PickResult,
  type PropBox,
  type ShotRequest,
  type SweepSample,
} from "@scenity/runtime-dev";
import { computed, onBeforeUnmount, onMounted, ref, type ComputedRef, type Ref, type ShallowRef } from "vue";
import { t } from "../texts";
import { backendText } from "./backendText";

/** The message ID of the label of each quality tier. */
const TIER_LABELS: Readonly<Record<Tier, string>> = {
  ultra: "lab-tier-ultra",
  high: "lab-tier-high",
  medium: "lab-tier-medium",
  low: "lab-tier-low",
};

/**
 * The quality tiers of the lab and the message IDs of their labels. The ultra tier has no frame cap.
 */
export const TIERS: readonly (readonly [Tier, string])[] = TIER_ORDER.map((tier) => [tier, TIER_LABELS[tier]] as const);

export interface Quality {
  readonly tier: Tier;
  readonly scale: number;
  readonly still: boolean;
}

/** What the lab reads from the room view (LabsRoomView exposes it). */
export interface ViewHandle {
  stats(reset?: boolean): Promise<SceneStats> | null;
  quality(): Quality | null;
  mark(): Promise<number | null>;
  inspect(): Promise<InspectReport | null>;
  /**
   * A picture `width` pixels wide; with a `height`, at that size and aspect. With panes: one pane (`target.pane`,
   * default the main pane) or the full canvas (`target.grid`).
   */
  capture(width: number, height?: number, target?: CaptureTarget): Promise<FrameCapture | null>;
  /**
   * The inspect report at each sample without a render, or null without the labs renderer. Absent: the lab sweeps
   * with rendered frames.
   */
  sweep?(samples: readonly SweepSample[]): Promise<readonly InspectReport[] | null>;
  /** The pictures of the frame index without a seek; absent: no index renders. */
  shots?(request: ShotRequest): Promise<readonly IndexShot[] | null>;
  /** What is under a point of the canvas in a pane; absent: no pick. */
  pick?(x: number, y: number, pane?: number): Promise<PickResult | null>;
  /** A capture of a new frame against a readback of its pixels; absent: the runtime renderer. */
  captureCheck?(): Promise<CaptureCheck | null>;
  /** The ghosts of the proposals; absent: the runtime renderer draws none. */
  ghosts?(specs: readonly GhostSpec[]): void;
  /** The ghosts as the core draws them. */
  listGhosts?(): Promise<readonly GhostView[]>;
  /** The editor overlay; absent: the runtime renderer draws none. */
  overlay?(spec: OverlaySpec): void;
  /** The overlay as the core draws it. */
  overlayView?(): Promise<OverlayView | null>;
  /** The box of each prop in the frame of its place. */
  propBoxes?(): Promise<Readonly<Record<string, PropBox>>>;
  /** The onion skin; absent: the runtime renderer draws none. */
  onion?(spec: OnionSpec): void;
  /** The onion skin as the core draws it. */
  onionView?(): Promise<OnionView | null>;
  /** The solo and hide of the panes; absent: the runtime renderer hides nothing. */
  hide?(spec: HideSpec): void;
  /** The solo and hide as the core holds it. */
  hiddenView?(): Promise<HideSpec | null>;
}

export interface LabStats {
  readonly stats: Ref<SceneStats | null>;
  readonly quality: Ref<Quality | null>;
  /** The frame rate of the readout: the last frame rate of a window with frames, or null. */
  readonly shownFps: Ref<number | null>;
  readonly frameRows: ComputedRef<readonly (readonly [string, string, string])[]>;
}

/** Frames per second from the median frame interval. */
export function fps(value: SceneStats): number {
  return value.intervalP50 > 0 ? Math.round(1000 / value.intervalP50) : 0;
}

/** The memory of the renderer as text: the geometries, the textures, the shader programs and the JS heap. */
function memoryText(value: SceneStats): string {
  const memory = value.memory;
  if (memory === undefined) return "…";
  const counts = {
    geometries: String(memory.geometries),
    textures: String(memory.textures),
    programs: String(memory.programs),
  };
  return value.heapMb === null || value.heapMb === undefined
    ? t("lab-stats-memory-value", counts)
    : t("lab-stats-memory-heap", { ...counts, heap: String(value.heapMb) });
}

/** The poll of the statistics (ms), and the poll when the clock is stopped. */
const POLL_MS = 1000;
const PAUSED_POLL_MS = 5000;

/** `paused`: the clock of the lab is stopped (then the poll is slower). */
export function useLabStats(view: ShallowRef<ViewHandle | null>, paused?: Readonly<Ref<boolean>>): LabStats {
  const stats = ref<SceneStats | null>(null);
  const quality = ref<Quality | null>(null);
  const shownFps = ref<number | null>(null);

  /** The rows of the card: the label, the value and what the value measures (the hint of the label). */
  const frameRows = computed<readonly (readonly [string, string, string])[]>(() => {
    const value = stats.value;
    if (value === null) return [];
    const ms = (time: number) => t("lab-stats-ms", { ms: time.toFixed(1) });
    // No samples yet: the timer starts with the card, and a GPU result comes some frames after its frame.
    const gpu =
      value.gpu === undefined || (value.gpu !== null && value.gpu.samples === 0)
        ? "…"
        : value.gpu === null
          ? t("lab-stats-none")
          : ms(value.gpu.p95);
    const tierId = TIERS.find(([item]) => item === value.tier)?.[1];
    const tier = tierId === undefined ? value.tier : t(tierId);
    const tierText =
      quality.value === null || quality.value.scale === 1
        ? t("lab-stats-tier-value", { tier, mode: value.mode })
        : t("lab-stats-tier-scaled", { tier, scale: String(quality.value.scale), mode: value.mode });
    return [
      [t("lab-stats-frame"), ms(value.intervalP95), t("lab-stats-frame-hint")],
      [t("lab-stats-cpu"), ms(value.workP95), t("lab-stats-cpu-hint")],
      [t("lab-stats-gpu"), gpu, t("lab-stats-gpu-hint")],
      // The backend that draws and the reason.
      [t("lab-stats-backend"), backendText(value, null), t("lab-stats-backend-hint")],
      [
        t("lab-stats-update"),
        value.updateP95 === undefined || value.renderP95 === undefined || value.poseP95 === undefined
          ? "…"
          : t("lab-stats-update-value", {
              update: value.updateP95.toFixed(1),
              pose: value.poseP95.toFixed(1),
              render: value.renderP95.toFixed(1),
            }),
        t("lab-stats-update-hint"),
      ],
      [t("lab-stats-draws"), value.drawCalls.toLocaleString("en-US"), t("lab-stats-draws-hint")],
      [t("lab-stats-triangles"), value.triangles.toLocaleString("en-US"), t("lab-stats-triangles-hint")],
      [t("lab-stats-tier"), tierText, t("lab-stats-tier-hint")],
      [t("lab-stats-memory"), memoryText(value), t("lab-stats-memory-hint")],
    ];
  });

  let timer: ReturnType<typeof setTimeout> | null = null;
  const poll = (): void => {
    quality.value = view.value?.quality() ?? null;
    void view.value?.stats(false)?.then((value) => {
      stats.value = value;
      // The adaptive quality starts the window of the statistics again. Keep the last frame rate until the window has
      // frames again.
      const rate = fps(value);
      if (rate > 0) shownFps.value = rate;
    });
    // A stopped clock draws no frames, thus the statistics change little: use a slower poll.
    timer = setTimeout(poll, paused?.value === true ? PAUSED_POLL_MS : POLL_MS);
  };
  onMounted(() => {
    timer = setTimeout(poll, POLL_MS);
  });
  onBeforeUnmount(() => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  });

  return { stats, quality, shownFps, frameRows };
}
