<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The agent panel. It shows the session tabs in their colours (⌘T makes a new session) and the transcript (each prompt
 * has a "Context" fold of its chips). It also shows the composer (AgentComposer.vue: ⌘↩ sends, ⌘. stops) and the
 * footer. The footer shows the mode, the model, the effort, the cost and the share of the context. The sessions run in
 * the studio host.
 */
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "@scenity/i18n";
import { Button, Menu, Select } from "@scenity/ui";
import { Ellipsis, Plus, Send, Square } from "lucide-vue-next";
import type { AgentEffort, AgentMode } from "./agentClient";
import AgentComposer from "./AgentComposer.vue";
import AgentToolCard from "./AgentToolCard.vue";
import AgentCheckpoint from "./AgentCheckpoint.vue";
import AgentApproval from "./AgentApproval.vue";
import AgentPlan from "./AgentPlan.vue";
import AgentQuestion from "./AgentQuestion.vue";
import type { AgentStore } from "./agentStore";
import { useRoleReason, useViewerReason } from "../../studio/extensions/api";

const props = defineProps<{
  store: AgentStore;
  run: (command: string) => void;
  /** Share a turn of the active session for review (a link in a dialog). */
  share?: (turn: number) => void;
}>();

/** The reason of the lock of a viewer, or null. */
const viewerReason = useViewerReason();
/** The reasons of the roles. A review link needs the owner (an editor gets the reason). Auto needs file writes. */
const ownerReason = useRoleReason("owner");
const shareReason = computed(() => viewerReason.value ?? ownerReason.value);
const autoReason = useRoleReason("auto");
const filesReason = useRoleReason("files");
const modeReason = computed(() => autoReason.value ?? filesReason.value);
const { $t } = useI18n();
const store = props.store;
const transcript = ref<HTMLElement | null>(null);

const session = computed(() => {
  const id = store.active.value;
  return store.sessions.value.find((item) => item.id === id) ?? null;
});
const items = computed(() => session.value?.items ?? []);
const undone = computed(() => new Set(items.value.flatMap((item) => (item.kind === "undone" ? [item.turn] : []))));
// The connection requests of the external agents that wait (for this project or for any project).
const pending = computed(() => store.connections.value.filter((item) => item.state === "pending"));
const prompts = computed(() => items.value.flatMap((item) => (item.kind === "prompt" ? [item.text] : [])));
const choices = computed(() => store.choices.value);
const modeOptions = computed(() =>
  (choices.value?.modes ?? []).map((mode) => ({
    value: mode,
    label: $t(`agent-mode-${mode}`),
    disabled: mode === "auto" && autoReason.value !== null,
  })),
);
const modelOptions = computed(() => (choices.value?.models ?? []).map((model) => ({ value: model, label: model })));
const effortOptions = computed(() =>
  (choices.value?.efforts ?? []).map((effort) => ({ value: effort, label: $t(`agent-effort-${effort}`) })),
);
const cost = computed(() => {
  const now = session.value;
  if (now === null) return "";
  const spent = `$${now.costUsd.toFixed(2)}`;
  const money =
    now.budgetUsd === null || now.budgetUsd === undefined ? spent : `${spent} / $${now.budgetUsd.toFixed(2)}`;
  // The tokens of the session.
  const tokens = now.tokens ?? 0;
  return tokens === 0 ? money : `${money} · ${$t("agent-tokens", { count: tokenText(tokens) })}`;
});
const context = computed(() => {
  const share = session.value?.contextShare ?? null;
  return share === null ? "" : $t("agent-context", { share: Math.round(share * 100) });
});

const sessionMenu = computed(() =>
  ["rename", "fork", "export", "close"].map((action) => ({
    value: `agent.${action}`,
    command: `agent.${action}`,
    label: $t(`command-agent-${action}`),
  })),
);
/** A count of tokens in short (1.2k, 34k, 1.5M). */
function tokenText(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${String(Number((count / 1000).toFixed(count < 10_000 ? 1 : 0)))}k`;
  return `${String(Number((count / 1_000_000).toFixed(1)))}M`;
}
const colour = (token: string): Record<string, string> => ({ background: `var(--sc-color-studio-${token})` });
// The switch to Auto always asks, with the budget of the session.
const autoAsk = ref(false);
const budget = ref(5);
const mode = computed({
  get: () => session.value?.mode ?? "review",
  set: (value: string) => {
    if (value !== "auto") {
      autoAsk.value = false;
      void store.patch({ mode: value as AgentMode });
      return;
    }
    budget.value = session.value?.budgetUsd ?? 5;
    autoAsk.value = true;
  },
});
async function switchToAuto(): Promise<void> {
  autoAsk.value = false;
  await store.patch({ mode: "auto", budgetUsd: Math.max(0, budget.value) });
}
const model = computed({
  get: () => session.value?.model ?? "",
  set: (value: string) => void store.patch({ model: value }),
});
const effort = computed({
  get: () => session.value?.effort ?? "high",
  set: (value: string) => void store.patch({ effort: value as AgentEffort }),
});

const names = computed(() => store.context?.names ?? { command: (id: string) => id, entity: (id: string) => id });
const known = (id: string): boolean => store.context?.known(id) ?? false;
// The changes of the session that wait for review.
const waiting = computed(() => (session.value === null ? 0 : (store.context?.waiting(session.value.id) ?? 0)));
const reviewError = ref<string | null>(null);
function acceptAll(): void {
  if (session.value !== null) reviewError.value = store.context?.acceptAll(session.value.id) ?? null;
}
const show = computed(() => {
  const context = store.context;
  return context === null ? null : (ids: readonly string[]) => context.show(ids);
});

watch(
  () => items.value.length,
  () => void nextTick(() => transcript.value?.scrollTo({ top: transcript.value.scrollHeight })),
);
</script>

<template>
  <section class="flex h-full min-h-0 flex-col text-caption" :aria-label="$t('panel-agent')" data-testid="agent-panel">
    <div class="flex flex-none items-center gap-1 border-b border-border-subtle px-1 py-1">
      <div role="tablist" class="flex min-w-0 flex-1 gap-1 overflow-x-auto" :aria-label="$t('agent-sessions')">
        <button
          v-for="item in store.sessions.value"
          :key="item.id"
          type="button"
          role="tab"
          class="flex min-h-6 items-center gap-1 truncate rounded-control px-2 hover:bg-surface-sunken aria-selected:bg-surface-overlay"
          :aria-selected="item.id === store.active.value"
          data-testid="agent-tab"
          :data-session="item.id"
          @click="store.select(item.id)"
        >
          <span class="size-2 flex-none rounded-full" :style="colour(item.colour)" aria-hidden="true" />
          {{ item.name }}
          <span v-if="item.running" class="text-text-secondary">{{ $t("agent-running") }}</span>
          <span
            v-if="item.waiting === true"
            class="size-2 flex-none rounded-full bg-status-caution"
            role="img"
            :aria-label="$t('agent-waits')"
            :title="$t('agent-waits')"
            data-testid="agent-tab-waits"
          />
        </button>
      </div>
      <button
        type="button"
        class="flex-none rounded-control p-1 hover:bg-surface-sunken"
        :title="$t('agent-new')"
        :aria-label="$t('agent-new')"
        data-testid="agent-new"
        @click="store.create()"
      >
        <Plus class="size-icon-sm" aria-hidden="true" />
      </button>
      <Menu v-if="session !== null" :items="sessionMenu" @select="props.run">
        <template #trigger>
          <button
            type="button"
            class="flex-none rounded-control p-1 hover:bg-surface-sunken"
            :title="$t('agent-session-menu')"
            :aria-label="$t('agent-session-menu')"
            data-testid="agent-session-menu"
          >
            <Ellipsis class="size-icon-sm" aria-hidden="true" />
          </button>
        </template>
      </Menu>
    </div>
    <div
      v-for="request in pending"
      :key="request.id"
      class="flex flex-none flex-wrap items-center gap-2 border-b border-status-caution px-2 py-1"
      data-testid="agent-connection"
      :data-connection="request.id"
    >
      <span class="min-w-0 flex-1">{{ $t("agent-connection", { name: request.name }) }}</span>
      <Button
        size="sm"
        variant="primary"
        data-testid="agent-connection-allow"
        @click="store.answerConnection(request.id, true)"
      >
        {{ $t("agent-connection-allow") }}
      </Button>
      <Button size="sm" data-testid="agent-connection-deny" @click="store.answerConnection(request.id, false)">
        {{ $t("agent-connection-deny") }}
      </Button>
    </div>
    <ol
      ref="transcript"
      class="min-h-0 flex-1 space-y-2 overflow-auto p-2"
      :aria-label="$t('agent-transcript')"
      aria-live="polite"
      data-testid="agent-transcript"
    >
      <li v-if="items.length === 0" class="text-text-secondary">{{ $t("agent-empty") }}</li>
      <li v-for="item in items" :key="item.id" :data-kind="item.kind" data-testid="agent-item">
        <AgentCheckpoint
          v-if="item.kind === 'prompt' && item.turn !== undefined && item.at !== undefined && session !== null"
          :store="store"
          :session="session.id"
          :turn="item.turn"
          :at="item.at"
          :running="session.running"
          class="mb-1"
        />
        <div v-if="item.kind === 'prompt'" class="rounded-control bg-surface-sunken px-2 py-1">
          <p>
            <strong>{{ $t("agent-you") }}</strong> {{ item.text }}
          </p>
          <details v-if="(item.context?.length ?? 0) > 0" data-testid="agent-context">
            <summary class="cursor-default text-text-secondary">
              {{ $t("agent-context-fold", { count: item.context?.length ?? 0 }) }}
            </summary>
            <ul class="text-text-secondary">
              <li v-for="(chip, at) in item.context" :key="at" data-testid="agent-context-line" :data-kind="chip.kind">
                {{ chip.kind }}: {{ chip.text }}
              </li>
            </ul>
          </details>
        </div>
        <p v-else-if="item.kind === 'text'" class="whitespace-pre-wrap">{{ item.text }}</p>
        <AgentToolCard v-else-if="item.kind === 'tool'" :item="item" :names="names" :known="known" :show="show" />
        <AgentPlan
          v-else-if="item.kind === 'plan'"
          :item="item"
          @answer="(decision, steps) => store.answer(item.approval, decision, steps)"
        />
        <AgentQuestion
          v-else-if="item.kind === 'question'"
          :item="item"
          @answer="(answer) => store.answerQuestion(item.question, answer)"
        />
        <AgentApproval
          v-else-if="item.kind === 'approval'"
          :item="item"
          @answer="(decision) => store.answer(item.approval, decision)"
        />
        <p v-else-if="item.kind === 'error'" class="text-status-negative">{{ item.text }}</p>
        <p
          v-else-if="item.kind === 'undone'"
          class="text-text-secondary"
          data-testid="agent-undone"
          :data-error="item.error === null ? undefined : '1'"
        >
          {{
            $t(item.restore === true ? "agent-turn-restored" : "agent-turn-undone", {
              turn: item.turn,
              files: item.files.length,
              steps: item.steps,
            })
          }}
          <span v-if="item.error !== null" class="text-status-negative">{{ item.error }}</span>
        </p>
        <div v-else class="flex items-center gap-2 text-text-secondary">
          <span v-if="item.reason !== 'done'">{{ $t(`agent-end-${item.reason}`) }}</span>
          <button
            v-if="item.turn !== undefined && !(session?.running && item === items.at(-1))"
            type="button"
            class="ml-auto rounded-control px-2 hover:bg-surface-sunken disabled:opacity-50"
            :disabled="shareReason !== null"
            :title="shareReason ?? $t('agent-share-turn-title')"
            data-testid="agent-share-turn"
            :data-turn="item.turn"
            @click="props.share?.(item.turn)"
          >
            {{ $t("agent-share-turn") }}
          </button>
          <button
            v-if="item.turn !== undefined && !undone.has(item.turn) && !(session?.running && item === items.at(-1))"
            type="button"
            class="rounded-control px-2 hover:bg-surface-sunken disabled:opacity-50"
            :disabled="viewerReason !== null"
            :title="viewerReason ?? undefined"
            data-testid="agent-undo-turn"
            :data-turn="item.turn"
            @click="store.undoTurn(item.turn)"
          >
            {{ $t("agent-undo-turn") }}
          </button>
        </div>
      </li>
    </ol>
    <div
      v-if="autoAsk"
      class="flex flex-none flex-wrap items-center gap-2 border-t border-status-caution px-2 py-1"
      role="group"
      :aria-label="$t('agent-auto-ask')"
      data-testid="agent-auto-ask"
    >
      <span class="min-w-0 flex-1">{{ $t("agent-auto-ask") }}</span>
      <span class="flex items-center gap-1">
        <input
          v-model.number="budget"
          type="number"
          min="0"
          step="0.5"
          class="min-h-6 w-20 rounded-control border border-border-strong bg-surface-raised px-1"
          :aria-label="$t('agent-budget')"
          data-testid="agent-auto-budget"
        />
        <span aria-hidden="true">{{ $t("agent-budget") }}</span>
      </span>
      <Button size="sm" variant="primary" data-testid="agent-auto-confirm" @click="switchToAuto">
        {{ $t("agent-auto-confirm") }}
      </Button>
      <Button size="sm" data-testid="agent-auto-cancel" @click="autoAsk = false">{{ $t("agent-auto-cancel") }}</Button>
    </div>
    <div
      v-if="waiting > 0"
      class="flex flex-none items-center gap-2 border-t border-border-subtle px-2 py-1"
      data-testid="agent-changes"
    >
      <span class="min-w-0 flex-1">{{ $t("review-status", { count: waiting }) }}</span>
      <Button size="sm" data-testid="agent-review" @click="store.context?.openReview()">{{
        $t("panel-review")
      }}</Button>
      <Button size="sm" variant="primary" data-testid="agent-accept-all" @click="acceptAll">
        {{ $t("review-accept-all") }}
      </Button>
    </div>
    <p v-if="reviewError !== null" class="px-2 text-status-negative" role="alert">{{ reviewError }}</p>
    <p v-if="store.error.value !== null" class="px-2 text-status-negative" role="alert">{{ store.error.value }}</p>
    <div class="flex flex-none flex-col gap-1 border-t border-border-subtle p-2">
      <p v-if="session?.external === true" class="text-text-secondary" data-testid="agent-external">
        {{ $t("agent-external", { name: session.name }) }}
      </p>
      <AgentComposer v-else :store="store" :prompts="prompts" />
      <div class="flex flex-wrap items-center gap-1">
        <Select
          v-model="mode"
          :options="modeOptions"
          class="w-28"
          :aria-label="$t('agent-mode')"
          data-testid="agent-mode"
        />
        <Select v-model="model" :options="modelOptions" class="w-28" :aria-label="$t('agent-model')" />
        <span class="flex items-center gap-1">
          <input
            type="checkbox"
            :checked="session?.planFirst === true"
            :disabled="session === null"
            :aria-label="$t('agent-plan-first')"
            data-testid="agent-plan-first"
            @change="store.patch({ planFirst: ($event.target as HTMLInputElement).checked })"
          />
          <span aria-hidden="true">{{ $t("agent-plan-first") }}</span>
        </span>
        <Select v-model="effort" :options="effortOptions" class="w-24" :aria-label="$t('agent-effort')" />
        <span v-if="(session?.queued ?? 0) > 0" class="text-text-secondary" data-testid="agent-queued">
          {{ $t("agent-queued", { count: session?.queued ?? 0 }) }}
        </span>
        <span class="flex-1 text-right text-text-secondary" data-testid="agent-cost" translate="no">
          {{ cost }}<template v-if="context !== ''"> · {{ context }}</template>
        </span>
        <Button
          v-if="session?.running === true"
          size="sm"
          :title="$t('agent-stop')"
          data-testid="agent-stop"
          @click="store.stop()"
        >
          <Square class="size-icon-sm" aria-hidden="true" />{{ $t("agent-stop") }}
        </Button>
        <Button
          size="sm"
          variant="primary"
          :title="$t('agent-send')"
          :disabled="store.draft.value.trim() === ''"
          data-testid="agent-send"
          @click="store.submit()"
        >
          <Send class="size-icon-sm" aria-hidden="true" />{{ $t("agent-send") }}
        </Button>
      </div>
      <p v-if="modeReason !== null" class="text-text-secondary" data-testid="agent-mode-reason">{{ modeReason }}</p>
    </div>
  </section>
</template>
