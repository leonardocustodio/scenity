<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * A terminal of the Claude panel: the xterm.js screen of a PTY of the host, a bar with the state and one action
 * ("Restart" for Claude, "New shell" for the shell), and the exit state.
 *
 * A resize of the element fits the screen (ResizeObserver), and the new size goes to the PTY. The screen opens its
 * PTY at the mount. The panel mounts it at the first show of its tab.
 *
 * The Claude terminal has "Resume" when its program ended (the session of this terminal). Under its bar, it has the
 * sessions and the export of a transcript (TerminalSessions.vue).
 */
import type { TerminalKind } from "@scenity/workbench-host/protocol";
import { History, RotateCcw, SquareTerminal } from "lucide-vue-next";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { button, cn } from "../layout/ui";
import TerminalSessions from "./TerminalSessions.vue";
import { useTerminal, type TerminalClient, type XtermKit } from "./useTerminal";

/** xterm.js loads at the first terminal, in a chunk of its own (the page bundle stays small). */
const realXterm = (): Promise<XtermKit> => import("./xterm").then((module) => module.makeXterm());

defineOptions({ name: "ClaudeTerminal" });
const props = defineProps<{
  readonly client: TerminalClient;
  readonly kind: TerminalKind;
  /** The path of the open checkout: the key of the stored PTY ID. */
  readonly checkout: string;
  /** True while the tab of the terminal is in front. */
  readonly active: boolean;
  /** The screen factory of a test. */
  readonly makeXterm?: () => XtermKit;
}>();

const terminal = useTerminal({
  client: props.client,
  kind: props.kind,
  storageKey: `scenity.workbench.terminal.${props.checkout}.${props.kind}`,
  makeXterm: props.makeXterm ?? realXterm,
});
const { phase, exit, error } = terminal;
const screen = ref<HTMLElement | null>(null);
let observer: ResizeObserver | null = null;

const action = computed(() => (props.kind === "claude" ? "Restart" : "New shell"));
const status = computed(() => {
  if (phase.value === "starting") return "Starting.";
  if (phase.value === "failed") return `Failed: ${error.value ?? "unknown error"}`;
  if (phase.value === "exited") {
    const end = exit.value;
    const how = end?.signal != null ? `signal ${end.signal}` : `code ${String(end?.code ?? "unknown")}`;
    return `The program ended (${how}).`;
  }
  if (phase.value === "running") return props.kind === "claude" ? "Claude Code in the checkout." : "Login shell.";
  return "";
});

async function restart(): Promise<void> {
  await terminal.restart();
  terminal.focus();
}

/** Start the CLI again with a recorded session. */
async function resume(session: string): Promise<void> {
  await terminal.resume(session);
  terminal.focus();
}

/** Resume the session of this terminal after its program ended. */
async function resumeThis(): Promise<void> {
  const id = terminal.id.value;
  try {
    const { sessions } = await props.client.request("terminal.sessions", {});
    const own = sessions.find((item) => item.terminal === id) ?? sessions[0];
    if (own !== undefined) await resume(own.session);
  } catch {
    // The host has no session of this terminal: "Restart" starts a new one.
  }
}

onMounted(() => {
  const element = screen.value;
  if (element === null) return;
  void terminal.attach(element);
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(() => terminal.fit());
    observer.observe(element);
  }
  if (props.active) terminal.focus();
});
watch(
  () => props.active,
  async (active) => {
    if (!active) return;
    await nextTick();
    terminal.fit();
    terminal.focus();
  },
);
onBeforeUnmount(() => {
  observer?.disconnect();
  terminal.dispose();
});
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col" :data-testid="`terminal-${kind}`" :data-phase="phase">
    <div ref="screen" class="min-h-0 flex-1 overflow-hidden bg-surface-sunken p-1.5" />
    <div
      class="flex h-8 shrink-0 items-center gap-2 border-t border-border-subtle px-2 text-caption text-text-secondary"
    >
      <SquareTerminal class="size-3.5 shrink-0" aria-hidden="true" />
      <span
        :class="
          cn(
            'min-w-0 flex-1 truncate',
            phase === 'failed' && 'text-status-negative',
            phase === 'exited' && 'text-status-caution',
          )
        "
        role="status"
        data-testid="terminal-status"
        >{{ status }}</span
      >
      <button
        v-if="kind === 'claude' && phase === 'exited'"
        type="button"
        :class="cn(button, 'inline-flex items-center gap-1')"
        data-testid="terminal-resume-this"
        @click="resumeThis"
      >
        <History class="size-3.5" aria-hidden="true" />Resume
      </button>
      <button
        type="button"
        :class="cn(button, 'inline-flex items-center gap-1')"
        :disabled="phase === 'starting'"
        data-testid="terminal-restart"
        @click="restart"
      >
        <RotateCcw class="size-3.5" aria-hidden="true" />{{ action }}
      </button>
    </div>
    <TerminalSessions v-if="kind === 'claude'" :client="client" :terminal="terminal.id.value" @resume="resume" />
  </div>
</template>
