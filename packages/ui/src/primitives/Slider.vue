<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * Slider (Reka UI): arrow keys, Page Up and Page Down, Home and End change the value. Every thumb has an
 * accessible name. A drag always has the keys as an alternative (WCAG 2.5.7).
 */
import { SliderRange, SliderRoot, SliderThumb, SliderTrack } from "reka-ui";
import { cn, type ClassValue } from "../lib/cn";

defineOptions({ name: "ScSlider" });

const value = defineModel<number[]>({ default: () => [0] });
const props = withDefaults(
  defineProps<{
    label: string;
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean;
    class?: ClassValue | undefined;
  }>(),
  { class: undefined, min: 0, max: 100, step: 1, disabled: false },
);
</script>

<template>
  <SliderRoot
    v-model="value"
    :min="props.min"
    :max="props.max"
    :step="props.step"
    :disabled="props.disabled"
    :class="
      cn(
        'relative flex h-target-min w-full touch-none items-center select-none data-[disabled]:opacity-(--sc-opacity-disabled)',
        props.class,
      )
    "
  >
    <SliderTrack
      class="relative h-1.5 grow overflow-hidden rounded-pill bg-surface-sunken outline outline-1 outline-border-strong"
    >
      <SliderRange class="absolute h-full bg-accent-brand" />
    </SliderTrack>
    <SliderThumb
      v-for="(_, index) in value"
      :key="index"
      :aria-label="props.label"
      class="block size-5 rounded-pill border-2 border-accent-brand bg-surface-raised pointer-coarse:size-6"
    />
  </SliderRoot>
</template>
