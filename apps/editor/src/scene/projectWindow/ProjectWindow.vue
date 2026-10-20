<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Project window: the favourites and the folder tree of the project folder on the left. On the right, the Assets
 * view (the asset browser: tiles with stills, the import, the filters, "used by") or the entries of a folder in a grid
 * or a list.
 *
 * - An entry has the icon of its kind (a scene, a prefab, a material, a sequence, rules, a plugin, an asset with its
 *   still).
 * - Search words and a kind filter select the entries. The create menu makes a folder, a scene, a material or a
 *   sequence.
 * - Enter or a double-click opens an entry, and F2 renames it. A drag onto a folder of the tree moves it (an asset
 *   keeps its ID, so its references stay).
 * - An asset drags to the views, the hierarchy and the fields. Reveal shows an entry on the disk, and the star keeps it
 *   in the favourites.
 */
import { useI18n } from "@scenity/i18n";
import { Button, Menu, Select } from "@scenity/ui";
import {
  Box,
  Clapperboard,
  File,
  Film,
  Folder,
  FolderOpen,
  LayoutGrid,
  List,
  Package,
  Palette,
  Puzzle,
  ScrollText,
  Star,
} from "lucide-vue-next";
import { computed, onMounted, ref, shallowRef, type Component } from "vue";
import AssetBrowser from "../../assetBrowser/AssetBrowser.vue";
import type { AssetSource } from "../../assetBrowser/assetClient";
import { ASSET_DRAG_TYPE, assetDragValue } from "../../assetBrowser/assetTypes";
import { usePanelState } from "../../studio/extensions/api";
import { ENTITY_DRAG_TYPE } from "../hierarchy/hierarchyUi";
import { pageKeys } from "../settings/pageKeys";
import {
  favouritesOf,
  FILE_KINDS,
  folderOf,
  folders,
  nameOf,
  shownEntries,
  type FileKind,
  type ProjectEntry,
  type ProjectFilesClient,
} from "./projectFiles";

const props = defineProps<{
  files: ProjectFilesClient;
  project: string;
  /** The props of the asset browser (the Assets view). */
  browser: { readonly source: AssetSource } & Readonly<Record<string, unknown>>;
  /** The stills of the assets (asset ID → URL). */
  stills(): Promise<ReadonlyMap<string, string>>;
  /** Open an entry: a scene, a material, a prefab. */
  open(entry: ProjectEntry): void;
  /** Run a command of the create menu. */
  create(command: string): void;
}>();
const { $t } = useI18n();

/** "assets" is the Assets view; another value is a folder ("" for the root). */
const place = usePanelState<string>("place", "assets");
const grid = usePanelState<boolean>("grid", true);
const query = ref("");
const kind = ref<string>("all");
const entries = shallowRef<readonly ProjectEntry[]>([]);
const stillOf = shallowRef<ReadonlyMap<string, string>>(new Map());
const favourites = ref<string[]>(favouritesOf(props.project).read());
const renaming = ref<string | null>(null);
const reason = ref<string | null>(null);

async function reload(): Promise<void> {
  entries.value = await props.files.list().catch(() => []);
  stillOf.value = await props.stills().catch(() => new Map());
}
onMounted(() => void reload());

const tree = computed(() => folders(entries.value));
const shown = computed(() =>
  place.value === "assets"
    ? []
    : shownEntries(entries.value, place.value, query.value, FILE_KINDS.find((item) => item === kind.value) ?? null),
);
const kindOptions = computed(() => [
  { value: "all", label: $t("project-kind-all") },
  ...FILE_KINDS.map((item) => ({ value: item, label: $t(`project-kind-${item}`) })),
]);
const createItems = computed(() => [
  { value: "folder", label: $t("project-new-folder") },
  { value: "scene.new", label: $t("project-new-scene") },
  { value: "material.new", label: $t("project-new-material") },
  { value: "sequence.new", label: $t("project-new-sequence") },
]);

const ICONS: Readonly<Record<FileKind, Component>> = {
  folder: Folder,
  scene: Clapperboard,
  prefab: Package,
  material: Palette,
  sequence: Film,
  rules: ScrollText,
  plugin: Puzzle,
  asset: Box,
  file: File,
};

async function act(work: Promise<string | null>): Promise<void> {
  reason.value = await work;
  await reload();
}

function onCreate(value: string): void {
  if (value !== "folder") {
    props.create(value);
    return;
  }
  const base = place.value === "assets" ? "" : place.value;
  const name = $t("project-new-folder-name");
  void act(props.files.folder(base === "" ? name : `${base}/${name}`));
}

function enter(entry: ProjectEntry): void {
  if (entry.kind === "folder" || entry.kind === "plugin") place.value = entry.path;
  else props.open(entry);
}

function rename(entry: ProjectEntry, name: string): void {
  renaming.value = null;
  const text = name.trim();
  if (text === "" || text === nameOf(entry.path)) return;
  const folder = folderOf(entry.path);
  void act(props.files.move(entry.path, folder === "" ? text : `${folder}/${text}`));
}

function toggleFavourite(path: string): void {
  favourites.value = favourites.value.includes(path)
    ? favourites.value.filter((item) => item !== path)
    : [...favourites.value, path];
  favouritesOf(props.project).write(favourites.value);
}

function onEntryKey(event: KeyboardEvent, entry: ProjectEntry): void {
  if (event.key === "Enter") enter(entry);
  else if (event.key === "F2") {
    event.preventDefault();
    renaming.value = entry.path;
  }
}

function onDragStart(event: DragEvent, entry: ProjectEntry): void {
  const transfer = event.dataTransfer;
  if (transfer === null) return;
  transfer.setData("application/x-scenity-file", entry.path);
  if (entry.asset !== null) {
    transfer.setData(ASSET_DRAG_TYPE, assetDragValue(entry.asset));
    transfer.setData("text/plain", assetDragValue(entry.asset));
  } else transfer.setData("text/plain", entry.path);
  transfer.effectAllowed = "copyMove";
}

function onFolderOver(event: DragEvent): void {
  const types = event.dataTransfer?.types ?? [];
  if (types.includes("application/x-scenity-file") || types.includes(ENTITY_DRAG_TYPE)) event.preventDefault();
}

/** Hierarchy rows that drop on a folder become a prefab in it; the selection becomes its instance. */
async function makePrefab(folder: string): Promise<string | null> {
  try {
    await pageKeys().execute("prefab.create", { folder: folder === "" ? "." : folder });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function onFolderDrop(event: DragEvent, folder: string): void {
  event.preventDefault();
  if ((event.dataTransfer?.getData(ENTITY_DRAG_TYPE) ?? "") !== "") {
    void act(makePrefab(folder));
    return;
  }
  const from = event.dataTransfer?.getData("application/x-scenity-file") ?? "";
  if (from === "" || folderOf(from) === folder || from === folder) return;
  void act(props.files.move(from, folder === "" ? nameOf(from) : `${folder}/${nameOf(from)}`));
}

const depth = (path: string): number => (path === "" ? 0 : path.split("/").length);
</script>

<template>
  <section class="flex h-full min-h-0 text-caption" :aria-label="$t('panel-project')" data-testid="project-window">
    <nav
      class="flex w-48 shrink-0 flex-col gap-0.5 overflow-auto border-r border-border-subtle p-1"
      :aria-label="$t('project-folders')"
    >
      <template v-if="favourites.length > 0">
        <h3 class="px-1 text-text-secondary">{{ $t("project-favourites") }}</h3>
        <button
          v-for="path in favourites"
          :key="`fav-${path}`"
          type="button"
          class="flex items-center gap-1 truncate rounded-control px-1 py-0.5 text-left hover:bg-surface-sunken"
          translate="no"
          data-testid="project-favourite"
          @click="
            place = entries.some((entry) => entry.path === path && entry.kind !== 'folder') ? folderOf(path) : path
          "
        >
          <Star class="size-3 shrink-0 text-text-secondary" aria-hidden="true" />{{ nameOf(path) }}
        </button>
      </template>
      <button
        type="button"
        class="flex items-center gap-1 rounded-control px-1 py-0.5 text-left hover:bg-surface-sunken"
        :aria-current="place === 'assets' ? 'page' : undefined"
        data-testid="project-assets"
        @click="place = 'assets'"
      >
        <Box class="size-3.5 shrink-0" aria-hidden="true" />{{ $t("project-assets") }}
      </button>
      <button
        type="button"
        class="flex items-center gap-1 rounded-control px-1 py-0.5 text-left hover:bg-surface-sunken"
        :aria-current="place === '' ? 'page' : undefined"
        data-testid="project-folder"
        data-path=""
        @click="place = ''"
        @dragover="onFolderOver"
        @drop="onFolderDrop($event, '')"
      >
        <FolderOpen class="size-3.5 shrink-0" aria-hidden="true" />{{ $t("project-root") }}
      </button>
      <button
        v-for="folder in tree"
        :key="folder.path"
        type="button"
        class="flex items-center gap-1 truncate rounded-control py-0.5 pr-1 text-left hover:bg-surface-sunken"
        :style="{ paddingLeft: `calc(var(--spacing) * ${String(depth(folder.path) * 2 + 1)})` }"
        :aria-current="place === folder.path ? 'page' : undefined"
        translate="no"
        data-testid="project-folder"
        :data-path="folder.path"
        @click="place = folder.path"
        @dragover="onFolderOver"
        @drop="onFolderDrop($event, folder.path)"
      >
        <component :is="ICONS[folder.kind]" class="size-3.5 shrink-0 text-text-secondary" aria-hidden="true" />{{
          nameOf(folder.path)
        }}
      </button>
    </nav>
    <AssetBrowser v-if="place === 'assets'" v-bind="browser" />
    <div v-else class="flex min-w-0 flex-1 flex-col gap-1 p-1">
      <div class="flex flex-wrap items-center gap-1">
        <input
          v-model="query"
          type="search"
          class="min-h-7 min-w-24 flex-1 rounded-control border border-border-subtle bg-surface-sunken px-1.5"
          :aria-label="$t('project-search')"
          :placeholder="$t('project-search')"
          data-testid="project-search"
        />
        <Select v-model="kind" :options="kindOptions" class="w-32" :aria-label="$t('project-kind')" />
        <Menu :items="createItems" @select="onCreate">
          <template #trigger>
            <Button size="sm" variant="secondary" data-testid="project-create">{{ $t("project-create") }}</Button>
          </template>
        </Menu>
        <Button
          size="sm"
          variant="ghost"
          :aria-label="grid ? $t('project-list') : $t('project-grid')"
          :title="grid ? $t('project-list') : $t('project-grid')"
          data-testid="project-view"
          @click="grid = !grid"
        >
          <List v-if="grid" class="size-icon-sm" aria-hidden="true" />
          <LayoutGrid v-else class="size-icon-sm" aria-hidden="true" />
        </Button>
      </div>
      <p v-if="reason !== null" class="text-status-negative" role="alert" data-testid="project-reason">{{ reason }}</p>
      <p v-if="shown.length === 0" class="text-text-secondary">{{ $t("project-empty") }}</p>
      <ul
        :class="grid ? 'grid grid-cols-4 gap-1' : 'flex flex-col'"
        class="min-h-0 overflow-auto"
        :aria-label="$t('project-entries')"
      >
        <li
          v-for="entry in shown"
          :key="entry.path"
          :data-path="entry.path"
          :data-kind="entry.kind"
          data-testid="project-entry"
        >
          <div
            role="button"
            tabindex="0"
            draggable="true"
            :class="grid ? 'flex flex-col items-center gap-1 p-1' : 'flex items-center gap-1 px-1 py-0.5'"
            class="rounded-control hover:bg-surface-sunken focus-visible:ring-1 focus-visible:ring-accent-brand"
            @dblclick="enter(entry)"
            @keydown="onEntryKey($event, entry)"
            @dragstart="onDragStart($event, entry)"
            @dragover="entry.kind === 'folder' ? onFolderOver($event) : undefined"
            @drop="entry.kind === 'folder' ? onFolderDrop($event, entry.path) : undefined"
          >
            <img
              v-if="grid && entry.asset !== null && stillOf.get(entry.asset) !== undefined"
              :src="stillOf.get(entry.asset)"
              alt=""
              class="aspect-square w-full rounded-control object-cover"
              loading="lazy"
            />
            <component :is="ICONS[entry.kind]" v-else class="size-6 shrink-0 text-text-secondary" aria-hidden="true" />
            <input
              v-if="renaming === entry.path"
              type="text"
              class="min-w-0 rounded-control border border-border-subtle bg-surface-sunken px-1"
              :value="nameOf(entry.path)"
              :aria-label="$t('project-rename', { name: nameOf(entry.path) })"
              data-testid="project-rename"
              @keydown.enter.stop="rename(entry, ($event.target as HTMLInputElement).value)"
              @keydown.escape.stop="renaming = null"
            />
            <span v-else class="min-w-0 truncate" translate="no" :title="entry.path">{{ nameOf(entry.path) }}</span>
          </div>
          <div class="flex justify-center gap-0.5">
            <button
              type="button"
              class="rounded-control px-1 text-text-secondary hover:bg-surface-sunken"
              :aria-pressed="favourites.includes(entry.path)"
              :aria-label="$t('project-favourite', { name: nameOf(entry.path) })"
              data-testid="project-star"
              @click="toggleFavourite(entry.path)"
            >
              <Star class="size-3" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="rounded-control px-1 text-text-secondary hover:bg-surface-sunken"
              :aria-label="$t('project-reveal', { name: nameOf(entry.path) })"
              data-testid="project-reveal"
              @click="act(files.reveal(entry.path))"
            >
              {{ $t("project-reveal-short") }}
            </button>
          </div>
        </li>
      </ul>
    </div>
  </section>
</template>
