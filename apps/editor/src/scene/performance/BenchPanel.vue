<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The bench runner: Run the bench (`scenity bench` as a job of the dev server, quick or full, at a tier), its log, the
 * budgets of the last run (the value, the limit and the result of each budget row), and the trend of each value of the
 * measure over the history of the runs (a sparkline with the budget).
 */
import { useI18n } from "@scenity/i18n";
import { RENDER_TIERS } from "@scenity/scene/schema/editor";
import { Button } from "@scenity/ui";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { IMPORT_HEADER } from "../../assetBrowser/assetTypes";
import { isBenchReport, sparkPoints, trendLines, type BenchReportView } from "./benchTrend";

const props = defineProps<{ base: string }>();
const { $t } = useI18n();
const history = shallowRef<readonly BenchReportView[]>([]);
const job = shallowRef<{ running: boolean; log: readonly string[]; code: number | null }>({
  running: false,
  log: [],
  code: null,
});
const quick = ref(true);
const tier = ref("high");
const note = ref<string | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
/** True after the first read of the state of the bench (the history shows). */
const loaded = ref(false);

async function read(): Promise<void> {
  clearTimeout(timer);
  const response = await fetch(`${props.base}bench.json`, { cache: "no-store" }).catch(() => null);
  if (response?.ok === true && (response.headers.get("content-type") ?? "").includes("json")) {
    const state = (await response.json()) as { job: typeof job.value; history: unknown[] };
    job.value = state.job;
    history.value = state.history.filter(isBenchReport);
  }
  loaded.value = true;
  if (job.value.running) timer = setTimeout(() => void read(), 1000);
}
onMounted(() => void read());
onBeforeUnmount(() => clearTimeout(timer));

async function run(): Promise<void> {
  const response = await fetch(`${props.base}bench.run`, {
    method: "POST",
    headers: { [IMPORT_HEADER]: "1", "Content-Type": "application/json" },
    body: JSON.stringify({ quick: quick.value, tier: tier.value }),
  }).catch((error: unknown) => error as Error);
  if (response instanceof Error) note.value = response.message;
  else {
    const answer = (await response.json()) as { ok: boolean; reason?: string };
    note.value = answer.ok ? null : (answer.reason ?? null);
  }
  await read();
}

const last = computed(() => history.value.at(-1) ?? null);
const lines = computed(() => trendLines(history.value));
const log = computed(() => job.value.log.slice(-10).join("\n"));
const RESULT: Readonly<Record<string, string>> = {
  pass: "text-status-positive",
  over: "text-status-negative",
  "not measured": "text-text-secondary",
  "not judged": "text-status-caution",
};
const input = "h-7 rounded-control border border-border-subtle bg-surface-sunken px-1.5 text-caption text-text-primary";
</script>

<template>
  <section
    class="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto p-1.5 text-caption text-text-primary"
    :aria-label="$t('panel-bench')"
    data-testid="bench-panel"
    :data-runs="history.length"
    :data-loaded="loaded ? '1' : '0'"
  >
    <div class="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="primary" :disabled="job.running" data-testid="bench-run" @click="run">
        {{ job.running ? $t("bench-running") : $t("bench-run") }}
      </Button>
      <label class="flex items-center gap-1" for="bench-quick">
        <input id="bench-quick" v-model="quick" type="checkbox" data-testid="bench-quick" />
        {{ $t("bench-quick") }}
      </label>
      <label class="flex items-center gap-1" for="bench-tier">
        {{ $t("perf-tier") }}
        <select id="bench-tier" v-model="tier" :class="input" data-testid="bench-tier">
          <option v-for="each in RENDER_TIERS" :key="each" :value="each" translate="no">{{ each }}</option>
        </select>
      </label>
      <span
        v-if="!job.running && job.code !== null"
        :class="job.code === 0 ? 'text-status-positive' : 'text-status-negative'"
        data-testid="bench-result"
        :data-code="job.code"
      >
        {{ job.code === 0 ? $t("bench-done") : $t("bench-failed") }}
      </span>
      <span class="text-text-secondary">{{ $t("bench-runs", { count: history.length }) }}</span>
      <p v-if="note !== null" class="text-status-negative" role="alert">{{ note }}</p>
    </div>
    <pre
      v-if="log !== ''"
      class="max-h-24 overflow-auto rounded-control bg-surface-sunken p-1.5 font-mono text-[0.6875rem]"
      translate="no"
      data-testid="bench-log"
      >{{ log }}</pre>
    <template v-if="last !== null">
      <h3 class="font-medium">
        {{ $t("bench-last", { date: last.date.slice(0, 16).replace("T", " "), tier: last.tier }) }}
      </h3>
      <p :class="last.verdict.passed ? 'text-status-positive' : 'text-status-caution'" data-testid="bench-verdict">
        {{ last.verdict.passed ? $t("bench-passed") : last.verdict.reasons.join("; ") }}
      </p>
      <table v-for="each in last.runs" :key="each.backend" class="w-full max-w-xl" :data-backend="each.backend">
        <caption class="text-left font-medium" translate="no">
          {{
            each.backend
          }}
          ·
          {{
            each.status
          }}{{
            each.note === null ? "" : ` · ${each.note}`
          }}
        </caption>
        <tbody>
          <tr v-for="row in each.rows" :key="row.key" :data-key="row.key" data-testid="bench-row">
            <td class="font-mono" translate="no">{{ row.key }}</td>
            <td class="text-right font-mono">{{ row.value === null ? "—" : Math.round(row.value * 100) / 100 }}</td>
            <td class="text-right font-mono text-text-secondary">{{ row.limit }}</td>
            <td :class="RESULT[row.result]">{{ $t(`bench-result-${row.result.replace(" ", "-")}`) }}</td>
          </tr>
        </tbody>
      </table>
    </template>
    <h3 v-if="lines.length > 0" class="font-medium">{{ $t("bench-trend") }}</h3>
    <ul class="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-1.5">
      <li
        v-for="line in lines"
        :key="`${line.backend}:${line.key}`"
        class="flex flex-col"
        :data-key="line.key"
        :data-points="line.values.filter((value) => value !== null).length"
        data-testid="bench-trend"
      >
        <span class="font-mono" translate="no">{{ line.backend }} · {{ line.key }}</span>
        <svg viewBox="-2 -2 124 32" class="h-8 w-full text-accent-brand" aria-hidden="true">
          <polyline
            :points="sparkPoints(line.values, line.limit)"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          />
        </svg>
      </li>
    </ul>
  </section>
</template>
