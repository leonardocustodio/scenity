<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Simulation panel. It shows the state of each simulation plugin at the time of the clock (the core gives the
 * state for the frame that it draws). Each record of records (the cars of the traffic plugin) is a table, and the
 * other fields are values. "Recorded stream" opens a `*.stream.jsonl` file of the project and shows its state at the
 * same time. The page does not show the live sources of an engine. The panel reads the core only while its tab is
 * visible.
 */
import { useI18n } from "@scenity/i18n";
import { Select } from "@scenity/ui";
import { readStream, recordedSource, type RecordedSource } from "@scenity/scene/sequence";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { usePanelVisible } from "../../studio/shell/panelState";
import { stateView } from "./simulationView";

const props = defineProps<{
  /** The simulation states of the last frame, by plugin ID (null: the core does not answer). */
  states(): Promise<Record<string, unknown> | null>;
  /** The time of the clock (ms). */
  time(): number;
  /** The stream files of the project, and the text of one. */
  streams(): Promise<readonly string[]>;
  read(path: string): Promise<string>;
}>();
const { $t } = useI18n();
const visible = usePanelVisible();

const shown = shallowRef<Record<string, unknown>>({});
const now = ref(0);
const views = computed(() =>
  Object.entries(shown.value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([plugin, state]) => ({ plugin, view: stateView(state) })),
);

const NONE = "*none";
const files = ref<readonly string[]>([]);
const picked = ref(NONE);
const stream = shallowRef<RecordedSource | null>(null);
const problem = ref<string | null>(null);
const streamView = computed(() => (stream.value === null ? null : stateView(stream.value.stateAt(now.value))));
const fileOptions = computed(() => [
  { value: NONE, label: $t("simulation-stream-none") },
  ...files.value.map((value) => ({ value, label: value })),
]);
watch(picked, async (path) => {
  problem.value = null;
  stream.value = null;
  if (path === NONE) return;
  const read = readStream(await props.read(path));
  if (!read.ok) problem.value = read.errors[0]?.message ?? null;
  else stream.value = recordedSource(read.doc);
});

let timer: ReturnType<typeof setInterval> | null = null;
async function refresh(): Promise<void> {
  if (!visible.value) return;
  now.value = Math.round(props.time());
  shown.value = (await props.states()) ?? {};
}
onMounted(() => {
  void refresh();
  void props.streams().then((found) => (files.value = found));
  timer = setInterval(() => void refresh(), 300);
});
onBeforeUnmount(() => {
  if (timer !== null) clearInterval(timer);
});
</script>

<template>
  <section
    class="flex h-full min-h-0 flex-col gap-2 overflow-auto p-2 text-caption"
    :aria-label="$t('panel-simulation')"
    :data-time="now"
    data-testid="simulation-panel"
  >
    <p class="text-text-secondary">{{ $t("simulation-time", { seconds: (now / 1000).toFixed(2) }) }}</p>
    <p v-if="views.length === 0" class="text-text-secondary" data-testid="simulation-empty">
      {{ $t("simulation-none") }}
    </p>
    <section
      v-for="{ plugin, view } in views"
      :key="plugin"
      class="flex flex-col gap-1"
      :data-plugin="plugin"
      data-testid="simulation-plugin"
    >
      <h3 class="font-semibold" translate="no">{{ plugin }}</h3>
      <table v-for="table in view.tables" :key="table.name" class="w-full text-left" :data-table="table.name">
        <caption class="text-left text-text-secondary" translate="no">
          {{
            table.name
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ $t("simulation-id") }}</th>
            <th v-for="column in table.columns" :key="column" scope="col" translate="no">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in table.rows" :key="row.id" :data-row="row.id" data-testid="simulation-row">
            <th scope="row" translate="no">{{ row.id }}</th>
            <td v-for="(cell, index) in row.cells" :key="index" class="font-mono" translate="no">{{ cell }}</td>
          </tr>
        </tbody>
      </table>
      <dl class="grid grid-cols-[auto_1fr] gap-x-2">
        <template v-for="item in view.values" :key="item.name">
          <dt class="text-text-secondary" translate="no">{{ item.name }}</dt>
          <dd class="truncate font-mono" translate="no">{{ item.value }}</dd>
        </template>
      </dl>
    </section>
    <section class="flex flex-col gap-1 border-t border-border-subtle pt-2" data-testid="simulation-streams">
      <h3 class="font-semibold">{{ $t("simulation-stream") }}</h3>
      <Select v-model="picked" :options="fileOptions" class="w-64" :aria-label="$t('simulation-stream')" />
      <p v-if="problem !== null" class="text-status-negative" role="alert">{{ problem }}</p>
      <dl v-if="streamView !== null" class="grid grid-cols-[auto_1fr] gap-x-2" data-testid="simulation-stream-state">
        <template v-for="item in streamView.values" :key="item.name">
          <dt class="text-text-secondary" translate="no">{{ item.name }}</dt>
          <dd class="truncate font-mono" translate="no">{{ item.value }}</dd>
        </template>
      </dl>
      <p class="text-text-secondary">{{ $t("simulation-live-none") }}</p>
    </section>
  </section>
</template>
