<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * An approval card of the transcript: an action of the agent that waits for the person. The card shows the kind, the
 * title and the detail of the action in a fold (the diff of a write, the command line of a run). The buttons are
 * Allow once, Allow for this session (the kind needs no card again in the session) and Deny.
 */
import { useI18n } from "@scenity/i18n";
import { Button } from "@scenity/ui";
import { ShieldQuestion } from "lucide-vue-next";
import type { AgentItem, ApprovalDecision } from "./agentClient";

defineProps<{ item: Extract<AgentItem, { kind: "approval" }> }>();
const emit = defineEmits<{ answer: [decision: ApprovalDecision] }>();
const { $t } = useI18n();
</script>

<template>
  <article
    class="rounded-control border border-status-caution px-2 py-1"
    data-testid="agent-approval"
    :data-action="item.action"
    :data-decision="item.decision ?? 'waiting'"
  >
    <header class="flex items-center gap-2">
      <ShieldQuestion class="size-icon-sm flex-none" aria-hidden="true" />
      <span class="min-w-0 flex-1 truncate font-medium">{{ item.title }}</span>
      <span class="flex-none text-text-secondary">{{ $t(`agent-kind-${item.action}`) }}</span>
    </header>
    <details v-if="item.detail !== ''" class="mt-1">
      <summary class="cursor-default text-text-secondary">{{ $t("agent-approval-detail") }}</summary>
      <pre class="max-h-48 overflow-auto whitespace-pre-wrap" translate="no">{{ item.detail }}</pre>
    </details>
    <div v-if="item.decision === null" class="mt-1 flex flex-wrap gap-1">
      <Button size="sm" variant="primary" data-testid="agent-approval-once" @click="emit('answer', 'once')">
        {{ $t("agent-approval-once") }}
      </Button>
      <Button size="sm" data-testid="agent-approval-session" @click="emit('answer', 'session')">
        {{ $t("agent-approval-session") }}
      </Button>
      <Button size="sm" data-testid="agent-approval-deny" @click="emit('answer', 'deny')">
        {{ $t("agent-approval-deny") }}
      </Button>
    </div>
    <p v-else class="mt-1 text-text-secondary">{{ $t(`agent-approval-${item.decision}-done`) }}</p>
  </article>
</template>
