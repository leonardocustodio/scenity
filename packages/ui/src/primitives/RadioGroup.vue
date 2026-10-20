<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * RadioGroup (Reka UI): one choice of a list. Each item has a visible label. Give the group a name.
 * The label fills the height of its row, so the radio and its label are one target: 24 px high, and
 * 44 px high on a coarse pointer (the target sizes).
 */
import { RadioGroupIndicator, RadioGroupItem, RadioGroupRoot } from "reka-ui";
import { useId } from "vue";
import { cn, type ClassValue } from "../lib/cn";
import Label from "./Label.vue";

export interface RadioOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

const value = defineModel<string>({ default: "" });
const props = withDefaults(
  defineProps<{
    options: readonly RadioOption[];
    disabled?: boolean;
    orientation?: "vertical" | "horizontal";
    class?: ClassValue | undefined;
  }>(),
  { class: undefined, disabled: false, orientation: "vertical" },
);
const base = useId();
</script>

<template>
  <RadioGroupRoot
    v-model="value"
    :disabled="props.disabled"
    :orientation="props.orientation"
    :class="cn('flex gap-2', props.orientation === 'vertical' ? 'flex-col' : 'flex-row flex-wrap', props.class)"
  >
    <div
      v-for="option in props.options"
      :key="option.value"
      class="flex min-h-target-min items-center gap-2 pointer-coarse:min-h-target-touch"
    >
      <RadioGroupItem
        :id="`${base}-${option.value}`"
        :value="option.value"
        :disabled="option.disabled === true"
        class="peer inline-flex size-6 shrink-0 items-center justify-center rounded-pill border-2 border-border-strong bg-surface-raised data-[state=checked]:border-accent-brand disabled:cursor-not-allowed disabled:opacity-(--sc-opacity-disabled)"
      >
        <RadioGroupIndicator class="sc-radio-dot block size-3 rounded-pill bg-accent-brand" />
      </RadioGroupItem>
      <!-- eslint-disable-next-line vuejs-accessibility/label-has-for -- "for" names the radio button of this row. -->
      <Label :for="`${base}-${option.value}`" class="flex items-center self-stretch">{{ option.label }}</Label>
    </div>
  </RadioGroupRoot>
</template>
