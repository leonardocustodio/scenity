<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The metrics graph: the motion metrics of a take across its span. It has one lane for each metric and one line for
 * each member. The limits of the checks of the plugin show as bands (pass, known gap, fail) and dashed lines. The time
 * of the clock shows as a cursor. A click seeks the clock to the nearest sample. The pointer shows the values at its
 * time. The arrow keys move 100 ms (with Shift: 1 s). The table under the lanes gives the worst value of each check,
 * and a press on its time seeks to that time. The canvas draws only when the data or the width changes. The cursor and
 * the hover line are elements, so a seek or a hover does not draw the canvas again. `data-draw-ms` is the time of the
 * last draw.
 *
 * The texts are Fluent messages of `src/i18n/en-US/graph.ftl`. The metric names, the units, the member IDs and the
 * check names are data values.
 */
import { useI18n } from "@scenity/i18n";
import { cn } from "@scenity/ui";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { clockText } from "../labUi";
import { drawLane, graphColors } from "./draw";
import type { GraphData } from "./graphData";
import { graphModel, LANE_HEIGHT, type GraphLane, type GraphModel, type LaneVerdict } from "./lanes";
import { seekTimeAt, ticksOf, timeOf, valuesAt, valueText, xOf } from "./scale";
import { memberOrder } from "../checks";
import { colorSlot } from "./series";
import "./graph.css";

const props = withDefaults(
  defineProps<{
    readonly data: GraphData | null;
    /** The time of the clock (ms): the cursor. */
    readonly time: number;
    readonly loading?: boolean;
    /** The width before the first measurement of the element (a test without layout). */
    readonly initialWidth?: number;
  }>(),
  { loading: false, initialWidth: 640 },
);
const emit = defineEmits<{ seek: [ms: number] }>();
const { $t } = useI18n();

const root = ref<HTMLElement | null>(null);
const lanesBox = ref<HTMLElement | null>(null);
const width = ref(props.initialWidth);
const canvases = new Map<number, HTMLCanvasElement>();
const model = shallowRef<GraphModel | null>(null);
/** The time of the last build and draw of the lanes (ms). */
const drawMs = ref<number | null>(null);
const hover = ref<{ lane: number; x: number; time: number } | null>(null);

function canvasRef(index: number) {
  return (element: unknown) => {
    if (element instanceof HTMLCanvasElement) canvases.set(index, element);
    else canvases.delete(index);
  };
}

/** Build the lanes and draw each canvas; keep the time of both. */
async function redraw(): Promise<void> {
  const data = props.data;
  const start = performance.now();
  model.value = data === null ? null : graphModel(data.take, data.samples, data.span, width.value);
  await nextTick();
  const element = root.value;
  const lanes = model.value?.lanes ?? [];
  if (element !== null && lanes.length > 0) {
    const colors = graphColors(element);
    const ratio = globalThis.devicePixelRatio || 1;
    lanes.forEach((lane, index) => {
      const canvas = canvases.get(index);
      const context = canvas?.getContext("2d") ?? null;
      if (canvas === undefined || context === null) return;
      canvas.width = Math.round(width.value * ratio);
      canvas.height = Math.round(LANE_HEIGHT * ratio);
      drawLane({ context, width: width.value, height: LANE_HEIGHT, ratio, ...lane, colors });
    });
  }
  drawMs.value = performance.now() - start;
}

watch(
  () => [props.data, width.value] as const,
  () => void redraw(),
  { immediate: true },
);

let observer: ResizeObserver | null = null;
onMounted(() => {
  const box = lanesBox.value;
  if (box === null || typeof ResizeObserver === "undefined") return;
  observer = new ResizeObserver((entries) => {
    const next = Math.round(entries[0]?.contentRect.width ?? 0);
    if (next > 0 && next !== width.value) width.value = next;
  });
  observer.observe(box);
});
onBeforeUnmount(() => observer?.disconnect());

const lanes = computed<readonly GraphLane[]>(() => model.value?.lanes ?? []);
const firstFrame = computed(() => lanes.value[0]?.frame ?? null);
/** The cursor in px from the left of the lanes, or null outside the span. */
const cursorX = computed(() => {
  const frame = firstFrame.value;
  if (frame === null || props.time < frame.t0 || props.time > frame.t1) return null;
  return xOf(frame, props.time);
});
const timeTicks = computed(() => {
  const frame = firstFrame.value;
  if (frame === null) return [];
  const count = Math.max(2, Math.floor((frame.x1 - frame.x0) / 70));
  return ticksOf(frame.t0 / 1000, frame.t1 / 1000, count).map((seconds) => ({
    seconds,
    x: xOf(frame, seconds * 1000),
  }));
});
const members = computed(() => {
  const seen = new Set<string | null>();
  for (const lane of lanes.value) for (const line of lane.series.lines) seen.add(line.member);
  return [...seen].sort((a, b) => colorSlot(a) - colorSlot(b) || String(a).localeCompare(String(b)));
});
const tip = computed(() => {
  const state = hover.value;
  const lane = state === null ? undefined : lanes.value[state.lane];
  if (state === null || lane === undefined) return null;
  const at = valuesAt(lane.series, state.time);
  if (at === null) return null;
  return { lane, x: state.x, at: at.at, values: at.values };
});

function pointerX(event: MouseEvent): number {
  const box = lanesBox.value?.getBoundingClientRect();
  return event.clientX - (box?.left ?? 0);
}

function laneOf(event: Event): number {
  const lane = event.target instanceof Element ? event.target.closest("[data-lane]") : null;
  return Number(lane?.getAttribute("data-lane") ?? 0);
}

/** A position on the lanes in px as a fraction of their width (the CSS of a position). */
function share(x: number): string {
  return `${String((x / Math.max(1, width.value)) * 100)}%`;
}

function onMove(event: PointerEvent): void {
  const frame = firstFrame.value;
  if (frame === null) return;
  const x = Math.min(frame.x1, Math.max(frame.x0, pointerX(event)));
  hover.value = { lane: laneOf(event), x, time: timeOf(frame, x) };
}

function onClick(event: MouseEvent): void {
  const frame = firstFrame.value;
  const lane = lanes.value[laneOf(event)];
  if (frame === null || lane === undefined) return;
  emit("seek", seekTimeAt(frame, pointerX(event), lane.series.times));
}

function onKey(event: KeyboardEvent): void {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  const step = (event.shiftKey ? 1000 : 100) * (event.key === "ArrowLeft" ? -1 : 1);
  const span = model.value?.span ?? [0, 0];
  emit("seek", Math.min(span[1], Math.max(span[0], Math.round(props.time / 100) * 100 + step)));
}

/** The message ID and the classes of the verdict of a lane. */
const VERDICT: Readonly<Record<LaneVerdict, { text: string; class: string } | null>> = {
  fail: { text: "graph-verdict-fail", class: "bg-status-negative-subtle text-status-negative" },
  known: { text: "graph-verdict-known", class: "bg-status-caution-subtle text-status-caution" },
  pass: { text: "graph-verdict-pass", class: "bg-status-positive-subtle text-status-positive" },
  none: null,
};
const swatch = (member: string | null) => `var(--graph-series-${String(colorSlot(member))})`;
const sourceText = computed(() => {
  const data = props.data;
  if (data === null) return "";
  // The numbers go into the message as strings, so the text shows them without digit groups.
  const count = String(data.samples.length);
  return $t("graph-source", { count, source: data.source, ms: data.loadMs.toFixed(0) });
});
defineExpose({ redraw, drawMs, MEMBER_ORDER: memberOrder() });
</script>

<template>
  <div
    ref="root"
    class="lab-metrics-graph flex min-w-0 flex-col gap-2 text-caption"
    :data-draw-ms="drawMs === null ? undefined : drawMs.toFixed(1)"
    :data-lanes="lanes.length"
    data-testid="metrics-graph"
  >
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-text-secondary">
      <span v-if="loading" role="status">{{ $t("graph-measuring") }}</span>
      <span v-else-if="data?.error" class="text-status-negative" role="alert">{{ data.error }}</span>
      <span v-else data-testid="metrics-graph-source">{{ sourceText }}</span>
      <span v-if="drawMs !== null && lanes.length > 0" class="font-mono">
        {{ $t("graph-drawn", { ms: drawMs.toFixed(1) }) }}
      </span>
      <ul class="ml-auto flex flex-wrap items-center gap-x-2.5" :aria-label="$t('graph-legend')">
        <li v-for="member in members" :key="String(member)" class="inline-flex items-center gap-1">
          <span
            class="inline-block h-0.5 w-3 rounded-pill"
            :style="{ background: swatch(member) }"
            aria-hidden="true"
          />
          <span v-if="member !== null" translate="no">{{ member }}</span>
          <template v-else>{{ $t("graph-scene") }}</template>
        </li>
        <li class="inline-flex items-center gap-1">
          <span class="lab-metrics-graph__band size-2.5 rounded-sm" data-kind="pass" aria-hidden="true" />{{
            $t("graph-verdict-pass")
          }}
        </li>
        <li class="inline-flex items-center gap-1">
          <span class="lab-metrics-graph__band size-2.5 rounded-sm" data-kind="known" aria-hidden="true" />{{
            $t("graph-verdict-known")
          }}
        </li>
        <li class="inline-flex items-center gap-1">
          <span class="lab-metrics-graph__band size-2.5 rounded-sm" data-kind="fail" aria-hidden="true" />{{
            $t("graph-verdict-fail")
          }}
        </li>
      </ul>
    </div>
    <p v-if="!loading && data !== null && lanes.length === 0 && !data.error" class="text-text-secondary">
      {{ $t("graph-empty") }}
    </p>
    <div
      ref="lanesBox"
      class="relative flex min-w-0 cursor-crosshair flex-col outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      tabindex="0"
      role="slider"
      :aria-label="$t('graph-lanes')"
      :aria-valuemin="model?.span[0] ?? 0"
      :aria-valuemax="model?.span[1] ?? 0"
      :aria-valuenow="Math.round(time)"
      :aria-valuetext="`${(time / 1000).toFixed(1)} s`"
      data-testid="metrics-graph-lanes"
      @pointermove="onMove"
      @pointerleave="hover = null"
      @click="onClick"
      @keydown="onKey"
    >
      <div v-for="(lane, index) in lanes" :key="lane.series.metric" :data-lane="index" class="relative flex flex-col">
        <div class="flex items-center gap-1.5 pl-1">
          <span class="font-mono text-text-primary" translate="no">{{ lane.series.metric }}</span>
          <span class="text-text-secondary" translate="no">{{ lane.series.unit }}</span>
          <span
            v-if="VERDICT[lane.verdict] !== null"
            :class="cn('rounded-pill px-1.5', VERDICT[lane.verdict]?.class)"
            :data-testid="`metrics-graph-verdict-${lane.series.metric}`"
            >{{ $t(VERDICT[lane.verdict]?.text ?? "graph-verdict-pass") }}</span
          >
        </div>
        <canvas
          :ref="canvasRef(index)"
          class="block h-16 w-full"
          role="img"
          :aria-label="$t('graph-lane', { metric: lane.series.metric, count: String(lane.series.lines.length) })"
          :data-testid="`metrics-graph-lane-${lane.series.metric}`"
        />
        <div
          v-if="tip !== null && hover?.lane === index"
          class="pointer-events-none absolute top-0 z-10 flex flex-col gap-0.5 rounded-control border border-border-subtle bg-surface-overlay px-2 py-1 font-mono shadow-overlay"
          :style="{ left: share(Math.max(0, Math.min(tip.x + 10, width - 180))) }"
          data-testid="metrics-graph-tip"
        >
          <span class="text-text-secondary">
            {{ $t("graph-tip-at", { metric: tip.lane.series.metric, seconds: (tip.at / 1000).toFixed(2) }) }}
          </span>
          <span v-for="item in tip.values" :key="String(item.member)" class="inline-flex items-center gap-1.5">
            <span class="inline-block h-0.5 w-3 rounded-pill" :style="{ background: swatch(item.member) }" />
            <span v-if="item.member !== null" translate="no">
              {{ item.member }} {{ valueText(item.value, tip.lane.series.unit) }}
            </span>
            <template v-else>
              {{ $t("graph-tip-scene", { value: valueText(item.value, tip.lane.series.unit) }) }}
            </template>
          </span>
        </div>
      </div>
      <div
        v-if="cursorX !== null"
        class="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-accent-brand"
        :style="{ left: share(cursorX) }"
        data-testid="metrics-graph-cursor"
      />
      <div
        v-if="hover !== null"
        class="pointer-events-none absolute inset-y-0 w-px bg-text-secondary/60"
        :style="{ left: share(hover.x) }"
        aria-hidden="true"
      />
      <div v-if="lanes.length > 0" class="relative h-4 text-text-secondary" aria-hidden="true">
        <span
          v-for="tick in timeTicks"
          :key="tick.seconds"
          class="absolute -translate-x-1/2 font-mono"
          :style="{ left: share(tick.x) }"
          >{{ clockText(tick.seconds * 1000) }}</span
        >
      </div>
    </div>
    <table v-if="model?.report" class="w-full font-mono" data-testid="metrics-graph-table">
      <caption class="text-left text-text-secondary">
        {{
          $t("graph-table")
        }}
      </caption>
      <thead class="text-text-secondary">
        <tr>
          <th class="text-left font-normal">{{ $t("graph-table-check") }}</th>
          <th class="text-right font-normal">{{ $t("graph-table-worst") }}</th>
          <th class="text-right font-normal">{{ $t("graph-table-limit") }}</th>
          <th class="text-right font-normal">{{ $t("graph-table-at") }}</th>
          <th class="text-right font-normal">{{ $t("graph-table-state") }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in model.report.worst" :key="row.check + row.limit">
          <td class="truncate pr-2" :title="row.known ?? row.check" translate="no">{{ row.check }}</td>
          <td class="text-right">{{ row.value === null ? "—" : row.value.toFixed(3) }}</td>
          <td class="text-right" translate="no">{{ row.limit }}</td>
          <td class="text-right">
            <button v-if="row.at !== null" type="button" class="underline" @click="emit('seek', row.at ?? 0)">
              {{ ((row.at ?? 0) / 1000).toFixed(1) }} s
            </button>
          </td>
          <td
            :class="
              cn(
                'text-right',
                row.pass ? 'text-status-positive' : row.known ? 'text-status-caution' : 'text-status-negative',
              )
            "
          >
            {{ row.pass ? $t("graph-state-pass") : row.known ? $t("graph-state-known") : $t("graph-state-fail") }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
