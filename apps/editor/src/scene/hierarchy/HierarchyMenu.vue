<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The context menu of the hierarchy panel: the entity commands of a row (add an
 * empty child, duplicate, copy, paste as a child, rename, delete) or of the empty tree (add an empty entity, paste).
 * Each action is a command of the page and one step of the history. A click outside or Escape closes the menu.
 * An instance row and a prefab row also have "Open prefab" and the apply and the revert of their overrides.
 *
 * Its texts are Fluent messages of `src/i18n/en-US/hierarchy.ftl` (menuItems gives the labels).
 */
import { useI18n } from "@scenity/i18n";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { menuItems, rowKind, useHierarchy } from "./hierarchyState";

const { $t } = useI18n();
const state = useHierarchy();
const { menu, doc } = state;
const list = ref<HTMLElement | null>(null);
const items = computed(() => {
  const open = menu.value;
  if (open === null) return [];
  return menuItems(open.id, open.id === null ? "entity" : rowKind(doc.value, open.id));
});

/** The place of the menu in rem (the pointer point over the root font size), as the resize handles of the lab. */
const place = computed(() => {
  const font = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const at = menu.value ?? { x: 0, y: 0 };
  return { left: `${String(at.x / font)}rem`, top: `${String(at.y / font)}rem` };
});

watch(menu, async (open) => {
  if (open === null) return;
  await nextTick();
  list.value?.querySelector("button")?.focus();
});

function onDown(event: PointerEvent): void {
  if (menu.value !== null && !(event.target instanceof Node && list.value?.contains(event.target) === true)) {
    state.closeMenu();
  }
}

function onKey(event: KeyboardEvent): void {
  if (menu.value === null || event.key !== "Escape") return;
  event.preventDefault();
  state.closeMenu();
}

onMounted(() => {
  globalThis.addEventListener("pointerdown", onDown, true);
  globalThis.addEventListener("keydown", onKey);
});
onBeforeUnmount(() => {
  globalThis.removeEventListener("pointerdown", onDown, true);
  globalThis.removeEventListener("keydown", onKey);
});
</script>

<template>
  <div
    v-if="menu !== null"
    ref="list"
    role="menu"
    :aria-label="$t('hierarchy-menu')"
    class="fixed z-50 flex min-w-40 flex-col rounded-control border border-border-subtle bg-surface-raised p-0.5 text-caption text-text-primary shadow-raised"
    :style="place"
    data-testid="hierarchy-menu"
  >
    <button
      v-for="item in items"
      :key="item.key"
      type="button"
      role="menuitem"
      class="rounded-control px-2 py-1 text-left hover:bg-surface-sunken focus-visible:bg-surface-sunken focus-visible:outline-none"
      :data-testid="`hierarchy-menu-${item.key}`"
      @click="state.choose(item)"
    >
      {{ item.label }}
    </button>
  </div>
</template>
