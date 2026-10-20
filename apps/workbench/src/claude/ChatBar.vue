<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The bar of a chat session: the state, the mode, the model and the effort pickers, the cost of the session (an
 * estimate) with the tokens per model, the context use, Interrupt, End, and Resume after an error.
 */
import type { AgentContextUsage, AgentEffort, AgentMode, AgentSessionInfo } from "@scenity/workbench-host/protocol";
import { computed } from "vue";
import { button, cn, field } from "../layout/ui";
import { credentialWords, EFFORTS, MODES, STATE_WORDS } from "./chatWords";
import { costText } from "./transcript";

const props = defineProps<{
  readonly info: AgentSessionInfo;
  readonly context: AgentContextUsage | null;
  readonly busy: boolean;
}>();
const emit = defineEmits<{
  mode: [mode: AgentMode];
  model: [model: string];
  effort: [effort: AgentEffort];
  interrupt: [];
  end: [];
  resume: [];
}>();

const state = computed(() => STATE_WORDS[props.info.state]);
const working = computed(() => props.info.state === "running" || props.info.state === "waiting");
const stopped = computed(() => props.info.state === "error" || props.info.state === "ended");
const models = computed(() => {
  const list = props.info.models.map((model) => ({ value: model.value, label: model.label }));
  const now = props.info.model;
  return now !== null && !list.some((model) => model.value === now) ? [{ value: now, label: now }, ...list] : list;
});
const efforts = computed(() => {
  const model = props.info.models.find((item) => item.value === props.info.model);
  return model === undefined || model.efforts.length === 0 ? EFFORTS : model.efforts;
});
const tokens = computed(() =>
  Object.entries(props.info.modelUsage)
    .map(([model, usage]) => `${model}: ${String(usage.inputTokens)} in, ${String(usage.outputTokens)} out`)
    .join("\n"),
);
const limits = computed(() => {
  const parts: string[] = [];
  if (props.info.maxBudgetUsd !== null) parts.push(`budget $${String(props.info.maxBudgetUsd)}`);
  if (props.info.maxTurns !== null) parts.push(`${String(props.info.maxTurns)} requests per prompt`);
  return parts.join(" · ");
});
</script>

<template>
  <div class="flex flex-col gap-1 border-b border-border-subtle px-2 py-1.5 text-caption" data-testid="chat-bar">
    <div class="flex flex-wrap items-center gap-1.5">
      <span :class="cn('size-2 rounded-full', state.color)" aria-hidden="true" />
      <span data-testid="chat-state">{{ state.words }}</span>
      <span class="text-text-secondary" :title="tokens" data-testid="chat-cost">{{ costText(info.costUsd) }}</span>
      <span v-if="context" class="text-text-secondary" data-testid="chat-context">
        context {{ Math.round(context.percentage) }}%
      </span>
      <span class="ml-auto flex gap-1">
        <button v-if="working" type="button" :class="button" data-testid="chat-interrupt" @click="emit('interrupt')">
          Interrupt
        </button>
        <button v-if="stopped" type="button" :class="button" data-testid="chat-resume" @click="emit('resume')">
          Resume
        </button>
        <button type="button" :class="button" data-testid="chat-end" @click="emit('end')">End</button>
      </span>
    </div>
    <p v-if="info.error" class="text-status-negative" role="alert" data-testid="chat-error">{{ info.error }}</p>
    <div class="grid grid-cols-3 gap-1">
      <select
        :value="info.mode"
        :class="field"
        aria-label="Permission mode"
        :disabled="busy || stopped"
        data-testid="chat-mode"
        @change="emit('mode', ($event.target as HTMLSelectElement).value as AgentMode)"
      >
        <option v-for="item in MODES" :key="item.value" :value="item.value" :title="item.hint">{{ item.label }}</option>
      </select>
      <select
        :value="info.model ?? ''"
        :class="field"
        aria-label="Model"
        :disabled="busy || stopped || models.length === 0"
        @change="emit('model', ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="model in models" :key="model.value" :value="model.value">{{ model.label }}</option>
      </select>
      <select
        :value="info.effort ?? ''"
        :class="field"
        aria-label="Effort"
        :disabled="busy || stopped"
        @change="emit('effort', ($event.target as HTMLSelectElement).value as AgentEffort)"
      >
        <option value="" disabled>effort</option>
        <option v-for="level in efforts" :key="level" :value="level">{{ level }}</option>
      </select>
    </div>
    <p class="truncate text-text-secondary" data-testid="chat-credential">
      credential: {{ credentialWords(info) }}
      {{ limits ? `· ${limits}` : "" }}
    </p>
  </div>
</template>
