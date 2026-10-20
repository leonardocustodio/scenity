<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The preview of the asset kind `demo.pattern` of the demo plugin (the `previews` point): the name of the
 * asset over a ring, in the asset inspector.
 */
import type { StudioContext } from "@scenity/editor/studio";

defineProps<{ ctx: StudioContext; asset: { readonly id: string; readonly name?: string }; url: string | null }>();
</script>

<template>
  <figure
    class="flex flex-col items-center gap-1 p-1.5 text-caption text-text-secondary"
    data-testid="demo-pattern-preview"
  >
    <svg viewBox="0 0 64 64" class="size-16" aria-hidden="true">
      <circle cx="32" cy="32" r="24" fill="none" stroke="currentColor" stroke-width="4" stroke-dasharray="8 6" />
    </svg>
    <figcaption translate="no">{{ asset.name ?? asset.id }}</figcaption>
  </figure>
</template>
