<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The curve editor of the sequencer. It shows the selected track as lines over the time line when its keys hold
 * numbers (a number property, a list of numbers, or the position of a transform). It uses the scales of the metrics
 * graph of the lab (core/graph/scale.ts). A vertical drag of a key point changes the value of the key (one step at
 * the end). The time of the clock is a line, and a click on the curve seeks.
 *
 * "All curves" shows the lines of all number tracks together. Frame all fits the keys of the lines in the time line.
 * A press on a point selects its key. The ease bar sets the ease from the previous key (step, linear, in, out, in and
 * out, Bézier). A Bézier key has two tangent handles in its segment. A drag of a handle changes the curve (one step
 * at the end).
 *
 * The texts are Fluent messages of `src/i18n/en-US/sequencer.ftl`. The line label of a property track is a data value
 * (its path or its name).
 */
import { useI18n } from "@scenity/i18n";
import { EASE_NAMES, type Ease } from "@scenity/scene/sequence";
import { computed, ref, useId } from "vue";
import { xOf, yOf } from "../../core/graph/scale";
import { bezierOf, dragHandle, easeArg, easeKind, handlesOf, type Segment } from "./curveEase";
import { curveFrame, curvesOf, curveTracks, linePath, secondsText, valueAtY } from "./sequencerModel";
import { fullWindow, windowTimeAt, type TimeWindow } from "./timeWindow";
import type { SequencerState } from "./useSequencer";
import "../../core/graph/graph.css";

const { $t } = useI18n();
const props = defineProps<{ readonly state: SequencerState }>();
const { sequence, selectedTrack, selectedKey, time } = props.state;

const HEIGHT = 96;
/** The series colours of the metrics graph of the lab (core/graph/graph.css). */
const COLOURS = [1, 2, 3, 4, 5].map((slot) => `var(--graph-series-${String(slot)})`);
const box = ref<SVGSVGElement | null>(null);
const width = ref(600);
const all = ref(false);
const allId = useId();
const view = ref<TimeWindow | null>(null);
const shownWindow = computed(() => view.value ?? fullWindow(sequence.value.duration));
const curve = computed(() =>
  curvesOf(
    sequence.value,
    all.value ? curveTracks(sequence.value) : selectedTrack.value === null ? [] : [selectedTrack.value],
  ),
);
const frame = computed(() =>
  curve.value === null ? null : curveFrame(curve.value, shownWindow.value, width.value, HEIGHT),
);
/** The point of a drag and its current value. */
const dragging = ref<{ line: number; key: number; value: number } | null>(null);

function measure(): void {
  width.value = Math.max(1, box.value?.getBoundingClientRect().width ?? width.value);
}

function pointY(line: number, key: number, value: number): number {
  const shown = dragging.value?.line === line && dragging.value.key === key ? dragging.value.value : value;
  return frame.value === null ? 0 : yOf(frame.value, shown);
}

function local(event: PointerEvent): { x: number; y: number } {
  const rect = box.value?.getBoundingClientRect();
  return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
}

/** A drag with the pointer capture: `move` at each move, `end` at the release. */
function capture(event: PointerEvent, move: (next: PointerEvent) => void, end: () => void): void {
  event.stopPropagation();
  const target = event.currentTarget as SVGElement;
  target.setPointerCapture(event.pointerId);
  const onUp = (): void => {
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", onUp);
    end();
  };
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", onUp);
}

function onPoint(event: PointerEvent, line: number, key: number, value: number): void {
  const shape = curve.value?.lines[line];
  if (event.button !== 0 || frame.value === null || shape === undefined) return;
  selectedTrack.value = shape.track;
  selectedKey.value = { track: shape.track, key };
  dragging.value = { line, key, value };
  capture(
    event,
    (next) => {
      if (frame.value !== null) dragging.value = { line, key, value: valueAtY(frame.value, local(next).y) };
    },
    () => {
      const done = dragging.value;
      dragging.value = null;
      if (done === null || done.value === value) return;
      void props.state.run("sequence.key.value", { track: shape.track, key, value: shape.valueWith(key, done.value) });
    },
  );
}

function onCurve(event: PointerEvent): void {
  measure();
  props.state.seek(windowTimeAt(local(event).x, width.value, shownWindow.value, sequence.value.duration));
}

/** Frame all: the time range of the keys of the lines, with a margin. */
function frameAll(): void {
  const times = curve.value?.lines.flatMap((line) => line.points.map((point) => point.t)) ?? [];
  if (times.length === 0) return;
  const low = Math.min(...times);
  const high = Math.max(...times);
  const pad = Math.max(50, (high - low) * 0.05);
  view.value = { from: Math.max(0, low - pad), to: Math.min(sequence.value.duration, high + pad) };
}

/** The selected key on a line of the curve: its line, its ease and its segment from the previous key. */
const selection = computed(() => {
  const ref = selectedKey.value;
  if (ref === null || curve.value === null) return null;
  const line = curve.value.lines.findIndex((item) => item.track === ref.track);
  const shape = curve.value.lines[line];
  const at = shape?.points.findIndex((point) => point.key === ref.key) ?? -1;
  const point = shape?.points[at];
  const before = shape?.points[at - 1];
  if (shape === undefined || point === undefined) return null;
  const ease = (sequence.value.tracks[ref.track]?.keys[ref.key] as { ease?: Ease } | undefined)?.ease;
  const segment: Segment | null =
    before === undefined ? null : { t0: before.t, v0: before.value, t1: point.t, v1: point.value };
  return { ref, line, ease, segment };
});
const kind = computed(() => easeKind(selection.value?.ease));
const EASES = [...EASE_NAMES, "bezier"] as const;

function setEase(name: (typeof EASES)[number]): void {
  const now = selection.value;
  if (now === null) return;
  const ease = name === "bezier" ? { bezier: bezierOf(now.ease) ?? [0.42, 0, 0.58, 1] } : name;
  void props.state.run("sequence.key.value", { ...now.ref, ease: easeArg(ease) });
}

/** The tangent handles of a Bézier key, with the Bézier of the current drag. */
const handleDrag = ref<[number, number, number, number] | null>(null);
const handles = computed(() => {
  const now = selection.value;
  if (now?.segment == null || kind.value !== "bezier") return [];
  const bezier = handleDrag.value ?? bezierOf(now.ease) ?? [0, 0, 1, 1];
  return handlesOf(now.segment, bezier).map((handle, which) => ({ ...handle, which: which as 0 | 1, bezier }));
});

function onHandle(event: PointerEvent, which: 0 | 1, bezier: readonly number[]): void {
  const now = selection.value;
  const segment = now?.segment ?? null;
  if (event.button !== 0 || frame.value === null || now === null || segment === null) return;
  capture(
    event,
    (next) => {
      if (frame.value === null) return;
      const at = local(next);
      const t = windowTimeAt(at.x, width.value, shownWindow.value, sequence.value.duration);
      handleDrag.value = dragHandle(segment, handleDrag.value ?? bezier, which, t, valueAtY(frame.value, at.y)).bezier;
    },
    () => {
      const done = handleDrag.value;
      handleDrag.value = null;
      if (done !== null) void props.state.run("sequence.key.value", { ...now.ref, ease: easeArg({ bezier: done }) });
    },
  );
}
</script>

<template>
  <div
    v-if="curve !== null && frame !== null"
    class="lab-metrics-graph shrink-0"
    data-testid="sequencer-curve"
    :data-from="shownWindow.from"
    :data-to="shownWindow.to"
  >
    <div class="flex flex-wrap items-center gap-2 text-text-secondary">
      <span
        v-for="(line, index) in curve.lines"
        :key="`${line.track}-${line.label}`"
        :style="{ color: COLOURS[index % COLOURS.length] }"
        translate="no"
      >
        {{ line.label }}
      </span>
      <span class="ml-auto">{{ $t("sequencer-curve-range", { min: String(curve.min), max: String(curve.max) }) }}</span>
      <label class="flex items-center gap-1" :for="allId">
        <input :id="allId" v-model="all" type="checkbox" data-testid="sequencer-curve-all" />
        {{ $t("sequencer-curve-all") }}
      </label>
      <button type="button" class="underline" data-testid="sequencer-curve-frame" @click="frameAll">
        {{ $t("sequencer-curve-frame") }}
      </button>
      <button type="button" class="underline" data-testid="sequencer-curve-full" @click="view = null">
        {{ $t("sequencer-zoom-fit-short") }}
      </button>
    </div>
    <div
      v-if="selection !== null && selection.segment !== null"
      class="flex flex-wrap items-center gap-1"
      role="group"
      :aria-label="$t('sequencer-curve-ease')"
      data-testid="sequencer-ease-bar"
      :data-ease="kind"
    >
      <span class="text-text-secondary">{{ $t("sequencer-curve-ease") }}</span>
      <button
        v-for="name in EASES"
        :key="name"
        type="button"
        :class="[
          'rounded-control border px-1.5',
          kind === name ? 'border-accent-brand text-accent-brand' : 'border-border-subtle',
        ]"
        :aria-pressed="kind === name"
        :data-testid="`sequencer-ease-${name}`"
        @click="setEase(name)"
      >
        {{ $t(`sequencer-ease-${name}`) }}
      </button>
    </div>
    <svg
      ref="box"
      class="block w-full cursor-crosshair rounded-control bg-surface-sunken"
      :height="HEIGHT"
      :viewBox="`0 0 ${width} ${HEIGHT}`"
      preserveAspectRatio="none"
      @pointerenter="measure"
      @pointerdown="onCurve"
    >
      <line :x1="xOf(frame, time)" :x2="xOf(frame, time)" y1="0" :y2="HEIGHT" stroke="currentColor" opacity="0.4" />
      <path
        v-for="(line, index) in curve.lines"
        :key="`path-${line.track}-${line.label}`"
        :d="linePath(frame, curve.samples, line.values)"
        fill="none"
        :stroke="COLOURS[index % COLOURS.length]"
        stroke-width="1.5"
      />
      <template v-for="(line, index) in curve.lines" :key="`points-${line.track}-${line.label}`">
        <circle
          v-for="point in line.points"
          :key="point.key"
          :cx="xOf(frame, point.t)"
          :cy="pointY(index, point.key, point.value)"
          r="4"
          :fill="COLOURS[index % COLOURS.length]"
          :stroke="selectedKey?.track === line.track && selectedKey.key === point.key ? 'currentColor' : 'none'"
          class="cursor-ns-resize"
          :data-testid="`sequencer-curve-key-${index}-${point.key}`"
          @pointerdown="onPoint($event, index, point.key, point.value)"
        >
          <title>
            {{
              $t("sequencer-curve-point", {
                line: line.label,
                value: String(point.value),
                time: secondsText(point.t),
              })
            }}
          </title>
        </circle>
      </template>
      <template v-if="selection !== null && selection.segment !== null">
        <template v-for="handle in handles" :key="handle.which">
          <line
            :x1="xOf(frame, handle.which === 0 ? selection.segment.t0 : selection.segment.t1)"
            :y1="yOf(frame, handle.which === 0 ? selection.segment.v0 : selection.segment.v1)"
            :x2="xOf(frame, handle.t)"
            :y2="yOf(frame, handle.v)"
            stroke="currentColor"
            opacity="0.6"
          />
          <rect
            :x="xOf(frame, handle.t) - 3.5"
            :y="yOf(frame, handle.v) - 3.5"
            width="7"
            height="7"
            fill="currentColor"
            class="cursor-move"
            :data-testid="`sequencer-ease-handle-${handle.which}`"
            @pointerdown="onHandle($event, handle.which, handle.bezier)"
          />
        </template>
      </template>
    </svg>
  </div>
</template>
