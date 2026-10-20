<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The texture preview of the asset inspector: the image on a check pattern, and a choice of the channels (all colours, red, green, blue, or the alpha as grey).
 */
import { useI18n } from "@scenity/i18n";
import { Toggle } from "@scenity/ui";
import { ref, shallowRef, watch } from "vue";
import { channelPixels, CHANNELS, type Channel } from "./previewKinds";

const props = defineProps<{ url: string }>();
const { $t } = useI18n();
const canvas = ref<HTMLCanvasElement | null>(null);
const channel = ref<Channel>("rgb");
const image = shallowRef<ImageBitmap | null>(null);
const error = ref<string | null>(null);

watch(
  () => props.url,
  async (url) => {
    image.value = null;
    error.value = null;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url}: ${String(response.status)}`);
      image.value = await createImageBitmap(await response.blob());
    } catch (failure) {
      error.value = failure instanceof Error ? failure.message : String(failure);
    }
  },
  { immediate: true },
);

/** Draw the image of the channel on a check pattern (the pattern shows the transparent parts). */
function draw(): void {
  const node = canvas.value;
  const bitmap = image.value;
  if (node === null || bitmap === null) return;
  node.width = bitmap.width;
  node.height = bitmap.height;
  const context = node.getContext("2d", { willReadFrequently: true });
  if (context === null) return;
  context.clearRect(0, 0, node.width, node.height);
  context.drawImage(bitmap, 0, 0);
  if (channel.value !== "rgb") {
    const data = context.getImageData(0, 0, node.width, node.height);
    context.putImageData(new ImageData(channelPixels(data.data, channel.value), node.width, node.height), 0, 0);
  }
  node.dataset.ready = "1";
}
watch([image, channel, canvas], draw, { flush: "post" });
</script>

<template>
  <div class="flex flex-col gap-1">
    <canvas
      ref="canvas"
      class="sc-check max-h-48 w-full rounded-control object-contain [image-rendering:pixelated]"
      :data-channel="channel"
      data-testid="asset-preview-texture"
    />
    <div class="flex gap-0.5" role="group" :aria-label="$t('asset-preview-channels')">
      <Toggle
        v-for="each in CHANNELS"
        :key="each"
        size="sm"
        class="h-6 px-1.5 text-caption"
        :model-value="channel === each"
        :data-testid="`asset-channel-${each}`"
        @update:model-value="channel = each"
        >{{ $t(`asset-preview-channel-${each}`) }}</Toggle
      >
    </div>
    <p v-if="error !== null" class="text-caption text-status-critical" role="alert">{{ error }}</p>
  </div>
</template>
