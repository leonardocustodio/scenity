<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The bar above the grid of the content browser: the up button, the path as a breadcrumb, the search field and the
 * filters. The key `/` puts the focus in the search field, and Escape clears it.
 *
 * The texts are Fluent messages of `src/i18n/en-US/browser.ftl`.
 */
import { cn } from "@scenity/ui";
import { ArrowUp, ChevronRight, Search, SlidersHorizontal, X } from "lucide-vue-next";
import { useI18n } from "@scenity/i18n";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { typingInto } from "../labUi";
import type { BrowserItem } from "./tree";
import { FILTERS, filterText, type FilterField, type Filters } from "./search";

const props = defineProps<{ readonly crumbs: readonly BrowserItem[] }>();
const query = defineModel<string>("query", { required: true });
const filters = defineModel<Filters>("filters", { required: true });
const emit = defineEmits<{ browse: [path: readonly string[]]; up: [] }>();
const { $t } = useI18n();

const field = ref<HTMLInputElement | null>(null);
const filtersOpen = ref(false);
const active = computed(() => filterText(filters.value) !== "");
/** The message IDs of the names of the filter fields. */
const LABELS: Readonly<Record<FilterField, string>> = {
  status: "browser-filter-status",
  priority: "browser-filter-priority",
  kind: "browser-filter-kind",
  layer: "browser-filter-layer",
  scene: "browser-filter-scene",
};

function setFilter(name: FilterField, event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  const rest = Object.entries(filters.value).filter(([key]) => key !== name);
  filters.value = Object.fromEntries(value === "" ? rest : [...rest, [name, value]]);
}

function onKey(event: KeyboardEvent): void {
  if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || typingInto(event.target)) return;
  event.preventDefault();
  field.value?.focus();
}

function onField(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    query.value = "";
    field.value?.blur();
  }
}

onMounted(() => globalThis.addEventListener("keydown", onKey));
onBeforeUnmount(() => globalThis.removeEventListener("keydown", onKey));
</script>

<template>
  <div class="relative flex min-h-9 shrink-0 items-center gap-1.5 border-b border-border-subtle px-2 py-1">
    <button
      type="button"
      class="inline-flex size-7 shrink-0 items-center justify-center rounded-control text-text-secondary hover:bg-surface-raised disabled:opacity-40"
      :aria-label="$t('browser-up')"
      :title="$t('browser-up-title')"
      :disabled="props.crumbs.length === 0 && query === '' && !active"
      data-testid="dock-up"
      @click="emit('up')"
    >
      <ArrowUp class="size-4" aria-hidden="true" />
    </button>
    <nav
      class="dock-crumbs flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-caption"
      :aria-label="$t('browser-path')"
    >
      <button
        type="button"
        class="shrink-0 rounded-control px-1.5 py-0.5 hover:bg-surface-raised"
        @click="emit('browse', [])"
      >
        {{ $t("browser-content") }}
      </button>
      <template v-for="crumb in props.crumbs" :key="crumb.key">
        <ChevronRight class="size-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
        <button
          type="button"
          class="max-w-48 shrink-0 truncate rounded-control px-1.5 py-0.5 hover:bg-surface-raised"
          translate="no"
          @click="emit('browse', crumb.path)"
        >
          {{ crumb.title }}
        </button>
      </template>
    </nav>
    <label class="relative flex w-56 shrink items-center max-sm:w-36" for="dock-search">
      <Search class="pointer-events-none absolute left-2 size-3.5 text-text-secondary" aria-hidden="true" />
      <input
        id="dock-search"
        ref="field"
        v-model="query"
        type="search"
        :placeholder="$t('browser-search-placeholder')"
        class="h-7 w-full rounded-control border border-border-subtle bg-surface-sunken pr-2 pl-7 text-caption"
        :aria-label="$t('browser-search')"
        data-testid="dock-search"
        @keydown="onField"
      />
    </label>
    <button
      type="button"
      :class="
        cn(
          'inline-flex size-7 shrink-0 items-center justify-center rounded-control hover:bg-surface-raised',
          active ? 'text-accent-brand' : 'text-text-secondary',
        )
      "
      :aria-label="$t('browser-filters')"
      :title="$t('browser-filters')"
      :aria-expanded="filtersOpen"
      data-testid="dock-filters"
      @click="filtersOpen = !filtersOpen"
    >
      <SlidersHorizontal class="size-4" aria-hidden="true" />
    </button>
    <div
      v-if="filtersOpen"
      class="absolute top-full right-2 z-20 mt-1 flex w-60 flex-col gap-2 rounded-card border border-border-subtle bg-surface-overlay p-3 text-caption shadow-overlay"
      role="group"
      :aria-label="$t('browser-filters')"
    >
      <label
        v-for="(values, name) in FILTERS"
        :key="name"
        class="flex items-center justify-between gap-2"
        :for="`dock-filter-${name}`"
      >
        {{ $t(LABELS[name]) }}
        <select
          :id="`dock-filter-${name}`"
          :value="filters[name] ?? ''"
          class="h-7 w-32 rounded-control border border-border-subtle bg-surface-sunken px-1"
          @change="setFilter(name, $event)"
        >
          <option value="">{{ $t("browser-filter-any") }}</option>
          <option v-for="value in values" :key="value" :value="value" translate="no">{{ value }}</option>
        </select>
      </label>
      <button
        type="button"
        class="inline-flex items-center gap-1 self-end rounded-control px-2 py-1 text-text-secondary hover:bg-surface-raised"
        @click="filters = {}"
      >
        <X class="size-3.5" aria-hidden="true" /> {{ $t("browser-filters-clear") }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.dock-crumbs {
  scrollbar-width: none;
}
</style>
