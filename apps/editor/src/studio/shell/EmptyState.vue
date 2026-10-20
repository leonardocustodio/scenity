<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The empty state of a panel (emptyStates.ts): what to do next, and "Ask the agent". "Ask the agent" puts the prompt
 * of the panel in the agent panel (the command `agent.ask`, in the studio). A panel can give its own text in place of
 * the text of the registry.
 */
import { useI18n } from "@scenity/i18n";
import { computed, inject } from "vue";
import { emptyStateOf } from "./emptyStates";
import { SHELL_KEY } from "./shell";

const props = defineProps<{ panel: string; text?: string }>();
const { $t } = useI18n();
const shell = inject(SHELL_KEY, null);
const state = computed(() => emptyStateOf(props.panel));
const agent = computed(() => shell?.commands?.has?.("agent.ask") === true);

function ask(): void {
  void shell?.commands?.execute?.("agent.ask", { prompt: $t(state.value.prompt) });
}
</script>

<template>
  <div class="flex flex-col items-start gap-1 p-1.5 text-caption text-text-secondary" role="status" :data-empty="panel">
    <p>{{ text ?? $t(state.text) }}</p>
    <button
      v-if="agent"
      type="button"
      class="rounded-control border border-border-subtle px-1.5 py-0.5 text-text-primary hover:bg-surface-raised"
      data-testid="empty-ask"
      @click="ask"
    >
      {{ $t("empty-ask") }}
    </button>
  </div>
</template>
