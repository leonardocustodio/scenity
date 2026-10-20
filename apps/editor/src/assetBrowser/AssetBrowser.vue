<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The asset browser: the assets of the project as tiles with stills, a search, the kind and tag filters, the "used by"
 * list of the selected asset, and the import of files by the Import button or by a drop on the browser. The scene page
 * shows it in a dock at the bottom of the edit mode. The lab shows it as the core tab "Assets" of its dock.
 *
 * The details of a prefab asset (a `*.prefab.json` source) have "Open prefab" when the page gives `openPrefab`. Then
 * the scene page opens the prefab file in its prefab mode.
 *
 * The details of a material asset have "Edit material" when the page gives `openMaterial`. Then the scene page opens
 * the material in its material editor.
 *
 * The texts are Fluent messages of `src/i18n/en-US/assets.ftl`. The asset data (IDs, names, kinds, tags,
 * sources and the "used by" lines) shows in elements with `translate="no"`.
 */
import { useI18n } from "@scenity/i18n";
import { t } from "../texts";
import { Button, Toggle, cn } from "@scenity/ui";
import { Globe, Images, RefreshCw, Upload } from "lucide-vue-next";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { AssetSource } from "./assetClient";
import { assetFocus } from "./assetFocus";
import AssetInspector from "./AssetInspector.vue";
import AssetTile from "./AssetTile.vue";
import ImportDialog from "./ImportDialog.vue";
import { importFix } from "./importFixes";
import RightsBar from "./RightsBar.vue";
import SourcesDialog from "./sources/SourcesDialog.vue";
import type { AssetImportResult, ImportOptions } from "./assetTypes";
import { ASSET_DRAG_TYPE } from "./assetTypes";
import { useAssetBrowser, type OpenScene } from "./useAssetBrowser";
import { markOf } from "../scene/agent/turnFileMarks";

const props = withDefaults(
  defineProps<{
    readonly source: AssetSource;
    /** The open scene of the editor, for the "used by" lines. */
    readonly openScene?: OpenScene | undefined;
    /** Listen to the changes of the open scene. The result stops the listener. */
    readonly listen?: ((listener: () => void) => () => void) | undefined;
    /** Select an entity of the open scene (a click on a "used by" line). */
    readonly selectEntity?: ((id: string) => void) | undefined;
    /** False when the source serves no project files: each tile shows the icon of its kind. */
    readonly stills?: boolean | undefined;
    /** Open a prefab file (its path in the project) in the prefab mode of the page. */
    readonly openPrefab?: ((source: string) => void) | undefined;
    /** Open a material asset (`asset:<id>`) in the material editor of the page. */
    readonly openMaterial?: ((ref: string) => void) | undefined;
    /** Open another scene of the project (a click on a "used by" line of a scene file). */
    readonly openDocument?: ((path: string) => void) | undefined;
  }>(),
  {
    openScene: undefined,
    listen: undefined,
    selectEntity: undefined,
    stills: true,
    openPrefab: undefined,
    openMaterial: undefined,
    openDocument: undefined,
  },
);

const { $t } = useI18n();
const tick = ref(0);
const state = useAssetBrowser(props.source, props.openScene ?? (() => null), tick);
const { list, error, status, query, kinds, tags, importing, shown, allKinds, allTags, selected, lines } = state;
// A result of the search box shows its asset: the search gets its name, and the browser selects the asset.
watch(
  assetFocus,
  (focus) => {
    if (focus === null) return;
    query.value = focus.name;
    state.selectedId.value = focus.id;
  },
  { immediate: true },
);
const input = ref<HTMLInputElement | null>(null);
const dropping = ref(false);
let stop: (() => void) | undefined;

onMounted(() => {
  void state.reload();
  stop = props.listen?.(() => (tick.value += 1));
});
onBeforeUnmount(() => stop?.());

/** True for a drag with files from outside the page (not a tile of this browser). */
function fileDrag(event: DragEvent): boolean {
  const types = [...(event.dataTransfer?.types ?? [])];
  return types.includes("Files") && !types.includes(ASSET_DRAG_TYPE);
}

function onDragOver(event: DragEvent): void {
  if (!fileDrag(event)) return;
  event.preventDefault();
  if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "copy";
  dropping.value = true;
}

/** The files that wait in the import dialog. A source with no settings forms imports them immediately. */
const pending = ref<readonly File[]>([]);
function chosen(files: readonly File[]): void {
  if (files.length === 0) return;
  if (props.source.importers === undefined) void state.importFiles(files);
  else pending.value = files;
}
function onImport(files: readonly File[], options: ImportOptions): void {
  pending.value = [];
  void state.importFiles(files, options);
}

/** The asset sources (Poly Haven). An import selects the new asset and makes its still. */
const sourcesOpen = ref(false);
async function onSourceImported(result: Extract<AssetImportResult, { ok: true }>): Promise<void> {
  sourcesOpen.value = false;
  await state.reload();
  state.selectedId.value = result.asset.id;
  state.status.value = t("sources-imported", { name: result.asset.name, rights: result.rights?.record ?? "" });
  void state.stills.make([result.asset.id], true);
}

function onDrop(event: DragEvent): void {
  dropping.value = false;
  if (!fileDrag(event)) return;
  event.preventDefault();
  chosen([...(event.dataTransfer?.files ?? [])]);
}

function onChosen(): void {
  const files = [...(input.value?.files ?? [])];
  if (input.value !== null) input.value.value = "";
  chosen(files);
}

const chip = "h-6 px-1.5 text-caption";
</script>

<template>
  <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -- a file drop on the browser; the Import button is the keyboard form. -->
  <section
    :class="cn('flex min-h-0 flex-col text-text-primary', dropping && 'ring-2 ring-accent-brand ring-inset')"
    :aria-label="$t('assets-browser')"
    data-testid="asset-browser"
    :data-count="list?.assets.length ?? -1"
    :data-dropping="dropping ? '1' : undefined"
    @dragover="onDragOver"
    @dragleave="dropping = false"
    @drop="onDrop"
  >
    <div class="flex shrink-0 flex-wrap items-center gap-1 border-b border-border-subtle px-1.5 py-1">
      <input
        v-model="query"
        type="search"
        :placeholder="$t('assets-search')"
        :aria-label="$t('assets-search')"
        class="h-6 w-44 min-w-0 rounded-control border border-border-subtle bg-surface-sunken px-1.5 text-caption text-text-primary placeholder:text-text-secondary"
        data-testid="asset-search"
      />
      <div class="flex flex-wrap items-center gap-0.5" role="group" :aria-label="$t('assets-kinds')">
        <Toggle
          v-for="kind in allKinds"
          :key="kind"
          size="sm"
          :class="chip"
          translate="no"
          :model-value="kinds.includes(kind)"
          :data-testid="`asset-kind-${kind}`"
          @update:model-value="state.toggleKind(kind)"
          >{{ kind }}</Toggle
        >
      </div>
      <div class="flex flex-wrap items-center gap-0.5" role="group" :aria-label="$t('assets-tags')">
        <Toggle
          v-for="tag in allTags"
          :key="tag"
          size="sm"
          :class="cn(chip, 'italic')"
          translate="no"
          :model-value="tags.includes(tag)"
          :data-testid="`asset-tag-${tag}`"
          @update:model-value="state.toggleTag(tag)"
          >#{{ tag }}</Toggle
        >
      </div>
      <span class="ml-auto text-caption text-text-secondary" data-testid="asset-shown">{{
        $t("assets-shown", { shown: shown.length, total: list?.assets.length ?? 0 })
      }}</span>
      <Button size="sm" :class="chip" :title="$t('assets-reload')" data-testid="asset-reload" @click="state.reload()">
        <RefreshCw class="size-3.5" aria-hidden="true" />
      </Button>
      <Button
        v-if="source.importSource !== undefined && list?.importable === true"
        size="sm"
        :class="chip"
        :title="$t('sources-open-hint')"
        data-testid="asset-get"
        @click="sourcesOpen = !sourcesOpen"
      >
        <Globe class="size-3.5" aria-hidden="true" />
        {{ $t("sources-open") }}
      </Button>
      <Button
        v-if="source.makeStill !== undefined && list !== null"
        size="sm"
        :class="chip"
        :disabled="state.stills.open.value.length === 0 || state.stills.drawing.value > 0"
        :title="$t('assets-make-stills-hint')"
        data-testid="asset-make-stills"
        @click="state.stills.make()"
      >
        <Images class="size-3.5" aria-hidden="true" />
        {{ $t("assets-make-stills", { count: state.stills.open.value.length }) }}
      </Button>
      <Button
        size="sm"
        :class="chip"
        :disabled="list?.importable !== true || importing > 0"
        :title="list?.reason ?? $t('assets-import-title', { extensions: list?.extensions.join(' ') ?? '' })"
        data-testid="asset-import"
        @click="input?.click()"
      >
        <Upload class="size-3.5" aria-hidden="true" />
        {{ $t("assets-import") }}
      </Button>
      <input
        ref="input"
        type="file"
        multiple
        class="hidden"
        :aria-label="$t('assets-import-files')"
        :accept="list?.extensions.join(',')"
        data-testid="asset-import-input"
        @change="onChosen"
      />
    </div>
    <SourcesDialog v-if="sourcesOpen" :source="source" @imported="onSourceImported" @close="sourcesOpen = false" />
    <ImportDialog
      v-if="pending.length > 0"
      :files="pending"
      :source="source"
      @import="onImport"
      @cancel="pending = []"
    />
    <RightsBar
      v-if="state.rights.picked.value.length > 0 && source.assignRights !== undefined"
      :count="state.rights.picked.value.length"
      :records="state.rights.records.value"
      @assign="state.rights.assign"
      @clear="state.rights.clear"
    />
    <ul
      v-if="state.queue.value.length > 0"
      class="flex flex-col gap-0.5 border-b border-border-subtle p-1.5 text-caption"
      :aria-label="$t('assets-import-queue')"
      data-testid="asset-import-queue"
    >
      <li
        v-for="item in state.queue.value"
        :key="item.name"
        class="flex gap-2"
        :data-state="item.state"
        data-testid="asset-import-row"
      >
        <span class="min-w-0 flex-1 truncate" translate="no">{{ item.name }}</span>
        <span :class="item.state === 'failed' ? 'text-status-critical' : 'text-text-secondary'">
          {{ $t(`assets-import-state-${item.state}`) }}
        </span>
        <span
          v-if="item.reason !== undefined"
          class="min-w-0 flex-1 truncate text-status-critical"
          :title="item.reason"
        >
          {{ item.reason }}
        </span>
        <span v-if="importFix(item.reason) !== null" class="flex gap-1" data-testid="asset-import-fix">
          {{ $t(importFix(item.reason)?.text ?? "") }}
          <a
            class="text-text-link underline"
            :href="importFix(item.reason)?.url"
            target="_blank"
            rel="noopener noreferrer"
            >{{ $t(importFix(item.reason)?.link ?? "") }}</a
          >
        </span>
      </li>
      <li v-if="state.importing.value > 0" class="flex">
        <Button size="sm" variant="ghost" data-testid="asset-import-cancel" @click="state.cancelImports">
          {{ $t("assets-import-queue-cancel") }}
        </Button>
      </li>
    </ul>
    <div class="flex min-h-0 flex-1">
      <div class="min-h-0 flex-1 overflow-auto p-1.5">
        <p v-if="error !== null" class="text-caption text-status-critical" role="alert">{{ error }}</p>
        <p v-else-if="list !== null && list.assets.length === 0" class="text-caption text-text-secondary">
          {{ list.importable ? $t("assets-empty-importable") : $t("assets-empty") }}
        </p>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-1" data-testid="asset-grid">
          <AssetTile
            v-for="asset in shown"
            :key="asset.id"
            :asset="asset"
            :base="stills === false ? null : source.base"
            :selected="selected?.id === asset.id"
            :still-state="state.stills.states.value.get(asset.id)"
            :still-key="state.stills.version.value"
            :picked="state.rights.picked.value.includes(asset.id)"
            :rights-problems="state.rights.blocked.value.get(asset.id)"
            :agent-mark="markOf([asset.record, asset.source])"
            @select="state.select"
            @pick="state.rights.toggle"
          />
        </div>
      </div>
      <AssetInspector
        v-if="selected !== null"
        :asset="selected"
        :source="source"
        :stills="stills !== false"
        :lines="lines"
        :select-entity="selectEntity"
        :open-prefab="openPrefab"
        :open-material="openMaterial"
        :open-document="openDocument"
        @changed="state.reload()"
      />
    </div>
    <p
      v-if="status !== ''"
      class="shrink-0 truncate px-1.5 text-caption text-text-secondary"
      role="status"
      data-testid="asset-status"
    >
      {{ status }}
    </p>
  </section>
</template>
