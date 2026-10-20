<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The core tab "Assets" of the dock of the lab: the generic asset browser for the project of the lab. The dev server
 * of the lab answers the list and the import under `/projects/lab/` (scripts/assetApiServer.ts). The lab serves no
 * project files, so a tile shows the icon of its kind.
 *
 * The tab has no text of its own: the asset browser has its texts.
 */
import AssetBrowser from "../../assetBrowser/AssetBrowser.vue";
import { devServerAssets } from "../../assetBrowser/assetClient";

/** The dock gives each tab the state of the content browser. This tab does not read it. */
defineProps<{ readonly browser?: unknown }>();

/** The project name of the lab on its dev server (vite.config.ts). */
const LAB_PROJECT_BASE = "/projects/lab/";
const source = devServerAssets(LAB_PROJECT_BASE);
</script>

<template>
  <AssetBrowser class="min-h-0 flex-1" :source="source" :stills="false" />
</template>
