<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The start form of a chat session. The fields are:
 * - the credential: the subscription by default, or the API key of the .env file of the checkout;
 * - the mode: ask by default;
 * - the model and the effort: empty for the defaults of the account;
 * - the budget and the turn limit: the mode "all" needs both, and the host gives defaults.
 * The picker starts on the choice that the host remembers for the checkout. The Sessions tab uses the same pickers
 * (ChatPickers.vue).
 */
import {
  formDefaults,
  type AgentCredential,
  type AgentEffort,
  type AgentMode,
  type AgentStartParams,
} from "@scenity/workbench-host/protocol";
import { ref, watch } from "vue";
import { button, field } from "../layout/ui";
import ChatPickers from "./ChatPickers.vue";

const props = withDefaults(defineProps<{ readonly busy: boolean; readonly credential?: AgentCredential }>(), {
  credential: "subscription",
});
const emit = defineEmits<{ start: [params: AgentStartParams] }>();

const credential = ref<AgentCredential>(props.credential);
watch(
  () => props.credential,
  (value) => (credential.value = value),
);
const mode = ref<AgentMode>(formDefaults(props.credential).mode);
const model = ref("");
const effort = ref<AgentEffort | "">("");
const budget = ref<number | null>(null);
const turns = ref<number | null>(null);

function submit(): void {
  emit("start", {
    mode: mode.value,
    ...(credential.value === "subscription" ? {} : { credential: credential.value }),
    ...(model.value.trim() === "" ? {} : { model: model.value.trim() }),
    ...(effort.value === "" ? {} : { effort: effort.value }),
    ...(budget.value === null || budget.value <= 0 ? {} : { maxBudgetUsd: budget.value }),
    ...(turns.value === null || turns.value <= 0 ? {} : { maxTurns: turns.value }),
  });
}
</script>

<template>
  <form class="flex flex-col gap-2 p-3 text-caption" data-testid="chat-start" @submit.prevent="submit">
    <p class="text-text-secondary">
      A chat session runs Claude Code through the Agent SDK in this checkout, with the workbench tools.
    </p>
    <ChatPickers
      id="chat-start"
      v-model:credential="credential"
      v-model:mode="mode"
      v-model:model="model"
      v-model:effort="effort"
    />
    <div class="grid grid-cols-2 gap-2">
      <label class="flex flex-col gap-0.5" for="chat-start-budget">
        Budget (USD)
        <input
          id="chat-start-budget"
          v-model.number="budget"
          type="number"
          min="0"
          step="any"
          :class="field"
          placeholder="5 in All"
        />
      </label>
      <label class="flex flex-col gap-0.5" for="chat-start-turns">
        Turn limit
        <input
          id="chat-start-turns"
          v-model.number="turns"
          type="number"
          min="1"
          step="1"
          :class="field"
          placeholder="200 in All"
        />
      </label>
    </div>
    <button type="submit" :class="button" :disabled="busy" data-testid="chat-start-button">Start a chat</button>
  </form>
</template>
