<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The memory cost of a detached pane. The page shows it before the first detach of a pane of the checkout. A detached pane is a second window with its own 3D context and its own copy
 * of the room assets. The answer goes to the layout of the host (`paneCost`), so the question comes once.
 *
 * Developer page: its text is not in Fluent (tools/wording-allowlist.json).
 */
import { onBeforeUnmount, onMounted, ref } from "vue";
import { button } from "../layout/ui";
import { PANE_COST_TEXT } from "./panelUrl";

const emit = defineEmits<{ answer: [ok: boolean] }>();
const confirmButton = ref<HTMLButtonElement | null>(null);
/** Escape answers "Cancel". */
function onKey(event: KeyboardEvent): void {
  if (event.key === "Escape") emit("answer", false);
}
onMounted(() => {
  confirmButton.value?.focus();
  globalThis.addEventListener("keydown", onKey);
});
onBeforeUnmount(() => globalThis.removeEventListener("keydown", onKey));
</script>

<template>
  <div class="fixed inset-0 z-50 grid place-items-center bg-surface-base/60" data-testid="detach-cost">
    <section
      class="flex max-w-md flex-col gap-3 rounded-card border border-border-subtle bg-surface-overlay p-4 shadow-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="detach-cost-title"
    >
      <h2 id="detach-cost-title" class="text-label">Detach the pane?</h2>
      <p class="text-caption text-text-secondary">{{ PANE_COST_TEXT }}</p>
      <div class="flex justify-end gap-2">
        <button type="button" :class="button" data-testid="detach-cost-cancel" @click="emit('answer', false)">
          Cancel
        </button>
        <button
          ref="confirmButton"
          type="button"
          :class="button"
          data-testid="detach-cost-ok"
          @click="emit('answer', true)"
        >
          Detach
        </button>
      </div>
    </section>
  </div>
</template>
