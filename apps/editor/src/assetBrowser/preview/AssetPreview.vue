<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The preview of the asset inspector: the preview of the kind of the asset (previewKinds.ts).
 * A source with no project files (`base` null) shows the icon of the kind.
 */
import { computed } from "vue";
import { kindIcon } from "../assetIcons";
import type { AssetListEntry } from "../assetTypes";
import AudioPreview from "./AudioPreview.vue";
import LivePreview from "./LivePreview.vue";
import { PLUGIN_PREVIEWS, previewOf } from "./previewKinds";
import TexturePreview from "./TexturePreview.vue";
import "./preview.css";

const props = defineProps<{ asset: AssetListEntry; base: string | null; version: number }>();
const kind = computed(() => (props.base === null ? "still" : previewOf(props.asset.kind)));
const url = (path: string): string => `${props.base ?? ""}${encodeURI(path)}`;
const icon = computed(() => kindIcon(props.asset.kind));
// The preview of a plugin for the kind of the asset has priority.
const plugin = computed(() => PLUGIN_PREVIEWS.get(props.asset.kind) ?? null);
</script>

<template>
  <div class="flex flex-col" :data-preview="plugin === null ? kind : 'plugin'" data-testid="asset-preview">
    <component :is="plugin" v-if="plugin !== null" :asset="asset" :url="base === null ? null : url(asset.source)" />
    <LivePreview
      v-else-if="base !== null && (kind === 'turntable' || kind === 'environment' || kind === 'material')"
      :id="asset.id"
      :base="base"
      :kind="kind"
      :version="version"
    />
    <TexturePreview v-else-if="kind === 'texture'" :url="url(asset.still ?? asset.source)" />
    <AudioPreview v-else-if="kind === 'audio'" :url="url(asset.source)" />
    <img
      v-else-if="asset.still !== null && base !== null"
      :src="url(asset.still)"
      alt=""
      class="aspect-[4/3] w-full rounded-control bg-surface-sunken object-contain"
      data-testid="asset-preview-still"
    />
    <component :is="icon" v-else class="mx-auto size-16 text-text-secondary" aria-hidden="true" />
  </div>
</template>
