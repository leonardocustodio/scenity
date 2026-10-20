<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The History group of the toolbar: Undo and Redo with the name of the step that each one changes. A long press of
 * either button opens the History panel (the list of the steps). The page gives the names in the status of the
 * window. A page with no history shows no group.
 */
import { computed } from "vue";
import { useI18n } from "@scenity/i18n";
import { Redo2, Undo2 } from "lucide-vue-next";
import type { CommandPort } from "./shell";
import type { WindowStatus } from "./status";

const props = defineProps<{ status: WindowStatus; port: CommandPort }>();
const { $t } = useI18n();
const history = computed(() => props.status.values.history);

/** The commands of the buttons. */
const UNDO = "history.undo";
const REDO = "history.redo";
/** The wait of a long press (ms). */
const LONG_PRESS_MS = 500;
let timer: ReturnType<typeof setTimeout> | null = null;
let long = false;

function down(): void {
  long = false;
  timer = setTimeout(() => {
    long = true;
    props.port.run("panel.open.history");
  }, LONG_PRESS_MS);
}

function up(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

function press(command: string): void {
  if (long) {
    long = false;
    return;
  }
  props.port.run(command);
}

const undoLabel = computed(() => {
  const step = history.value?.undo ?? null;
  return step === null ? $t("history-undo-none") : $t("history-undo-step", { step });
});
const redoLabel = computed(() => {
  const step = history.value?.redo ?? null;
  return step === null ? $t("history-redo-none") : $t("history-redo-step", { step });
});
</script>

<template>
  <div
    v-if="history !== null"
    class="studio-history"
    role="group"
    :aria-label="$t('history-group')"
    data-testid="toolbar-history"
  >
    <button
      type="button"
      class="studio-tool"
      :disabled="history.undo === null"
      :title="undoLabel"
      :aria-label="undoLabel"
      data-command="history.undo"
      data-testid="toolbar-undo"
      @pointerdown="down"
      @pointerup="up"
      @pointerleave="up"
      @click="press(UNDO)"
    >
      <Undo2 aria-hidden="true" />
    </button>
    <button
      type="button"
      class="studio-tool"
      :disabled="history.redo === null"
      :title="redoLabel"
      :aria-label="redoLabel"
      data-command="history.redo"
      data-testid="toolbar-redo"
      @pointerdown="down"
      @pointerup="up"
      @pointerleave="up"
      @click="press(REDO)"
    >
      <Redo2 aria-hidden="true" />
    </button>
  </div>
</template>
