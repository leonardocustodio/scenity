<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The status bar of the editor window. It shows the save state, the selection count, the jobs and the problem counts.
 * It also shows the agent activity, the changes that wait for review and the items of the plugins. Then it shows the
 * backend, the tier, the frame rate and the bell of the facts that need an action. A press on an item runs its
 * action: it opens its panel, saves or frames.
 */
import { computed } from "vue";
import { useI18n } from "@scenity/i18n";
import { Popover } from "@scenity/ui";
import {
  Bell,
  CircleAlert,
  Cpu,
  GitPullRequestArrow,
  MousePointer2,
  Save,
  TriangleAlert,
  Workflow,
  X,
} from "lucide-vue-next";
import type { StatusItem, WindowStatus } from "./status";

const props = defineProps<{ status: WindowStatus }>();
const { $t } = useI18n();
const values = computed(() => props.status.values);

function press(item: StatusItem): void {
  props.status.action(item)?.();
}

const has = (item: StatusItem): boolean => props.status.action(item) !== undefined;
/** The items of the plugins. A press runs the command of the item. */
const custom = computed(() => [...props.status.custom.values()]);
const run = (command: string | undefined): void => {
  if (command !== undefined) props.status.runCommand?.(command);
};
</script>

<template>
  <div class="studio-statusbar" role="status" :aria-label="$t('status-label')" data-testid="studio-status">
    <button
      v-if="values.save !== null"
      type="button"
      class="studio-status-item"
      :data-state="values.save.error ? 'error' : values.save.dirty ? 'unsaved' : 'saved'"
      :disabled="!has('save')"
      data-testid="status-save"
      :data-command="props.status.commandOf('save')"
      :title="$t('status-save-title')"
      @click="press('save')"
    >
      <Save aria-hidden="true" />{{ values.save.text }}
    </button>
    <button
      v-if="values.selection !== null"
      type="button"
      class="studio-status-item"
      :disabled="!has('selection') || values.selection === 0"
      data-testid="status-selection"
      :data-command="props.status.commandOf('selection')"
      :title="$t('status-selection-title')"
      @click="press('selection')"
    >
      <MousePointer2 aria-hidden="true" />{{ $t("status-selection", { count: values.selection }) }}
    </button>
    <button
      v-if="values.jobs !== null"
      type="button"
      class="studio-status-item"
      :disabled="!has('jobs')"
      data-testid="status-jobs"
      :data-command="props.status.commandOf('jobs')"
      @click="press('jobs')"
    >
      <Workflow aria-hidden="true" />{{ $t("status-jobs", { count: values.jobs }) }}
    </button>
    <button
      v-if="values.problems !== null"
      type="button"
      class="studio-status-item"
      :data-state="values.problems.fail > 0 ? 'fail' : values.problems.warn > 0 ? 'warn' : 'ok'"
      :disabled="!has('problems')"
      data-testid="status-problems"
      :data-command="props.status.commandOf('problems')"
      :title="$t('status-problems-title')"
      @click="press('problems')"
    >
      <CircleAlert aria-hidden="true" />{{ values.problems.fail }} <TriangleAlert aria-hidden="true" />{{
        values.problems.warn
      }}
    </button>
    <button
      v-if="values.agent !== null"
      type="button"
      class="studio-status-item"
      :disabled="!has('agent')"
      data-testid="status-agent"
      :data-command="props.status.commandOf('agent')"
      @click="press('agent')"
    >
      {{ values.agent }}
    </button>
    <button
      v-if="values.review !== null && values.review > 0"
      type="button"
      class="studio-status-item"
      :disabled="!has('review')"
      data-testid="status-review"
      :data-command="props.status.commandOf('review')"
      @click="press('review')"
    >
      <GitPullRequestArrow aria-hidden="true" />{{ $t("review-status", { count: values.review }) }}
    </button>
    <span class="studio-status-gap" />
    <button
      v-for="item in custom"
      :key="item.id"
      type="button"
      class="studio-status-item"
      :disabled="item.command === undefined"
      :title="item.title?.()"
      :data-testid="`status-${item.id}`"
      :data-command="item.command"
      @click="run(item.command)"
    >
      <span :data-version="item.version.value">{{ item.text() }}</span>
    </button>
    <button
      v-if="values.render !== null"
      type="button"
      class="studio-status-item"
      :disabled="!has('render')"
      data-testid="status-render"
      :data-command="props.status.commandOf('render')"
      :title="$t('status-render-title')"
      @click="press('render')"
    >
      <Cpu aria-hidden="true" /><span translate="no">{{ values.render.backend }} · {{ values.render.tier }}</span>
      <template v-if="values.render.fps !== null"> · {{ $t("status-fps", { fps: values.render.fps }) }}</template>
    </button>
    <Popover>
      <template #trigger>
        <button
          type="button"
          class="studio-status-item"
          :aria-label="$t('status-bell', { count: values.bell.length })"
          :data-count="values.bell.length"
          data-testid="status-bell"
        >
          <Bell aria-hidden="true" /><span v-if="values.bell.length > 0">{{ values.bell.length }}</span>
        </button>
      </template>
      <div class="flex w-72 flex-col gap-2" data-testid="status-bell-list">
        <p v-if="values.bell.length === 0" class="text-text-secondary">{{ $t("status-bell-empty") }}</p>
        <div v-for="fact in values.bell" :key="fact.id" class="flex items-start gap-2">
          <p class="min-w-0 flex-1">{{ fact.text }}</p>
          <button
            type="button"
            class="studio-toast-close"
            :aria-label="$t('notice-dismiss')"
            @click="props.status.forget(fact.id)"
          >
            <X aria-hidden="true" />
          </button>
        </div>
      </div>
    </Popover>
  </div>
</template>
