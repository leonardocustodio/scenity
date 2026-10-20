<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * One row of the hierarchy panel: the expand button, the name (a double-click or
 * F2 opens the rename field), and the hide, solo and lock toggles. A drag of the row moves the selected entities: the
 * top quarter of a row drops before it, the bottom quarter after it, the middle inside it. A right click
 * opens the context menu of the entity commands. Its texts are Fluent messages of
 * `src/i18n/en-US/hierarchy.ftl`, and the entity name is data (`translate="no"`).
 *
 * An instance row has a prefab mark, a prefab row (an entity of a prefab, `<instance>/<entity>`) has no drag,
 * and a row with overrides has a mark with their number. The toggles and the rename of a prefab row change the
 * instance only (overrides, or the view state).
 */
import { isShown, type TreeRow } from "@scenity/editor-core";
import { pageNotes } from "../notes/pageNotes";
import { useI18n } from "@scenity/i18n";
import { ChevronDown, ChevronRight, Crosshair, Eye, EyeOff, Lock, LockOpen, Package } from "lucide-vue-next";
import { computed, nextTick, ref, watch } from "vue";
import { placeAt, rowKind, useHierarchy } from "./hierarchyState";
import { ENTITY_DRAG_TYPE, iconButton, rowClass, toggleOn } from "./hierarchyUi";
import { ASSET_DRAG_TYPE } from "../../assetBrowser/assetTypes";
import { entityIcon } from "./entityIcons";
import { pageReview } from "../review/reviewState";
import { workingOn } from "../agent/presence";
import { actorColour } from "../actorColour";

const props = defineProps<{
  row: TreeRow;
  /** The place of the row in the whole tree (1 for the first) and the count of the rows. */
  position?: number;
  count?: number;
}>();
/** The notes of the note file on this entity. */
const notesHere = computed(
  () => (pageNotes()?.file.value?.notes ?? []).filter((note) => note.at === `entity:${props.row.id}`).length,
);
const state = useHierarchy();
const { $t } = useI18n();
const { selected, editing, dimmed, locked, view, drop, doc, overrides } = state;

const id = computed(() => props.row.id);
const isSelected = computed(() => selected.value.includes(id.value));
const hidden = computed(() => !isShown(doc.value, id.value));
const solo = computed(() => view.value.solo.includes(id.value));
const lockedHere = computed(() => view.value.locked.includes(id.value));
const mark = computed(() => (drop.value?.target === id.value ? drop.value.place : null));
const kind = computed(() => rowKind(doc.value, id.value));
const overridden = computed(() => overrides.value.get(id.value) ?? 0);
// A change of an agent that waits for review: a dot in the colour of its session; a removed row struck out.
const change = computed(() => pageReview()?.entities.value.get(id.value) ?? null);
// A turn of an agent that runs works on this entity: a ring in the colour of its session.
const working = computed(() => workingOn(id.value));
const field = ref<HTMLInputElement | null>(null);
// One row of the tree takes the Tab key: the first selected row, else the first row.
const tabStop = computed(() => (selected.value.length === 0 ? props.position === 1 : selected.value[0] === id.value));
// The icon of the main component of the entity.
const icon = computed(() => entityIcon(doc.value.entities[id.value]?.components ?? {}, kind.value));

watch(
  () => editing.value === id.value,
  async (open) => {
    if (!open) return;
    await nextTick();
    field.value?.focus();
    field.value?.select();
  },
);

function onClick(event: MouseEvent): void {
  state.click(id.value, { shift: event.shiftKey, toggle: event.metaKey || event.ctrlKey });
}

// F2 is the page command `hierarchy.rename` of the key map (startHierarchy.ts).
function onKey(event: KeyboardEvent): void {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    state.click(id.value, { shift: event.shiftKey, toggle: event.metaKey || event.ctrlKey });
  }
}

function onFieldKey(event: KeyboardEvent): void {
  event.stopPropagation();
  if (event.key === "Enter") void state.rename(id.value, (event.target as HTMLInputElement).value);
  else if (event.key === "Escape") state.cancelRename();
}

function onBlur(event: FocusEvent): void {
  if (editing.value === id.value) void state.rename(id.value, (event.target as HTMLInputElement).value);
}

/** A right click opens the context menu of the row. */
function onMenu(event: MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
  state.openMenu(id.value, event.clientX, event.clientY);
}

function onDragStart(event: DragEvent): void {
  state.startDrag(id.value);
  const transfer = event.dataTransfer ?? null;
  transfer?.setData("text/plain", state.dragging.value.join(","));
  // The composer of the agent panel takes the rows as mentions.
  transfer?.setData(ENTITY_DRAG_TYPE, state.dragging.value.join(","));
  if (transfer !== null) transfer.effectAllowed = "move";
}

function placeOf(event: DragEvent) {
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  return placeAt(event.clientY - box.top, box.height);
}

function onDragOver(event: DragEvent): void {
  // The tree under the rows takes a drop at the end of the roots: a drag over a row does not reach it.
  event.stopPropagation();
  // An asset of the Project window goes into the row.
  if (event.dataTransfer?.types.includes(ASSET_DRAG_TYPE) === true && kind.value !== "prefab") {
    event.preventDefault();
    return;
  }
  if (!state.over(id.value, placeOf(event))) return;
  event.preventDefault();
  const transfer = event.dataTransfer ?? null;
  if (transfer !== null) transfer.dropEffect = "move";
}

function onDrop(event: DragEvent): void {
  event.preventDefault();
  event.stopPropagation();
  const asset = event.dataTransfer?.getData(ASSET_DRAG_TYPE) ?? "";
  if (asset !== "") {
    void state.dropAsset(asset, id.value, "inside");
    return;
  }
  void state.dropOn(id.value, placeOf(event));
}
</script>

<template>
  <!-- eslint-disable-next-line vuejs-accessibility/interactive-supports-focus -- one row has the tab stop (a roving tabindex); the keys of the tree move the focus. -->
  <li
    role="treeitem"
    :tabindex="tabStop ? 0 : -1"
    :aria-posinset="position"
    :aria-setsize="count"
    :data-row="id"
    :class="[rowClass, isSelected ? 'bg-accent-brand/20' : 'hover:bg-surface-raised', dimmed.has(id) && 'opacity-50']"
    :style="{ paddingLeft: `calc(var(--spacing) * ${String(row.depth * 3.5 + 0.5)})` }"
    :aria-level="row.depth + 1"
    :aria-selected="isSelected"
    :aria-expanded="row.children > 0 ? row.expanded : undefined"
    :data-testid="`hierarchy-row-${id}`"
    :data-drop="mark ?? undefined"
    :data-match="row.match ? undefined : 'parent'"
    :data-kind="kind"
    :draggable="editing !== id && kind !== 'prefab'"
    @click="onClick"
    @dblclick="state.startRename(id)"
    @keydown="onKey"
    @dragstart="onDragStart"
    @dragover="onDragOver"
    @dragleave="state.clearMark()"
    @drop="onDrop"
    @dragend="state.endDrag()"
    @contextmenu="onMenu"
  >
    <span v-if="mark === 'before'" class="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-accent-brand" />
    <span v-if="mark === 'after'" class="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-accent-brand" />
    <span
      v-if="mark === 'inside'"
      class="pointer-events-none absolute inset-0 rounded-control border border-accent-brand"
    />
    <button
      v-if="row.children > 0"
      type="button"
      :class="iconButton"
      :aria-label="row.expanded ? $t('hierarchy-collapse') : $t('hierarchy-expand')"
      :data-testid="`hierarchy-expand-${id}`"
      @click.stop="state.toggleExpand(id)"
    >
      <ChevronDown v-if="row.expanded" class="size-3.5" />
      <ChevronRight v-else class="size-3.5" />
    </button>
    <span v-else class="inline-block size-6 shrink-0" />
    <component
      :is="icon.icon"
      class="mr-0.5 size-3.5 shrink-0"
      :class="kind === 'entity' ? 'text-text-secondary' : 'text-studio-prefab'"
      aria-hidden="true"
      :data-icon="icon.component"
    />
    <input
      v-if="editing === id"
      ref="field"
      type="text"
      class="min-h-6 min-w-0 flex-1 rounded-control border border-border-subtle bg-surface-sunken px-1 text-caption text-text-primary"
      :value="row.label"
      :aria-label="$t('hierarchy-rename-field', { name: row.label })"
      data-testid="hierarchy-rename"
      @click.stop
      @keydown="onFieldKey"
      @blur="onBlur"
    />
    <span
      v-else
      class="min-w-0 flex-1 truncate"
      translate="no"
      :title="id"
      :class="[
        row.match ? '' : 'text-text-secondary',
        kind !== 'entity' && row.match && 'text-studio-prefab',
        kind === 'prefab' && 'italic',
        change?.change === 'removed' && 'line-through',
      ]"
    >
      {{ row.label }}
    </span>
    <span
      v-if="working !== null"
      class="size-2.5 shrink-0 rounded-full border-2 motion-safe:animate-pulse"
      :style="{ borderColor: actorColour(working.session) }"
      role="img"
      :aria-label="$t('agent-works-on', { name: working.session.name })"
      :title="$t('agent-works-on', { name: working.session.name })"
      :data-testid="`hierarchy-working-${id}`"
    />
    <span
      v-if="change !== null"
      class="size-2 shrink-0 rounded-full"
      :style="{ background: change.colour }"
      role="img"
      :aria-label="$t('review-mark', { by: change.by })"
      :title="$t('review-mark', { by: change.by })"
      :data-testid="`hierarchy-change-${id}`"
      :data-change="change.change"
    />
    <Package
      v-if="kind === 'instance'"
      class="size-3.5 shrink-0 text-accent-brand"
      :aria-label="$t('hierarchy-instance')"
      :data-testid="`hierarchy-prefab-${id}`"
    />
    <span
      v-if="overridden > 0"
      class="shrink-0 rounded-control bg-accent-brand/20 px-1 text-caption text-accent-brand"
      :title="$t('hierarchy-overrides', { count: overridden })"
      :data-testid="`hierarchy-override-${id}`"
      >{{ overridden }}</span
    >
    <span
      v-if="notesHere > 0"
      class="shrink-0 rounded-control bg-status-caution px-1 text-caption text-text-primary"
      :title="$t('hierarchy-notes', { count: notesHere })"
      :data-testid="`hierarchy-notes-${id}`"
      >{{ notesHere }}</span
    >
    <button
      type="button"
      :class="[iconButton, hidden && toggleOn]"
      :aria-pressed="hidden"
      :aria-label="hidden ? $t('hierarchy-unhide', { name: row.label }) : $t('hierarchy-hide', { name: row.label })"
      :title="hidden ? $t('hierarchy-unhide-title') : $t('hierarchy-hide-title')"
      :data-testid="`hierarchy-hide-${id}`"
      @click.stop="state.toggle('hide', id)"
    >
      <EyeOff v-if="hidden" class="size-3.5" />
      <Eye v-else class="size-3.5" />
    </button>
    <button
      type="button"
      :class="[iconButton, solo && toggleOn]"
      :aria-pressed="solo"
      :aria-label="$t('hierarchy-solo', { name: row.label })"
      :title="$t('hierarchy-solo-title')"
      :data-testid="`hierarchy-solo-${id}`"
      @click.stop="state.toggle('solo', id)"
    >
      <Crosshair class="size-3.5" />
    </button>
    <button
      type="button"
      :class="[iconButton, lockedHere && toggleOn, !lockedHere && locked.has(id) && 'text-text-primary']"
      :aria-pressed="lockedHere"
      :aria-label="lockedHere ? $t('hierarchy-unlock', { name: row.label }) : $t('hierarchy-lock', { name: row.label })"
      :title="$t('hierarchy-lock-title')"
      :data-testid="`hierarchy-lock-${id}`"
      @click.stop="state.toggle('lock', id)"
    >
      <Lock v-if="locked.has(id)" class="size-3.5" />
      <LockOpen v-else class="size-3.5" />
    </button>
  </li>
</template>
