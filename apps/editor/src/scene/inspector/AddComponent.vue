<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * "Add component" of the inspector: a search field over the components that the subjects can
 * take, in their groups (the built-in groups and the groups of plugins). The words match the label, the ID and the
 * group. Enter adds the first match, ↓ goes to the list, and Escape clears the search. The names come from the schemas:
 * they are data (`translate="no"`).
 */
import { componentLabel, groupLabel } from "./componentTexts";
import { useI18n } from "@scenity/i18n";
import type { ComponentDefinition } from "@scenity/scene/components";
import { computed, ref } from "vue";
import { componentIcon } from "./componentIcons";
import { useInspector } from "./inspectorState";
import { field } from "./inspectorUi";

const inspector = useInspector();
const { $t } = useI18n();
const query = ref("");
const open = ref(false);
const list = ref<HTMLElement | null>(null);

const matches = computed(() => {
  const words = query.value.toLowerCase().split(/\s+/).filter(Boolean);
  return inspector.addable.value.filter((definition) => {
    const label = componentLabel(definition.id, definition.editor.label);
    const group = definition.editor.group ?? "";
    const hay = `${label} ${definition.editor.label} ${definition.id} ${group} ${groupLabel(group)}`.toLowerCase();
    return words.every((word) => hay.includes(word));
  });
});
const groups = computed(() => {
  const out = new Map<string, ComponentDefinition[]>();
  for (const definition of matches.value) {
    const group = definition.editor.group ?? "";
    out.set(group, [...(out.get(group) ?? []), definition]);
  }
  return [...out];
});

function add(definition: ComponentDefinition | undefined): void {
  if (definition === undefined) return;
  inspector.add(definition);
  query.value = "";
  open.value = false;
}

function onKey(event: KeyboardEvent): void {
  if (event.key === "Enter") {
    event.preventDefault();
    add(matches.value[0]);
  } else if (event.key === "Escape") {
    query.value = "";
    open.value = false;
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    list.value?.querySelector<HTMLButtonElement>("button")?.focus();
  }
}

function onListKey(event: KeyboardEvent): void {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  const items = [...(list.value?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
  const at = items.findIndex((item) => item === document.activeElement);
  items[at + (event.key === "ArrowDown" ? 1 : -1)]?.focus();
}
</script>

<template>
  <div v-if="inspector.addable.value.length > 0" class="flex flex-col gap-1 border-t border-border-subtle pt-2">
    <input
      v-model="query"
      type="search"
      :class="field"
      :aria-label="$t('inspector-add-label')"
      :placeholder="$t('inspector-add')"
      aria-controls="inspector-add-list"
      :aria-expanded="open || query !== ''"
      data-testid="inspector-add"
      @focus="open = true"
      @keydown="onKey"
    />
    <div
      v-if="open || query !== ''"
      id="inspector-add-list"
      ref="list"
      role="menu"
      tabindex="-1"
      :aria-label="$t('inspector-add-label')"
      class="flex max-h-64 flex-col gap-1 overflow-auto"
      data-testid="inspector-add-list"
      @keydown="onListKey"
    >
      <p v-if="matches.length === 0" role="none" class="text-text-secondary">{{ $t("inspector-add-none") }}</p>
      <section
        v-for="[group, items] in groups"
        :key="group"
        role="group"
        :aria-label="group === '' ? $t('inspector-add-other') : groupLabel(group)"
      >
        <h4 class="text-text-secondary">
          {{ group === "" ? $t("inspector-add-other") : groupLabel(group) }}
        </h4>
        <button
          v-for="definition in items"
          :key="definition.id"
          type="button"
          role="menuitem"
          class="flex w-full items-center gap-1 rounded-control px-1 py-0.5 text-left hover:bg-surface-sunken focus-visible:bg-surface-sunken"
          :data-component="definition.id"
          data-testid="inspector-add-item"
          @click="add(definition)"
        >
          <component
            :is="componentIcon(definition.id)"
            class="size-3.5 shrink-0 text-text-secondary"
            aria-hidden="true"
          />
          <span class="truncate">{{ componentLabel(definition.id, definition.editor.label) }}</span>
          <span class="truncate font-mono text-text-secondary" translate="no">{{ definition.id }}</span>
        </button>
      </section>
    </div>
  </div>
</template>
