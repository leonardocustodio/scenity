<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Changes tab: the turns of Claude with Keep and Undo the turn, and the changed files of the working tree (the
 * files of the session first) with a diff. It also has the commit of the selected files with one subject line, and
 * tune to code. The app never commits by itself and never pushes.
 */
import type { ChangedFile, TurnSummary } from "@scenity/workbench-host/protocol";
import { computed } from "vue";
import type { HostRequest } from "../host/useHost";
import { button, cn, field } from "../layout/ui";
import DiffView from "./DiffView.vue";
import TuneToCode from "./TuneToCode.vue";
import type { ChangesApi } from "./useChanges";
import type { RunsApi } from "./useRuns";

defineOptions({ name: "DockChanges" });
const props = defineProps<{
  readonly changes: ChangesApi;
  readonly runs: RunsApi;
  readonly request: HostRequest;
}>();

const session = computed(() => new Set(props.changes.sessionFiles.value));
/** The changed files: the files of the session first. */
const ordered = computed<ChangedFile[]>(() => {
  const list = props.changes.files.value;
  return [
    ...list.filter((file) => session.value.has(file.path)),
    ...list.filter((file) => !session.value.has(file.path)),
  ];
});

function toggle(path: string, on: boolean): void {
  const picked = props.changes.picked.value;
  props.changes.pick(on ? [...picked, path] : picked.filter((item) => item !== path));
}

function turnTitle(turn: TurnSummary): string {
  return `Turn ${String(turn.turn)}${turn.prompt === "" ? "" : `: ${turn.prompt.split("\n")[0] ?? ""}`}`;
}
</script>

<template>
  <div class="grid h-full min-h-0 grid-cols-[22rem_minmax(0,1fr)] gap-3" data-testid="dock-changes-tab">
    <div class="flex min-h-0 flex-col gap-2 overflow-y-auto">
      <section aria-label="Turns" class="flex flex-col gap-1">
        <h3 class="text-label">Turns</h3>
        <p v-if="changes.turns.value.length === 0" class="text-caption text-text-secondary">
          No turn of Claude yet in this checkout.
        </p>
        <ul class="flex flex-col gap-1">
          <li
            v-for="turn in changes.turns.value"
            :key="`${turn.session}-${turn.turn}`"
            class="rounded-control border border-border-subtle p-1.5 text-caption"
            :data-testid="`turn-${turn.turn}`"
          >
            <p class="truncate" :title="turn.prompt">{{ turnTitle(turn) }}</p>
            <p class="truncate text-text-secondary">{{ turn.files.join(", ") || "no file" }} · {{ turn.state }}</p>
            <div v-if="turn.state === 'open' && turn.files.length > 0" class="mt-1 flex gap-1">
              <button type="button" :class="button" :disabled="changes.busy.value" @click="changes.keep(turn)">
                Keep
              </button>
              <button type="button" :class="button" :disabled="changes.busy.value" @click="changes.undo(turn)">
                Undo the turn
              </button>
            </div>
          </li>
        </ul>
      </section>
      <section aria-label="Changed files" class="flex flex-col gap-1">
        <h3 class="flex items-center text-label">
          Changed files <span class="ml-1 text-text-secondary">({{ changes.files.value.length }})</span>
          <button type="button" :class="cn(button, 'ml-auto')" @click="changes.refresh()">Refresh</button>
        </h3>
        <ul class="flex flex-col">
          <li v-for="file in ordered" :key="file.path" class="flex items-center gap-1.5 text-caption">
            <input
              type="checkbox"
              :checked="changes.picked.value.includes(file.path)"
              :aria-label="`Commit ${file.path}`"
              @change="toggle(file.path, ($event.target as HTMLInputElement).checked)"
            />
            <code class="w-5 shrink-0 font-mono text-text-secondary">{{ file.status }}</code>
            <button
              type="button"
              :class="
                cn(
                  'truncate text-left hover:underline',
                  session.has(file.path) ? 'text-text-primary' : 'text-text-secondary',
                  changes.diffPath.value === file.path && 'underline',
                )
              "
              :title="session.has(file.path) ? 'A file of the session' : 'A file outside the session'"
              @click="changes.showDiff(file.path)"
            >
              {{ file.path }}
            </button>
          </li>
        </ul>
      </section>
      <form class="flex flex-col gap-1" aria-label="Commit" @submit.prevent="changes.commit()">
        <input
          :value="changes.message.value"
          :class="field"
          aria-label="Commit message (one subject line)"
          placeholder="One subject line"
          data-testid="commit-message"
          @input="changes.setMessage(($event.target as HTMLInputElement).value)"
        />
        <button type="submit" :class="button" :disabled="!changes.canCommit.value" data-testid="commit">
          Commit {{ changes.picked.value.length }} files
        </button>
      </form>
      <TuneToCode :request="request" :runs="runs" />
      <p v-if="changes.notice.value !== null" class="text-caption text-status-positive" role="status">
        {{ changes.notice.value }}
      </p>
      <p v-if="changes.error.value !== null" class="text-caption text-status-negative" role="alert">
        {{ changes.error.value }}
      </p>
    </div>
    <div class="min-h-0 overflow-auto">
      <DiffView v-if="changes.diffPath.value !== null" :patch="changes.patch.value" />
      <p v-else class="text-caption text-text-secondary">Select a file to see its diff against HEAD.</p>
    </div>
  </div>
</template>
