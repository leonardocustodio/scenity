<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The view tab of the 3D room lab: the camera (named cameras), the source of the views, the debug layers and the
 * renderer (tier, backend, worker, reduced motion, cards, glTF characters). It also has "Save camera" and the camera
 * bookmarks (editor/CameraSave.vue). The sections of the plugin (for example the layout variants) come after the
 * panes. The clock is the play bar of the dock. The take and its code are in the inspector of the dock. The frame
 * statistics are the card of the frame rate on the scene.
 *
 * The texts are Fluent messages of `src/i18n/en-US/lab-core.ftl`. The camera names, the debug layer names, the backend
 * names and the backend line are data values.
 */
import { useI18n } from "@scenity/i18n";
import type { DebugLayer } from "../plugins";
import { cn, Switch } from "@scenity/ui";
import { FieldLabel } from "@scenity/ui/components/field";
import { computed } from "vue";
import { cameraNames, viewText } from "./cameras";
import { useLab } from "./labContext";
import { button, segment, segmentOn, select, words } from "./labUi";
import { TIERS } from "./useLabStats";
import { backendText } from "./backendText";
import LabPaneLayout from "./panes/LabPaneLayout.vue";
import CameraSave from "./editor/CameraSave.vue";
import { editorPlugin } from "./plugin";
import { editorRoom } from "./sceneSource";

/** The named cameras of the plugin. */
const CAMERA_NAMES = cameraNames();
/** The sections of the plugin in this tab. */
const VIEW_SECTIONS = editorPlugin().tabs.filter((tab) => tab.at === "view");
/** The debug layers of the scene of the plugin. */
const DEBUG_LAYERS = editorRoom().debugLayers;

const { camera, renderer, stats } = useLab();
const { $t } = useI18n();

/**
 * The renderer backend: the backend that draws and the reason, as the frame statistics give it, and the adapter of the
 * chooser. A device without WebGPU and `backend=webgl` show "webgl" with the reason.
 */
const backendLine = computed(() => {
  const adapter = renderer.backend.value?.adapter ?? null;
  const text = backendText(stats.stats.value, renderer.backend.value);
  return adapter === null ? text : $t("lab-backend-line", { text, adapter });
});
/**
 * The choices of the URL parameter `backend`: the chooser of the game ("auto"), or one backend. The label of "auto" is
 * a message. A backend name is a data value.
 */
const BACKENDS = [
  ["auto", $t("lab-backend-auto"), false],
  ["webgpu", "WebGPU", true],
  ["webgl", "WebGL", true],
] as const;
const backendParam = new URLSearchParams(globalThis.location.search).get("backend") ?? "auto";

/** The chooser runs once per page. A new backend loads the page again with `backend=` (or without it for "auto"). */
function setBackend(value: string): void {
  const url = new URL(globalThis.location.href);
  if (value === "auto") url.searchParams.delete("backend");
  else url.searchParams.set("backend", value);
  globalThis.location.assign(url);
}

const { tier, useWorker, reduced, showCards, useAssets, debug } = renderer;

/** Show or hide a debug layer. */
function toggleLayer(layer: DebugLayer, on: boolean): void {
  debug.value = on
    ? [...debug.value.filter((item) => item !== layer), layer]
    : debug.value.filter((item) => item !== layer);
}
const cameraName = camera.name;
const cameraView = camera.view;

/** The switches of the renderer: the id, the label and the flag. */
const FLAGS = [
  ["lab-worker", $t("lab-flag-worker"), useWorker],
  ["lab-reduced", $t("lab-flag-reduced"), reduced],
  ["lab-cards", $t("lab-flag-cards"), showCards],
  ["lab-assets", $t("lab-flag-assets"), useAssets],
] as const;

function onCamera(event: Event): void {
  camera.setCamera((event.target as HTMLSelectElement).value);
}
</script>

<template>
  <div class="flex flex-col gap-4 text-caption">
    <section class="flex flex-col gap-1.5" :aria-label="$t('lab-view-camera')">
      <div class="flex items-center justify-between gap-2">
        <h3 class="text-label text-text-secondary">{{ $t("lab-view-camera") }}</h3>
        <button
          type="button"
          :class="cn(button, 'min-h-9 px-3 pointer-coarse:min-h-11')"
          data-testid="lab-camera-reset"
          @click="camera.reset()"
        >
          {{ $t("lab-view-camera-reset") }}
        </button>
      </div>
      <label for="lab-camera" class="flex flex-col">
        <span class="sr-only">{{ $t("lab-view-camera-named") }}</span>
        <select
          id="lab-camera"
          :value="cameraName ?? ''"
          :class="select"
          data-testid="lab-camera-select"
          @change="onCamera"
        >
          <option v-if="cameraName === null" value="">{{ $t("lab-view-camera-free") }}</option>
          <option v-for="(name, index) in CAMERA_NAMES" :key="name" :value="name" translate="no">
            {{ index + 1 }} · {{ words(name) }}
          </option>
        </select>
      </label>
      <p class="text-text-secondary">{{ $t("lab-view-camera-keys") }}</p>
      <p class="font-mono break-all select-all" translate="no" data-testid="lab-camera-view">
        {{ cameraName !== null ? `camera=${cameraName}` : cameraView === null ? "" : `view=${viewText(cameraView)}` }}
      </p>
    </section>

    <!-- "Save camera" and the camera bookmarks. -->
    <CameraSave />

    <LabPaneLayout />

    <!-- The sections of the plugin (for example the layout variants). -->
    <component :is="section.component" v-for="section in VIEW_SECTIONS" :key="section.value" />

    <section class="flex flex-col gap-2" :aria-label="$t('lab-view-debug')">
      <h3 class="text-label text-text-secondary">{{ $t("lab-view-debug") }}</h3>
      <div v-for="layer in DEBUG_LAYERS" :key="layer" class="flex items-center justify-between gap-3">
        <FieldLabel :for="`lab-debug-${layer}`"
          ><span translate="no">{{ words(layer) }}</span></FieldLabel
        >
        <Switch
          :id="`lab-debug-${layer}`"
          :model-value="debug.includes(layer)"
          @update:model-value="(on: boolean) => toggleLayer(layer, on)"
        />
      </div>
    </section>

    <div class="flex flex-col gap-1.5">
      <h3 class="text-label text-text-secondary">{{ $t("lab-view-tier") }}</h3>
      <div class="flex gap-0.5 rounded-control bg-surface-sunken p-0.5" role="group" :aria-label="$t('lab-view-tier')">
        <button
          v-for="[value, label] in TIERS"
          :key="value"
          type="button"
          :class="cn(segment, tier === value && segmentOn)"
          :aria-pressed="tier === value"
          :data-testid="`lab-tier-${value}`"
          @click="tier = value"
        >
          {{ $t(label) }}
        </button>
      </div>
    </div>
    <div class="flex flex-col gap-1.5" data-testid="lab-backend">
      <h3 class="text-label text-text-secondary">{{ $t("lab-view-backend") }}</h3>
      <p class="m-0 font-mono break-words" data-testid="lab-backend-text">{{ backendLine }}</p>
      <div
        class="flex gap-0.5 rounded-control bg-surface-sunken p-0.5"
        role="group"
        :aria-label="$t('lab-view-backend')"
      >
        <button
          v-for="[value, label, data] in BACKENDS"
          :key="value"
          type="button"
          :class="cn(segment, backendParam === value && segmentOn)"
          :aria-pressed="backendParam === value"
          :data-testid="`lab-backend-${value}`"
          :translate="data ? 'no' : undefined"
          @click="setBackend(value)"
        >
          {{ label }}
        </button>
      </div>
    </div>
    <div class="flex flex-col gap-2">
      <div v-for="[id, label, flag] in FLAGS" :key="id" class="flex items-center justify-between gap-3">
        <FieldLabel :for="id">{{ label }}</FieldLabel>
        <Switch :id="id" v-model="flag.value" />
      </div>
    </div>
  </div>
</template>
