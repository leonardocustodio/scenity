<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The tree of the content browser: the folders (the categories, the characters, the groups) with the number of their
 * items. A press shows the folder in the grid. The up and down keys move the focus. The right key opens a folder or
 * moves to its first child. The left key closes a folder or moves to its parent. Enter shows the folder.
 *
 * The texts are Fluent messages of `src/i18n/en-US/browser.ftl`.
 */
import { cn } from "@scenity/ui";
import { ChevronDown, ChevronRight } from "lucide-vue-next";
import { useI18n } from "@scenity/i18n";
import { computed, nextTick, ref, watch } from "vue";
import { iconOf } from "./dockUi";
import { leavesOf, type BrowserItem } from "./tree";

const props = defineProps<{ readonly roots: readonly BrowserItem[]; readonly path: readonly string[] }>();
const emit = defineEmits<{ browse: [path: readonly string[]] }>();
const { $t } = useI18n();

const expanded = ref<Set<string>>(new Set(props.path.slice(0, -1)));
const focusKey = ref<string>(props.path.at(-1) ?? props.roots[0]?.key ?? "");
const list = ref<HTMLElement | null>(null);

// The folders of a new path open, so the tree shows the node of the grid.
watch(
  () => props.path,
  (path) => {
    expanded.value = new Set([...expanded.value, ...path.slice(0, -1)]);
    if (path.length > 0) focusKey.value = path.at(-1) ?? focusKey.value;
  },
);

interface Row {
  readonly item: BrowserItem;
  readonly depth: number;
  readonly folders: number;
}

/** The visible rows: the folders of the open folders, in the order of the tree. */
const rows = computed<Row[]>(() => {
  const out: Row[] = [];
  const add = (items: readonly BrowserItem[], depth: number): void => {
    for (const item of items) {
      const folders = item.children.filter((child) => child.children.length > 0);
      out.push({ item, depth, folders: folders.length });
      if (expanded.value.has(item.key)) add(folders, depth + 1);
    }
  };
  add(props.roots, 0);
  return out;
});

const leafCounts = computed(() => new Map(rows.value.map((row) => [row.item.key, leavesOf([row.item]).length])));

function toggle(key: string, open?: boolean): void {
  const next = new Set(expanded.value);
  if (open ?? !next.has(key)) next.add(key);
  else next.delete(key);
  expanded.value = next;
}

async function focusRow(key: string): Promise<void> {
  focusKey.value = key;
  await nextTick();
  list.value?.querySelector<HTMLElement>(`[data-tree-key="${CSS.escape(key)}"]`)?.focus();
}

function onKey(event: KeyboardEvent): void {
  const index = rows.value.findIndex((row) => row.item.key === focusKey.value);
  const row = rows.value[index];
  if (row === undefined) return;
  const go = (target: Row | undefined): void => {
    event.preventDefault();
    event.stopPropagation();
    if (target !== undefined) void focusRow(target.item.key);
  };
  if (event.key === "ArrowDown") go(rows.value[index + 1]);
  else if (event.key === "ArrowUp") go(rows.value[index - 1]);
  else if (event.key === "ArrowRight") {
    if (row.folders > 0 && !expanded.value.has(row.item.key)) {
      event.preventDefault();
      toggle(row.item.key, true);
    } else go(row.folders > 0 ? rows.value[index + 1] : undefined);
  } else if (event.key === "ArrowLeft") {
    if (expanded.value.has(row.item.key)) {
      event.preventDefault();
      toggle(row.item.key, false);
    } else go(rows.value.find((other) => other.item.key === row.item.path.at(-2)));
  } else if (event.key === "Enter") {
    event.preventDefault();
    emit("browse", row.item.path);
  }
}

function press(row: Row): void {
  focusKey.value = row.item.key;
  if (row.folders > 0) toggle(row.item.key, true);
  emit("browse", row.item.path);
}
</script>

<template>
  <ul
    ref="list"
    class="min-h-0 overflow-y-auto py-1 text-caption"
    role="tree"
    tabindex="-1"
    :aria-label="$t('browser-folders')"
    data-testid="dock-tree"
    @keydown="onKey"
  >
    <li
      v-for="row in rows"
      :key="row.item.key"
      role="treeitem"
      :aria-level="row.depth + 1"
      :aria-expanded="row.folders > 0 ? expanded.has(row.item.key) : undefined"
      :aria-selected="path.at(-1) === row.item.key"
    >
      <div
        :class="
          cn(
            'flex min-h-7 items-center gap-1 pr-2 hover:bg-surface-raised',
            path.at(-1) === row.item.key && 'bg-accent-brand/15 text-text-primary',
          )
        "
        :style="{ paddingLeft: `${0.25 + row.depth * 0.75}rem` }"
      >
        <button
          v-if="row.folders > 0"
          type="button"
          tabindex="-1"
          class="inline-flex size-5 shrink-0 items-center justify-center text-text-secondary"
          :aria-label="expanded.has(row.item.key) ? $t('browser-tree-close') : $t('browser-tree-open')"
          @click="toggle(row.item.key)"
        >
          <ChevronDown v-if="expanded.has(row.item.key)" class="size-3.5" aria-hidden="true" />
          <ChevronRight v-else class="size-3.5" aria-hidden="true" />
        </button>
        <span v-else class="size-5 shrink-0" />
        <button
          type="button"
          :tabindex="focusKey === row.item.key ? 0 : -1"
          :data-tree-key="row.item.key"
          :data-testid="`dock-tree-${row.item.key}`"
          class="flex min-w-0 flex-1 items-center gap-1.5 rounded-control py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          @click="press(row)"
        >
          <component
            :is="iconOf(row.item)"
            :class="cn('size-3.5 shrink-0', row.item.kind === 'group' ? 'text-status-caution' : 'text-text-secondary')"
            aria-hidden="true"
          />
          <span class="min-w-0 flex-1 truncate" translate="no">{{ row.item.title }}</span>
          <span class="shrink-0 text-[0.625rem] text-text-secondary tabular-nums">{{
            leafCounts.get(row.item.key)
          }}</span>
        </button>
      </div>
    </li>
  </ul>
</template>
