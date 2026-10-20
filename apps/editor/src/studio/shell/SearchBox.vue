<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The search box of the editor window: a field and the results in groups. ↑ and ↓ choose a result, and ↩ runs it.
 * ⌘↩ asks the agent, and ⌥↩ opens the text in the Search window. ⌘C copies the ID or the path of the result. F1
 * opens the docs of the result. Escape closes the box and gives the focus back. A text that reads as a sentence, or
 * a text with no result, shows "Ask the agent" first.
 */
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "@scenity/i18n";
import { Sparkles } from "lucide-vue-next";
import { parseQuery, readsAsSentence, type SearchResult, type WindowSearch } from "./search";

const props = defineProps<{ search: WindowSearch }>();
const { $t } = useI18n();
const state = props.search.state;
const field = ref<HTMLInputElement | null>(null);
const active = ref(0);
let before: HTMLElement | null = null;

/** The row of the agent: the text as a question (its ID is the text). */
const ASK = "agent";

const results = computed<SearchResult[]>(() =>
  state.open && state.version >= 0 ? props.search.results(state.text) : [],
);
const text = computed(() => state.text.trim());
// A text with the prefix of a provider (`>`, `@`, …) asks for the results of that provider only.
// The box then does not show the agent row.
const narrowed = computed(() => parseQuery(state.text, props.search.providers()).provider !== null);
const asks = computed(
  () => text.value !== "" && !narrowed.value && (readsAsSentence(text.value) || results.value.length === 0),
);
const rows = computed<SearchResult[]>(() => {
  const agent: SearchResult = {
    provider: ASK,
    score: 0,
    item: {
      id: text.value,
      label: $t("search-ask", { text: text.value }),
      reason: props.search.ask === null ? $t("search-ask-none") : null,
      run: () => props.search.ask?.(text.value),
    },
  };
  return asks.value ? [agent, ...results.value] : results.value;
});
const titles = computed(() => new Map(props.search.providers().map((provider) => [provider.id, provider.title])));

watch(
  () => state.open,
  async (open) => {
    if (!open) {
      before?.focus();
      return;
    }
    before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    active.value = 0;
    await nextTick();
    field.value?.focus();
  },
);
watch(
  () => state.text,
  () => (active.value = 0),
);

function choose(row: SearchResult | undefined): void {
  if (row === undefined || (row.item.reason ?? null) !== null) return;
  props.search.run(row);
}

function key(event: KeyboardEvent): void {
  const count = rows.value.length;
  const mod = event.metaKey || event.ctrlKey;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (count > 0) active.value = (active.value + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
  } else if (event.key === "Enter" && event.altKey && props.search.openWindow !== null) {
    // ⌥↩ opens the text in the Search window.
    event.preventDefault();
    const open = props.search.openWindow;
    props.search.close();
    open(state.text);
  } else if (event.key === "Enter") {
    event.preventDefault();
    if (mod && text.value !== "") choose(rows.value.find((row) => row.provider === ASK) ?? rows.value[0]);
    else choose(rows.value[active.value]);
  } else if (event.key === "F1") {
    // F1 opens the docs of the active row (a command with a docs link).
    const docs = rows.value[active.value]?.item.docs;
    if (docs === undefined) return;
    event.preventDefault();
    window.open(docs, "_blank", "noopener");
  } else if (event.key === "Escape") {
    event.preventDefault();
    props.search.close();
  } else if (mod && event.key === "c" && field.value?.selectionStart === field.value?.selectionEnd) {
    const copy = rows.value[active.value]?.item.copy;
    if (copy === undefined) return;
    event.preventDefault();
    void navigator.clipboard.writeText(copy);
  }
}

const optionId = (index: number): string => `studio-search-${String(index)}`;
</script>

<template>
  <div v-if="state.open" class="studio-search-backdrop" @pointerdown.self="props.search.close()">
    <div class="studio-search" role="dialog" aria-modal="true" :aria-label="$t('search-label')" data-testid="search">
      <input
        ref="field"
        v-model="state.text"
        class="studio-search-field"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded="true"
        aria-controls="studio-search-list"
        :aria-activedescendant="rows.length > 0 ? optionId(active) : undefined"
        :aria-label="$t('search-label')"
        :placeholder="$t('search-placeholder')"
        data-testid="search-input"
        @keydown="key"
      />
      <ul id="studio-search-list" class="studio-search-list" role="listbox" :aria-label="$t('search-results')">
        <li
          v-for="(row, index) in rows"
          :id="optionId(index)"
          :key="`${row.provider}:${row.item.id}`"
          role="option"
          class="studio-search-row"
          :aria-selected="index === active"
          :aria-disabled="(row.item.reason ?? null) !== null"
          :title="row.item.reason ?? undefined"
          :data-kind="row.provider"
          :data-item="row.item.id"
          data-testid="search-row"
          tabindex="-1"
          @pointermove="active = index"
          @click="choose(row)"
          @keydown.enter="choose(row)"
        >
          <span class="studio-search-kind">{{
            row.provider === "agent" ? $t("search-kind-agent") : titles.get(row.provider)
          }}</span>
          <Sparkles v-if="row.provider === 'agent'" class="size-icon-sm" aria-hidden="true" />
          <span class="studio-search-label">{{ row.item.label }}</span>
          <span v-if="row.item.detail" class="studio-search-detail" translate="no">{{ row.item.detail }}</span>
          <a
            v-if="row.item.docs !== undefined"
            :href="row.item.docs"
            target="_blank"
            rel="noopener"
            class="studio-search-detail"
            :aria-label="$t('search-docs', { label: row.item.label })"
            :title="$t('search-docs', { label: row.item.label })"
            data-testid="search-row-docs"
            @click.stop
            >?</a
          >
          <!-- With no agent, the agent row tells how to connect one. -->
          <span
            v-if="row.provider === 'agent' && row.item.reason"
            class="studio-search-detail"
            data-testid="search-ask-reason"
            >{{ row.item.reason }}</span
          >
        </li>
        <li v-if="rows.length === 0" class="studio-search-empty" role="presentation">{{ $t("search-empty") }}</li>
      </ul>
    </div>
  </div>
</template>
