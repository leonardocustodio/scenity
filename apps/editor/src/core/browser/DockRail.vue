<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The rail of a closed side panel of the dock: a narrow column with the name of the panel. A press opens the panel
 * again. The caller gives the texts: `label` is the name of the panel, and `openLabel` is the name of the button. The
 * texts are Fluent messages of `src/i18n/en-US/browser.ftl`.
 */
import { PanelLeftOpen, PanelRightOpen } from "lucide-vue-next";

defineProps<{ readonly label: string; readonly openLabel: string; readonly side: "left" | "right" }>();
const emit = defineEmits<{ open: [] }>();
</script>

<template>
  <button
    type="button"
    class="flex w-7 shrink-0 flex-col items-center gap-2 border-border-subtle bg-surface-sunken/40 py-2 text-caption text-text-secondary hover:bg-surface-raised hover:text-text-primary"
    :class="side === 'left' ? 'border-r' : 'border-l'"
    :title="openLabel"
    :aria-label="openLabel"
    :data-testid="`dock-rail-${side}`"
    @click="emit('open')"
  >
    <PanelLeftOpen v-if="side === 'left'" class="size-4" aria-hidden="true" />
    <PanelRightOpen v-else class="size-4" aria-hidden="true" />
    <span class="[writing-mode:vertical-rl]">{{ label }}</span>
  </button>
</template>
