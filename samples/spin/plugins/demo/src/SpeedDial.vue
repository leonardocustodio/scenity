<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The widget `demo.speedDial` of the demo plugin (the `widgets` point): the turn speed of `demo.spin` as a
 * slider with its value. A change is one edit of the field (one undo step), through `set`.
 */
import type { StudioContext } from "@scenity/editor/studio";
import { computed } from "vue";

const props = defineProps<{ ctx: StudioContext; value: unknown; label: string; set: (value: unknown) => void }>();
const speed = computed(() => (typeof props.value === "number" ? props.value : 90));
</script>

<template>
  <div class="flex items-center gap-1" data-testid="demo-speed-dial">
    <input
      type="range"
      min="-720"
      max="720"
      step="5"
      class="flex-1"
      :value="speed"
      :aria-label="label"
      data-testid="demo-speed-range"
      @change="set(Number(($event.target as HTMLInputElement).value))"
    />
    <span class="w-16 text-right text-text-secondary">{{ ctx.t("demo-speed", { speed }) }}</span>
  </div>
</template>
