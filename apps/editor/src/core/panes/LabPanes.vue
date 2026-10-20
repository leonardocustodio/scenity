<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The panes of the split screen over the scene. The layer shows the focus ring of the focused pane and a small bar per
 * pane. The bar has the camera of the pane, "Swap to main", the debug layers of the pane, the full size and "Detach".
 * "Detach" moves the pane into its own window (follow/detach.ts). The scene draws the panes (one canvas). This layer
 * only shows their boxes. With one pane, it shows nothing.
 *
 * The texts are Fluent messages of `src/i18n/en-US/panes.ftl`.
 */
import { useI18n } from "@scenity/i18n";
import { cn } from "@scenity/ui";
import { computed } from "vue";
import { cameraNames } from "../cameras";
import { detachPane } from "../follow/detach";
import { button } from "../labUi";
import { dropPane } from "./paneApi";
import { camsText } from "./paneUrl";
import type { LabPanes } from "./usePanes";

/** The named cameras of the plugin. */
const CAMERA_NAMES = cameraNames();

const props = defineProps<{ readonly panes: LabPanes }>();
const { $t } = useI18n();

const split = computed(() => props.panes.boxes.value.length > 1 || props.panes.full.value !== null);

/** The CSS box of a share of the scene. */
function boxStyle(share: { x: number; y: number; width: number; height: number }): Record<string, string> {
  const percent = (value: number) => `${String(value * 100)}%`;
  return { left: percent(share.x), top: percent(share.y), width: percent(share.width), height: percent(share.height) };
}

function cameraOf(pane: number): string {
  const cam = props.panes.cams.value[pane];
  return cam?.name ?? "";
}

/** Move a pane into its own window. */
function detach(pane: number): void {
  const cam = props.panes.cams.value[pane];
  if (cam === undefined) return;
  detachPane(pane, camsText([cam]), (index) => dropPane(props.panes, index));
}

function onCamera(pane: number, event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  if (value !== "") props.panes.setCamera(pane, value);
}
</script>

<template>
  <div v-if="split" class="pointer-events-none absolute inset-0 z-10" data-testid="lab-panes">
    <div
      v-for="{ pane, share } in panes.boxes.value"
      :key="pane"
      :class="
        cn('absolute border border-border-subtle/60', panes.focus.value === pane && 'border-2 border-accent-brand')
      "
      :style="boxStyle(share)"
      :data-pane="pane"
      :data-focused="panes.focus.value === pane || undefined"
      data-testid="lab-pane"
    >
      <div
        class="pointer-events-auto absolute top-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-control bg-surface-overlay/80 px-1.5 py-1 text-caption whitespace-nowrap shadow-overlay"
        data-scene-control
      >
        <span class="font-mono text-text-secondary">{{ pane === 0 ? $t("panes-main") : pane }}</span>
        <label :for="`lab-pane-camera-${pane}`" class="flex items-center">
          <span class="sr-only">{{ $t("panes-camera", { pane }) }}</span>
          <select
            :id="`lab-pane-camera-${pane}`"
            :value="cameraOf(pane)"
            class="rounded-control border border-border-subtle bg-surface-sunken px-1 text-caption text-text-primary"
            data-testid="lab-pane-camera"
            @change="onCamera(pane, $event)"
          >
            <option v-if="cameraOf(pane) === ''" value="">{{ $t("panes-free-view") }}</option>
            <option v-for="name in CAMERA_NAMES" :key="name" :value="name" translate="no">{{ name }}</option>
          </select>
        </label>
        <button
          v-if="pane > 0"
          type="button"
          :class="button"
          :title="$t('panes-swap-title')"
          data-testid="lab-pane-swap"
          @click="panes.swap(pane)"
        >
          {{ $t("panes-swap") }}
        </button>
        <button
          type="button"
          :class="button"
          :aria-pressed="panes.hideDebug.value[pane] === true"
          :title="$t('panes-debug-title')"
          data-testid="lab-pane-debug"
          @click="panes.toggleDebug(pane)"
        >
          {{ panes.hideDebug.value[pane] === true ? $t("panes-debug-off") : $t("panes-debug") }}
        </button>
        <button
          v-if="pane > 0 && panes.full.value === null"
          type="button"
          :class="button"
          :title="$t('panes-detach-title')"
          data-testid="lab-pane-detach"
          @click="detach(pane)"
        >
          {{ $t("panes-detach") }}
        </button>
        <button
          type="button"
          :class="button"
          :title="$t('panes-full-title')"
          data-testid="lab-pane-full"
          @click="panes.toggleFull(pane)"
        >
          {{ panes.full.value === pane ? $t("panes-back") : $t("panes-full") }}
        </button>
      </div>
    </div>
  </div>
</template>
