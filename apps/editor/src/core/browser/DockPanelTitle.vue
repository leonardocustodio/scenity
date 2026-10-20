<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The title row of a side panel of the dock, with the button that closes the panel to its rail. The caller gives the
 * texts: `label` is the name of the panel, and `closeLabel` is the name of the button. The texts are Fluent messages
 * of `src/i18n/en-US/browser.ftl`.
 */
import { PanelLeftClose, PanelRightClose } from "lucide-vue-next";

defineProps<{ readonly label: string; readonly closeLabel: string; readonly side: "left" | "right" }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <div class="flex h-7 shrink-0 items-center justify-between gap-1 border-b border-border-subtle pr-1 pl-2">
    <span class="text-label text-text-secondary">{{ label }}</span>
    <button
      type="button"
      class="inline-flex size-6 items-center justify-center rounded-control text-text-secondary hover:bg-surface-raised hover:text-text-primary"
      :title="closeLabel"
      :aria-label="closeLabel"
      :data-testid="`dock-close-${side}`"
      @click="emit('close')"
    >
      <PanelLeftClose v-if="side === 'left'" class="size-4" aria-hidden="true" />
      <PanelRightClose v-else class="size-4" aria-hidden="true" />
    </button>
  </div>
</template>
