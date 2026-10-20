<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The card of the tour (tour.ts): the title and the text of the step, its number, Back, Next (Done on the last step)
 * and Skip. The part of the window of the step gets a mark (`data-tour-target`). The card is in a corner of the
 * window, so it never covers the part that it shows. Escape skips the tour.
 */
import { useI18n } from "@scenity/i18n";
import { computed, onBeforeUnmount, watch } from "vue";
import { backStep, endTour, nextStep, TOUR_STEPS, tourStep } from "./tour";

const props = defineProps<{ open: (panel: string) => void }>();
const { $t } = useI18n();
const step = computed(() => (tourStep.value === null ? null : (TOUR_STEPS[tourStep.value] ?? null)));
let marked: Element | null = null;

function mark(): void {
  marked?.removeAttribute("data-tour-target");
  marked = null;
  const now = step.value;
  if (now === null) return;
  if (now.panel !== null) props.open(now.panel);
  // The panel renders after the open: mark it in the next frame, and again a moment later (a re-render of the dock
  // can give the panel a new element).
  const place = (): void => {
    if (step.value !== now) return;
    marked?.removeAttribute("data-tour-target");
    marked = document.querySelector(now.target);
    marked?.setAttribute("data-tour-target", "1");
  };
  requestAnimationFrame(place);
  setTimeout(place, 250);
}
watch(step, mark, { immediate: true });

function onKey(event: KeyboardEvent): void {
  if (event.key === "Escape" && step.value !== null) endTour();
}
globalThis.addEventListener("keydown", onKey);
onBeforeUnmount(() => {
  globalThis.removeEventListener("keydown", onKey);
  marked?.removeAttribute("data-tour-target");
});
</script>

<template>
  <aside
    v-if="step !== null && tourStep !== null"
    class="fixed bottom-10 right-4 z-50 flex w-80 flex-col gap-1 rounded-control border border-border-strong bg-surface-overlay p-3 text-body text-text-primary shadow-overlay"
    role="dialog"
    aria-modal="false"
    :aria-label="$t('tour-label')"
    data-testid="tour"
    :data-step="step.id"
  >
    <span class="text-caption text-text-secondary">{{
      $t("tour-count", { step: tourStep + 1, count: TOUR_STEPS.length })
    }}</span>
    <h2 class="font-semibold">{{ $t(step.title) }}</h2>
    <p>{{ $t(step.text) }}</p>
    <div class="flex items-center gap-1">
      <button
        type="button"
        class="rounded-control border border-border-subtle px-2 py-0.5 hover:bg-surface-raised"
        data-testid="tour-skip"
        @click="endTour"
      >
        {{ $t("tour-skip") }}
      </button>
      <span class="flex-1" />
      <button
        v-if="tourStep > 0"
        type="button"
        class="rounded-control border border-border-subtle px-2 py-0.5 hover:bg-surface-raised"
        data-testid="tour-back"
        @click="backStep"
      >
        {{ $t("tour-back") }}
      </button>
      <button
        type="button"
        class="rounded-control border border-border-subtle px-2 py-0.5 hover:bg-surface-raised"
        data-testid="tour-next"
        @click="nextStep"
      >
        {{ tourStep + 1 === TOUR_STEPS.length ? $t("tour-done") : $t("tour-next") }}
      </button>
    </div>
  </aside>
</template>
