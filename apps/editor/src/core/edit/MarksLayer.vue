<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The marks on the scene. While the owner marks (the clock is stopped), a drag draws a circle from its centre. A drag
 * with Shift draws an arrow to its head. The marks keep their positions as fractions of the scene (marks.ts), so
 * `lab_marks` draws them on a picture of each size. The marks show until the owner clears them. The layer gets the
 * pointer only while the owner marks.
 *
 * The layer shows no text.
 */
import { ref } from "vue";
import { MARK_COLOR, type Mark } from "./marks";

const props = defineProps<{ readonly marking: boolean }>();
const marks = defineModel<Mark[]>("marks", { required: true });

const svg = ref<SVGSVGElement | null>(null);
const draft = ref<Mark | null>(null);

function share(event: PointerEvent): readonly [number, number] {
  const box = svg.value?.getBoundingClientRect();
  if (box === undefined || box.width === 0 || box.height === 0) return [0, 0];
  const clamp = (value: number): number => Math.min(1, Math.max(0, value));
  return [clamp((event.clientX - box.left) / box.width), clamp((event.clientY - box.top) / box.height)];
}

function onDown(event: PointerEvent): void {
  if (!props.marking || event.button !== 0) return;
  event.stopPropagation();
  svg.value?.setPointerCapture(event.pointerId);
  const at = share(event);
  draft.value = { kind: event.shiftKey ? "arrow" : "circle", from: at, to: at };
}

function onMove(event: PointerEvent): void {
  if (draft.value === null) return;
  event.stopPropagation();
  draft.value = { ...draft.value, to: share(event) };
}

function onUp(event: PointerEvent): void {
  const done = draft.value;
  draft.value = null;
  if (done === null) return;
  event.stopPropagation();
  const size = Math.hypot(done.to[0] - done.from[0], done.to[1] - done.from[1]);
  // A click without a drag gives a small circle at the point.
  const mark: Mark = size < 0.005 ? { ...done, kind: "circle", to: [done.from[0] + 0.02, done.from[1]] } : done;
  marks.value = [...marks.value, mark];
}

/** The SVG units: the view box is 1000 by 1000, and the shapes stretch with the scene. */
const pct = (value: number): number => value * 1000;

/** The radius of a circle in the view box on x and on y. Thus the circle is round in the pixels of the scene. */
function radius(mark: Mark, axis: 0 | 1): number {
  const box = svg.value?.getBoundingClientRect();
  const width = box?.width ?? 1;
  const height = box?.height ?? 1;
  const pixels = Math.hypot((mark.to[0] - mark.from[0]) * width, (mark.to[1] - mark.from[1]) * height);
  return pct(pixels / (axis === 0 ? width : height));
}
</script>

<template>
  <svg
    ref="svg"
    class="absolute inset-0 z-10 size-full"
    :class="marking ? 'cursor-crosshair' : 'pointer-events-none'"
    viewBox="0 0 1000 1000"
    preserveAspectRatio="none"
    :aria-hidden="!marking"
    data-scene-control
    data-testid="lab-marks"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="draft = null"
  >
    <template v-for="(mark, index) in draft === null ? marks : [...marks, draft]" :key="index">
      <ellipse
        v-if="mark.kind === 'circle'"
        :cx="pct(mark.from[0])"
        :cy="pct(mark.from[1])"
        :rx="radius(mark, 0)"
        :ry="radius(mark, 1)"
        fill="none"
        :stroke="MARK_COLOR"
        stroke-width="4"
        vector-effect="non-scaling-stroke"
      />
      <line
        v-else
        :x1="pct(mark.from[0])"
        :y1="pct(mark.from[1])"
        :x2="pct(mark.to[0])"
        :y2="pct(mark.to[1])"
        :stroke="MARK_COLOR"
        stroke-width="4"
        stroke-linecap="round"
        marker-end="url(#lab-mark-head)"
        vector-effect="non-scaling-stroke"
      />
    </template>
    <defs>
      <marker id="lab-mark-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
        <path d="M0,0 L10,5 L0,10" fill="none" :stroke="MARK_COLOR" stroke-width="2" />
      </marker>
    </defs>
  </svg>
</template>
