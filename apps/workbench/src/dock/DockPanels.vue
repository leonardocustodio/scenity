<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The panels of the dock tabs Changes, Runs, Review, Sessions and Picker. The component stays mounted while a tab is
 * closed, so the output of a run and the state of the changes stay. It gives the bottom bar the count of changed files
 * and the active run (the status line).
 */
import { computed, watch } from "vue";
import Changes from "./Changes.vue";
import type { DockHost } from "./dockHost";
import Review from "./Review.vue";
import Runs from "./Runs.vue";
import Picker from "./Picker.vue";
import SessionsTabs from "./SessionsTabs.vue";
import { useRunFiles } from "./runFile";
import { useChanges } from "./useChanges";
import { runLine, useRuns } from "./useRuns";

const props = defineProps<{
  readonly dock: DockHost;
  /** The open tab of the bottom bar, or null. */
  readonly open: string | null;
  /** The panel alone in a detached window fills the window. */
  readonly fill?: boolean;
}>();

const emit = defineEmits<{
  summary: [value: { changes: number; running: string | null }];
}>();

const runs = useRuns(props.dock);
const changes = useChanges(props.dock);
const files = useRunFiles(props.dock);

/** True when the open tab is a panel of this component. */
const mine = computed(() => ["Changes", "Runs", "Review", "Sessions", "Picker"].includes(props.open ?? ""));

const running = computed(() => {
  const run = runs.running.value;
  return run === null ? null : `${runLine(run)} running`;
});
watch(
  () => ({ changes: changes.files.value.length, running: running.value }),
  (value) => emit("summary", value),
  { immediate: true },
);
</script>

<template>
  <section
    v-show="mine"
    :id="mine ? `dock-${String(open).toLowerCase()}` : undefined"
    :class="
      fill ? 'h-full min-h-0 overflow-auto px-3 py-2' : 'h-[45vh] min-h-48 border-b border-border-subtle px-3 py-2'
    "
    :aria-label="mine ? (open ?? undefined) : undefined"
    :data-testid="mine ? `dock-${String(open).toLowerCase()}` : undefined"
  >
    <Changes v-if="open === 'Changes'" :changes="changes" :runs="runs" :request="dock.request" />
    <Runs v-else-if="open === 'Runs'" :runs="runs" :files="files" />
    <Review
      v-else-if="open === 'Review'"
      :runs="runs"
      :files="files"
      :start="changes.start.value"
      :default-sequence="dock.defaultSequence?.() ?? null"
    />
    <!-- The Sessions tab also holds the background runs, the log and the settings. -->
    <SessionsTabs v-else-if="open === 'Sessions'" :dock="dock" />
    <!-- The picker. -->
    <Picker v-else-if="open === 'Picker'" :dock="dock" :files="files" />
  </section>
</template>
