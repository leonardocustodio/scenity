<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/** Progress (Reka UI, role="progressbar") with an accessible name. Null value: the progress is unknown. */
import { ProgressIndicator, ProgressRoot } from "reka-ui";
import { computed } from "vue";
import { cn, type ClassValue } from "../lib/cn";

defineOptions({ name: "ScProgress" });

const props = withDefaults(
  defineProps<{ value: number | null; max?: number; label: string; class?: ClassValue | undefined }>(),
  { class: undefined, max: 100 },
);
const percent = computed(() =>
  props.value === null ? 0 : Math.min(100, Math.max(0, (props.value / props.max) * 100)),
);
</script>

<template>
  <ProgressRoot
    :model-value="props.value"
    :max="props.max"
    :aria-label="props.label"
    :class="
      cn('relative h-2 w-full overflow-hidden rounded-pill border border-border-strong bg-surface-sunken', props.class)
    "
  >
    <ProgressIndicator
      class="h-full bg-accent-brand transition-transform duration-base ease-standard"
      :style="{ transform: `translateX(-${String(100 - percent)}%)` }"
    />
  </ProgressRoot>
</template>
