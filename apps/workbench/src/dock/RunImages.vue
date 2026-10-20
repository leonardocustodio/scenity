<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The images of the output folder of a run as thumbnails. A click opens one large image. Escape or a click on the
 * image closes it.
 */
import { onBeforeUnmount, onMounted, ref } from "vue";
import { fileName, type RunFiles } from "./runFile";

const props = defineProps<{
  readonly run: string;
  readonly images: readonly string[];
  readonly files: RunFiles;
}>();

const large = ref<string | null>(null);

function onKey(event: KeyboardEvent): void {
  if (event.key === "Escape" && large.value !== null) large.value = null;
}
onMounted(() => globalThis.addEventListener("keydown", onKey));
onBeforeUnmount(() => globalThis.removeEventListener("keydown", onKey));
</script>

<template>
  <ul v-if="images.length > 0" class="flex flex-wrap gap-2" aria-label="Images of the run" data-testid="run-images">
    <li v-for="image in images" :key="image">
      <button
        type="button"
        class="flex w-28 flex-col gap-0.5 rounded-control border border-border-subtle bg-surface-sunken p-1 text-left hover:border-border-strong"
        :title="image"
        @click="large = image"
      >
        <img
          v-if="props.files.url(run, image) !== null"
          :src="props.files.url(run, image) ?? undefined"
          :alt="fileName(image)"
          class="h-16 w-full object-contain"
        />
        <span v-else class="h-16 w-full animate-pulse rounded-control bg-surface-raised" aria-hidden="true" />
        <span class="truncate text-caption text-text-secondary">{{ fileName(image) }}</span>
      </button>
    </li>
  </ul>
  <div
    v-if="large !== null"
    class="fixed inset-0 z-50 flex flex-col items-center justify-center gap-2 bg-surface-scrim p-6"
    role="dialog"
    aria-modal="true"
    :aria-label="fileName(large)"
    data-testid="run-image-large"
  >
    <button type="button" class="flex min-h-0 max-w-full flex-1 items-center justify-center" @click="large = null">
      <img
        :src="props.files.url(run, large) ?? undefined"
        :alt="fileName(large)"
        class="max-h-full max-w-full object-contain shadow-overlay"
      />
    </button>
    <p class="text-caption text-text-primary">{{ large }} · a click or Escape closes</p>
  </div>
</template>
