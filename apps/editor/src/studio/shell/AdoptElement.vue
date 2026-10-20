<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * A place in the shell for a plain DOM element of the page (a region, the Scene view). The element moves into the
 * component when it mounts, and stays the same element: its state and its listeners stay.
 */
import { onMounted, ref } from "vue";

const props = defineProps<{ element: HTMLElement }>();
const root = ref<HTMLDivElement | null>(null);

onMounted(() => {
  root.value?.append(props.element);
});
</script>

<template>
  <div ref="root" class="studio-adopt" />
</template>
