<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The motion of a turn before and after: two one-row sheets of the turn window from the shadow frame. The sheets are
 * one over the other, so the owner compares the same times. The window is the window of the open item, or ±2 s
 * around the time of the turn. A sheet that is not there yet shows a note.
 */
import type { PictureRef, TurnWindow } from "@scenity/workbench-host/protocol";
import { computed } from "vue";
import PictureImg from "../layout/PictureImg.vue";

const props = defineProps<{
  readonly before: PictureRef | null;
  readonly after: PictureRef | null;
  readonly window: TurnWindow | null;
}>();

/** The ID of a sheet of the host; PictureImg.vue shows it as an object URL. */
function source(picture: PictureRef | null): string | null {
  return picture?.id ?? null;
}

/** The window in seconds, its source and its camera. */
const caption = computed(() => {
  const window = props.window;
  if (window === null) return "";
  const seconds = (ms: number): string => (ms / 1000).toFixed(2);
  const where = window.source === "item" ? "item window" : "±2 s round the turn";
  return `${seconds(window.from)}–${seconds(window.to)} s · ${where} · ${window.camera ?? "frame camera"}`;
});
const rows = computed(() => [
  { label: "Before", src: source(props.before) },
  { label: "After", src: source(props.after) },
]);
</script>

<template>
  <section
    v-if="window !== null || before !== null || after !== null"
    class="flex flex-col gap-1"
    aria-label="The motion of the turn before and after"
    data-testid="turn-sheets"
  >
    <h4 class="text-caption text-text-secondary">
      Motion <span data-testid="turn-sheets-window">{{ caption }}</span>
    </h4>
    <figure v-for="row in rows" :key="row.label" class="flex flex-col gap-0.5">
      <PictureImg
        v-if="row.src !== null"
        :picture="row.src"
        :alt="`The sheet of the turn window ${row.label.toLowerCase()} the turn`"
        class="block w-full rounded-control bg-surface-sunken"
        :data-testid="`turn-sheet-${row.label.toLowerCase()}`"
      />
      <p v-else class="rounded-control bg-surface-sunken px-2 py-1 text-caption text-text-secondary">
        No sheet yet: the shadow frame draws it.
      </p>
      <figcaption class="text-caption text-text-secondary">{{ row.label }}</figcaption>
    </figure>
  </section>
</template>
