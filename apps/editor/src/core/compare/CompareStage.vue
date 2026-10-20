<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The two pictures of the compare view: side by side, or in a wipe. In the wipe, B is above A, cut at the line of the
 * wipe: A is on the left of the line, and B is on the right. A drag on the stage or on the range under it moves the
 * line. The arrow keys on the range also move it.
 *
 * The texts are Fluent messages of `src/i18n/en-US/compare.ftl`. The take and camera names are data values.
 */
import { useI18n } from "@scenity/i18n";
import { cn } from "@scenity/ui";
import { ref } from "vue";
import type { CompareMode, StageSide } from "./sources";

const props = defineProps<{
  readonly a: StageSide;
  readonly b: StageSide;
  readonly mode: CompareMode;
}>();
/** The percentage of A in the wipe (0 to 100). */
const split = defineModel<number>("split", { required: true });
const { $t } = useI18n();
const stage = ref<HTMLElement | null>(null);
let dragging = false;

function splitAt(event: PointerEvent): void {
  const box = stage.value?.getBoundingClientRect();
  if (box === undefined || box.width <= 0) return;
  split.value = Math.round(Math.min(100, Math.max(0, ((event.clientX - box.left) / box.width) * 100)));
}

function onDown(event: PointerEvent): void {
  dragging = true;
  (event.currentTarget as Element | null)?.setPointerCapture(event.pointerId);
  splitAt(event);
}

function onMove(event: PointerEvent): void {
  if (dragging) splitAt(event);
}

const time = (side: StageSide) => (side.simMs === null ? "" : `${(side.simMs / 1000).toFixed(2)} s`);
/** The `translate` value of a label. A take name is a data value, and the label for no take is a text. */
const labelTranslate = (side: StageSide) => (side.label === $t("compare-no-take") ? undefined : "no");
</script>

<template>
  <div class="flex min-h-0 flex-col gap-2" data-testid="compare-stage" :data-mode="props.mode">
    <div v-if="props.mode === 'side'" class="grid min-h-0 grid-cols-1 gap-2 md:grid-cols-2">
      <figure v-for="(side, index) in [props.a, props.b]" :key="index" class="flex min-w-0 flex-col gap-1">
        <div class="relative grid aspect-[16/10] place-items-center overflow-hidden rounded-control bg-surface-sunken">
          <img
            v-if="side.url !== null"
            :src="side.url"
            :alt="$t('compare-frame-alt', { label: side.label, time: time(side) })"
            class="block size-full object-contain"
            :data-testid="`compare-${index === 0 ? 'a' : 'b'}`"
          />
          <p v-else class="px-3 text-caption text-text-secondary">{{ side.note ?? $t("compare-frame-loads") }}</p>
        </div>
        <figcaption class="flex gap-2 text-caption text-text-secondary">
          <span class="font-mono text-text-primary">{{ index === 0 ? "A" : "B" }}</span>
          <span :translate="labelTranslate(side)">{{ side.label }}</span>
          <span class="ml-auto font-mono">{{ time(side) }}</span>
          <span v-if="side.url !== null && side.note" class="text-status-caution">{{ side.note }}</span>
        </figcaption>
      </figure>
    </div>
    <div v-else class="flex flex-col gap-1">
      <div
        ref="stage"
        class="relative aspect-[16/10] w-full cursor-ew-resize touch-none overflow-hidden rounded-control bg-surface-sunken select-none"
        data-testid="compare-wipe"
        @pointerdown="onDown"
        @pointermove="onMove"
        @pointerup="dragging = false"
        @pointercancel="dragging = false"
      >
        <img
          v-if="props.a.url !== null"
          :src="props.a.url"
          :alt="$t('compare-alt-a', { label: props.a.label })"
          class="absolute inset-0 block size-full object-contain"
          draggable="false"
          data-testid="compare-a"
        />
        <img
          v-if="props.b.url !== null"
          :src="props.b.url"
          :alt="$t('compare-alt-b', { label: props.b.label })"
          class="absolute inset-0 block size-full object-contain"
          :style="{ clipPath: `inset(0 0 0 ${String(split)}%)` }"
          draggable="false"
          data-testid="compare-b"
        />
        <div
          class="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-text-primary shadow-overlay"
          :style="{ left: `${String(split)}%` }"
          data-testid="compare-wipe-line"
        />
        <span class="absolute top-2 left-2 rounded-pill bg-surface-overlay/85 px-2 font-mono text-caption">A</span>
        <span class="absolute top-2 right-2 rounded-pill bg-surface-overlay/85 px-2 font-mono text-caption">B</span>
      </div>
      <div class="flex items-center gap-2 text-caption text-text-secondary">
        <span :class="cn('truncate')">{{ $t("compare-wipe-a", { label: props.a.label, time: time(props.a) }) }}</span>
        <input
          v-model.number="split"
          type="range"
          min="0"
          max="100"
          class="flex-1"
          :aria-label="$t('compare-split')"
          data-testid="compare-split"
        />
        <span class="truncate">{{ $t("compare-wipe-b", { label: props.b.label, time: time(props.b) }) }}</span>
      </div>
      <p v-if="props.a.note || props.b.note" class="text-caption text-status-caution">
        {{ [props.a.note, props.b.note].filter(Boolean).join(" ") }}
      </p>
    </div>
  </div>
</template>
