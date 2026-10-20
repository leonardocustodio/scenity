<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The frame of a surface: the page of a dev server of the checkout in an `<iframe>`. The frame gets the `workbench`
 * parameter, so its bridge answers this page. The relay knows the window and
 * the origin of the frame while the frame exists.
 *
 * The visible frame takes the keyboard focus when it loads and on `focus()`, so the keys of the lab work at once. The
 * shadow frame stays in the viewport with `visibility: hidden` behind the page. A browser stops the frames that are
 * out of the viewport or have `display: none`, and the shadow must draw with WebGL.
 *
 * Each frame has a `sandbox` attribute with the smallest set of tokens of the lab page (frameSandbox.ts). The
 * lab dev server sends a Content-Security-Policy header (apps/editor `scripts/labsCsp.ts`).
 */
import type { SurfaceWhere } from "@scenity/workbench-host/protocol";
import { onBeforeUnmount, ref, watch } from "vue";
import { LAB_FRAME_SANDBOX } from "./frameSandbox";
import type { SurfaceRelay } from "./relay";
import { frameName, nextFrameSrc, originOf } from "./useSurface";

const props = defineProps<{
  readonly surface: string;
  readonly where: SurfaceWhere;
  /** The URL that the host keeps for this frame, or null. */
  readonly url: string | null;
  readonly pageOrigin: string;
  readonly relay: SurfaceRelay;
  readonly title: string;
}>();

const frame = ref<HTMLIFrameElement | null>(null);
const allow = "fullscreen; clipboard-read; clipboard-write";
const src = ref<string | null>(null);
watch(
  () => props.url,
  (url) => {
    src.value = nextFrameSrc(src.value, url, props.pageOrigin);
  },
  { immediate: true },
);

let detach: (() => void) | null = null;
watch(
  [frame, src],
  ([element, current]) => {
    detach?.();
    detach = null;
    const target = element?.contentWindow ?? null;
    const origin = current === null ? null : originOf(current);
    if (target !== null && origin !== null)
      detach = props.relay.attach(props.surface, props.where, { window: target, origin });
  },
  { flush: "post" },
);
onBeforeUnmount(() => detach?.());

/** Give the keyboard focus to the frame (the keys of the lab). */
function focus(): void {
  frame.value?.focus();
}

/** The visible frame takes the focus when it loads, unless the owner types in a field of the workbench. */
function onLoad(): void {
  if (props.where !== "visible") return;
  const active = document.activeElement;
  if (active === null || active === document.body) focus();
}

defineExpose({ focus });
</script>

<template>
  <iframe
    v-if="src !== null"
    ref="frame"
    :src="src"
    :title="title"
    :data-frame="frameName(surface, where)"
    :data-testid="`surface-frame-${where}`"
    :allow="allow"
    :sandbox="LAB_FRAME_SANDBOX"
    allowfullscreen
    :tabindex="where === 'shadow' ? -1 : 0"
    :aria-hidden="where === 'shadow' ? 'true' : undefined"
    :class="where === 'shadow' ? 'surface-shadow' : 'block size-full border-0 bg-surface-sunken'"
    @load="onLoad"
  />
</template>

<style scoped>
/*
 * The shadow frame: in the viewport and `visibility: hidden`. A hidden frame in the viewport draws at 60 fps. A frame
 * off the screen never draws. The owner cannot see or touch this frame.
 */
.surface-shadow {
  position: fixed;
  right: 0;
  bottom: 0;
  z-index: -1;
  /* 16:10, the aspect of `labs sheet` (1280 × 800), so a sheet of the shadow has the cells of the CLI. */
  width: 40rem;
  height: 25rem;
  border: 0;
  visibility: hidden;
  pointer-events: none;
}
</style>
