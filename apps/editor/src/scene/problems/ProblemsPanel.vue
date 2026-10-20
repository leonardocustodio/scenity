<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Problems panel: the problems of the window, the errors first. Each row has its kind, its title and its detail.
 * It also has Go to (it selects the entities of the problem and moves the clock to its time), its fixes, and Ask the
 * agent to fix when an agent is there. A menu shows only one kind.
 */
import { computed, onMounted } from "vue";
import { useI18n } from "@scenity/i18n";
import { Button, Select } from "@scenity/ui";
import { CircleAlert, TriangleAlert } from "lucide-vue-next";
import { PROBLEM_KINDS, type Problem, type ProblemList } from "./problemList";
import { EmptyState, usePanelState } from "../../studio/extensions/api";

const props = defineProps<{
  list: ProblemList;
  goTo(problem: Problem): void;
  /** Ask the agent to fix a problem; null when no agent is there. */
  ask: (() => ((problem: Problem) => void) | null) | undefined;
  /** More actions of the header (the check job). */
  actions?: readonly { readonly id: string; readonly label: string; readonly busy: () => boolean; run(): void }[];
}>();
const { $t } = useI18n();

const kind = usePanelState<string>("kind", "all");
const kindOptions = computed(() => [
  { value: "all", label: $t("problems-kind-all") },
  ...PROBLEM_KINDS.map((item) => ({ value: item, label: $t(`problems-kind-${item}`) })),
]);
const shown = computed(() =>
  props.list.problems.value.filter((problem) => kind.value === "all" || problem.kind === kind.value),
);
const counts = computed(() => {
  const all = props.list.problems.value;
  const errors = all.filter((problem) => problem.level === "error").length;
  return { errors, warnings: all.length - errors };
});
const asker = computed(() => props.ask?.() ?? null);
// The rules check again when the panel shows.
onMounted(() => void props.list.refresh());
const canGo = (problem: Problem): boolean => problem.entities.length > 0 || problem.time !== null;
</script>

<template>
  <section
    class="flex h-full min-h-0 flex-col text-caption"
    :aria-label="$t('panel-problems')"
    data-testid="problems-panel"
  >
    <div class="flex flex-wrap items-center gap-2 border-b border-border-subtle p-1">
      <span class="text-text-secondary" data-testid="problems-counts">{{
        $t("problems-counts", { errors: counts.errors, warnings: counts.warnings })
      }}</span>
      <Select v-model="kind" :options="kindOptions" class="w-40" :aria-label="$t('problems-kind')" />
      <span class="flex-1" />
      <Button
        v-for="action in actions ?? []"
        :key="action.id"
        size="sm"
        variant="ghost"
        :disabled="action.busy()"
        :data-testid="`problems-${action.id}`"
        @click="action.run()"
      >
        {{ action.label }}
      </Button>
      <Button size="sm" variant="ghost" data-testid="problems-refresh" @click="list.refresh()">
        {{ $t("problems-refresh") }}
      </Button>
    </div>
    <div v-if="shown.length === 0" data-testid="problems-none">
      <EmptyState panel="problems" :text="$t('problems-none')" />
    </div>
    <ol v-else class="min-h-0 flex-1 overflow-auto" :aria-label="$t('problems-list')">
      <li
        v-for="problem in shown"
        :key="problem.key"
        class="flex flex-col gap-1 border-b border-border-subtle px-2 py-1"
        :data-kind="problem.kind"
        :data-level="problem.level"
        data-testid="problem-row"
      >
        <div class="flex items-center gap-2">
          <CircleAlert
            v-if="problem.level === 'error'"
            class="size-icon-sm flex-none text-status-negative"
            :aria-label="$t('problems-level-error')"
          />
          <TriangleAlert
            v-else
            class="size-icon-sm flex-none text-status-caution"
            :aria-label="$t('problems-level-warn')"
          />
          <span class="w-20 flex-none text-text-secondary">{{ $t(`problems-kind-${problem.kind}`) }}</span>
          <span class="min-w-0 flex-1" data-testid="problem-title">{{ problem.title }}</span>
        </div>
        <p v-if="problem.detail !== null" class="pl-6 text-text-secondary" translate="no">{{ problem.detail }}</p>
        <div class="flex flex-wrap gap-1 pl-6">
          <Button v-if="canGo(problem)" size="sm" variant="ghost" data-testid="problem-go" @click="goTo(problem)">
            {{ $t("problems-go") }}
          </Button>
          <Button
            v-for="fix in problem.fixes"
            :key="fix.id"
            size="sm"
            variant="ghost"
            :data-fix="fix.id"
            data-testid="problem-fix"
            @click="fix.run()"
          >
            {{ fix.label }}
          </Button>
          <Button v-if="asker !== null" size="sm" variant="ghost" data-testid="problem-ask" @click="asker(problem)">
            {{ $t("problems-ask") }}
          </Button>
        </div>
      </li>
    </ol>
  </section>
</template>
