<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Search window: the full form of the search box. The entities that match show as a table with a column for each
 * compared field (`c:light intensity>2`), and a cell edits its value as one undo step. The other providers (assets,
 * files, commands, settings, docs) show as lists. A menu shows only one kind of results. Save keeps the text in the
 * saved searches of the project.
 */
import { computed } from "vue";
import { useI18n } from "@scenity/i18n";
import type { EntityDocument } from "@scenity/scene/schema/documents";
import { Button, Select } from "@scenity/ui";
import { Bookmark, X } from "lucide-vue-next";
import { parseQuery, type SearchResult, type WindowSearch } from "../../studio/shell/search";
import { entityTable, type TableCell } from "./searchTable";
import { listText, type SearchWindowState } from "./searchWindow";

const props = defineProps<{
  state: SearchWindowState;
  search: WindowSearch;
  doc: { readonly value: EntityDocument };
  select(ids: readonly string[]): void;
  setValue(entity: string, component: string, field: string, value: unknown): void;
}>();
const { $t } = useI18n();
const { text, scope, saved } = props.state;

/** The most results of one provider in the lists. */
const LIST_LIMIT = 50;
const ENTITIES = "entities";

const providers = computed(() => (props.search.state.version >= 0 ? props.search.providers() : []));
const scopeValue = computed({
  get: () => scope.value ?? "all",
  set: (value: string) => (scope.value = value === "all" ? null : value),
});
const scopeOptions = computed(() => [
  { value: "all", label: $t("search-window-all") },
  ...providers.value.map((provider) => ({ value: provider.id, label: provider.title })),
]);
/** The provider of the prefix of the text (`@`, `>`, …), or of the menu. */
const narrow = computed(() => scope.value ?? parseQuery(text.value, providers.value).provider);
const empty = computed(() => text.value.trim() === "");
const table = computed(() => {
  if (empty.value || (narrow.value !== null && narrow.value !== ENTITIES)) return null;
  const words = text.value.trimStart();
  return entityTable(props.doc.value, words.startsWith("@") ? words.slice(1) : words);
});
const groups = computed(() => {
  if (empty.value || narrow.value === ENTITIES) return [];
  const results = props.search.results(listText(text.value), LIST_LIMIT);
  return providers.value
    .filter((provider) => provider.id !== ENTITIES && (narrow.value === null || narrow.value === provider.id))
    .map((provider) => ({ provider, items: results.filter((result) => result.provider === provider.id) }))
    .filter((group) => group.items.length > 0);
});

function run(result: SearchResult): void {
  if ((result.item.reason ?? null) === null) props.search.run(result);
}

/** The kind of input of a cell. */
function inputOf(cell: TableCell): "number" | "checkbox" | "text" | null {
  if (typeof cell.value === "number") return "number";
  if (typeof cell.value === "boolean") return "checkbox";
  return typeof cell.value === "string" ? "text" : null;
}

/** The cells of each row in the order of the columns, with the kind of input of each one. */
const lines = computed(() =>
  (table.value?.rows ?? []).map((row) => ({
    row,
    cells: (table.value?.columns ?? []).map((column) => {
      const cell = row.cells[column.key] ?? null;
      return { key: column.key, cell, kind: cell === null ? null : inputOf(cell) };
    }),
  })),
);

/** Set a cell from its input. */
function edit(id: string, cell: TableCell, event: Event): void {
  const input = event.target as HTMLInputElement;
  const kind = inputOf(cell);
  const value = kind === "number" ? Number(input.value) : kind === "checkbox" ? input.checked : input.value;
  if (typeof value === "number" && (input.value.trim() === "" || !Number.isFinite(value))) return;
  props.setValue(id, cell.component, cell.field, value);
}
</script>

<template>
  <section
    class="flex h-full min-h-0 flex-col text-caption"
    :aria-label="$t('panel-search')"
    data-testid="search-window"
  >
    <div class="flex flex-wrap items-center gap-2 border-b border-border-subtle p-1">
      <input
        v-model="text"
        type="search"
        class="min-w-40 flex-1 rounded-control border border-border-strong bg-surface-raised px-2 py-0.5"
        :aria-label="$t('search-window-label')"
        :placeholder="$t('search-window-placeholder')"
        data-testid="search-window-input"
      />
      <Select v-model="scopeValue" :options="scopeOptions" class="w-36" :aria-label="$t('search-window-kind')" />
      <Button size="sm" variant="ghost" :disabled="empty" data-testid="search-window-save" @click="state.save(text)">
        <Bookmark class="size-icon-sm" aria-hidden="true" />{{ $t("search-window-save") }}
      </Button>
    </div>
    <ul
      v-if="saved.length > 0"
      class="flex flex-wrap gap-1 border-b border-border-subtle p-1"
      :aria-label="$t('search-window-saved')"
    >
      <li v-for="item in saved" :key="item" class="flex items-center rounded-control bg-surface-sunken">
        <button type="button" class="px-2 py-0.5" translate="no" data-testid="search-saved" @click="text = item">
          {{ item }}
        </button>
        <button
          type="button"
          class="px-1"
          :aria-label="$t('search-window-remove', { text: item })"
          data-testid="search-saved-remove"
          @click="state.remove(item)"
        >
          <X class="size-icon-sm" aria-hidden="true" />
        </button>
      </li>
    </ul>
    <p v-if="empty" class="p-2 text-text-secondary">{{ $t("search-window-hint") }}</p>
    <div v-else class="min-h-0 flex-1 overflow-auto">
      <section v-if="table !== null" :aria-label="$t('search-kind-entities')">
        <div class="flex items-center gap-2 px-2 py-1">
          <h3 class="flex-1 text-label">
            {{ $t("search-window-entities", { count: table.matches }) }}
          </h3>
          <Button
            v-if="table.rows.length > 0"
            size="sm"
            variant="ghost"
            data-testid="search-select-all"
            @click="select(table.rows.map((row) => row.id))"
          >
            {{ $t("search-window-select-all") }}
          </Button>
        </div>
        <table v-if="table.rows.length > 0" class="w-full border-collapse" data-testid="search-table">
          <thead>
            <tr class="border-b border-border-subtle text-left text-text-secondary">
              <th scope="col" class="px-2 py-0.5">{{ $t("search-window-name") }}</th>
              <th
                v-for="column in table.columns"
                :key="column.key"
                scope="col"
                class="px-2 py-0.5"
                translate="no"
                :data-column="column.key"
                data-testid="search-column"
              >
                {{ column.key }}
              </th>
              <th scope="col" class="px-2 py-0.5">{{ $t("search-window-components") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="{ row, cells } in lines"
              :key="row.id"
              class="border-b border-border-subtle"
              :data-entity="row.id"
              data-testid="search-table-row"
            >
              <td class="px-2 py-0.5">
                <button type="button" class="text-left hover:underline" @click="select([row.id])">
                  {{ row.label }}
                </button>
              </td>
              <td v-for="item in cells" :key="item.key" class="px-2 py-0.5">
                <input
                  v-if="item.cell !== null && item.kind !== null"
                  :type="item.kind"
                  class="w-24 rounded-control border border-border-strong bg-surface-raised px-1"
                  :value="item.kind === 'checkbox' ? undefined : item.cell.value"
                  :checked="item.cell.value === true"
                  step="any"
                  :aria-label="$t('search-window-cell', { field: item.key, entity: row.label })"
                  :data-column="item.key"
                  data-testid="search-cell"
                  @change="edit(row.id, item.cell, $event)"
                />
                <span v-else-if="item.cell !== null" class="text-text-secondary" translate="no">{{
                  JSON.stringify(item.cell.value)
                }}</span>
              </td>
              <td class="truncate px-2 py-0.5 text-text-secondary" translate="no">{{ row.components.join(", ") }}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <section v-for="group in groups" :key="group.provider.id" :aria-label="group.provider.title">
        <h3 class="px-2 py-1 text-label">{{ group.provider.title }}</h3>
        <ul>
          <li v-for="result in group.items" :key="result.item.id">
            <button
              type="button"
              class="flex w-full items-center gap-2 border-b border-border-subtle px-2 py-1 text-left hover:bg-surface-sunken"
              :disabled="(result.item.reason ?? null) !== null"
              :title="result.item.reason ?? undefined"
              :data-provider="group.provider.id"
              data-testid="search-result"
              @click="run(result)"
            >
              <span class="min-w-0 flex-1 truncate">{{ result.item.label }}</span>
              <span v-if="result.item.detail !== undefined" class="truncate text-text-secondary" translate="no">{{
                result.item.detail
              }}</span>
            </button>
          </li>
        </ul>
      </section>
      <p v-if="(table === null || table.matches === 0) && groups.length === 0" class="p-2 text-text-secondary">
        {{ $t("search-empty") }}
      </p>
    </div>
  </section>
</template>
