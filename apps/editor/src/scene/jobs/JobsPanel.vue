<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Jobs panel: the runs of the project with their presets (each a button), and
 * each job of the dev server and of the studio host with its state, its time, its output pictures, clips and files,
 * its log, Run again and Stop. The state is `useJobs.ts`.
 */
import { useI18n } from "@scenity/i18n";
import { onMounted, ref } from "vue";
import { studioHost } from "../../studio/shell/panels";
import { button, field } from "../inspector/inspectorUi";
import { useJobs, type JobRow } from "./useJobs";
import EmptyState from "../../studio/shell/EmptyState.vue";

const props = defineProps<{ base: string }>();
const { $t } = useI18n();
const jobs = useJobs(props.base, () => studioHost.value);
const open = ref<string | null>(null);
/** The arguments of each command of a plugin. */
const argsOf = ref<Record<string, string>>({});
const logs = ref<Readonly<Record<string, readonly string[]>>>({});
onMounted(() => void jobs.load());

async function toggleLog(row: JobRow): Promise<void> {
  open.value = open.value === row.id ? null : row.id;
  if (open.value !== null && row.source === "studio")
    logs.value = { ...logs.value, [row.id]: await jobs.studioLog(row) };
}
const seconds = (row: JobRow): string =>
  row.startedAt === null || row.endedAt === null ? "" : `${((row.endedAt - row.startedAt) / 1000).toFixed(1)} s`;
const MARK: Readonly<Record<string, string>> = {
  done: "text-status-positive",
  failed: "text-status-negative",
  cancelled: "text-text-secondary",
  running: "text-accent-brand",
  queued: "text-text-secondary",
};
</script>

<template>
  <section
    class="flex min-h-0 flex-1 flex-col gap-1 overflow-auto p-1.5 text-caption text-text-primary"
    :aria-label="$t('panel-jobs')"
    data-testid="jobs"
    :data-count="String(jobs.rows.value.length)"
  >
    <div class="flex flex-wrap items-center gap-1" data-testid="jobs-runs">
      <span class="font-semibold">{{ $t("jobs-runs") }}</span>
      <span v-if="jobs.restricted.value" class="text-status-warning" data-testid="jobs-restricted">
        {{ $t("jobs-restricted") }}
      </span>
      <span v-else-if="jobs.runs.value.length === 0" class="text-text-secondary">{{ $t("jobs-no-runs") }}</span>
      <template v-for="run in jobs.runs.value" :key="run.id">
        <button
          type="button"
          :class="button"
          :disabled="jobs.restricted.value"
          :title="run.command"
          :data-testid="`jobs-run-${run.id}`"
          translate="no"
          @click="jobs.startRun(run.id)"
        >
          {{ run.label }}
        </button>
        <button
          v-for="(preset, index) in run.presets"
          :key="`${run.id}-${index}`"
          type="button"
          :class="button"
          :disabled="jobs.restricted.value"
          :title="[run.command, ...preset.args].join(' ')"
          :data-testid="`jobs-run-${run.id}-${index}`"
          translate="no"
          @click="jobs.startRun(run.id, index)"
        >
          {{ run.label }} · {{ preset.label }}
        </button>
      </template>
      <button type="button" :class="button" class="ml-auto" data-testid="jobs-refresh" @click="jobs.load()">
        {{ $t("jobs-refresh") }}
      </button>
    </div>
    <div v-if="jobs.commands.value.length > 0" class="flex flex-col gap-0.5" data-testid="jobs-commands">
      <span class="font-semibold">{{ $t("jobs-commands") }}</span>
      <div
        v-for="command in jobs.commands.value"
        :key="command.name"
        class="flex items-center gap-1"
        :data-command="command.name"
      >
        <span class="w-28 shrink-0 font-medium" translate="no">{{ command.name }}</span>
        <input
          :value="argsOf[command.name] ?? ''"
          :class="field"
          class="max-w-60"
          :placeholder="$t('jobs-command-args')"
          :aria-label="$t('jobs-command-args')"
          translate="no"
          :data-testid="`jobs-command-args-${command.name}`"
          @input="argsOf = { ...argsOf, [command.name]: ($event.target as HTMLInputElement).value }"
        />
        <button
          type="button"
          :class="button"
          :disabled="jobs.restricted.value"
          :data-testid="`jobs-command-run-${command.name}`"
          @click="jobs.runCommand(command.name, argsOf[command.name] ?? '')"
        >
          {{ $t("jobs-command-run") }}
        </button>
        <span class="truncate text-text-secondary">{{ command.summary }}</span>
      </div>
    </div>
    <p v-if="jobs.error.value !== null" class="text-status-negative" role="alert" data-testid="jobs-error">
      {{ jobs.error.value }}
    </p>
    <EmptyState v-if="jobs.rows.value.length === 0" panel="jobs" :text="$t('jobs-none')" />
    <ul class="flex flex-col gap-1" :aria-label="$t('panel-jobs')">
      <li
        v-for="row in jobs.rows.value"
        :key="`${row.source}-${row.id}`"
        class="flex flex-col gap-0.5 border-b border-border-subtle pb-1"
        :data-job="row.id"
        :data-source="row.source"
        :data-state="row.state"
      >
        <div class="flex items-center gap-1">
          <span class="w-16 shrink-0" :class="MARK[row.state] ?? ''">{{ $t(`jobs-state-${row.state}`) }}</span>
          <span class="min-w-0 flex-1 truncate" translate="no" :title="row.title">{{ row.title }}</span>
          <span class="shrink-0 text-text-secondary" translate="no">{{ seconds(row) }}</span>
          <button type="button" :class="button" data-testid="jobs-log" @click="toggleLog(row)">
            {{ $t("jobs-log") }}
          </button>
          <button
            v-if="row.state === 'running' || row.state === 'queued'"
            type="button"
            :class="button"
            data-testid="jobs-cancel"
            @click="jobs.cancel(row)"
          >
            {{ $t("jobs-cancel") }}
          </button>
          <button
            v-else-if="row.source === 'server' || row.request !== undefined"
            type="button"
            :class="button"
            data-testid="jobs-again"
            @click="jobs.again(row)"
          >
            {{ $t("jobs-again") }}
          </button>
        </div>
        <div v-if="row.outputs.length > 0" class="flex flex-wrap gap-1" data-testid="jobs-outputs">
          <template v-for="output in row.outputs" :key="output.name">
            <a
              v-if="output.url !== null && output.kind === 'picture'"
              :href="output.url"
              target="_blank"
              rel="noopener"
            >
              <img :src="output.url" :alt="output.name" class="h-16 rounded-control border border-border-subtle" />
            </a>
            <!-- A clip of a render has no sound and no captions. -->
            <video
              v-else-if="output.url !== null && output.kind === 'video'"
              :src="output.url"
              :aria-label="output.name"
              class="h-16 rounded-control border border-border-subtle"
              controls
              muted
            />
            <a v-else-if="output.url !== null" :href="output.url" class="underline" translate="no" download>{{
              output.name
            }}</a>
            <span v-else translate="no">{{ output.name }}</span>
          </template>
        </div>
        <pre
          v-if="open === row.id"
          class="max-h-40 overflow-auto font-mono text-text-secondary"
          translate="no"
          data-testid="jobs-log-text"
          >{{ (row.source === "studio" ? (logs[row.id] ?? []) : row.log).join("\n") }}</pre>
      </li>
    </ul>
  </section>
</template>
