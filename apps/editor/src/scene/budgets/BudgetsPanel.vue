<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The budgets editor. It shows the quality budgets of the project (`quality.budgets`: a group, each tier, the limit of
 * each key). Next to each limit, it shows the value and the result of the last bench run of the tier. Save writes the
 * project file through the route of Project settings. The Bench panel runs the next bench. The budgets of the build
 * entries are in the Build window (`build.budgets`).
 */
import { useI18n } from "@scenity/i18n";
import { computed, onMounted, ref, shallowRef } from "vue";
import { isBenchReport, type BenchReportView } from "../performance/benchTrend";
import { readProjectSettings, writeProjectSettings } from "../projectSettings/projectCalls";
import { button, field, selectField } from "../inspector/inspectorUi";
import { budgetRows, groupsOf, tiersOf, withLimit, type BudgetKey, type QualityBudgets } from "./budgetTable";

const props = defineProps<{ base: string; open: (panel: string) => void }>();
const { $t } = useI18n();
type Project = Record<string, unknown> & { quality?: { tiers?: string[]; budgets?: QualityBudgets } };
const project = shallowRef<Project | null>(null);
const budgets = shallowRef<QualityBudgets>({});
const history = shallowRef<BenchReportView[]>([]);
const group = ref("scene");
const saved = ref(true);
const note = ref<string | null>(null);

async function load(): Promise<void> {
  const settings = await readProjectSettings(props.base).catch(() => null);
  if (settings !== null) {
    project.value = settings.project as Project;
    budgets.value = project.value.quality?.budgets ?? {};
    saved.value = true;
  }
  const bench = await fetch(`${props.base}bench.json`, { cache: "no-store" }).catch(() => null);
  if (bench?.ok === true)
    history.value = ((await bench.json()) as { history: unknown[] }).history.filter(isBenchReport);
}
onMounted(() => void load());

const tiers = computed(() => (project.value === null ? [] : tiersOf(project.value)));
const rows = computed(() => budgetRows(budgets.value, group.value, tiers.value, history.value));

function setLimit(tier: string, key: BudgetKey, text: string): void {
  const value = text.trim() === "" ? null : Number(text);
  if (value !== null && (!Number.isFinite(value) || value < 0)) return;
  budgets.value = withLimit(budgets.value, group.value, tier, key, value);
  saved.value = false;
}

async function save(): Promise<void> {
  if (project.value === null) return;
  const next = { ...project.value, quality: { ...(project.value.quality ?? {}), budgets: budgets.value } };
  const answer = await writeProjectSettings(props.base, next);
  note.value = answer.ok ? null : answer.checks.map((check) => `${check.path}: ${check.detail}`).join("; ");
  if (answer.ok) await load();
}
</script>

<template>
  <section
    class="flex min-h-0 flex-1 flex-col gap-1 overflow-auto p-1.5 text-caption text-text-primary"
    :aria-label="$t('panel-budgets')"
    data-testid="budgets"
    :data-saved="saved ? '1' : '0'"
  >
    <div class="flex flex-wrap items-center gap-1">
      <select
        v-model="group"
        :class="selectField"
        class="max-w-40"
        :aria-label="$t('budgets-group')"
        data-testid="budgets-group"
      >
        <option v-for="name in groupsOf(budgets)" :key="name" :value="name" translate="no">{{ name }}</option>
      </select>
      <button type="button" :class="button" :disabled="saved" data-testid="budgets-save" @click="save">
        {{ $t("budgets-save") }}
      </button>
      <button type="button" :class="button" data-testid="budgets-refresh" @click="load">
        {{ $t("budgets-refresh") }}
      </button>
      <button type="button" :class="button" data-testid="budgets-bench" @click="open('bench')">
        {{ $t("budgets-bench") }}
      </button>
      <button type="button" :class="button" data-testid="budgets-build" @click="open('build')">
        {{ $t("budgets-build") }}
      </button>
    </div>
    <p v-if="note !== null" class="text-status-negative" role="alert" data-testid="budgets-note">{{ note }}</p>
    <table class="w-full border-collapse">
      <thead>
        <tr class="text-left text-text-secondary">
          <th class="pr-2 font-normal">{{ $t("budgets-tier") }}</th>
          <th class="pr-2 font-normal">{{ $t("budgets-key") }}</th>
          <th class="pr-2 font-normal">{{ $t("budgets-limit") }}</th>
          <th class="pr-2 font-normal">{{ $t("budgets-value") }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="`${row.tier}-${row.key}`"
          class="border-b border-border-subtle"
          :data-row="`${row.tier}.${row.key}`"
          :data-result="row.result ?? ''"
          :data-bench-limit="row.benchLimit ?? ''"
        >
          <td class="pr-2" translate="no">{{ row.tier }}</td>
          <td class="pr-2" translate="no">{{ row.key }}</td>
          <td class="pr-2">
            <input
              :class="field"
              class="max-w-28"
              inputmode="decimal"
              :value="row.limit ?? ''"
              :aria-label="$t('budgets-limit-of', { key: row.key, tier: row.tier })"
              :data-testid="`budgets-limit-${row.tier}-${row.key}`"
              @change="setLimit(row.tier, row.key, ($event.target as HTMLInputElement).value)"
            />
          </td>
          <td
            class="pr-2"
            :class="
              row.result === 'over'
                ? 'text-status-negative'
                : row.result === 'pass'
                  ? 'text-status-positive'
                  : 'text-text-secondary'
            "
            translate="no"
          >
            {{ row.value ?? "—" }}<template v-if="row.result !== null"> · {{ row.result }}</template>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
