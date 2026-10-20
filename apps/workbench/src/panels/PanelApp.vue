<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * A detached window of the workbench: the workbench page with one panel (`?panel=<kind>&key=<key>`, panelUrl.ts). In
 * the labs app, it is a native window of the same app with the host of the main window. In a browser, it is a browser
 * window on the same host. The host keeps the
 * state (the runs, the changes, the terminals, the clock of the lab), so the panel stays in step with the main window.
 *
 * - The page tells the host its key (`layout.join`) after each connection, and its place when it changes.
 * - "Dock back" (`layout.dock`) puts the panel again into the main window, and this window closes.
 * - The Claude panel opens the terminals of the main window (their IDs come in the URL, `p.claude` and `p.shell`).
 *
 * Developer page: its text is not in Fluent (tools/wording-allowlist.json).
 */
import type { DetachedPanel } from "@scenity/workbench-host/protocol";
import { PanelBottomClose } from "lucide-vue-next";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useAgentLoop } from "../claude/useAgentLoop";
import DockPanels from "../dock/DockPanels.vue";
import { makeDockHost } from "../dock/dockHost";
import { closeWindow, windowLabel } from "../host/closeWindow";
import { useHost } from "../host/useHost";
import ClaudeColumn from "../layout/ClaudeColumn.vue";
import HostMissing from "../layout/HostMissing.vue";
import { button } from "../layout/ui";
import { trackRect } from "./openPanel";
import PanelLab from "./PanelLab.vue";
import { DOCK_TABS, panelTitle } from "./panelUrl";
import { terminalKey } from "./useWindowLayout";

defineOptions({ name: "LabsPanelWindow" });
const props = defineProps<{ readonly panel: Omit<DetachedPanel, "rect"> }>();

const host = useHost();
const { state, greeted, checkout } = host;
const title = panelTitle(props.panel);
document.title = `Scenity — ${title}`;
const dockTab = DOCK_TABS[props.panel.kind] ?? null;
const labPanel = ["dock", "graph", "pane"].includes(props.panel.kind);
const dock = dockTab === null ? null : makeDockHost(host);
const loop = props.panel.kind === "claude" ? useAgentLoop(host.client) : null;
/** The Claude panel mounts after the IDs of the terminals of the main window are in this window's storage. */
const terminalsReady = ref(props.panel.kind !== "claude");
const ready = computed(() => state.value === "connected" && greeted.value);

function keepTerminals(path: string): void {
  try {
    for (const kind of ["claude", "shell"] as const) {
      const id = props.panel.query[kind];
      if (id !== undefined) globalThis.sessionStorage.setItem(terminalKey(path, kind), id);
    }
  } catch {
    // A blocked storage: the panel starts new terminals.
  }
  terminalsReady.value = true;
}

/** Close this window (the app closes its native window; a browser closes a window that a script opened). */
async function closeSelf(): Promise<void> {
  if (windowLabel() !== null) await closeWindow();
  else globalThis.close();
}

async function dockBack(): Promise<void> {
  await host.request("layout.dock", { key: props.panel.key }).catch(() => undefined);
  await closeSelf();
}

const stops: (() => void)[] = [];
stops.push(
  watch(
    () => [ready.value, checkout.value?.path ?? null] as const,
    ([connected, path]) => {
      if (!connected) return;
      if (path !== null && !terminalsReady.value) keepTerminals(path);
      void host.request("layout.join", { key: props.panel.key }).catch(() => undefined);
    },
    { immediate: true },
  ),
);
stops.push(
  watch(
    host.client,
    (client, _old, onCleanup) => {
      if (client === null) return;
      onCleanup(
        client.on("layout.state", (event) => {
          if (event.docked?.key === props.panel.key) void closeSelf();
        }),
      );
    },
    { immediate: true },
  ),
);
stops.push(
  trackRect((rect) => {
    if (!ready.value) return false;
    void host.request("layout.rect", { key: props.panel.key, rect }).catch(() => undefined);
    return true;
  }),
);
onBeforeUnmount(() => {
  stops.forEach((stop) => stop());
});
</script>

<template>
  <div
    class="grid h-dvh grid-rows-[auto_minmax(0,1fr)] bg-surface-base text-body text-text-primary"
    :data-panel="panel.kind"
    data-testid="panel-window"
  >
    <header class="flex h-9 items-center gap-2 border-b border-border-subtle bg-surface-raised px-3">
      <h1 class="mr-auto text-label" data-testid="panel-title">{{ title }}</h1>
      <span v-if="state === 'lost'" class="text-caption text-status-negative" role="status"
        >Reconnecting to the host.</span
      >
      <button
        type="button"
        :class="[button, 'inline-flex items-center gap-1.5']"
        title="Put this panel back into the main window"
        data-testid="panel-dock-back"
        @click="dockBack"
      >
        <PanelBottomClose class="size-4" aria-hidden="true" /> Dock back
      </button>
    </header>
    <HostMissing v-if="state === 'looking' || state === 'none'" :mode="state" :origin="null" />
    <HostMissing v-else-if="!greeted" mode="waiting" :origin="host.endpoint.value?.origin ?? null" />
    <main v-else class="grid min-h-0">
      <ClaudeColumn
        v-if="panel.kind === 'claude' && terminalsReady"
        :client="host.client.value"
        :checkout="checkout?.path ?? null"
        :loop="loop"
      />
      <DockPanels v-else-if="dock !== null" :dock="dock" :open="dockTab" fill />
      <PanelLab v-else-if="labPanel" :host="host" :panel="panel" />
    </main>
  </div>
</template>
