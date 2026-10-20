<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Console panel: the log of the window, the oldest line first. The counters of the levels are filters. A menu
 * keeps one source, and a search keeps the lines with its words. A line that comes again shows
 * once with its count. A click shows the line in the detail pane and selects the entity that it names, or opens the
 * scene file that it names.
 */
import { computed, ref } from "vue";
import { useI18n } from "@scenity/i18n";
import { Button, Select } from "@scenity/ui";
import { CircleAlert, Info, TriangleAlert } from "lucide-vue-next";
import {
  filterEntries,
  LOG_LEVELS,
  LOG_SOURCES,
  type ConsoleStore,
  type LogEntry,
  type LogLevel,
} from "./consoleStore";
import { EmptyState, usePanelState } from "../../studio/extensions/api";

const props = defineProps<{
  store: ConsoleStore;
  select(entity: string): void;
  openFile(path: string): void;
}>();
const { $t } = useI18n();

const hidden = usePanelState<LogLevel[]>("hidden", []);
const source = usePanelState<string>("source", "all");
const query = ref("");
const chosen = ref<number | null>(null);

const counts = computed(() => {
  const all: Record<LogLevel, number> = { error: 0, warn: 0, info: 0 };
  for (const entry of props.store.entries.value) all[entry.level] += entry.count;
  return all;
});
const sourceOptions = computed(() => [
  { value: "all", label: $t("console-source-all") },
  ...LOG_SOURCES.map((item) => ({ value: item, label: $t(`console-source-${item}`) })),
]);
const shown = computed(() =>
  filterEntries(props.store.entries.value, {
    levels: new Set(LOG_LEVELS.filter((level) => !hidden.value.includes(level))),
    source: source.value === "all" ? null : (LOG_SOURCES.find((item) => item === source.value) ?? null),
    text: query.value,
  }),
);
const detail = computed(() => props.store.entries.value.find((entry) => entry.id === chosen.value) ?? null);

function toggle(level: LogLevel): void {
  hidden.value = hidden.value.includes(level)
    ? hidden.value.filter((item) => item !== level)
    : [...hidden.value, level];
}

function pick(entry: LogEntry): void {
  chosen.value = entry.id;
  if (entry.entity !== null) props.select(entry.entity);
  else if (entry.file?.path.endsWith(".scene.json") === true) props.openFile(entry.file.path);
}

const ICONS = { error: CircleAlert, warn: TriangleAlert, info: Info } as const;
const time = (at: number): string => new Date(at).toLocaleTimeString();
</script>

<template>
  <section
    class="flex h-full min-h-0 flex-col text-caption"
    :aria-label="$t('panel-console')"
    data-testid="console-panel"
  >
    <div class="flex flex-wrap items-center gap-2 border-b border-border-subtle p-1">
      <button
        v-for="level in LOG_LEVELS"
        :key="level"
        type="button"
        class="flex items-center gap-1 rounded-control px-2 py-0.5 hover:bg-surface-sunken"
        :class="{ 'opacity-50': hidden.includes(level) }"
        :aria-pressed="!hidden.includes(level)"
        :aria-label="$t(`console-level-${level}`, { count: counts[level] })"
        :data-level="level"
        data-testid="console-counter"
        @click="toggle(level)"
      >
        <component :is="ICONS[level]" class="size-icon-sm" aria-hidden="true" />{{ counts[level] }}
      </button>
      <Select v-model="source" :options="sourceOptions" class="w-36" :aria-label="$t('console-source')" />
      <input
        v-model="query"
        type="search"
        class="min-w-24 flex-1 rounded-control border border-border-strong bg-surface-raised px-2 py-0.5"
        :aria-label="$t('console-search')"
        :placeholder="$t('console-search')"
        data-testid="console-search"
      />
      <Button size="sm" variant="ghost" data-testid="console-clear" @click="store.clear()">
        {{ $t("console-clear") }}
      </Button>
    </div>
    <div class="flex min-h-0 flex-1">
      <ol class="min-h-0 flex-1 overflow-auto" :aria-label="$t('console-lines')">
        <li v-if="shown.length === 0"><EmptyState panel="console" :text="$t('console-empty')" /></li>
        <li v-for="entry in shown" :key="entry.id">
          <button
            type="button"
            class="flex w-full items-center gap-2 border-b border-border-subtle px-2 py-1 text-left hover:bg-surface-sunken"
            :class="{ 'bg-surface-sunken': chosen === entry.id }"
            :aria-current="chosen === entry.id ? 'true' : undefined"
            :data-level="entry.level"
            :data-source="entry.source"
            data-testid="console-line"
            @click="pick(entry)"
          >
            <component
              :is="ICONS[entry.level]"
              class="size-icon-sm flex-none"
              :class="{
                'text-status-negative': entry.level === 'error',
                'text-status-caution': entry.level === 'warn',
              }"
              :aria-label="$t(`console-level-name-${entry.level}`)"
            />
            <span class="w-14 flex-none text-text-secondary">{{ $t(`console-source-${entry.source}`) }}</span>
            <span class="min-w-0 flex-1 truncate" translate="no">{{ entry.text }}</span>
            <span
              v-if="entry.count > 1"
              class="flex-none rounded-full bg-surface-raised px-1.5 text-text-secondary"
              data-testid="console-count"
              >{{ entry.count }}</span
            >
            <span class="flex-none text-text-secondary" translate="no">{{ time(entry.last) }}</span>
          </button>
        </li>
      </ol>
      <aside
        v-if="detail !== null"
        class="w-2/5 min-w-48 overflow-auto border-l border-border-subtle p-2"
        :aria-label="$t('console-detail')"
        data-testid="console-detail"
      >
        <p class="text-text-secondary">
          {{ $t("console-detail-facts", { source: $t(`console-source-${detail.source}`), count: detail.count }) }}
          · <span translate="no">{{ time(detail.first) }} – {{ time(detail.last) }}</span>
        </p>
        <pre class="whitespace-pre-wrap break-words" translate="no">{{ detail.text }}</pre>
        <pre v-if="detail.detail !== null" class="whitespace-pre-wrap break-words text-text-secondary" translate="no">{{
          detail.detail
        }}</pre>
      </aside>
    </div>
  </section>
</template>
