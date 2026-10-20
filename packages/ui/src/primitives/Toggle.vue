<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/** Toggle: a button with a pressed state (Reka UI Toggle, aria-pressed). */
import { Toggle } from "reka-ui";
import { cn, type ClassValue } from "../lib/cn";
import { buttonVariants } from "./variants";

defineOptions({ name: "ScToggle" });

const pressed = defineModel<boolean>({ default: false });
const props = withDefaults(defineProps<{ disabled?: boolean; size?: "sm" | "md"; class?: ClassValue | undefined }>(), {
  class: undefined,
  disabled: false,
  size: "md",
});
</script>

<template>
  <Toggle
    v-model="pressed"
    :disabled="props.disabled"
    :class="
      cn(
        buttonVariants({ variant: 'secondary', size: props.size }),
        'data-[state=on]:border-accent-brand data-[state=on]:bg-status-info-subtle data-[state=on]:text-text-primary',
        props.class,
      )
    "
  >
    <slot />
  </Toggle>
</template>
