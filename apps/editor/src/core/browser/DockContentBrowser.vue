<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The content browser of the dock: the tree of folders, the path with the search, and the grid of tiles of the tree
 * of the plugin (`EditorPlugin.browser`). The plugin shows it as a tab of the dock (`EditorPlugin.dockTabs`, for
 * example "Clips and presets"). The dock gives the browser state. The layout of the dock keeps the width of the
 * folders.
 *
 * The texts are Fluent messages of `src/i18n/en-US/browser.ftl`.
 */
import { useI18n } from "@scenity/i18n";
import { computed } from "vue";
import { useLab } from "../labContext";
import DockBreadcrumb from "./DockBreadcrumb.vue";
import DockGrid from "./DockGrid.vue";
import DockPanelTitle from "./DockPanelTitle.vue";
import DockRail from "./DockRail.vue";
import DockTree from "./DockTree.vue";
import { clampSize, defaultLayout } from "./dockLayout";
import ResizeHandle from "./ResizeHandle.vue";
import type { BrowserItem } from "./tree";
import type { LabBrowser } from "./useBrowser";

const props = defineProps<{ readonly browser: LabBrowser }>();
const lab = useLab();
const { $t } = useI18n();

const { path, query, filters, item, recent, items, layout } = props.browser;
const tree = props.browser.tree;
const searching = computed(() => query.value.trim() !== "" || Object.keys(filters.value).length > 0);
const recentItems = computed(() =>
  path.value.length === 0 && !searching.value
    ? recent.value.flatMap((key) => {
        const found = tree.byKey.get(key);
        return found === undefined ? [] : [found];
      })
    : [],
);

/** The size of 1rem in CSS pixels. */
function rootFont(): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

const treeWidth = computed({
  get: () => layout.treeWidth,
  set: (value: number) => {
    layout.treeWidth = clampSize("treeWidth", value, rootFont());
  },
});

function openTile(target: BrowserItem): void {
  if (target.children.length > 0) props.browser.browse(target.path);
  else {
    props.browser.open(target.key);
    lab.showScene();
  }
}
</script>

<template>
  <div class="flex min-h-0 flex-1">
    <template v-if="layout.tree">
      <div class="flex min-h-0 shrink-0 flex-col" :style="{ width: `${String(treeWidth)}rem` }">
        <DockPanelTitle
          :label="$t('browser-folders')"
          :close-label="$t('browser-part-hide-folders')"
          side="left"
          @close="layout.tree = false"
        />
        <DockTree class="min-h-0 flex-1" :roots="tree.roots" :path="path" @browse="(next) => browser.browse(next)" />
      </div>
      <ResizeHandle
        v-model="treeWidth"
        axis="x"
        :label="$t('browser-tree-width')"
        :title="$t('browser-tree-width-title')"
        class="border-l border-border-subtle"
        data-testid="dock-tree-handle"
        @reset="layout.treeWidth = defaultLayout().treeWidth"
      />
    </template>
    <DockRail
      v-else
      :label="$t('browser-folders')"
      :open-label="$t('browser-part-show-folders')"
      side="left"
      @open="layout.tree = true"
    />
    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      <DockBreadcrumb
        v-model:query="query"
        v-model:filters="filters"
        :crumbs="browser.crumbs.value"
        @browse="(next) => browser.browse(next)"
        @up="browser.up()"
      />
      <DockGrid
        :items="items"
        :recent="recentItems"
        :open-key="item?.key ?? null"
        :searching="searching"
        @open="openTile"
        @up="browser.up()"
      />
    </div>
  </div>
</template>
