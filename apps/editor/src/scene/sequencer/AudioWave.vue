<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The waveform in the lane of an audio track: the peaks of each sound where a play key plays it (waveform.ts), in the
 * visible window of the time line. The colour is the text colour of the canvas (a token class). The canvas takes no
 * pointer events, so the keys on it stay as they are.
 */
import type { EntityDocument } from "@scenity/scene";
import type { Track } from "@scenity/scene/sequence";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { pageSoundUrl } from "../audio";
import type { TimeWindow } from "./timeWindow";
import { soundPeaks, soundSegments, type SoundPeaks } from "./waveform";

const props = defineProps<{
  readonly track: Track;
  readonly scene: EntityDocument;
  readonly duration: number;
  readonly view: TimeWindow;
}>();

const canvas = ref<HTMLCanvasElement | null>(null);
const peaks = shallowRef<ReadonlyMap<string, SoundPeaks>>(new Map());
const segments = computed(() =>
  soundSegments(props.track, props.scene, props.duration, (sound) => peaks.value.get(sound)?.ms ?? null),
);

/** Load the peaks of each sound of the track once. */
watch(
  () => [...new Set(segments.value.map((segment) => segment.sound))],
  async (sounds) => {
    for (const sound of sounds) {
      if (peaks.value.has(sound)) continue;
      const url = pageSoundUrl(sound);
      const found = url === null ? null : await soundPeaks(url);
      if (found !== null) peaks.value = new Map([...peaks.value, [sound, found]]);
    }
  },
  { immediate: true },
);

function draw(): void {
  const node = canvas.value;
  if (node === null) return;
  const width = Math.max(1, Math.round(node.clientWidth));
  const height = Math.max(1, Math.round(node.clientHeight));
  node.width = width;
  node.height = height;
  const context = node.getContext("2d");
  if (context === null) return;
  context.clearRect(0, 0, width, height);
  context.fillStyle = getComputedStyle(node).color;
  const { from, to } = props.view;
  const scale = width / Math.max(1, to - from);
  for (const segment of segments.value) {
    const sound = peaks.value.get(segment.sound);
    if (sound === undefined) continue;
    const left = Math.max(0, Math.floor((segment.from - from) * scale));
    const right = Math.min(width, Math.ceil((segment.to - from) * scale));
    for (let x = left; x < right; x += 1) {
      const t = from + x / scale - segment.from + segment.offset;
      const peak = sound.peaks[Math.floor((t / Math.max(1, sound.ms)) * sound.peaks.length)] ?? 0;
      const bar = Math.max(1, peak * height);
      context.fillRect(x, (height - bar) / 2, 1, bar);
    }
  }
}

watch([segments, peaks, () => props.view], draw, { flush: "post" });
let resize: ResizeObserver | null = null;
onMounted(() => {
  draw();
  if (canvas.value !== null) {
    resize = new ResizeObserver(draw);
    resize.observe(canvas.value);
  }
});
onBeforeUnmount(() => resize?.disconnect());
</script>

<template>
  <canvas
    ref="canvas"
    class="pointer-events-none absolute inset-0 size-full text-accent-brand/40"
    aria-hidden="true"
    :data-segments="segments.length"
    :data-loaded="peaks.size"
    data-testid="sequencer-wave"
  />
</template>
