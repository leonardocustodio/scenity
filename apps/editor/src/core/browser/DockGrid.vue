<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The grid of the content browser: the tiles of the node of the path (or of the search), the recent items at the
 * root, and the status line. One tile has the focus at a time, and the arrow keys move the focus. Enter or a press
 * opens the tile: a folder shows its children, and an item plays its scene. Backspace or Escape goes to the parent.
 *
 * The texts are Fluent messages of `src/i18n/en-US/browser.ftl`.
 */
import { useI18n } from "@scenity/i18n";
import { computed, nextTick, ref, watch } from "vue";
import DockTile from "./DockTile.vue";
import { counts, type BrowserItem } from "./tree";

const props = defineProps<{
  readonly items: readonly BrowserItem[];
  readonly recent: readonly BrowserItem[];
  readonly openKey: string | null;
  readonly searching: boolean;
}>();
const emit = defineEmits<{ open: [item: BrowserItem]; up: [] }>();
const { $t } = useI18n();

const grid = ref<HTMLElement | null>(null);
const focusIndex = ref(0);
const total = computed(() => counts(props.items));
const all = computed(() => [...props.recent, ...props.items]);

watch(
  () => props.items,
  () => {
    focusIndex.value = 0;
  },
);

/** The current number of tiles in one row of the grid (from the positions of the first tiles). */
function columns(): number {
  const tiles = [...(grid.value?.querySelectorAll<HTMLElement>(".dock-tile") ?? [])];
  const top = tiles[0]?.offsetTop;
  const row = tiles.findIndex((tile) => tile.offsetTop !== top);
  return row <= 0 ? Math.max(1, tiles.length) : row;
}

async function focusTile(index: number): Promise<void> {
  focusIndex.value = Math.max(0, Math.min(all.value.length - 1, index));
  await nextTick();
  grid.value?.querySelectorAll<HTMLElement>(".dock-tile")[focusIndex.value]?.focus();
}

function onKey(event: KeyboardEvent): void {
  const moves: Readonly<Record<string, number>> = {
    ArrowRight: 1,
    ArrowLeft: -1,
    ArrowDown: columns(),
    ArrowUp: -columns(),
    Home: -all.value.length,
    End: all.value.length,
  };
  const move = moves[event.key];
  if (move !== undefined) {
    event.preventDefault();
    event.stopPropagation();
    void focusTile(focusIndex.value + move);
  } else if (event.key === "Enter") {
    event.preventDefault();
    const item = all.value[focusIndex.value];
    if (item !== undefined) emit("open", item);
  } else if (event.key === "Backspace" || event.key === "Escape") {
    event.preventDefault();
    emit("up");
  }
}

function press(item: BrowserItem, index: number): void {
  focusIndex.value = index;
  emit("open", item);
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div ref="grid" class="dock-grid min-h-0 flex-1 overflow-y-auto p-2" data-testid="dock-grid">
      <template v-if="recent.length > 0">
        <h3 class="mb-1 text-label text-text-secondary">{{ $t("browser-recent") }}</h3>
        <div class="dock-grid__tiles mb-3">
          <DockTile
            v-for="(item, index) in recent"
            :key="`recent-${item.key}`"
            :item="item"
            :open="item.key === openKey"
            :focused="index === focusIndex"
            @click="press(item, index)"
            @keydown="onKey"
          />
        </div>
        <h3 class="mb-1 text-label text-text-secondary">{{ $t("browser-content") }}</h3>
      </template>
      <div v-if="items.length > 0" class="dock-grid__tiles">
        <DockTile
          v-for="(item, index) in items"
          :key="item.key"
          :item="item"
          :open="item.key === openKey"
          :focused="index + recent.length === focusIndex"
          @click="press(item, index + recent.length)"
          @keydown="onKey"
        />
      </div>
      <p v-else class="p-4 text-caption text-text-secondary">
        {{ searching ? $t("browser-no-match") : $t("browser-empty") }}
      </p>
    </div>
    <p
      class="flex shrink-0 gap-3 border-t border-border-subtle px-2 py-1 text-[0.6875rem] text-text-secondary tabular-nums"
      data-testid="dock-status"
    >
      <span>{{ $t("browser-count-items", { count: total.items }) }}</span>
      <span>{{ $t("browser-count-playable", { count: total.playable }) }}</span>
      <span>{{ $t("browser-count-captured", { count: total.captured }) }}</span>
      <span>{{ $t("browser-count-drawn", { count: total.drawn }) }}</span>
      <span>{{ $t("browser-count-none", { count: total.none }) }}</span>
    </p>
  </div>
</template>

<style scoped>
.dock-grid__tiles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr));
  gap: 0.375rem;
}
</style>
