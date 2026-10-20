<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Sessions tab: the earlier Claude Code sessions of the checkout (chat and terminal, from `listSessions` of the
 * SDK). Each row has the date, the title, the first prompt, the branch and the cost that the host saw. Resume
 * continues a session in the chat tab. Fork starts a copy for a second try. The new session shows in the Chat tab of
 * the Claude panel.
 *
 * Each row shows the options of a resume (the model, the credential, the mode and the limits). These are the options
 * that the host kept for the session, else the defaults of the start form. "Options" opens the pickers of the start
 * form (ChatPickers.vue) for one row. Resume and Fork of that row then send the picked options. Without the pickers,
 * the request sends no option, and the host uses the kept options.
 */
import type {
  AgentCredential,
  AgentEffort,
  AgentMode,
  AgentSessionEntry,
  AgentStartParams,
} from "@scenity/workbench-host/protocol";
import { onMounted, ref } from "vue";
import ChatPickers from "../claude/ChatPickers.vue";
import { CREDENTIALS, MODES } from "../claude/chatWords";
import { costText } from "../claude/transcript";
import { button } from "../layout/ui";
import type { DockHost } from "./dockHost";

defineOptions({ name: "DockSessions" });
const props = defineProps<{ readonly dock: Pick<DockHost, "request"> }>();

const sessions = ref<readonly AgentSessionEntry[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
/** The session whose pickers are open, or null. */
const editing = ref<string | null>(null);
const credential = ref<AgentCredential>("subscription");
const mode = ref<AgentMode>("default");
const model = ref("");
const effort = ref<AgentEffort | "">("");

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    sessions.value = (await props.dock.request("agent.sessions", { limit: 50 })).sessions;
  } catch (reason) {
    error.value = message(reason);
  } finally {
    loading.value = false;
  }
}

/** Open the pickers of a row on the options of its session, or close them. */
function toggle(entry: AgentSessionEntry): void {
  if (editing.value === entry.sessionId) {
    editing.value = null;
    return;
  }
  editing.value = entry.sessionId;
  credential.value = entry.options.credential ?? "subscription";
  mode.value = entry.options.mode;
  model.value = entry.options.model ?? "";
  effort.value = entry.options.effort ?? "";
}

/** The picked options of a row: an empty model or effort keeps the one of the session. */
function picked(): Partial<AgentStartParams> {
  return {
    credential: credential.value,
    mode: mode.value,
    ...(model.value.trim() === "" ? {} : { model: model.value.trim() }),
    ...(effort.value === "" ? {} : { effort: effort.value }),
  };
}

/** The options of a resume of a row, in words. */
function optionsText(entry: AgentSessionEntry): string {
  const { options } = entry;
  const parts = [
    `model ${options.model ?? "the default of the account"}`,
    CREDENTIALS.find((item) => item.value === (options.credential ?? "subscription"))?.label ?? "",
    `mode ${MODES.find((item) => item.value === options.mode)?.label ?? options.mode}`,
  ];
  if (options.effort !== undefined) parts.push(`effort ${options.effort}`);
  if (options.maxBudgetUsd !== undefined) parts.push(`budget $${String(options.maxBudgetUsd)}`);
  if (options.maxTurns !== undefined) parts.push(`${String(options.maxTurns)} requests per prompt`);
  return `${parts.join(" · ")}${entry.kept ? "" : " (the defaults of the start form)"}`;
}

async function open(entry: AgentSessionEntry, fork: boolean): Promise<void> {
  error.value = null;
  notice.value = null;
  try {
    const { session } = await props.dock.request("agent.resume", {
      sessionId: entry.sessionId,
      fork,
      ...(editing.value === entry.sessionId ? picked() : {}),
    });
    editing.value = null;
    notice.value = `${fork ? "Forked" : "Resumed"} as ${session}: see the Chat tab of the Claude panel.`;
    await load();
  } catch (reason) {
    error.value = message(reason);
  }
}

function date(epochMs: number): string {
  return new Date(epochMs).toLocaleString();
}

onMounted(() => void load());
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-2 text-caption" data-testid="dock-sessions-tab">
    <div class="flex items-center gap-2">
      <button type="button" :class="button" :disabled="loading" data-testid="sessions-refresh" @click="load">
        Refresh
      </button>
      <span v-if="notice" class="text-status-positive" data-testid="sessions-notice">{{ notice }}</span>
    </div>
    <p v-if="error" class="text-status-negative" role="alert" data-testid="sessions-error">{{ error }}</p>
    <p v-else-if="!loading && sessions.length === 0" class="text-text-secondary">No session in this checkout yet.</p>
    <ul class="flex min-h-0 flex-col gap-1 overflow-y-auto">
      <li
        v-for="(entry, index) in sessions"
        :key="entry.sessionId"
        class="flex flex-wrap items-start gap-2 rounded-control border border-border-subtle p-1.5"
        data-testid="session-row"
      >
        <div class="min-w-0 flex-1">
          <p class="truncate text-text-primary">{{ entry.title }}</p>
          <p class="truncate text-text-secondary">
            {{ date(entry.lastModified) }} · {{ entry.sessionId.slice(0, 8) }}
            <template v-if="entry.gitBranch"> · {{ entry.gitBranch }}</template>
            <template v-if="entry.costUsd !== null"> · {{ costText(entry.costUsd) }}</template>
            <template v-if="entry.workbench"> · workbench</template>
            <template v-if="entry.live"> · open as {{ entry.live }}</template>
          </p>
          <p v-if="entry.firstPrompt" class="truncate text-text-secondary">“{{ entry.firstPrompt }}”</p>
          <p class="truncate text-text-secondary" :title="optionsText(entry)" data-testid="session-options">
            {{ optionsText(entry) }}
          </p>
        </div>
        <button
          type="button"
          :class="button"
          :aria-expanded="editing === entry.sessionId"
          data-testid="session-edit"
          @click="toggle(entry)"
        >
          Options
        </button>
        <button
          type="button"
          :class="button"
          :disabled="entry.live !== null"
          data-testid="session-resume"
          @click="open(entry, false)"
        >
          Resume
        </button>
        <button type="button" :class="button" data-testid="session-fork" @click="open(entry, true)">Fork</button>
        <ChatPickers
          v-if="editing === entry.sessionId"
          :id="`session-${String(index)}`"
          v-model:credential="credential"
          v-model:mode="mode"
          v-model:model="model"
          v-model:effort="effort"
          testid="session"
          compact
          model-hint="the model of the session"
          effort-hint="the effort of the session"
          class="basis-full"
        />
      </li>
    </ul>
  </div>
</template>
