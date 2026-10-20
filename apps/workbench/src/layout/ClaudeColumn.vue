<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Claude column of the workbench. It holds the Claude panel (the terminals and the chat). Under the panel, it
 * shows the before and after of a turn (any saved turn, with the sheets of the turn window) and the `Stop` gate
 * toggle. "Open in a window" moves the column into its own window (`detach`, panels/useWindowLayout.ts).
 */
import { ExternalLink } from "lucide-vue-next";
import BeforeAfter from "../claude/BeforeAfter.vue";
import ClaudePanel from "../claude/ClaudePanel.vue";
import StopGateToggle from "../claude/StopGateToggle.vue";
import type { AgentLoopView } from "../claude/useAgentLoop";
import type { TerminalClient } from "../claude/useTerminal";

defineProps<{
  /** The host client, or null without a host. */
  readonly client?: TerminalClient | null;
  /** The path of the open checkout, or null. */
  readonly checkout?: string | null;
  /** The agent loop of the page, or none. */
  readonly loop?: AgentLoopView | null;
  /** Show "Open in a window" (the main window only). */
  readonly detachable?: boolean;
}>();
const emit = defineEmits<{ detach: [] }>();
</script>

<template>
  <aside
    id="workbench-claude"
    class="flex min-h-0 flex-col border-border-subtle bg-surface-raised max-md:border-t md:border-l"
    aria-label="Claude"
    data-testid="claude-column"
  >
    <ClaudePanel :client="client ?? null" :checkout="checkout ?? null">
      <template v-if="detachable" #actions>
        <button
          type="button"
          class="inline-flex size-7 items-center justify-center rounded-control text-text-secondary hover:bg-surface-sunken hover:text-text-primary"
          title="Open Claude in a window"
          aria-label="Open Claude in a window"
          data-testid="claude-detach"
          @click="emit('detach')"
        >
          <ExternalLink class="size-4" aria-hidden="true" />
        </button>
      </template>
    </ClaudePanel>
    <!-- The loop parts take at most half of the column, so the terminal keeps its place in a narrow window. -->
    <div v-if="loop" class="flex max-h-[50%] shrink-0 flex-col overflow-y-auto">
      <BeforeAfter
        :turn="loop.history.display.value"
        :turns="loop.history.turns.value"
        :selected="loop.history.selected.value"
        @select="loop.history.select"
      />
      <StopGateToggle
        :gate="loop.gate.value"
        :error="loop.gateError.value"
        :disabled="client === null"
        @set="loop.setGate"
      />
    </div>
  </aside>
</template>
