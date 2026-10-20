<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * Switch (Reka UI, role="switch"). Pair it with a Label through `id`. On a coarse pointer an invisible
 * ::after box makes the hit area 44 px high (the target sizes). The drawing does not change.
 */
import { SwitchRoot, SwitchThumb } from "reka-ui";
import { cn, type ClassValue } from "../lib/cn";

defineOptions({ name: "ScSwitch" });

const checked = defineModel<boolean>({ default: false });
const props = withDefaults(defineProps<{ disabled?: boolean; class?: ClassValue | undefined }>(), {
  class: undefined,
  disabled: false,
});
</script>

<template>
  <SwitchRoot
    v-model="checked"
    :disabled="props.disabled"
    :class="
      cn(
        'peer relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-pill border-2 border-border-strong bg-surface-sunken p-0.5',
        'pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-3',
        'transition-colors duration-fast ease-standard data-[state=checked]:border-accent-brand data-[state=checked]:bg-accent-brand',
        'disabled:cursor-not-allowed disabled:opacity-(--sc-opacity-disabled)',
        props.class,
      )
    "
  >
    <SwitchThumb
      class="sc-switch-thumb pointer-events-none block size-4 rounded-pill bg-text-secondary transition-transform duration-fast ease-standard data-[state=checked]:translate-x-5 data-[state=checked]:bg-text-on-accent"
    />
  </SwitchRoot>
</template>
