<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Claude panel: the tabs "Claude" (the `claude` CLI in a terminal), "Shell" (the login shell of the owner) and
 * "Chat" (the Agent SDK chat, `Chat.vue`).
 *
 * A terminal starts at the first show of its tab and stays while the panel lives. A hidden tab keeps its PTY. The
 * panel shows no terminal without a host or a checkout. The slot `actions` adds buttons to the header (for example
 * "Open in a window").
 */
import { Bot } from "lucide-vue-next";
import { defineAsyncComponent, ref } from "vue";
import { tab } from "../layout/ui";
import Terminal from "./Terminal.vue";
import type { TerminalClient, XtermKit } from "./useTerminal";
import { HIDDEN_CLAUDE_TABS } from "../layout/hiddenSurfaces";

/** The chat (the transcript, the cards, the markdown) loads at the first show of its tab, in a chunk of its own. */
const Chat = defineAsyncComponent(() => import("./Chat.vue"));

defineProps<{
  /** The host client, or null without a host. */
  readonly client: TerminalClient | null;
  /** The path of the open checkout, or null. */
  readonly checkout: string | null;
  /** The screen factory of a test. */
  readonly makeXterm?: () => XtermKit;
}>();

type PanelTab = "claude" | "shell" | "chat";
// const TABS: readonly { readonly id: PanelTab; readonly label: string }[] = [
const ALL_TABS: readonly { readonly id: PanelTab; readonly label: string }[] = [
  { id: "claude", label: "Claude" },
  { id: "shell", label: "Shell" },
  { id: "chat", label: "Chat" },
];
const TABS = ALL_TABS.filter((entry) => !HIDDEN_CLAUDE_TABS.includes(entry.id));

const current = ref<PanelTab>("claude");
/** The tabs that the owner showed at least once: their terminals exist. */
const shown = ref<ReadonlySet<PanelTab>>(new Set(["claude"]));

function pick(next: PanelTab): void {
  current.value = next;
  if (!shown.value.has(next)) shown.value = new Set([...shown.value, next]);
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col" data-testid="claude-panel">
    <div class="flex h-9 shrink-0 items-center gap-1 border-b border-border-subtle px-2">
      <h2 class="mr-auto flex items-center gap-1.5 px-1 text-label">
        <Bot class="size-4 text-text-secondary" aria-hidden="true" />
        Claude
      </h2>
      <!-- <div class="flex items-center gap-0.5" role="tablist" aria-label="Claude mode"> -->
      <div v-if="TABS.length > 1" class="flex items-center gap-0.5" role="tablist" aria-label="Claude mode">
        <button
          v-for="entry in TABS"
          :key="entry.id"
          type="button"
          role="tab"
          :aria-selected="current === entry.id"
          :class="tab(current === entry.id)"
          :data-testid="`claude-tab-${entry.id}`"
          @click="pick(entry.id)"
        >
          {{ entry.label }}
        </button>
      </div>
      <slot name="actions" />
    </div>
    <p v-if="client === null || checkout === null" class="p-3 text-caption text-text-secondary">
      The terminals start when the host is connected and a checkout is open.
    </p>
    <template v-else>
      <template v-for="kind in ['claude', 'shell'] as const" :key="`${checkout}:${kind}`">
        <Terminal
          v-if="shown.has(kind)"
          v-show="current === kind"
          :client="client"
          :kind="kind"
          :checkout="checkout"
          :active="current === kind"
          v-bind="makeXterm === undefined ? {} : { makeXterm }"
        />
      </template>
      <Chat
        v-if="shown.has('chat')"
        v-show="current === 'chat'"
        :key="`${checkout}:chat`"
        :client="client"
        :checkout="checkout"
      />
    </template>
  </div>
</template>
