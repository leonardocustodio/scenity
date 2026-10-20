<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The card of a tutorial (tutorialCard.ts): the title, the step and its text, Show me (the callout on the part of the
 * window), Skip step and End. The card moves to the next step automatically when the check of the step passes. After
 * the last step, the card says that the tutorial is done. The card is in the lower left corner, away from the tour
 * card.
 */
import { useI18n } from "@scenity/i18n";
import { computed } from "vue";
import { tutorialAction, tutorialShown } from "./tutorialCard";

const { $t } = useI18n();
const finished = computed(() => tutorialShown.value !== null && tutorialShown.value.step >= tutorialShown.value.count);
</script>

<template>
  <aside
    v-if="tutorialShown !== null"
    class="fixed bottom-10 left-4 z-50 flex w-80 flex-col gap-1 rounded-panel border border-border-strong bg-surface-raised p-3 text-body text-text-primary shadow-overlay"
    role="dialog"
    aria-modal="false"
    :aria-label="$t('tutorial-label')"
    data-testid="tutorial"
    :data-tutorial="tutorialShown.tutorial"
    :data-step="finished ? 'done' : tutorialShown.stepId"
  >
    <span class="text-caption text-text-secondary">
      {{
        finished
          ? $t("tutorial-finished")
          : $t("tutorial-count", { step: tutorialShown.step + 1, count: tutorialShown.count })
      }}
    </span>
    <h2 class="font-semibold">{{ tutorialShown.title }}</h2>
    <p aria-live="polite">{{ tutorialShown.text }}</p>
    <div class="flex items-center gap-1">
      <template v-if="!finished">
        <button type="button" class="studio-button" data-testid="tutorial-show" @click="tutorialAction('showMe')">
          {{ $t("tutorial-show-me") }}
        </button>
        <button type="button" class="studio-button" data-testid="tutorial-skip" @click="tutorialAction('skip')">
          {{ $t("tutorial-skip") }}
        </button>
      </template>
      <span class="flex-1" />
      <button type="button" class="studio-button" data-testid="tutorial-end" @click="tutorialAction('end')">
        {{ finished ? $t("tutorial-done") : $t("tutorial-end") }}
      </button>
    </div>
  </aside>
</template>
