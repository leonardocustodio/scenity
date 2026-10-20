<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The audio preview of the asset inspector: the wave of the sound (`soundPeaks` of the sequencer) and a player.
 */
import { useI18n } from "@scenity/i18n";
import { ref, shallowRef, watch } from "vue";
import { soundPeaks, type SoundPeaks } from "../../scene/sequencer/waveform";

const props = defineProps<{ url: string }>();
const { $t } = useI18n();
const canvas = ref<HTMLCanvasElement | null>(null);
const peaks = shallowRef<SoundPeaks | null>(null);

watch(
  () => props.url,
  async (url) => {
    peaks.value = null;
    peaks.value = await soundPeaks(url);
  },
  { immediate: true },
);

function draw(): void {
  const node = canvas.value;
  const sound = peaks.value;
  if (node === null || sound === null) return;
  const width = Math.max(1, Math.round(node.clientWidth));
  const height = Math.max(1, Math.round(node.clientHeight));
  node.width = width;
  node.height = height;
  const context = node.getContext("2d");
  if (context === null) return;
  context.fillStyle = getComputedStyle(node).color;
  for (let x = 0; x < width; x += 1) {
    const peak = sound.peaks[Math.floor((x / width) * sound.peaks.length)] ?? 0;
    const bar = Math.max(1, peak * height);
    context.fillRect(x, (height - bar) / 2, 1, bar);
  }
  node.dataset.ready = "1";
}
watch([peaks, canvas], draw, { flush: "post" });
</script>

<template>
  <div class="flex flex-col gap-1">
    <canvas
      ref="canvas"
      class="h-16 w-full rounded-control bg-surface-sunken text-accent-brand"
      data-testid="asset-preview-wave"
    />
    <!-- eslint-disable-next-line vuejs-accessibility/media-has-caption -- an asset sound has no captions; the wave shows it. -->
    <audio controls preload="metadata" :src="url" class="w-full" :aria-label="$t('asset-preview-player')" />
  </div>
</template>
