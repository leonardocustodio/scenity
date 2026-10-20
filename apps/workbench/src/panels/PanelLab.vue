<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The lab frame of a detached window: the content browser alone, the metrics graph or one pane of the split screen,
 * on the lab server of the checkout (panelUrl.ts `panelFrameUrl`). The lab follows the clock of the lab of the main
 * window through the host (hostLink.ts). The frame reports nothing to the host: the host keeps the URL and the tools of
 * the lab frame of the main window only. The lab frame is a frame of the scene surface (the first surface with the
 * capability `scene`).
 */
import { surfaceWith, type DetachedPanel } from "@scenity/workbench-host/protocol";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { HostApi } from "../host/useHost";
import { scratchModelHandler } from "../imports/useImportDrop";
import { createRelay } from "../surfaces/relay";
import SurfaceFrame from "../surfaces/SurfaceFrame.vue";
import { deliverKept, linkFromHost, linkToHost } from "./hostLink";
import { panelFrameUrl, panelTitle } from "./panelUrl";

const props = defineProps<{
  readonly host: HostApi;
  readonly panel: Omit<DetachedPanel, "rect">;
}>();

/** The ID of the scene surface of the host, or null. */
const scene = computed(() => surfaceWith(props.host.surfaces.value)?.id ?? null);
/** The lab URL of the main window when this window opened: the frame keeps its own URL after that. */
const start = ref<string | null>(null);
watch(
  () => surfaceWith(props.host.surfaces.value)?.url ?? null,
  (url) => {
    if (start.value === null && url !== null) start.value = panelFrameUrl(props.panel, url);
  },
  { immediate: true },
);
const title = computed(() => panelTitle(props.panel));

const linkOut = linkToHost(props.host.request, () => scene.value);
const relay = createRelay({
  surfaces: () => props.host.surfaces.value,
  answer: () => undefined,
  // A frame that loaded (again) gets the kept clock of the host at once.
  report: (params) => {
    if (params.event.event === "ready") void deliverKept(props.host.request, relay, { tries: 4 });
  },
  onLink: linkOut,
  // A lab URL with scratch props gets their models from the host, as in the main window.
  onScratch: scratchModelHandler(props.host, () => relay),
});
const onMessage = (event: MessageEvent): void => {
  relay.receive(event);
};
let stopLink: (() => void) | null = null;
const stopClient = watch(
  props.host.client,
  (client) => {
    stopLink?.();
    stopLink =
      client === null
        ? null
        : linkFromHost({ request: props.host.request, on: (listener) => client.on("link.message", listener) }, relay);
  },
  { immediate: true },
);
onMounted(() => {
  globalThis.addEventListener("message", onMessage);
  // The metrics graph page sends no `ready` (it has no lab API): the kept clock goes in when its listener exists.
  void deliverKept(props.host.request, relay);
});
onBeforeUnmount(() => {
  stopClient();
  stopLink?.();
  globalThis.removeEventListener("message", onMessage);
  relay.dispose();
});
</script>

<template>
  <div class="relative grid min-h-0" data-testid="panel-lab">
    <SurfaceFrame
      v-if="start !== null && scene !== null"
      :surface="scene"
      where="visible"
      :url="start"
      :page-origin="host.pageOrigin"
      :relay="relay"
      :title="title"
    />
    <p v-else class="grid place-items-center p-6 text-caption text-text-secondary" role="status">
      The lab server of the checkout is not ready.
    </p>
  </div>
</template>
