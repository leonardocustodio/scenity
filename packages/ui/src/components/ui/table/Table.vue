<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * A data table in a horizontal scroll container. WCAG 1.4.10 lets a data table scroll on a narrow screen, so
 * the page itself does not scroll horizontally. With a `label`, the container becomes a named region in the
 * Tab order when the table is wider than the container, so a keyboard user can scroll it (axe rule
 * scrollable-region-focusable). When the table fits, the container adds no Tab stop. Other attributes go to
 * the container.
 */
import type { HTMLAttributes } from "vue";
import { onBeforeUnmount, onMounted, ref, useTemplateRef } from "vue";
import { cn } from "../../../lib/utils";

const props = defineProps<{
  class?: HTMLAttributes["class"];
  /** The name of the scroll region when the table is wider than its container. */
  label?: string;
}>();

const container = useTemplateRef<HTMLDivElement>("container");
const scrolls = ref(false);
let observer: ResizeObserver | null = null;

function check(): void {
  const element = container.value;
  if (element !== null) scrolls.value = element.scrollWidth > element.clientWidth + 1;
}

onMounted(() => {
  if (props.label === undefined) return;
  check();
  const element = container.value;
  if (element === null || typeof ResizeObserver === "undefined") return;
  observer = new ResizeObserver(check);
  observer.observe(element);
  if (element.firstElementChild !== null) observer.observe(element.firstElementChild);
});

onBeforeUnmount(() => {
  observer?.disconnect();
});
</script>

<template>
  <div
    ref="container"
    data-slot="table-container"
    class="relative w-full overflow-auto"
    v-bind="props.label !== undefined && scrolls ? { tabindex: 0, role: 'region', 'aria-label': props.label } : {}"
  >
    <table data-slot="table" :class="cn('w-full caption-bottom text-sm', props.class)">
      <slot />
    </table>
  </div>
</template>
