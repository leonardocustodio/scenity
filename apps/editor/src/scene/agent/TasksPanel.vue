<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Tasks panel. It has a form for a new background task (a prompt, a budget, a time limit and a gate). It also has
 * the list of the tasks of the project: the prompt, the session in its colour, the state, the change sets that wait,
 * the use of the budget, the branch and the last check of the gate. A search finds old tasks (the record of the
 * host). Open shows the session in the agent panel. Review opens the Review panel.
 *
 * A count of variants above 1 gives the prompt to that number of agents at the same time (a group of tasks). When
 * each task of a group is at its end, Compare shows the grid of frames of the group. There the person keeps one
 * variant.
 */
import { computed, ref, useId, watch } from "vue";
import { useI18n } from "@scenity/i18n";
import { Button, Select } from "@scenity/ui";
import type { AgentTaskInfo, TaskRequest } from "./agentClient";
import TaskGrid from "./TaskGrid.vue";
import { taskGroups, type TaskGroupView } from "./taskGroups";
import { EmptyState } from "../../studio/extensions/api";

const props = defineProps<{
  /** The tasks of the project, the newest first. */
  tasks: () => readonly AgentTaskInfo[];
  start(request: TaskRequest): Promise<AgentTaskInfo | null>;
  stop(id: string): Promise<void>;
  /** The tasks of a search of the record of the host. */
  search(text: string): Promise<readonly AgentTaskInfo[]>;
  /** The count of the ops that wait in Review for the change sets of a task. */
  waiting(sets: readonly string[]): number;
  /** Show the session of a task in the agent panel, or the Review panel. */
  open(session: string): void;
  review(): void;
  /** The picture of the view after the change sets of a session, and the keep and the merge of a group. */
  picture(session: string): Promise<ImageBitmap | null>;
  keep(group: TaskGroupView, session: string): string | null;
  merge(group: TaskGroupView): string | null;
}>();
const { $t } = useI18n();

const prompt = ref("");
const budget = ref(5);
const minutes = ref(30);
const gate = ref<"rules" | "check" | "none">("rules");
const gateOptions = computed(() => [
  { value: "rules", label: $t("tasks-gate-rules") },
  // The rules, then `scenity check` of the task folder.
  { value: "check", label: $t("tasks-gate-check") },
  { value: "none", label: $t("tasks-gate-none") },
]);
/** The task works in a Git worktree of the project. */
const worktree = ref(false);
const busy = ref(false);
const variants = ref(1);
const ids = { budget: useId(), minutes: useId(), variants: useId(), worktree: useId() };

async function begin(): Promise<void> {
  const text = prompt.value.trim();
  if (text === "" || busy.value) return;
  busy.value = true;
  const request = { prompt: text, budgetUsd: Math.max(0.01, budget.value), maxMinutes: Math.max(1, minutes.value) };
  const count = Math.round(variants.value);
  const many = count >= 2 ? { variants: Math.min(6, count) } : {};
  const made = await props.start({
    ...request,
    gate: gate.value,
    ...many,
    ...(worktree.value ? { worktree: true } : {}),
  });
  busy.value = false;
  if (made !== null) prompt.value = "";
}

// The search reads the record of the host. An empty search shows the tasks of the panel.
const query = ref("");
const found = ref<readonly AgentTaskInfo[] | null>(null);
let timer: ReturnType<typeof setTimeout> | null = null;
watch(query, (text) => {
  if (timer !== null) clearTimeout(timer);
  if (text.trim() === "") {
    found.value = null;
    return;
  }
  timer = setTimeout(() => {
    void props.search(text.trim()).then((tasks) => (found.value = tasks));
  }, 200);
});
const shown = computed(() => found.value ?? props.tasks());

// The groups of the tasks, and the group that the grid shows.
const groups = computed(() => taskGroups(props.tasks()));
const comparing = ref<string | null>(null);
const compared = computed(() => groups.value.find((group) => group.id === comparing.value) ?? null);
const reason = ref<string | null>(null);
/** The group of a task when the task is its first one and each task of the group is at its end. */
function comparable(task: AgentTaskInfo): TaskGroupView | null {
  const group = groups.value.find((item) => item.id === task.group?.id);
  return group !== undefined && group.ended && group.tasks[0]?.id === task.id ? group : null;
}
function keepOne(session: string): void {
  if (compared.value === null) return;
  reason.value = props.keep(compared.value, session);
  if (reason.value === null) comparing.value = null;
}
function mergeAll(): void {
  if (compared.value === null) return;
  reason.value = props.merge(compared.value);
  if (reason.value === null) comparing.value = null;
}

const colour = (token: string): Record<string, string> => ({ background: `var(--sc-color-studio-${token})` });
const money = (value: number): string => `$${value.toFixed(2)}`;
const running = (task: AgentTaskInfo): boolean => task.state === "running" || task.state === "checking";
function gateWords(task: AgentTaskInfo): string {
  if (task.gate === "none") return $t("tasks-gate-none");
  const check = task.check;
  if (check === null) return $t(task.gate === "check" ? "tasks-gate-check" : "tasks-gate-rules");
  if (check.passed === null) return $t("tasks-check-none", { message: check.message });
  if (check.passed) return $t(task.gate === "check" ? "tasks-check-passed-check" : "tasks-check-passed");
  return $t("tasks-check-failed", { message: check.message });
}
</script>

<template>
  <section class="flex h-full min-h-0 flex-col gap-2 overflow-auto p-2 text-caption" data-testid="tasks-panel">
    <form class="flex flex-col gap-2" :aria-label="$t('tasks-new')" @submit.prevent="begin">
      <textarea
        v-model="prompt"
        rows="3"
        class="w-full resize-y rounded-control border border-border-strong bg-surface-raised p-2 text-body"
        :aria-label="$t('tasks-prompt')"
        :placeholder="$t('tasks-prompt-placeholder')"
        data-testid="tasks-prompt"
      />
      <div class="flex flex-wrap items-center gap-2">
        <label class="flex items-center gap-1" :for="ids.budget">
          {{ $t("tasks-budget") }}
          <input
            :id="ids.budget"
            v-model.number="budget"
            type="number"
            min="0.01"
            step="any"
            class="w-16 rounded-control border border-border-strong bg-surface-raised px-1"
            data-testid="tasks-budget"
          />
        </label>
        <label class="flex items-center gap-1" :for="ids.minutes">
          {{ $t("tasks-minutes") }}
          <input
            :id="ids.minutes"
            v-model.number="minutes"
            type="number"
            min="1"
            class="w-14 rounded-control border border-border-strong bg-surface-raised px-1"
            data-testid="tasks-minutes"
          />
        </label>
        <label class="flex items-center gap-1" :for="ids.variants" :title="$t('tasks-variants-title')">
          {{ $t("tasks-variants") }}
          <input
            :id="ids.variants"
            v-model.number="variants"
            type="number"
            min="1"
            max="6"
            class="w-12 rounded-control border border-border-strong bg-surface-raised px-1"
            data-testid="tasks-variants"
          />
        </label>
        <Select
          v-model="gate"
          :options="gateOptions"
          class="w-32"
          :aria-label="$t('tasks-gate')"
          data-testid="tasks-gate-select"
        />
        <label class="flex items-center gap-1" :for="ids.worktree" :title="$t('tasks-worktree-title')">
          <input :id="ids.worktree" v-model="worktree" type="checkbox" data-testid="tasks-worktree" />
          {{ $t("tasks-worktree") }}
        </label>
        <Button size="sm" variant="primary" type="submit" :disabled="busy" data-testid="tasks-start">
          {{ $t("tasks-start") }}
        </Button>
      </div>
    </form>
    <input
      v-model="query"
      type="search"
      class="rounded-control border border-border-strong bg-surface-raised px-2 py-1"
      :aria-label="$t('tasks-search')"
      :placeholder="$t('tasks-search')"
      data-testid="tasks-search"
    />
    <TaskGrid
      v-if="compared !== null"
      :key="compared.id"
      :group="compared"
      :picture="picture"
      :waiting="waiting"
      :keep="keepOne"
      :merge="mergeAll"
      :close="() => (comparing = null)"
    />
    <p v-if="reason !== null" class="text-text-secondary" role="alert">{{ reason }}</p>
    <div v-if="shown.length === 0" data-testid="tasks-empty">
      <EmptyState panel="tasks" :text="$t('tasks-empty')" />
    </div>
    <ul v-else class="flex flex-col gap-1" :aria-label="$t('tasks-list')">
      <li
        v-for="task in shown"
        :key="task.id"
        class="flex flex-col gap-1 rounded-control border border-border-subtle p-2"
        :data-state="task.state"
        :data-group="task.group?.id"
        data-testid="tasks-row"
      >
        <div class="flex items-center gap-2">
          <span class="size-2 flex-none rounded-full" :style="colour(task.colour)" aria-hidden="true" />
          <strong class="min-w-0 flex-1 truncate">{{ task.name }}</strong>
          <span class="text-text-secondary" data-testid="tasks-state">{{ $t(`tasks-state-${task.state}`) }}</span>
        </div>
        <p class="truncate text-text-secondary">{{ task.prompt }}</p>
        <p class="text-text-secondary" data-testid="tasks-facts">
          <span translate="no">{{ money(task.costUsd) }} / {{ money(task.budgetUsd) }}</span>
          · {{ $t("tasks-waiting", { count: waiting(task.sets) }) }}
          <template v-if="task.branch !== null">
            · <span translate="no">{{ task.branch }}</span>
          </template>
        </p>
        <p class="text-text-secondary" data-testid="tasks-gate">{{ gateWords(task) }}</p>
        <p v-if="task.reason !== null" class="text-text-secondary" data-testid="tasks-reason">{{ task.reason }}</p>
        <p v-if="task.pack !== null" class="text-text-secondary" data-testid="tasks-pack">
          {{ $t("tasks-pack") }} <span translate="no">{{ task.pack }}/REVIEW.md</span>
        </p>
        <div class="flex gap-1">
          <Button size="sm" variant="ghost" data-testid="tasks-open" @click="open(task.session)">
            {{ $t("tasks-open") }}
          </Button>
          <Button v-if="waiting(task.sets) > 0" size="sm" variant="ghost" data-testid="tasks-review" @click="review()">
            {{ $t("tasks-review") }}
          </Button>
          <Button
            v-if="comparable(task) !== null"
            size="sm"
            variant="primary"
            data-testid="tasks-compare"
            @click="comparing = task.group?.id ?? null"
          >
            {{ $t("tasks-compare", { count: task.group?.count ?? 0 }) }}
          </Button>
          <Button v-if="running(task)" size="sm" variant="ghost" data-testid="tasks-stop" @click="stop(task.id)">
            {{ $t("tasks-stop") }}
          </Button>
        </div>
      </li>
    </ul>
  </section>
</template>
