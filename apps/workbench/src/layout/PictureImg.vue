<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * A picture of the host by ID: an `<img>` with the object URL of the picture cache of the page (host/pictures.ts).
 * The image has no `src` until the bytes arrive. No `data:` URL goes into the DOM. The view releases the picture when
 * its ID changes or the view ends, so the cache can revoke the URL.
 */
import { ref, watch } from "vue";
import { pictureSource } from "../host/pictures";

const props = defineProps<{
  /** The ID of the picture, or null for no picture. */
  readonly picture: string | null;
  readonly alt: string;
}>();

const src = ref<string | null>(null);

watch(
  () => props.picture,
  (id, _old, onCleanup) => {
    src.value = null;
    const source = pictureSource();
    if (id === null || source === null) return;
    let alive = true;
    source.acquire(id).then(
      (url) => {
        if (alive) src.value = url;
      },
      () => undefined,
    );
    onCleanup(() => {
      alive = false;
      source.release(id);
    });
  },
  { immediate: true },
);
</script>

<template>
  <img :src="src ?? undefined" :alt="alt" :data-picture="picture ?? undefined" />
</template>
