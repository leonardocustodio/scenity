<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The surface area of the workbench: the frame of the surface in front, the shadow frame when the host has one, and
 * the state of the dev server over the frame while it is not ready. A failed server shows its last log lines and a
 * Restart button. The words name the surface by its label (from the project manifest).
 */
import type { SurfaceState } from "@scenity/workbench-host/protocol";
import { LoaderCircle, RotateCw, ServerCrash, ServerOff } from "lucide-vue-next";
import { computed, ref } from "vue";
import { button, cn } from "../layout/ui";
import type { SurfaceRelay } from "./relay";
import SurfaceFrame from "./SurfaceFrame.vue";

const props = defineProps<{
  readonly surface: SurfaceState | null;
  readonly pageOrigin: string;
  readonly relay: SurfaceRelay;
  readonly restarting?: boolean;
  /** The label of the tab, for the words when the host has no such surface. The default is the label of `surface`. */
  readonly label?: string;
}>();
const emit = defineEmits<{ restart: [] }>();
const name = computed(() => (props.surface?.label ?? props.label ?? "scene").toLowerCase());

/** The count of log lines that a failed server shows. */
const LOG_LINES = 16;
const status = computed(() => props.surface?.server.status ?? "stopped");
const logLines = computed(() =>
  (props.surface?.server.error ?? "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .slice(-LOG_LINES),
);
const frame = ref<{ focus(): void } | null>(null);

defineExpose({ focus: () => frame.value?.focus() });
</script>

<template>
  <section class="relative min-h-0 min-w-0 bg-surface-sunken" aria-label="Surface" data-testid="surface-view">
    <template v-if="surface !== null">
      <SurfaceFrame
        ref="frame"
        :surface="surface.id"
        where="visible"
        :url="surface.url"
        :page-origin="pageOrigin"
        :relay="relay"
        :title="`The ${name} surface of the checkout`"
      />
      <!-- A new shadow URL is a new shadow. The key loads the frame again (the src keeps its origin). -->
      <SurfaceFrame
        v-if="typeof surface.shadowUrl === 'string'"
        :key="surface.shadowUrl"
        :surface="surface.id"
        where="shadow"
        :url="surface.shadowUrl"
        :page-origin="pageOrigin"
        :relay="relay"
        title="The shadow frame for measurements"
      />
    </template>
    <div
      v-if="surface === null || status !== 'ready' || surface.url === null"
      class="absolute inset-0 grid place-items-center overflow-auto bg-surface-sunken/95 p-6"
      :data-testid="`surface-status-${surface === null ? 'none' : status}`"
    >
      <div v-if="surface === null" class="flex max-w-md flex-col items-center gap-2 text-center text-text-secondary">
        <ServerOff class="size-6" aria-hidden="true" />
        <p>This checkout has no {{ name }} surface yet.</p>
      </div>
      <div v-else-if="status === 'failed'" class="flex w-full max-w-2xl flex-col gap-3" role="alert">
        <div class="flex items-center gap-2 text-status-negative">
          <ServerCrash class="size-5 shrink-0" aria-hidden="true" />
          <h2 class="text-label">The {{ name }} dev server stopped with an error</h2>
        </div>
        <pre
          class="max-h-80 overflow-auto rounded-control border border-border-subtle bg-surface-base p-3 font-mono text-caption whitespace-pre-wrap text-text-secondary"
          data-testid="surface-log"
          >{{ logLines.length > 0 ? logLines.join("\n") : "The host gave no log lines." }}</pre>
        <button
          type="button"
          :class="cn(button, 'inline-flex items-center gap-1.5 self-start')"
          :disabled="restarting"
          data-testid="surface-restart"
          @click="emit('restart')"
        >
          <RotateCw
            :class="cn('size-3.5', restarting && 'animate-spin motion-reduce:animate-none')"
            aria-hidden="true"
          />
          {{ restarting ? "Restarting" : "Restart the dev server" }}
        </button>
      </div>
      <div v-else-if="status === 'stopped'" class="flex flex-col items-center gap-3 text-center text-text-secondary">
        <ServerOff class="size-6" aria-hidden="true" />
        <p>The {{ name }} dev server is stopped.</p>
        <button
          type="button"
          :class="button"
          :disabled="restarting"
          data-testid="surface-restart"
          @click="emit('restart')"
        >
          Start the dev server
        </button>
      </div>
      <div v-else class="flex items-center gap-2 text-text-secondary" role="status">
        <LoaderCircle class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        <p>
          Starting the {{ name }} dev server<template v-if="surface.server.port !== null">
            on port {{ surface.server.port }}</template
          >
        </p>
      </div>
    </div>
  </section>
</template>
