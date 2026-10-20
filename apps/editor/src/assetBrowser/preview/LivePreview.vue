<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * A live preview of the asset inspector: the turntable of a model, the balls of an environment
 * map, or a material ball (previewScenes.ts). A change of the asset starts a new view.
 */
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { previewLoads } from "./previewLoads";
import { startPreview, type PreviewHandle } from "./previewScenes";

const props = defineProps<{
  base: string;
  id: string;
  kind: "turntable" | "environment" | "material";
  /** It changes after an import again, so the view loads the asset again. */
  version: number;
  /** The level of detail of the build that the view loads (default "high"). */
  tier?: string | undefined;
}>();
const host = ref<HTMLDivElement | null>(null);
const error = ref<string | null>(null);
let handle: PreviewHandle | null = null;
let run = 0;

/** A new canvas in the host. A lost WebGL context does not return, so each view gets its own canvas. */
function newCanvas(parent: HTMLDivElement): HTMLCanvasElement {
  const node = document.createElement("canvas");
  node.className = "aspect-[4/3] w-full rounded-control bg-surface-sunken";
  node.dataset.kind = props.kind;
  node.dataset.testid = "asset-preview-canvas";
  parent.replaceChildren(node);
  return node;
}

async function start(): Promise<void> {
  handle?.stop();
  handle = null;
  error.value = null;
  if (host.value === null) return;
  const node = newCanvas(host.value);
  const mine = (run += 1);
  try {
    const started = await startPreview(node, props.kind, previewLoads(props.base, props.id, props.tier));
    if (mine === run) handle = started;
    else started.stop();
  } catch (failure) {
    if (mine === run) error.value = failure instanceof Error ? failure.message : String(failure);
  }
}

onMounted(() => void start());
watch(
  () => [props.id, props.kind, props.version, props.tier],
  () => void start(),
);
onBeforeUnmount(() => {
  run += 1;
  handle?.stop();
});
</script>

<template>
  <div class="relative">
    <div ref="host" />
    <p v-if="error !== null" class="text-caption text-status-critical" role="alert">{{ error }}</p>
  </div>
</template>
