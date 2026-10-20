<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The sessions of the Claude terminal: the session IDs that the host recorded. The sources of the IDs
 * (`terminal.sessions`) are the `--session-id` of a new terminal, the `SessionStart` hook, or the transcript folder of
 * the CLI. "Resume" starts the CLI again with `--resume <id>`. "Export transcript" writes the session file of the CLI
 * as Markdown into a folder of the checkout (`terminal.export`, the denylist applies), for the record of a loop.
 */
import type { TerminalSessionInfo } from "@scenity/workbench-host/protocol";
import { FileDown, History } from "lucide-vue-next";
import { computed, ref } from "vue";
import { button, cn, field } from "../layout/ui";
import type { TerminalClient } from "./useTerminal";

const props = defineProps<{
  readonly client: Pick<TerminalClient, "request">;
  /** The ID of the terminal of this tab, or null. */
  readonly terminal: string | null;
}>();
const emit = defineEmits<{ resume: [session: string] }>();

/** The default folder of an export: the records of the web workspace. */
const DEFAULT_FOLDER = "records";

const sessions = ref<readonly TerminalSessionInfo[]>([]);
const chosen = ref("");
const folder = ref(DEFAULT_FOLDER);
const status = ref<{ text: string; bad: boolean } | null>(null);
const busy = ref(false);

/** The session of the choice, else the session of this terminal, else the newest one. */
const session = computed(
  () =>
    sessions.value.find((item) => item.session === chosen.value) ??
    sessions.value.find((item) => item.terminal === props.terminal) ??
    sessions.value[0] ??
    null,
);

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function label(item: TerminalSessionInfo): string {
  const when = new Date(item.seen).toLocaleString();
  const mark = item.terminal === props.terminal && item.live ? " · this terminal" : item.live ? " · runs" : "";
  return `${item.session.slice(0, 8)} · ${when}${mark}`;
}

async function refresh(): Promise<void> {
  try {
    sessions.value = (await props.client.request("terminal.sessions", {})).sessions;
  } catch (error) {
    status.value = { text: errorText(error), bad: true };
  }
}

function onToggle(event: Event): void {
  if ((event.target as HTMLDetailsElement).open) void refresh();
}

function resume(): void {
  const current = session.value;
  if (current !== null) emit("resume", current.session);
}

async function exportTranscript(): Promise<void> {
  const current = session.value;
  if (current === null) return;
  busy.value = true;
  status.value = null;
  try {
    const done = await props.client.request("terminal.export", { session: current.session, folder: folder.value });
    status.value = { text: `Wrote ${done.path} (${String(done.messages)} messages).`, bad: false };
  } catch (error) {
    status.value = { text: errorText(error), bad: true };
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <details
    class="shrink-0 border-t border-border-subtle px-2 py-1 text-caption text-text-secondary"
    data-testid="terminal-sessions"
    @toggle="onToggle"
  >
    <summary class="cursor-pointer select-none">Sessions and transcript</summary>
    <div class="flex flex-col gap-1.5 py-1.5">
      <p v-if="sessions.length === 0">No recorded session of this checkout yet.</p>
      <template v-else>
        <div class="flex items-center gap-1.5">
          <span class="shrink-0" aria-hidden="true">Session</span>
          <select v-model="chosen" :class="field" aria-label="The Claude session" data-testid="terminal-session-pick">
            <option value="">{{ session === null ? "" : label(session) }}</option>
            <option v-for="item in sessions" :key="item.session" :value="item.session">{{ label(item) }}</option>
          </select>
        </div>
        <div class="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            :class="cn(button, 'inline-flex items-center gap-1')"
            :disabled="session === null"
            data-testid="terminal-resume"
            @click="resume"
          >
            <History class="size-3.5" aria-hidden="true" />Resume
          </button>
          <input
            v-model="folder"
            :class="cn(field, 'min-w-0 flex-1')"
            aria-label="The folder of the transcript, in the checkout"
            data-testid="terminal-export-folder"
          />
          <button
            type="button"
            :class="cn(button, 'inline-flex items-center gap-1')"
            :disabled="session === null || busy || session.transcript === false || folder.trim() === ''"
            data-testid="terminal-export"
            @click="exportTranscript"
          >
            <FileDown class="size-3.5" aria-hidden="true" />Export transcript
          </button>
        </div>
      </template>
      <p
        v-if="status !== null"
        :class="status.bad ? 'text-status-negative' : 'text-text-secondary'"
        role="status"
        data-testid="terminal-sessions-status"
      >
        {{ status.text }}
      </p>
    </div>
  </details>
</template>
