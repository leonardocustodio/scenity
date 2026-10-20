<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The surfaces of the opened tabs: one surface view per tab that the owner opened. The tab in front fills the area.
 * The other views stay loaded behind it at 0 opacity, without pointer and keyboard input. A browser stops a frame
 * with `display: none`, and the tools of the lab need the lab frame. Their bridges pause the render loops of these
 * frames. A tool call wakes a frame for the call.
 */
import type { SurfaceId, SurfaceState } from "@scenity/workbench-host/protocol";
import { watchEffect } from "vue";
import { cn } from "../layout/ui";
import type { SurfaceRelay } from "./relay";
import SurfaceView from "./SurfaceView.vue";

const props = defineProps<{
  readonly stack: readonly { readonly kind: SurfaceId; readonly surface: SurfaceState | null }[];
  /** The surface ID of the tab in front, or null. */
  readonly kind: SurfaceId | null;
  /** The label of a surface ID, for the words of a tab whose surface the host does not run. */
  readonly label?: (id: SurfaceId) => string;
  readonly pageOrigin: string;
  readonly relay: SurfaceRelay;
  readonly restarting?: boolean;
}>();
const emit = defineEmits<{ restart: [] }>();

// The frame of a tab behind another tab pauses its render loops (through its bridge). The tab in front draws.
watchEffect(() => {
  for (const entry of props.stack) {
    if (entry.surface !== null) props.relay.setHidden(entry.surface.id, entry.kind !== props.kind);
  }
});

const views = new Map<SurfaceId, { focus(): void }>();
function keep(kind: SurfaceId, view: unknown): void {
  if (view === null) views.delete(kind);
  else views.set(kind, view as { focus(): void });
}
/** Give the keyboard focus to the frame of a tab. */
function focus(kind: SurfaceId): void {
  views.get(kind)?.focus();
}

defineExpose({ focus });
</script>

<template>
  <div class="relative grid min-h-0 min-w-0" data-testid="surface-stack">
    <div
      v-for="entry in stack"
      :key="entry.kind"
      :class="cn('grid min-h-0 min-w-0', entry.kind !== kind && 'pointer-events-none absolute inset-0 opacity-0')"
      :inert="entry.kind !== kind"
      :aria-hidden="entry.kind !== kind ? 'true' : undefined"
      :data-surface-tab="entry.kind"
    >
      <SurfaceView
        :ref="(view) => keep(entry.kind, view)"
        :surface="entry.surface"
        :label="label?.(entry.kind) ?? entry.kind"
        :page-origin="pageOrigin"
        :relay="relay"
        :restarting="restarting && entry.kind === kind"
        @restart="emit('restart')"
      />
    </div>
  </div>
</template>
