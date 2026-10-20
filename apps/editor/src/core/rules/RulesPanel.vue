<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The rules panel of the editor: the rules of the open project, scene and sequence, grouped by source file. Each row
 * gives the result (ok, fail, known, n/a, error), the rule ID, and the value and the limit of the worst time with the
 * provisional mark. Under it, the row gives the scope, the level, a known gap and the words of the result. A filter
 * keeps only the failed rules, or one level. A click on a row sends `pick`: the page selects the entities of the rule
 * and seeks to its worst time.
 *
 * The lab gives its layout checks (the layout status of its plugin) to the same panel. `collapsible` shows the
 * one-line head with a toggle. `testid` keeps the test IDs of the lab (`lab-layout-head`, `lab-layout-check`).
 *
 * The texts are Fluent messages of `src/i18n/en-US/rules.ftl`. The words of a result come from
 * `@scenity/rules` in English. The source files show in elements with `translate="no"`.
 */
import { useI18n } from "@scenity/i18n";
import { computed, ref, useId } from "vue";
import {
  failedRow,
  filterRows,
  groupRows,
  levelWord,
  rowLine,
  rowsSummary,
  type RowFilter,
  type RuleRow,
} from "./ruleRows";

const props = withDefaults(
  defineProps<{
    readonly rows: readonly RuleRow[];
    /** The ID of the picked row, or null. */
    readonly selected?: string | null;
    /** The head line; null: the counts of the rows. */
    readonly head?: string | null;
    readonly expanded?: boolean;
    /** Show the head as a toggle that opens and closes the list. */
    readonly collapsible?: boolean;
    /** The prefix of the test IDs. */
    readonly testid?: string;
    readonly busy?: boolean;
    readonly error?: string | null;
    readonly notes?: readonly string[];
    /** A line under the list (for example the note of the provisional limits). */
    readonly footer?: string | null;
  }>(),
  {
    selected: null,
    head: null,
    expanded: true,
    collapsible: false,
    testid: "rules",
    busy: false,
    error: null,
    notes: () => [],
    footer: null,
  },
);
const emit = defineEmits<{ pick: [row: RuleRow]; "update:expanded": [open: boolean] }>();

const { $t } = useI18n();
const filter = ref<RowFilter>({ failedOnly: false, level: "all" });
const ids = { failed: useId(), level: useId() };
const groups = computed(() => groupRows(filterRows(props.rows, filter.value)));
const failing = computed(() => props.rows.some(failedRow));
const headText = computed(() => props.head ?? rowsSummary(props.rows));

const TONE: Readonly<Record<RuleRow["status"], string>> = {
  pass: "text-text-secondary",
  known: "text-text-secondary",
  "n/a": "text-text-secondary",
  fail: "text-status-caution",
  error: "text-status-negative",
};

function setFailed(event: Event): void {
  filter.value = { ...filter.value, failedOnly: (event.target as HTMLInputElement).checked };
}

function setLevel(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  filter.value = { ...filter.value, level: value === "block" || value === "warn" ? value : "all" };
}

/** The words under the main line of a row: the scope, the level, a known gap. */
function marks(row: RuleRow): string {
  const known = row.known === null ? "" : $t("rules-known", { reason: row.known });
  return [row.scope, levelWord(row.level), known].filter((part) => part).join(" · ");
}
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-col gap-1 text-caption">
    <button
      v-if="collapsible"
      type="button"
      class="flex items-baseline gap-2 text-left"
      :aria-expanded="expanded"
      :data-testid="`${testid}-toggle`"
      @click="emit('update:expanded', !expanded)"
    >
      <span
        :class="failing ? 'text-status-caution' : 'text-text-secondary'"
        class="min-w-0 flex-1 truncate"
        :title="headText"
        :data-testid="`${testid}-head`"
        >{{ headText }}</span
      >
      <span class="text-text-secondary">{{ expanded ? $t("rules-less") : $t("rules-more") }}</span>
    </button>
    <div v-else class="flex items-baseline gap-2">
      <span
        :class="failing ? 'text-status-caution' : 'text-text-secondary'"
        class="min-w-0 flex-1 truncate"
        :data-testid="`${testid}-head`"
        >{{ headText }}</span
      >
      <span v-if="busy" class="text-text-secondary" role="status">{{ $t("rules-checking") }}</span>
    </div>
    <template v-if="expanded">
      <div class="flex flex-wrap items-center gap-2 text-text-secondary" role="group" :aria-label="$t('rules-filter')">
        <label class="inline-flex items-center gap-1" :for="ids.failed">
          <input
            :id="ids.failed"
            type="checkbox"
            :checked="filter.failedOnly"
            :data-testid="`${testid}-filter-failed`"
            @change="setFailed"
          />
          {{ $t("rules-failed-only") }}
        </label>
        <label class="inline-flex items-center gap-1" :for="ids.level">
          {{ $t("rules-level") }}
          <select
            :id="ids.level"
            class="rounded-control bg-surface-sunken px-1 text-text-primary"
            :value="filter.level"
            :data-testid="`${testid}-filter-level`"
            @change="setLevel"
          >
            <option value="all">{{ $t("rules-level-all") }}</option>
            <option value="block">{{ $t("rules-level-block") }}</option>
            <option value="warn">{{ $t("rules-level-warn") }}</option>
          </select>
        </label>
        <slot name="actions" />
      </div>
      <p v-if="error" class="m-0 text-status-negative" role="alert">{{ error }}</p>
      <ul class="m-0 flex min-h-0 list-none flex-col gap-1 overflow-auto p-0" :aria-label="$t('rules-list')">
        <li v-for="group in groups" :key="group.source" :data-source="group.source" :data-testid="`${testid}-group`">
          <p class="m-0 truncate text-text-secondary" translate="no" :title="group.source">{{ group.source }}</p>
          <ul
            class="m-0 flex list-none flex-col gap-0.5 p-0 font-mono"
            :aria-label="$t('rules-checks-of', { source: group.source })"
          >
            <li
              v-for="row in group.rows"
              :key="row.id"
              :class="[TONE[row.status], row.id === selected ? 'rounded-control bg-surface-sunken' : '']"
              :title="$t('rules-row-title', { id: row.id, detail: row.detail })"
              data-package-title
              :data-status="row.status"
              :data-rule="row.id"
              :data-selected="row.id === selected ? '1' : undefined"
              :data-testid="`${testid}-check`"
              class="cursor-pointer"
              role="button"
              tabindex="0"
              @click="emit('pick', row)"
              @keydown.enter.prevent="emit('pick', row)"
            >
              {{ rowLine(row) }}
              <!-- The detail comes from @scenity/rules in English. The metric library has no message IDs. -->
              <span class="block truncate pl-3 font-sans" data-package-text>{{ row.detail }}</span>
              <span class="block truncate pl-3 font-sans text-text-secondary">{{ marks(row) }}</span>
            </li>
          </ul>
        </li>
      </ul>
      <p v-for="note in notes" :key="note" class="m-0 text-text-secondary">{{ note }}</p>
      <p v-if="footer" class="m-0 text-text-secondary">{{ footer }}</p>
    </template>
  </div>
</template>
