<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Terminal panel: the terminals of the project in the studio, one tab for each terminal. "Claude" opens the Claude
 * Code CLI with the MCP server of the studio, and "Shell" opens the login shell. Both run in the project folder on the
 * host, with the role rules of the host. A tab keeps its terminal, and the screen follows the size of the panel. The
 * terminals belong to the owner, and a studio in remote mode opens no shell. In these cases, the buttons are disabled
 * and show the reason.
 */
import { nextTick, onMounted, onUnmounted, ref, shallowRef } from "vue";
import { useI18n } from "@scenity/i18n";
import { Button } from "@scenity/ui";
import { useRoleReason } from "../../studio/extensions/api";
import type { Terminal } from "@xterm/xterm";
import type { TerminalClient, TerminalKind } from "./terminalClient";
import { makeXterm } from "./xterm";

const props = defineProps<{ client: TerminalClient; project: string }>();
const { $t } = useI18n();
const ownerReason = useRoleReason("owner");
const shellReason = useRoleReason("shell");
interface Tab {
  readonly id: string;
  readonly kind: TerminalKind;
  readonly term: Terminal;
  readonly fit: () => void;
  ended: boolean;
}
const tabs = shallowRef<readonly Tab[]>([]);
const active = ref<string | null>(null);
const error = ref<string | null>(null);
const host = ref<HTMLElement | null>(null);
let stop: (() => void) | null = null;
let observer: ResizeObserver | null = null;

function show(id: string): void {
  active.value = id;
  void nextTick(() => {
    const tab = tabs.value.find((item) => item.id === id);
    const element = host.value;
    if (tab === undefined || element === null) return;
    if (tab.term.element === undefined) tab.term.open(element);
    for (const other of tabs.value) other.term.element?.classList.toggle("hidden", other.id !== id);
    tab.fit();
    tab.term.focus();
  });
}

async function open(kind: TerminalKind): Promise<void> {
  const screen = makeXterm();
  const { term } = screen;
  try {
    const opened = await props.client.open(kind, props.project, term.cols, term.rows);
    const tab: Tab = { id: opened.terminal, kind, term, fit: () => screen.fit(), ended: false };
    term.write(opened.replay);
    term.onData((data) => void props.client.input(tab.id, data));
    term.onResize(({ cols, rows }) => void props.client.resize(tab.id, cols, rows));
    tabs.value = [...tabs.value, tab];
    error.value = null;
    show(tab.id);
  } catch (failure) {
    term.dispose();
    error.value = failure instanceof Error ? failure.message : String(failure);
  }
}

async function close(tab: Tab): Promise<void> {
  await props.client.close(tab.id).catch(() => undefined);
  tab.term.dispose();
  tabs.value = tabs.value.filter((item) => item !== tab);
  const last = tabs.value.at(-1);
  if (last === undefined) active.value = null;
  else show(last.id);
}

onMounted(() => {
  stop = props.client.events((event) => {
    const tab = tabs.value.find((item) => item.id === event.terminal);
    if (tab === undefined) return;
    if (event.type === "terminal.output") tab.term.write(event.data);
    else {
      tab.ended = true;
      tab.term.write(`\r\n${$t("terminal-ended", { code: event.code ?? 0 })}\r\n`);
    }
  });
  observer = new ResizeObserver(() => tabs.value.find((item) => item.id === active.value)?.fit());
  if (host.value !== null) observer.observe(host.value);
});

onUnmounted(() => {
  stop?.();
  observer?.disconnect();
});
</script>

<template>
  <section
    class="flex h-full min-h-0 flex-col text-caption"
    :aria-label="$t('panel-terminal')"
    data-testid="terminal-panel"
  >
    <div class="flex flex-none items-center gap-1 border-b border-border-subtle px-1 py-1">
      <div role="tablist" class="flex min-w-0 flex-1 gap-1 overflow-x-auto" :aria-label="$t('terminal-tabs')">
        <span v-for="tab in tabs" :key="tab.id" class="flex items-center">
          <button
            type="button"
            role="tab"
            class="rounded-control px-2 hover:bg-surface-sunken aria-selected:bg-surface-overlay"
            :aria-selected="tab.id === active"
            data-testid="terminal-tab"
            :data-kind="tab.kind"
            @click="show(tab.id)"
          >
            {{ $t(`terminal-kind-${tab.kind}`) }}
          </button>
          <button
            type="button"
            class="min-h-6 min-w-6 rounded-control hover:bg-surface-sunken"
            :aria-label="$t('terminal-close')"
            data-testid="terminal-close"
            @click="close(tab)"
          >
            ×
          </button>
        </span>
      </div>
      <Button
        size="sm"
        :disabled="ownerReason !== null"
        :title="ownerReason ?? undefined"
        data-testid="terminal-new-claude"
        @click="open('claude')"
        >{{ $t("terminal-new-claude") }}</Button
      >
      <Button
        size="sm"
        :disabled="shellReason !== null"
        :title="shellReason ?? undefined"
        data-testid="terminal-new-shell"
        @click="open('shell')"
        >{{ $t("terminal-new-shell") }}</Button
      >
    </div>
    <p v-if="ownerReason !== null" class="px-2 text-text-secondary" data-testid="terminal-reason">{{ ownerReason }}</p>
    <p v-if="error !== null" class="px-2 text-status-negative" role="alert">{{ error }}</p>
    <p v-if="tabs.length === 0" class="p-2 text-text-secondary">{{ $t("terminal-empty") }}</p>
    <div ref="host" class="min-h-0 flex-1 overflow-hidden p-1" data-testid="terminal-screen" />
  </section>
</template>
