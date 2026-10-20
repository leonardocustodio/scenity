<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The hierarchy panel of the scene page, on the left side in the edit mode: the
 * entity tree with expand and collapse, the search by name, tag or component (`tag:`, `component:` or `c:` and
 * `name:` set the field), and a row for each entity (HierarchyRow.vue). A click selects, ⌘ or Ctrl adds, Shift
 * selects a range; the selection is the selection of the page. Each change is a command and one step of the history.
 * A right click opens the context menu of the entity commands (HierarchyMenu.vue).
 *
 * The tree is a virtual list (only the rows in the view and a few more are in the page, so 10,000 entities
 * scroll at the frame rate); the keys of the tree (treeKeys.ts) select, open, close and move the entities; + creates
 * an entity of a preset; an asset of the Project window that drops on the tree adds a model.
 *
 * Its texts are Fluent messages of `src/i18n/en-US/hierarchy.ftl`.
 */
import { ENTITY_PRESETS } from "@scenity/editor-core";
import { PLUGIN_PRESETS } from "../extensions/pluginPresets";
import { useI18n } from "@scenity/i18n";
import { Menu } from "@scenity/ui";
import { Plus } from "lucide-vue-next";
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from "vue";
import { ASSET_DRAG_TYPE } from "../../assetBrowser/assetTypes";
import { messageIdOf, textOr } from "../../texts";
import HierarchyMenu from "./HierarchyMenu.vue";
import HierarchyRow from "./HierarchyRow.vue";
import { HIERARCHY_KEY, type HierarchyState } from "./hierarchyState";
import { button, ROW_HEIGHT, ROW_UNITS, searchField } from "./hierarchyUi";
import { treeKey } from "./treeKeys";
import { EmptyState } from "../../studio/extensions/api";

const props = defineProps<{ state: HierarchyState }>();
const { $t } = useI18n();
provide(HIERARCHY_KEY, props.state);

const { rows, query, error, view, drop, selected, doc } = props.state;

// The window of the virtual list: the rows in the view of the tree, and OVERSCAN rows above and below it.
const OVERSCAN = 8;
const tree = ref<HTMLUListElement | null>(null);
const top = ref(0);
const height = ref(600);
/** The height of a row in pixels: measured on a row (the text size of the person changes it). */
const rowHeight = ref(ROW_HEIGHT);
const first = computed(() => Math.max(0, Math.floor(top.value / rowHeight.value) - OVERSCAN));
const last = computed(() =>
  Math.min(rows.value.length, Math.ceil((top.value + height.value) / rowHeight.value) + OVERSCAN),
);
/** The style of a spacer of `count` rows (in the unit of the row class). */
const spacer = (count: number): Record<string, string> => ({
  height: `calc(var(--spacing) * ${String(count * ROW_UNITS)})`,
  flex: "none",
});
const shown = computed(() => rows.value.slice(first.value, last.value));
let resize: ResizeObserver | null = null;
onMounted(() => {
  const element = tree.value;
  if (element === null) return;
  const measure = (): void => {
    height.value = element.clientHeight || height.value;
    // A row with no layout (a hidden panel) keeps the height before.
    const measured = element.querySelector<HTMLElement>("[data-row]")?.offsetHeight ?? 0;
    if (measured > 0) rowHeight.value = measured;
  };
  measure();
  resize = new ResizeObserver(measure);
  resize.observe(element);
});
onBeforeUnmount(() => resize?.disconnect());

/** Scroll the tree so that the row of an entity is in the view. */
function reveal(id: string): void {
  const element = tree.value;
  const at = rows.value.findIndex((row) => row.id === id);
  if (element === null || at < 0) return;
  const y = at * rowHeight.value;
  if (y < element.scrollTop) element.scrollTop = y;
  else if (y + rowHeight.value > element.scrollTop + element.clientHeight)
    element.scrollTop = y + rowHeight.value - element.clientHeight;
  top.value = element.scrollTop;
}

// A selection from another part of the page (the view, the search box) scrolls to its first entity.
watch(selected, (ids) => {
  const id = ids[0];
  if (id !== undefined) reveal(id);
});

/** The keys of the tree on the row that has the focus. */
async function onTreeKey(event: KeyboardEvent): Promise<void> {
  const row = (event.target as HTMLElement).closest<HTMLElement>("[data-row]");
  const id = row?.dataset.row;
  if (id === undefined || (event.target as HTMLElement).tagName === "INPUT") return;
  const action = treeKey(rows.value, doc.value, id, event.key, { alt: event.altKey, shift: event.shiftKey });
  if (action === null) return;
  event.preventDefault();
  event.stopPropagation();
  await props.state.keyAction(action);
  const focus = action.id;
  reveal(focus);
  await nextTick();
  tree.value?.querySelector<HTMLElement>(`[data-row="${CSS.escape(focus)}"]`)?.focus();
}

// The + menu: the presets of the Create menu.
const createItems = computed(() => [
  ...ENTITY_PRESETS.map((preset) => {
    const id = `entity.create.${preset.id}`;
    return {
      value: preset.id,
      label: textOr(messageIdOf("menu-item", id), textOr(messageIdOf("settings-command", id), preset.name)),
    };
  }),
  // The presets of the plugins.
  ...PLUGIN_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
]);

function carriesAsset(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes(ASSET_DRAG_TYPE) === true;
}

function onRootOver(event: DragEvent): void {
  if (carriesAsset(event)) {
    event.preventDefault();
    return;
  }
  if (!props.state.over(null, "inside")) return;
  event.preventDefault();
  const transfer = event.dataTransfer ?? null;
  if (transfer !== null) transfer.dropEffect = "move";
}

function onRootDrop(event: DragEvent): void {
  event.preventDefault();
  const asset = event.dataTransfer?.getData(ASSET_DRAG_TYPE) ?? "";
  if (asset !== "") void props.state.dropAsset(asset, null, "inside");
  else void props.state.dropOn(null, "inside");
}

/** A right click on the empty tree opens the menu of the scene root. */
function onRootMenu(event: MouseEvent): void {
  event.preventDefault();
  props.state.openMenu(null, event.clientX, event.clientY);
}
</script>

<template>
  <nav class="flex h-full flex-col gap-1.5 text-caption text-text-primary" :aria-label="$t('hierarchy-title')">
    <header class="flex items-center justify-between gap-2">
      <h2 class="flex-1 text-label">{{ $t("hierarchy-title") }}</h2>
      <Menu :items="createItems" @select="(value: string) => void state.create(value)">
        <template #trigger>
          <button
            type="button"
            :class="button"
            :aria-label="$t('hierarchy-create')"
            :title="$t('hierarchy-create')"
            data-testid="hierarchy-create"
          >
            <Plus class="size-icon-sm" aria-hidden="true" />
          </button>
        </template>
      </Menu>
      <button
        v-if="view.solo.length > 0"
        type="button"
        :class="button"
        data-testid="hierarchy-show-all"
        :title="$t('hierarchy-show-all-title')"
        @click="state.showAll()"
      >
        {{ $t("hierarchy-show-all") }}
      </button>
    </header>
    <label for="scene-hierarchy-search" class="flex">
      <span class="sr-only">{{ $t("hierarchy-search-label") }}</span>
      <input
        id="scene-hierarchy-search"
        v-model="query"
        type="search"
        :class="searchField"
        :placeholder="$t('hierarchy-search-placeholder')"
        data-testid="hierarchy-search"
      />
    </label>
    <ul
      ref="tree"
      role="tree"
      tabindex="-1"
      :aria-label="$t('hierarchy-tree')"
      aria-multiselectable="true"
      class="flex min-h-0 flex-1 flex-col overflow-auto pb-6"
      :data-selection="selected.join(',')"
      data-testid="hierarchy-tree"
      :data-rows="rows.length"
      @scroll="top = ($event.target as HTMLElement).scrollTop"
      @keydown="onTreeKey"
      @dragover="onRootOver"
      @dragleave="state.clearMark()"
      @drop="onRootDrop"
      @contextmenu="onRootMenu"
    >
      <li v-if="first > 0" role="presentation" :style="spacer(first)" />
      <HierarchyRow
        v-for="(row, index) in shown"
        :key="row.id"
        :row="row"
        :position="first + index + 1"
        :count="rows.length"
      />
      <li v-if="last < rows.length" role="presentation" :style="spacer(rows.length - last)" />
      <li
        v-if="drop?.target === null"
        role="presentation"
        class="mx-1 h-0.5 bg-accent-brand"
        data-testid="hierarchy-drop-root"
      />
      <li v-if="rows.length === 0" role="presentation" class="px-1 text-text-secondary" data-testid="hierarchy-empty">
        <EmptyState panel="hierarchy" :text="$t('hierarchy-empty')" />
      </li>
    </ul>
    <HierarchyMenu />
    <p v-if="error !== null" class="text-caption text-text-secondary" role="alert" data-testid="hierarchy-error">
      {{ error }}
    </p>
  </nav>
</template>
