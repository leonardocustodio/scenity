<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The content of the Scene view panel. The view element of the page (the canvas and the parts over it) moves into the
 * panel and stays the same element. The places of the overlays of the view go into
 * the state of the panel, so the layout keeps them after a restart.
 */
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { usePanelState } from "../../studio/shell/panelState";
import { pageOverlays } from "./overlays";

const props = defineProps<{ element: HTMLElement }>();
const root = ref<HTMLDivElement | null>(null);
const places = usePanelState<unknown>("overlays", {});
let stop: (() => void) | null = null;

onMounted(() => {
  root.value?.append(props.element);
});

watch(
  pageOverlays,
  (dock) => {
    stop?.();
    stop = null;
    if (dock === null) return;
    dock.load(places.value);
    stop = dock.onChange((next) => {
      places.value = next;
    });
  },
  { immediate: true },
);

onBeforeUnmount(() => stop?.());
</script>

<template>
  <div ref="root" class="studio-adopt" />
</template>
