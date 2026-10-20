<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The overview strip of the time line. It shows small frames of the full track from the frame index (the frames at
 * steps of 1 s). It shows in red the times where a motion check fails (from the metrics of the index,
 * index/overviewMarks.ts). A click seeks to the time under the pointer. A frame of an older content hash has a
 * "stale" mark until the indexer replaces it. The strip shows only when the index has frames of the track.
 *
 * The texts are Fluent messages of `src/i18n/en-US/lab-core.ftl`. The check names are data values.
 */
import { useI18n } from "@scenity/i18n";
import { cn } from "@scenity/ui";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useAttrs, watch } from "vue";
import { OVERVIEW_MS } from "./index/frameInput";
import { failingMarks } from "./index/overviewMarks";
import { useInjectedLabIndex } from "./index/useLabIndex";
import { useLab } from "./labContext";

// The class of the parent places the strip (for example `absolute` over the track): it replaces the `relative` of
// the root (tailwind-merge in `cn`), so the strip never takes the place of the track in its row.
defineOptions({ inheritAttrs: false });
const attrs = useAttrs();

const props = defineProps<{
  readonly start: number;
  readonly stop: number;
}>();
const emit = defineEmits<{ seek: [ms: number] }>();
const { $t } = useI18n();

const index = useInjectedLabIndex();
const { take } = useLab();
const root = ref<HTMLElement | null>(null);
const width = ref(0);
/** The width of one tile (px; the class `w-11`): about 16:10 at the height of the strip (`h-7`). */
const TILE_WIDTH = 44;

let observer: ResizeObserver | null = null;
onMounted(() => {
  if (root.value === null || typeof ResizeObserver !== "function") return;
  observer = new ResizeObserver((entries) => {
    width.value = entries[0]?.contentRect.width ?? 0;
  });
  observer.observe(root.value);
});
onBeforeUnmount(() => observer?.disconnect());

function share(at: number): number {
  return Math.min(1, Math.max(0, (at - props.start) / Math.max(1, props.stop - props.start)));
}

/** The 1 s frames of the index in the track. */
const seconds = computed(() => {
  if (index === null) return [];
  const out = [];
  for (let at = Math.ceil(props.start / OVERVIEW_MS) * OVERVIEW_MS; at <= props.stop; at += OVERVIEW_MS) {
    const found = index.lookup(at, { maxGapMs: 0 });
    if (found !== null) out.push(found);
  }
  return out;
});

/** The tiles: as many as fit, each the 1 s frame nearest to its place. */
const tiles = computed(() => {
  const list = seconds.value;
  const count = Math.min(list.length, Math.max(1, Math.floor(width.value / TILE_WIDTH)));
  if (list.length === 0 || width.value === 0) return [];
  return Array.from({ length: count }, (_, slot) => {
    const at = props.start + ((slot + 0.5) / count) * (props.stop - props.start);
    return list.reduce((best, item) =>
      Math.abs(item.frame.timeMs - at) < Math.abs(best.frame.timeMs - at) ? item : best,
    );
  });
});

const urls = shallowRef(new Map<string, string>());
watch(
  tiles,
  async (list) => {
    if (index === null) return;
    const next = new Map<string, string>();
    for (const item of list) {
      const url = await index.picture(item.frame);
      if (url !== null) next.set(item.frame.key, url);
    }
    urls.value = next;
  },
  { immediate: true },
);

const marks = computed(() =>
  failingMarks(
    take.base.value,
    seconds.value.map((item) => ({ timeMs: item.frame.timeMs, metrics: item.frame.metrics })),
  ),
);
const staleCount = computed(() => seconds.value.filter((item) => item.stale).length);

function onClick(event: MouseEvent): void {
  const box = root.value?.getBoundingClientRect();
  if (box === undefined || box.width <= 0) return;
  const part = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
  emit("seek", Math.round(props.start + part * (props.stop - props.start)));
}
</script>

<template>
  <div
    ref="root"
    :class="
      cn(
        'relative h-7 w-full cursor-pointer overflow-hidden rounded-control bg-surface-sunken',
        attrs.class as string | undefined,
        seconds.length === 0 && 'hidden',
      )
    "
    role="button"
    tabindex="0"
    :aria-label="$t('lab-overview', { frames: String(seconds.length), failing: String(marks.length) })"
    data-testid="lab-overview"
    :data-frames="seconds.length"
    :data-stale="staleCount"
    :data-failing="marks.length"
    @click="onClick"
    @keydown.enter.prevent="emit('seek', marks[0]?.timeMs ?? start)"
  >
    <img
      v-for="item in tiles"
      :key="item.frame.key"
      :src="urls.get(item.frame.key)"
      alt=""
      :class="cn('absolute top-0 h-full w-11 -translate-x-1/2 object-cover', item.stale && 'opacity-50 grayscale')"
      :style="{ left: `${share(item.frame.timeMs) * 100}%` }"
      :data-at="item.frame.timeMs"
      data-testid="lab-overview-tile"
    />
    <span
      v-for="mark in marks"
      :key="mark.timeMs"
      class="pointer-events-none absolute inset-y-0 w-0.5 bg-status-negative"
      :style="{ left: `${share(mark.timeMs) * 100}%` }"
      :title="$t('lab-overview-fail', { seconds: (mark.timeMs / 1000).toFixed(1), checks: mark.checks.join(', ') })"
      data-testid="lab-overview-fail"
    />
    <span
      v-if="staleCount > 0"
      class="pointer-events-none absolute top-0.5 right-0.5 rounded-control bg-status-caution/30 px-1 text-caption text-status-caution"
      :title="$t('lab-overview-stale-title')"
      >{{ $t("lab-overview-stale") }}</span
    >
  </div>
</template>
