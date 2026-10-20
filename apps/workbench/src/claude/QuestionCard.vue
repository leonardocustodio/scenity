<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The question card of the chat: the questions of `AskUserQuestion`, each with its options (one or many) and an
 * "Other" text. The answer returns as `{ [question]: "label, label" }`. Skip denies the call, and Claude continues
 * without an answer.
 */
import type { AgentAsk, AgentDecision } from "@scenity/workbench-host/protocol";
import { MessageCircleQuestion } from "lucide-vue-next";
import { computed, ref } from "vue";
import { button, field } from "../layout/ui";
import { answerText, questionsOf } from "./approval";

const props = defineProps<{ readonly ask: AgentAsk; readonly disabled?: boolean }>();
const emit = defineEmits<{ answer: [ask: string, decision: AgentDecision] }>();

const questions = computed(() => questionsOf(props.ask.input));
const picked = ref<Record<string, string[]>>({});
const other = ref<Record<string, string>>({});

function toggle(question: string, label: string, many: boolean): void {
  const now = picked.value[question] ?? [];
  const next = many ? (now.includes(label) ? now.filter((item) => item !== label) : [...now, label]) : [label];
  picked.value = { ...picked.value, [question]: next };
}

const answers = computed(() =>
  Object.fromEntries(
    questions.value.map((item) => [
      item.question,
      answerText(picked.value[item.question] ?? [], other.value[item.question] ?? ""),
    ]),
  ),
);
const complete = computed(() => Object.values(answers.value).every((text) => text !== ""));
</script>

<template>
  <form
    class="flex flex-col gap-2 rounded-control border border-status-info bg-surface-overlay p-2 text-caption shadow-overlay"
    aria-label="Question of Claude"
    data-testid="question-card"
    @submit.prevent="emit('answer', ask.ask, { behavior: 'answer', answers })"
  >
    <h3 class="flex items-center gap-1.5 text-label">
      <MessageCircleQuestion class="size-4 text-status-info" aria-hidden="true" />
      Claude asks
    </h3>
    <fieldset v-for="(item, qi) in questions" :key="item.question" class="flex flex-col gap-1">
      <legend class="mb-1">
        <span v-if="item.header" class="mr-1 text-text-secondary">{{ item.header }} ·</span>{{ item.question }}
      </legend>
      <label
        v-for="(option, oi) in item.options"
        :key="option.label"
        :for="`${ask.ask}-${qi}-${oi}`"
        class="flex items-start gap-1.5"
      >
        <input
          :id="`${ask.ask}-${qi}-${oi}`"
          :type="item.multiSelect ? 'checkbox' : 'radio'"
          :name="item.question"
          :checked="(picked[item.question] ?? []).includes(option.label)"
          @change="toggle(item.question, option.label, item.multiSelect)"
        />
        <span>
          {{ option.label }}
          <span v-if="option.description" class="block text-text-secondary">{{ option.description }}</span>
        </span>
      </label>
      <input
        :value="other[item.question] ?? ''"
        :class="field"
        :aria-label="`Other answer to ${item.question}`"
        placeholder="Other"
        @input="other = { ...other, [item.question]: ($event.target as HTMLInputElement).value }"
      />
    </fieldset>
    <div class="flex gap-1">
      <button type="submit" :class="button" :disabled="disabled || !complete" data-testid="question-send">
        Answer
      </button>
      <button
        type="button"
        :class="button"
        :disabled="disabled"
        data-testid="question-skip"
        @click="emit('answer', ask.ask, { behavior: 'deny', message: 'The owner did not answer.' })"
      >
        Skip
      </button>
    </div>
  </form>
</template>
