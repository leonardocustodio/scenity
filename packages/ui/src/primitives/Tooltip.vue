<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * Tooltip (Reka UI): a short text for a control that has a visible name or an icon with an aria-label. It
 * opens on hover and on keyboard focus, and Escape closes it (WCAG 1.4.13). Never put required information
 * only in a tooltip.
 */
import { TooltipContent, TooltipPortal, TooltipProvider, TooltipRoot, TooltipTrigger } from "reka-ui";
import { usePortalTarget } from "../lib/portal";

defineOptions({ name: "ScTooltip" });

const open = defineModel<boolean>("open", { default: false });
const props = withDefaults(defineProps<{ text: string; side?: "top" | "right" | "bottom" | "left" }>(), {
  side: "top",
});
const portal = usePortalTarget();
</script>

<template>
  <TooltipProvider :delay-duration="400">
    <TooltipRoot v-model:open="open">
      <TooltipTrigger as-child><slot /></TooltipTrigger>
      <TooltipPortal :to="portal">
        <TooltipContent
          :side="props.side"
          :side-offset="6"
          class="z-50 max-w-xs rounded-control border border-border-strong bg-surface-overlay px-2 py-1 text-caption text-text-primary shadow-overlay"
        >
          {{ props.text }}
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>
