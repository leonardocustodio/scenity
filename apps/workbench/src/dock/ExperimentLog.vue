<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The experiment log: every run of a `labs` command and every
 * background run of this host with its result. The owner searches by take, command, intent, date and text.
 */
import type { ExperimentEntry, ExperimentQuery } from "@scenity/workbench-host/protocol";
import { onMounted, ref } from "vue";
import { button, cn, field } from "../layout/ui";
import type { DockHost } from "./dockHost";

defineOptions({ name: "DockExperimentLog" });
const props = defineProps<{ readonly dock: Pick<DockHost, "request"> }>();

const take = ref("");
const command = ref("");
const intent = ref("");
const from = ref("");
const to = ref("");
const text = ref("");
const entries = ref<readonly ExperimentEntry[]>([]);
const error = ref<string | null>(null);
const searched = ref(false);

/** The query of the form: only the fields with a text. */
function queryOf(fields: Record<string, string>): ExperimentQuery {
  return Object.fromEntries(Object.entries(fields).filter((entry) => entry[1].trim() !== ""));
}

async function search(): Promise<void> {
  error.value = null;
  const fields = {
    take: take.value,
    command: command.value,
    intent: intent.value,
    from: from.value,
    to: to.value,
    text: text.value,
  };
  try {
    entries.value = await props.dock.request("experiments.search", { ...queryOf(fields), limit: 100 });
    searched.value = true;
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  }
}

const STATUS_CLASS: Readonly<Record<string, string>> = {
  passed: "text-status-positive",
  done: "text-status-positive",
  failed: "text-status-negative",
  timeout: "text-status-negative",
};

onMounted(() => void search());
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-2 text-caption" data-testid="experiment-log">
    <form class="grid grid-cols-[repeat(6,minmax(0,1fr))_auto] gap-1" @submit.prevent="search">
      <input v-model="take" :class="field" aria-label="Take" placeholder="take" data-testid="log-take" />
      <input v-model="command" :class="field" aria-label="Command" placeholder="command" />
      <input v-model="intent" :class="field" aria-label="Intent" placeholder="intent" />
      <input v-model="from" type="date" :class="field" aria-label="From date" />
      <input v-model="to" type="date" :class="field" aria-label="To date" />
      <input v-model="text" :class="field" aria-label="Text" placeholder="text" data-testid="log-text" />
      <button type="submit" :class="button" data-testid="log-search">Search</button>
    </form>
    <p v-if="error !== null" class="text-status-negative" role="alert">{{ error }}</p>
    <p v-else-if="searched && entries.length === 0" class="text-text-secondary">No run matches.</p>
    <ul class="flex min-h-0 flex-col gap-1 overflow-y-auto" aria-label="Experiments">
      <li
        v-for="entry in entries"
        :key="entry.id"
        class="rounded-control border border-border-subtle p-1.5"
        data-testid="log-entry"
      >
        <p class="flex flex-wrap items-center gap-x-2">
          <span :class="cn('w-14', STATUS_CLASS[entry.status] ?? 'text-text-secondary')">{{ entry.status }}</span>
          <code class="font-mono">{{ entry.command }}</code>
          <span class="truncate">{{ entry.kind === "loop" ? entry.args[0] : entry.args.join(" ") }}</span>
          <span class="ml-auto text-text-secondary">{{ new Date(entry.at).toLocaleString() }}</span>
        </p>
        <p class="truncate text-text-secondary">
          <template v-if="entry.take">take {{ entry.take }} · </template>
          <template v-if="entry.intent">intent {{ entry.intent }} · </template>
          <template v-if="entry.costUsd !== undefined && entry.costUsd !== null"
            >about ${{ entry.costUsd.toFixed(4) }} ·
          </template>
          {{ entry.summary.split("\n").at(-1) }}
        </p>
      </li>
    </ul>
  </div>
</template>
