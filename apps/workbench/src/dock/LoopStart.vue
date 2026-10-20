<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The form of a new background run: the prompt, the sequence of the `Stop` gate and of the review pack, the intent,
 * the budget, the turn limit, the wall-clock limit, the model and a new worktree. A gate run that needs a sequence
 * does not run without one. The run uses every permission (`bypassPermissions`) and never commits.
 */
import type { LoopParams } from "@scenity/workbench-host/protocol";
import { ref } from "vue";
import { button, cn, field } from "../layout/ui";
import { useDefaultSequence } from "./defaultSequence";

defineOptions({ name: "DockLoopStart" });
/** The default sequence of the project, or null. */
const props = defineProps<{ readonly defaultSequence?: string | null }>();
const emit = defineEmits<{ start: [params: LoopParams] }>();

const prompt = ref("");
const sequence = ref("");
useDefaultSequence(sequence, () => props.defaultSequence);
const intent = ref("");
const budget = ref<number | string>(2);
const turns = ref<number | string>(60);
const minutes = ref<number | string>(30);
const model = ref("");
const worktree = ref(false);

function submit(): void {
  const text = prompt.value.trim();
  if (text === "") return;
  emit("start", {
    prompt: text,
    sequence: sequence.value.trim() === "" ? null : sequence.value.trim(),
    intent: intent.value.trim() === "" ? null : intent.value.trim(),
    budgetUsd: Number(budget.value),
    maxTurns: Number(turns.value),
    minutes: Number(minutes.value),
    model: model.value.trim() === "" ? null : model.value.trim(),
    worktree: worktree.value,
  });
}
</script>

<template>
  <form class="flex flex-col gap-1.5" data-testid="loop-start" @submit.prevent="submit">
    <label for="loop-prompt" class="flex flex-col text-caption text-text-secondary">
      Prompt
      <textarea
        id="loop-prompt"
        v-model="prompt"
        :class="cn(field, 'min-h-16 py-1')"
        placeholder="Fix the hand pose of the grip until the gate passes."
        data-testid="loop-prompt"
      />
    </label>
    <div class="grid grid-cols-3 gap-1">
      <label for="loop-take" class="flex flex-col text-caption text-text-secondary">
        Sequence (gate, pack)
        <input id="loop-take" v-model="sequence" :class="field" placeholder="none" data-testid="loop-take" />
      </label>
      <label for="loop-intent" class="flex flex-col text-caption text-text-secondary">
        Intent
        <input id="loop-intent" v-model="intent" :class="field" placeholder="none" data-testid="loop-intent" />
      </label>
      <label for="loop-model" class="flex flex-col text-caption text-text-secondary">
        Model
        <input id="loop-model" v-model="model" :class="field" placeholder="default" data-testid="loop-model" />
      </label>
      <label for="loop-budget" class="flex flex-col text-caption text-text-secondary">
        Budget (USD)
        <input
          id="loop-budget"
          v-model.number="budget"
          type="number"
          min="0.01"
          step="0.01"
          :class="field"
          data-testid="loop-budget"
        />
      </label>
      <label for="loop-turns" class="flex flex-col text-caption text-text-secondary">
        Turns
        <input
          id="loop-turns"
          v-model.number="turns"
          type="number"
          min="1"
          step="1"
          :class="field"
          data-testid="loop-turns"
        />
      </label>
      <label for="loop-minutes" class="flex flex-col text-caption text-text-secondary">
        Minutes
        <input
          id="loop-minutes"
          v-model.number="minutes"
          type="number"
          min="1"
          step="1"
          :class="field"
          data-testid="loop-minutes"
        />
      </label>
    </div>
    <label for="loop-worktree" class="flex items-center gap-1.5 text-caption">
      <input id="loop-worktree" v-model="worktree" type="checkbox" data-testid="loop-worktree" />
      In a new worktree (a candidate of the picker)
    </label>
    <p class="text-caption text-text-secondary">
      Every permission, on your login; the run never commits. Its changes stay in the files for your review.
    </p>
    <button type="submit" :class="button" :disabled="prompt.trim() === ''" data-testid="loop-submit">
      Start the background run
    </button>
  </form>
</template>
