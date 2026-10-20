<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * ScrollArea (Reka UI): a scroll container with a token-styled scroll bar. The viewport takes the keyboard
 * focus, so a keyboard user can scroll it (WCAG 2.1.1).
 */
import { useI18n } from "@scenity/i18n";
import { ScrollAreaRoot, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport } from "reka-ui";
import { cn, type ClassValue } from "../lib/cn";

const props = withDefaults(defineProps<{ label?: string | undefined; class?: ClassValue | undefined }>(), {
  class: undefined,
  label: undefined,
});
const { $t } = useI18n();
</script>

<template>
  <ScrollAreaRoot type="auto" :class="cn('relative overflow-hidden', props.class)">
    <ScrollAreaViewport
      tabindex="0"
      role="region"
      :aria-label="props.label ?? $t('ui-scroll-area')"
      class="size-full rounded-[inherit]"
    >
      <slot />
    </ScrollAreaViewport>
    <ScrollAreaScrollbar orientation="vertical" class="flex w-2.5 touch-none p-0.5 select-none">
      <ScrollAreaThumb class="relative flex-1 rounded-pill bg-border-strong" />
    </ScrollAreaScrollbar>
  </ScrollAreaRoot>
</template>
