<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Runs tab. It has these parts:
 * - the buttons of the runs of the project: the presets of `workbench.runs` and of the host plugins (a sequence field,
 *   a plain button, or a button that asks first, for example a release);
 * - a free run of the project and the list of runs;
 * - the output of the selected run and the images of its output folder.
 * The tab only starts the runs. The host checks them.
 */
import type { RunInfo } from "@scenity/workbench-host/protocol";
import { computed, reactive, ref, watch } from "vue";
import { button, cn, field } from "../layout/ui";
import AssetRun from "./AssetRun.vue";
import RunImages from "./RunImages.vue";
import type { RunFiles } from "./runFile";
import { buttonArgs, runButtons, words, type RunButton } from "./runPresets";
import { runLine, type RunsApi } from "./useRuns";

defineOptions({ name: "DockRuns" });
const props = defineProps<{
  readonly runs: RunsApi;
  readonly files: RunFiles;
}>();

const buttons = computed(() => runButtons(props.runs.commands.value));
/** The text of each sequence field, by the key of its button. */
const sequences = reactive<Record<string, string>>({});
const command = ref("");
const argsText = ref("");
/** The key of the button that asks the owner now, or null. */
const confirming = ref<string | null>(null);
const asking = computed(() => buttons.value.confirm.find((item) => item.key === confirming.value) ?? null);
/** The asset flow shows when the project has the run `asset` (AssetRun.vue). */
const hasAsset = computed(() => props.runs.commands.value.some((run) => run.id === "asset"));

watch(
  () => props.runs.commands.value,
  (list) => {
    for (const item of buttons.value.sequence) sequences[item.key] ??= item.preset.sequence ?? "";
    if (!list.some((run) => run.id === command.value)) command.value = list[0]?.id ?? "";
  },
  { immediate: true },
);

const current = computed<RunInfo | null>(
  () => props.runs.runs.value.find((run) => run.run === props.runs.selected.value) ?? props.runs.runs.value[0] ?? null,
);
const text = computed(() => (current.value === null ? "" : (props.runs.output.value[current.value.run] ?? "")));

const STATUS_CLASS: Readonly<Record<RunInfo["status"], string>> = {
  running: "text-status-caution",
  passed: "text-status-positive",
  failed: "text-status-negative",
  cancelled: "text-text-secondary",
};

function startButton(item: RunButton): void {
  void props.runs.start(item.run.id, buttonArgs(item, sequences[item.key] ?? ""));
}

async function confirmed(item: RunButton): Promise<void> {
  confirming.value = null;
  await props.runs.start(item.run.id, buttonArgs(item), true);
}
</script>

<template>
  <div class="grid h-full min-h-0 grid-cols-[16rem_minmax(0,1fr)] gap-3" data-testid="dock-runs-tab">
    <div class="flex min-h-0 flex-col gap-2 overflow-y-auto">
      <form v-for="item in buttons.sequence" :key="item.key" class="flex gap-1" @submit.prevent="startButton(item)">
        <input
          v-model="sequences[item.key]"
          :class="field"
          :aria-label="`Sequence of ${item.run.label}`"
          placeholder="sequence"
        />
        <button type="submit" :class="button" :disabled="(sequences[item.key] ?? '').trim() === ''">
          {{ item.preset.label }}
        </button>
      </form>
      <div class="flex flex-wrap gap-1">
        <button v-for="item in buttons.plain" :key="item.key" type="button" :class="button" @click="startButton(item)">
          {{ item.preset.label }}
        </button>
        <button
          v-for="item in buttons.confirm"
          :key="item.key"
          type="button"
          :class="button"
          :data-testid="item.run.id"
          @click="confirming = item.key"
        >
          {{ item.preset.label }}
        </button>
      </div>
      <div
        v-if="asking !== null"
        role="alertdialog"
        aria-labelledby="run-confirm-title"
        class="flex flex-col gap-1 rounded-control border border-status-caution bg-surface-sunken p-2"
        :data-testid="`${asking.run.id}-confirm`"
      >
        <p id="run-confirm-title" class="text-caption">{{ asking.preset.confirm }}</p>
        <div class="flex gap-1">
          <button type="button" :class="button" @click="confirmed(asking)">{{ asking.run.label }}</button>
          <button type="button" :class="button" @click="confirming = null">Back</button>
        </div>
      </div>
      <AssetRun v-if="hasAsset" :runs="runs" />
      <form class="flex gap-1" @submit.prevent="runs.start(command, words(argsText))">
        <select v-model="command" :class="cn(field, 'w-28')" aria-label="Run command">
          <option v-for="run in runs.commands.value" :key="run.id" :value="run.id">{{ run.id }}</option>
        </select>
        <input v-model="argsText" :class="field" aria-label="Arguments" placeholder="arguments" />
        <button type="submit" :class="button" :disabled="command === ''">Run</button>
      </form>
      <p v-if="runs.error.value !== null" class="text-caption text-status-negative" role="alert">
        {{ runs.error.value }}
      </p>
      <ul class="flex flex-col gap-0.5" aria-label="Runs">
        <li v-for="run in runs.runs.value" :key="run.run">
          <button
            type="button"
            :class="
              cn(
                'flex w-full items-center gap-2 rounded-control px-1.5 py-1 text-left text-caption hover:bg-surface-sunken',
                current?.run === run.run && 'bg-surface-sunken',
              )
            "
            :data-testid="`run-${run.run}`"
            @click="runs.select(run.run)"
          >
            <span :class="cn('w-16 shrink-0', STATUS_CLASS[run.status])">{{ run.status }}</span>
            <span class="truncate">{{ runLine(run) }}</span>
          </button>
        </li>
      </ul>
    </div>
    <section v-if="current !== null" class="flex min-h-0 flex-col gap-2" aria-label="Run output">
      <header class="flex items-center gap-2 text-caption">
        <span :class="STATUS_CLASS[current.status]">{{ current.status }}</span>
        <span v-if="current.code !== null">exit {{ current.code }}</span>
        <code class="truncate font-mono">{{ runLine(current) }}</code>
        <button
          v-if="current.status === 'running'"
          type="button"
          :class="cn(button, 'ml-auto')"
          data-testid="run-cancel"
          @click="runs.cancel(current.run)"
        >
          Cancel
        </button>
      </header>
      <pre
        class="min-h-0 flex-1 overflow-auto rounded-control bg-surface-sunken p-2 font-mono text-caption whitespace-pre-wrap"
        data-testid="run-output"
        >{{ text }}</pre>
      <p v-if="current.outDir !== null" class="truncate text-caption text-text-secondary">
        Output: <code class="font-mono">{{ current.outDir }}</code>
      </p>
      <RunImages :run="current.run" :images="current.images" :files="files" />
    </section>
    <p v-else class="text-caption text-text-secondary">No run yet. A run of Claude or of these buttons shows here.</p>
  </div>
</template>
