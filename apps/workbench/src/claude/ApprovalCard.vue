<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The approval card of the chat: the tool and its input (a diff for an edit, the command for Bash, else the input as
 * JSON). The actions are Allow, Allow for the session (when the SDK gave rules for it), and Deny with a reason. The
 * reason reaches Claude as the result of the tool.
 */
import type { AgentAsk, AgentDecision } from "@scenity/workbench-host/protocol";
import { ShieldQuestion } from "lucide-vue-next";
import { computed, ref } from "vue";
import DiffView from "../dock/DiffView.vue";
import { button, field } from "../layout/ui";
import { approvalPatch, bashCall } from "./approval";

const props = defineProps<{ readonly ask: AgentAsk; readonly disabled?: boolean }>();
const emit = defineEmits<{ answer: [ask: string, decision: AgentDecision] }>();

const patch = computed(() => approvalPatch(props.ask.tool, props.ask.input));
const bash = computed(() => bashCall(props.ask.tool, props.ask.input));
const json = computed(() => JSON.stringify(props.ask.input ?? {}, null, 2));
const denying = ref(false);
const reason = ref("");

function deny(): void {
  emit("answer", props.ask.ask, { behavior: "deny", message: reason.value.trim() || "The owner denied this." });
}
</script>

<template>
  <section
    class="flex flex-col gap-2 rounded-control border border-status-caution bg-surface-overlay p-2 text-caption shadow-overlay"
    :aria-label="`Approval for ${ask.tool}`"
    data-testid="approval-card"
  >
    <h3 class="flex items-center gap-1.5 text-label">
      <ShieldQuestion class="size-4 text-status-caution" aria-hidden="true" />
      {{ ask.title ?? `Claude wants to use ${ask.tool}` }}
    </h3>
    <p v-if="ask.reason" class="text-text-secondary">{{ ask.reason }}</p>
    <div class="max-h-72 overflow-auto">
      <DiffView v-if="patch !== null" :patch="patch" />
      <template v-else-if="bash !== null">
        <p v-if="bash.description" class="mb-1 text-text-secondary">{{ bash.description }}</p>
        <pre
          class="rounded-control bg-surface-sunken p-1.5 font-mono whitespace-pre-wrap"
          data-testid="approval-command"
          >{{ bash.command }}</pre>
      </template>
      <pre v-else class="rounded-control bg-surface-sunken p-1.5 font-mono">{{ json }}</pre>
    </div>
    <form v-if="denying" class="flex gap-1" @submit.prevent="deny">
      <input v-model="reason" :class="field" aria-label="Reason for Claude" placeholder="Reason for Claude" />
      <button type="submit" :class="button" :disabled="disabled" data-testid="approval-deny-send">Deny</button>
    </form>
    <div v-else class="flex flex-wrap gap-1">
      <button
        type="button"
        :class="button"
        :disabled="disabled"
        data-testid="approval-allow"
        @click="emit('answer', ask.ask, { behavior: 'allow', scope: 'once' })"
      >
        Allow
      </button>
      <button
        v-if="ask.canRemember"
        type="button"
        :class="button"
        :disabled="disabled"
        data-testid="approval-allow-session"
        @click="emit('answer', ask.ask, { behavior: 'allow', scope: 'session' })"
      >
        Allow for the session
      </button>
      <button type="button" :class="button" :disabled="disabled" data-testid="approval-deny" @click="denying = true">
        Deny…
      </button>
    </div>
  </section>
</template>
