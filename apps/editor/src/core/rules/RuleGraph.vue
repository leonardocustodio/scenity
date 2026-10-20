<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The metric graph of a rule over time. It shows the value of the rule over the sequence time as a line, and the limit
 * as a pass band and dashed lines. It also shows the markers of the sequence, the times of the rule scope as check
 * points (coloured by their result) and the time of the clock as a cursor. A click seeks to the nearest sample. It
 * uses the scales and the colours of the metrics graph of the lab (core/graph/scale.ts, graph.css). The curve editor
 * of the sequencer uses them too.
 *
 * The texts are Fluent messages of `src/i18n/en-US/rules.ftl`. The rule ID, the unit and the marker names show
 * in elements with `translate="no"`.
 */
import { useI18n } from "@scenity/i18n";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { seekTimeAt, ticksOf, xOf, yOf } from "../graph/scale";
import { seriesFrame, seriesPath, type RuleSeries } from "./ruleSeries";
import "../graph/graph.css";

const props = withDefaults(
  defineProps<{
    readonly series: RuleSeries | null;
    /** The time of the clock (ms): the cursor. */
    readonly time?: number | null;
    readonly loading?: boolean;
    readonly error?: string | null;
  }>(),
  { time: null, loading: false, error: null },
);
const emit = defineEmits<{ seek: [ms: number] }>();

const { $t } = useI18n();
const HEIGHT = 120;
const box = ref<SVGSVGElement | null>(null);
const width = ref(480);
let observer: ResizeObserver | null = null;
onMounted(() => {
  if (box.value === null || typeof ResizeObserver === "undefined") return;
  observer = new ResizeObserver((entries) => {
    const next = Math.round(entries[0]?.contentRect.width ?? 0);
    if (next > 0) width.value = next;
  });
  observer.observe(box.value);
});
onBeforeUnmount(() => observer?.disconnect());

const frame = computed(() => (props.series === null ? null : seriesFrame(props.series, width.value, HEIGHT)));
const x = (t: number): number => (frame.value === null ? 0 : xOf(frame.value, t));
const y = (v: number): number => (frame.value === null ? 0 : yOf(frame.value, v));
const path = computed(() => (props.series === null ? "" : seriesPath(props.series.points, x, y)));
const ticks = computed(() => (frame.value === null ? [] : ticksOf(frame.value.v0, frame.value.v1, 3)));
/** The pass band: the values inside the limit, clamped to the plot. */
const band = computed(() => {
  const f = frame.value;
  const limit = props.series?.limit ?? null;
  if (f === null || limit === null) return null;
  const top = y(Math.min(f.v1, limit.max ?? f.v1));
  const bottom = y(Math.max(f.v0, limit.min ?? f.v0));
  return { top, height: Math.max(0, bottom - top) };
});
const limits = computed(() => {
  const limit = props.series?.limit ?? null;
  return [limit?.min, limit?.max].filter((value): value is number => value !== undefined);
});
const COLOUR: Readonly<Record<string, string>> = {
  pass: "var(--sc-color-status-positive)",
  known: "var(--sc-color-status-caution)",
  fail: "var(--sc-color-status-negative)",
  error: "var(--sc-color-status-negative)",
};

/** The sample times of the line and of the checks, in order. */
const times = computed(() =>
  props.series === null
    ? []
    : [...props.series.points, ...props.series.checks].map((point) => point.t).sort((a, b) => a - b),
);

function onClick(event: MouseEvent): void {
  const f = frame.value;
  if (f === null || box.value === null) return;
  emit("seek", seekTimeAt(f, event.clientX - box.value.getBoundingClientRect().left, times.value));
}

/** The arrow keys seek to the sample before or after the time of the clock. */
function onKey(event: KeyboardEvent): void {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  const now = props.time ?? 0;
  const next = event.key === "ArrowLeft" ? times.value.filter((t) => t < now).at(-1) : times.value.find((t) => t > now);
  if (next !== undefined) emit("seek", next);
}
</script>

<template>
  <div class="lab-metrics-graph flex min-w-0 flex-col gap-1 text-caption" data-testid="rule-graph">
    <p v-if="loading" class="m-0 text-text-secondary" role="status">{{ $t("rules-graph-sampling") }}</p>
    <p v-else-if="error" class="m-0 text-status-negative" role="alert">{{ error }}</p>
    <p v-else-if="series === null" class="m-0 text-text-secondary">
      {{ $t("rules-graph-empty") }}
    </p>
    <template v-if="series !== null">
      <div class="flex items-baseline gap-2 text-text-secondary">
        <span class="font-mono text-text-primary" data-testid="rule-graph-id" translate="no">{{ series.id }}</span>
        <span translate="no">{{ series.unit ?? "" }}</span>
        <span class="ml-auto">{{ $t("rules-graph-samples", { count: series.points.length }) }}</span>
      </div>
      <svg
        ref="box"
        class="block w-full cursor-crosshair rounded-control bg-surface-sunken"
        :height="HEIGHT"
        :viewBox="`0 0 ${width} ${HEIGHT}`"
        preserveAspectRatio="none"
        tabindex="0"
        role="slider"
        :aria-label="$t('rules-graph-slider', { id: series.id })"
        aria-valuemin="0"
        :aria-valuemax="series.duration"
        :aria-valuenow="Math.round(time ?? 0)"
        :data-points="series.points.filter((point) => point.value !== null).length"
        @click="onClick"
        @keydown="onKey"
      >
        <rect
          v-if="band !== null && frame !== null"
          :x="frame.x0"
          :y="band.top"
          :width="frame.x1 - frame.x0"
          :height="band.height"
          fill="var(--graph-band-pass)"
          data-testid="rule-graph-band"
        />
        <template v-for="tick in ticks" :key="`tick-${tick}`">
          <text :x="(frame?.x0 ?? 0) - 4" :y="y(tick) + 3" text-anchor="end" font-size="9" fill="currentColor">
            {{ tick }}
          </text>
        </template>
        <line
          v-for="value in limits"
          :key="`limit-${value}`"
          :x1="frame?.x0 ?? 0"
          :x2="frame?.x1 ?? 0"
          :y1="y(value)"
          :y2="y(value)"
          stroke="var(--sc-color-status-negative)"
          stroke-dasharray="4 3"
          data-testid="rule-graph-limit"
        />
        <g
          v-for="marker in series.markers"
          :key="`marker-${marker.label}`"
          data-testid="rule-graph-marker"
          :data-marker="marker.label"
          translate="no"
        >
          <line :x1="x(marker.t)" :x2="x(marker.t)" y1="0" :y2="HEIGHT - 12" stroke="currentColor" opacity="0.35" />
          <text :x="x(marker.t) + 2" :y="HEIGHT - 2" font-size="9" fill="currentColor">{{ marker.label }}</text>
        </g>
        <path :d="path" fill="none" stroke="var(--graph-series-1)" stroke-width="1.5" data-testid="rule-graph-line" />
        <circle
          v-for="point in series.checks.filter((item) => item.value !== null)"
          :key="`check-${point.t}`"
          :cx="x(point.t)"
          :cy="y(point.value ?? 0)"
          r="3.5"
          :fill="COLOUR[point.status] ?? 'currentColor'"
          :data-status="point.status"
          data-testid="rule-graph-check"
        >
          <title>
            {{ $t("rules-graph-check", { value: String(point.value), t: String(point.t), status: point.status }) }}
          </title>
        </circle>
        <line
          v-if="time !== null && frame !== null && time >= frame.t0 && time <= frame.t1"
          :x1="x(time)"
          :x2="x(time)"
          y1="0"
          :y2="HEIGHT"
          stroke="var(--sc-color-accent-brand)"
          stroke-width="1.5"
          data-testid="rule-graph-cursor"
        />
      </svg>
    </template>
  </div>
</template>
