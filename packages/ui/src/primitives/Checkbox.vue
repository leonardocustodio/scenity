<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/** Checkbox (Reka UI) with the checked and the mixed state. Pair it with a Label through `id`. */
import { Check, Minus } from "lucide-vue-next";
import { CheckboxIndicator, CheckboxRoot } from "reka-ui";
import { cn, type ClassValue } from "../lib/cn";

defineOptions({ name: "ScCheckbox" });

const checked = defineModel<boolean | "indeterminate">({ default: false });
const props = withDefaults(defineProps<{ disabled?: boolean; class?: ClassValue | undefined }>(), {
  class: undefined,
  disabled: false,
});
</script>

<template>
  <CheckboxRoot
    v-model="checked"
    :disabled="props.disabled"
    :class="
      cn(
        'peer inline-flex size-6 shrink-0 items-center justify-center rounded-control border-2 border-border-strong bg-surface-raised',
        'data-[state=checked]:border-accent-brand data-[state=checked]:bg-accent-brand data-[state=checked]:text-text-on-accent',
        'data-[state=indeterminate]:border-accent-brand data-[state=indeterminate]:bg-accent-brand data-[state=indeterminate]:text-text-on-accent',
        'disabled:cursor-not-allowed disabled:opacity-(--sc-opacity-disabled) aria-[invalid=true]:border-status-attention',
        props.class,
      )
    "
  >
    <CheckboxIndicator class="flex items-center justify-center">
      <Minus v-if="checked === 'indeterminate'" class="size-4" aria-hidden="true" />
      <Check v-else class="size-4" aria-hidden="true" />
    </CheckboxIndicator>
  </CheckboxRoot>
</template>
