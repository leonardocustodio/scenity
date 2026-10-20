<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/** Popover (Reka UI): non-modal content next to a trigger. Escape closes it and the focus goes back. */
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from "reka-ui";
import { cn, type ClassValue } from "../lib/cn";
import { usePortalTarget } from "../lib/portal";
import { panelClass } from "./variants";

defineOptions({ name: "ScPopover" });

const open = defineModel<boolean>("open", { default: false });
const props = withDefaults(
  defineProps<{ side?: "top" | "right" | "bottom" | "left"; class?: ClassValue | undefined }>(),
  { class: undefined, side: "bottom" },
);
const portal = usePortalTarget();
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child><slot name="trigger" /></PopoverTrigger>
    <PopoverPortal :to="portal">
      <PopoverContent
        :side="props.side"
        :side-offset="6"
        :class="cn(panelClass, 'max-w-sm p-3 text-body', props.class)"
      >
        <slot />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
