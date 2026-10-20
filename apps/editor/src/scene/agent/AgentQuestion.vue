<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * A question card of the transcript: the question of the agent with its 2 to 4 choices and "Other" (a text of the
 * person). The session waits until the person answers. Then the card shows the answer.
 */
import { ref } from "vue";
import { useI18n } from "@scenity/i18n";
import { Button } from "@scenity/ui";
import { MessageCircleQuestion } from "lucide-vue-next";
import type { AgentItem } from "./agentClient";

defineProps<{ item: Extract<AgentItem, { kind: "question" }> }>();
const emit = defineEmits<{ answer: [answer: string] }>();
const { $t } = useI18n();
const other = ref("");
</script>

<template>
  <article
    class="rounded-control border border-status-caution px-2 py-1"
    data-testid="agent-question"
    :data-answered="item.answer === null ? undefined : '1'"
  >
    <header class="flex items-start gap-2">
      <MessageCircleQuestion class="size-icon-sm mt-0.5 flex-none" aria-hidden="true" />
      <p class="min-w-0 flex-1 font-medium">{{ item.text }}</p>
    </header>
    <div v-if="item.answer === null" class="mt-1 flex flex-col gap-1">
      <div class="flex flex-wrap gap-1">
        <Button
          v-for="option in item.options"
          :key="option"
          size="sm"
          data-testid="agent-question-option"
          @click="emit('answer', option)"
        >
          {{ option }}
        </Button>
      </div>
      <form class="flex gap-1" @submit.prevent="other.trim() !== '' && emit('answer', other.trim())">
        <input
          v-model="other"
          type="text"
          class="min-h-6 min-w-0 flex-1 rounded-control border border-border-strong bg-surface-raised px-2"
          :placeholder="$t('agent-question-other')"
          :aria-label="$t('agent-question-other')"
          data-testid="agent-question-other"
        />
        <Button size="sm" type="submit" :disabled="other.trim() === ''">{{ $t("agent-question-send") }}</Button>
      </form>
    </div>
    <p v-else class="mt-1 text-text-secondary" data-testid="agent-question-answer">
      {{ $t("agent-question-answered", { answer: item.answer }) }}
    </p>
  </article>
</template>
