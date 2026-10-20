<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The hover preview of the time line: the frame of the frame index at the time under the pointer, its time and its
 * metric values. The frame is a 160 px tile at the nearest step of 100 ms. A frame of an older content hash shows with
 * a "stale" mark until the indexer replaces it. The tile shows nothing when the index has no frame near the time.
 * `data-ms` is the time from the pointer to the picture.
 *
 * The texts are Fluent messages of `src/i18n/en-US/lab-core.ftl`. A metric line (member, metric, value) is a data
 * value.
 */
import { useI18n } from "@scenity/i18n";
import { metricsList } from "@scenity/labs-platform/indexRead";
import { computed, ref, watch } from "vue";
import { useInjectedLabIndex } from "./index/useLabIndex";

const props = defineProps<{
  /** The time under the pointer (ms), or null when the pointer is not over the track. */
  readonly at: number | null;
  /** The place of the tile over the track (a CSS length). */
  readonly left: string;
}>();
const { $t } = useI18n();

const index = useInjectedLabIndex();
const url = ref<string | null>(null);
const shown = ref<{ timeMs: number; stale: boolean; metrics: string[] } | null>(null);
const elapsed = ref<number | null>(null);
let ticket = 0;

/** At most this many metric values in the tile. */
const MAX_METRICS = 4;

function metricText(record: Readonly<Record<string, number>> | null): string[] {
  return metricsList(record)
    .slice(0, MAX_METRICS)
    .map((item) => `${item.member} ${item.metric} ${item.value.toFixed(3)}${item.unit === "" ? "" : ` ${item.unit}`}`);
}

watch(
  () => props.at,
  async (at) => {
    const own = ++ticket;
    if (at === null || index === null) {
      shown.value = null;
      return;
    }
    const start = performance.now();
    const found = index.lookup(at);
    if (found === null) {
      shown.value = null;
      return;
    }
    const picture = await index.picture(found.frame);
    if (own !== ticket) return;
    url.value = picture;
    elapsed.value = performance.now() - start;
    shown.value = { timeMs: found.frame.timeMs, stale: found.stale, metrics: metricText(found.frame.metrics) };
  },
);

const seconds = computed(() => (shown.value === null ? "" : `${(shown.value.timeMs / 1000).toFixed(1)} s`));
</script>

<template>
  <div
    v-if="shown !== null && url !== null"
    class="pointer-events-none absolute bottom-full z-20 mb-2 w-40 -translate-x-1/2 overflow-hidden rounded-control border border-border-subtle bg-surface-overlay text-caption shadow-overlay"
    :style="{ left }"
    data-testid="lab-timeline-preview"
    :data-at="shown.timeMs"
    :data-stale="shown.stale ? 'true' : 'false'"
    :data-ms="elapsed === null ? undefined : elapsed.toFixed(1)"
  >
    <img :src="url" alt="" class="block aspect-[16/10] w-full" />
    <div class="flex items-center justify-between gap-1 px-1.5 py-0.5">
      <span class="font-mono tabular-nums" translate="no">{{ seconds }}</span>
      <span
        v-if="shown.stale"
        class="rounded-control bg-status-caution/20 px-1 text-status-caution"
        :title="$t('lab-preview-stale-title')"
        >{{ $t("lab-overview-stale") }}</span
      >
    </div>
    <ul v-if="shown.metrics.length > 0" class="border-t border-border-subtle px-1.5 py-0.5 text-text-secondary">
      <li v-for="line in shown.metrics" :key="line" class="truncate font-mono" translate="no">{{ line }}</li>
    </ul>
  </div>
</template>
