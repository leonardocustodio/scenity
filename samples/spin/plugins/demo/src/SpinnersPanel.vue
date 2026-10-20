<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The panel "Spinners" of the demo plugin: each entity of the open scene with the component `demo.spin`, with its
 * speed, and Select. It reads the scene through the context and follows its changes. It never writes.
 */
import type { StudioContext } from "@scenity/editor/studio";
import { computed, onBeforeUnmount, ref } from "vue";

const props = defineProps<{ ctx: StudioContext }>();
const version = ref(0);
const stop = props.ctx.documents.listen(() => {
  version.value += 1;
});
onBeforeUnmount(stop);
const spinners = computed(() => {
  // The version of the scene: a change of the scene makes the list again.
  if (version.value < 0) return [];
  return props.ctx.documents.entities("demo.spin").map((entity) => ({
    id: entity.id,
    name: entity.name ?? entity.id,
    speed: (entity.components["demo.spin"] as { speed?: number } | undefined)?.speed ?? 90,
  }));
});
</script>

<template>
  <section class="flex flex-col gap-1 p-1.5 text-caption text-text-primary" data-testid="demo-spinners">
    <p v-if="spinners.length === 0" class="text-text-secondary">{{ ctx.t("demo-no-spinners") }}</p>
    <div v-for="spinner in spinners" :key="spinner.id" class="flex items-center gap-1" :data-entity="spinner.id">
      <span class="flex-1 truncate" translate="no">{{ spinner.name }}</span>
      <span class="text-text-secondary">{{ ctx.t("demo-speed", { speed: spinner.speed }) }}</span>
      <button
        type="button"
        class="rounded-control border border-border-subtle px-1.5 py-0.5 hover:bg-surface-raised"
        :data-testid="`demo-select-${spinner.id}`"
        @click="ctx.selection.set([spinner.id])"
      >
        {{ ctx.t("demo-select") }}
      </button>
    </div>
  </section>
</template>
