<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The version control panel. It shows the branch and the changed files of the project, and the diff of a file. For a
 * scene, a prefab or a sequence, the diff is the semantic diff with the patch under it. For another file, it is the
 * patch. The panel also has the commit of the selected files by the owner, the branches with Switch and the
 * worktrees. In the studio, it also shows the agent tasks of each branch. The state is in `useVcs.ts`.
 */
import { useI18n } from "@scenity/i18n";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import SemanticDiff from "../diff/SemanticDiff.vue";
import { button, field } from "../inspector/inspectorUi";
import { useVcs } from "./useVcs";
import EmptyState from "../../studio/shell/EmptyState.vue";

interface BranchTask {
  readonly id: string;
  readonly name: string;
  readonly branch: string | null;
  readonly state: string;
}

const props = defineProps<{
  base: string;
  /** The agent tasks of the project (in the studio), each with the branch where it ran. */
  tasks?: () => Promise<readonly BranchTask[]>;
  /** Call `listener` after each save of a file of the page. The result stops it. */
  onSaved?: (listener: (path: string) => void) => () => void;
}>();
const { $t } = useI18n();
const vcs = useVcs(props.base);
const showPatch = ref(false);
const taskList = shallowRef<readonly BranchTask[]>([]);
const tasksOf = (name: string): readonly BranchTask[] => taskList.value.filter((task) => task.branch === name);
const lines = computed(() =>
  (vcs.diff.value?.patch ?? "").split("\n").map((line) => ({
    line,
    kind:
      line.startsWith("+") && !line.startsWith("+++")
        ? "add"
        : line.startsWith("-") && !line.startsWith("---")
          ? "del"
          : "same",
  })),
);
let stop: (() => void) | undefined;
onMounted(() => {
  void vcs.refresh();
  stop = props.onSaved?.((path) => vcs.saved(path));
  void props.tasks?.().then(
    (list) => {
      taskList.value = list;
    },
    () => undefined,
  );
});
onBeforeUnmount(() => stop?.());

function toggle(path: string, on: boolean): void {
  vcs.picked.value = on ? [...vcs.picked.value, path] : vcs.picked.value.filter((item) => item !== path);
}
const STATUS: Readonly<Record<string, string>> = {
  M: "vcs-status-m",
  A: "vcs-status-a",
  D: "vcs-status-d",
  R: "vcs-status-r",
  "?": "vcs-status-new",
};
</script>

<template>
  <section
    class="flex min-h-0 flex-1 gap-2 overflow-hidden p-1.5 text-caption text-text-primary"
    :aria-label="$t('panel-vcs')"
    data-testid="vcs"
    :data-git="vcs.git.value === null ? '' : vcs.git.value ? '1' : '0'"
  >
    <p v-if="vcs.git.value === false" class="text-text-secondary">{{ $t("vcs-no-git") }}</p>
    <template v-else>
      <div class="flex w-72 shrink-0 flex-col gap-1 overflow-auto">
        <div class="flex items-center gap-1">
          <span class="font-semibold" translate="no" data-testid="vcs-branch">{{ vcs.branch.value ?? "" }}</span>
          <button type="button" :class="button" class="ml-auto" data-testid="vcs-refresh" @click="vcs.refresh()">
            {{ $t("vcs-refresh") }}
          </button>
        </div>
        <EmptyState v-if="vcs.files.value.length === 0" panel="vcs" :text="$t('vcs-clean')" />
        <ul :aria-label="$t('vcs-changes')" data-testid="vcs-files">
          <li v-for="file in vcs.files.value" :key="file.path" class="flex items-center gap-1" :data-path="file.path">
            <input
              type="checkbox"
              :checked="vcs.picked.value.includes(file.path)"
              :aria-label="$t('vcs-pick', { path: file.path })"
              :data-testid="`vcs-pick-${file.path}`"
              @change="toggle(file.path, ($event.target as HTMLInputElement).checked)"
            />
            <span class="w-4 text-text-secondary" :title="$t(STATUS[file.status] ?? 'vcs-status-m')" translate="no">{{
              file.status
            }}</span>
            <button
              type="button"
              class="truncate text-left hover:underline"
              :class="vcs.diff.value?.path === file.path ? 'font-medium' : ''"
              translate="no"
              :data-testid="`vcs-file-${file.path}`"
              @click="vcs.showDiff(file.path)"
            >
              {{ file.path }}
            </button>
          </li>
        </ul>
        <form class="flex flex-col gap-1" :aria-label="$t('vcs-commit')" @submit.prevent="vcs.commit()">
          <input
            v-model="vcs.message.value"
            :class="field"
            :placeholder="$t('vcs-message')"
            :aria-label="$t('vcs-message')"
            data-testid="vcs-message"
          />
          <button
            type="submit"
            :class="button"
            class="self-start"
            :disabled="!vcs.canCommit.value"
            data-testid="vcs-commit"
          >
            {{ $t("vcs-commit-picked", { count: vcs.picked.value.length }) }}
          </button>
        </form>
        <p v-if="vcs.notice.value !== null" role="status" class="text-status-positive" data-testid="vcs-notice">
          {{ $t("vcs-committed", { commit: vcs.notice.value }) }}
        </p>
        <p v-if="vcs.error.value !== null" role="alert" class="text-status-negative" data-testid="vcs-error">
          {{ vcs.error.value }}
        </p>
        <h3 class="mt-1 font-semibold">{{ $t("vcs-branches") }}</h3>
        <ul data-testid="vcs-branches">
          <li
            v-for="item in vcs.branches.value"
            :key="item.name"
            class="flex flex-col"
            :data-branch="item.name"
            :data-current="item.current ? '1' : '0'"
          >
            <div class="flex items-center gap-1">
              <span :class="item.current ? 'font-medium' : ''" translate="no">{{ item.name }}</span>
              <span v-if="item.upstream !== null" class="text-text-secondary" translate="no">{{ item.upstream }}</span>
              <button
                v-if="!item.current"
                type="button"
                :class="button"
                class="ml-auto"
                :disabled="vcs.busy.value"
                :data-testid="`vcs-switch-${item.name}`"
                @click="vcs.switchTo(item.name)"
              >
                {{ $t("vcs-switch") }}
              </button>
            </div>
            <span
              v-for="task in tasksOf(item.name)"
              :key="task.id"
              class="pl-2 text-text-secondary"
              :data-task="task.id"
            >
              {{ $t("vcs-task", { name: task.name, state: task.state }) }}
            </span>
          </li>
        </ul>
        <template v-if="vcs.worktrees.value.length > 1">
          <h3 class="mt-1 font-semibold">{{ $t("vcs-worktrees") }}</h3>
          <ul data-testid="vcs-worktrees">
            <li v-for="tree in vcs.worktrees.value" :key="tree.path" class="truncate" translate="no" :title="tree.path">
              {{ tree.branch ?? tree.head.slice(0, 10) }} · {{ tree.path }}
            </li>
          </ul>
        </template>
      </div>
      <div class="flex min-w-0 flex-1 flex-col gap-1 overflow-auto" data-testid="vcs-diff">
        <p v-if="vcs.diff.value === null" class="text-text-secondary">{{ $t("vcs-pick-file") }}</p>
        <template v-else>
          <div class="flex items-center gap-1">
            <span class="font-medium" translate="no">{{ vcs.diff.value.path }}</span>
            <label v-if="vcs.diff.value.semantic !== null" class="ml-auto flex items-center gap-1" for="vcs-patch">
              <input id="vcs-patch" v-model="showPatch" type="checkbox" data-testid="vcs-show-patch" />
              {{ $t("vcs-show-patch") }}
            </label>
          </div>
          <SemanticDiff v-if="vcs.diff.value.semantic !== null" :diff="vcs.diff.value.semantic" />
          <pre
            v-if="vcs.diff.value.semantic === null || showPatch"
            class="overflow-auto font-mono text-caption"
            translate="no"
            data-testid="vcs-patch"
          ><span
            v-for="(item, index) in lines"
            :key="index"
            class="block"
            :class="item.kind === 'add' ? 'text-status-positive' : item.kind === 'del' ? 'text-status-negative' : ''"
            :data-kind="item.kind"
          >{{ item.line }}</span></pre>
        </template>
      </div>
    </template>
  </section>
</template>
