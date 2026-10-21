<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The workbench page: the top bar, the surface of the checkout on the left, the Claude column on the right, the dock
 * tabs and the status line. ⌘\ hides the Claude column. A narrow window puts the column under the surface. Without a
 * host, the page tells how to start one. Without a checkout, it shows the checkouts. When the host connection is lost,
 * a banner shows while the client connects again. A project folder with no Git has no Changes tab. A viewer token has
 * no Claude column. The theme of the project manifest applies.
 *
 * The workbench keys are ⌘ chords only, because the lab in the frame owns Space, B, / and the arrows. ⌘\ hides and
 * shows the Claude column. ⌘1 to ⌘9 show the surface tabs in their order. ⌘K gives the focus to the Claude prompt. The
 * chords come from the page, from the native menu of the app, or from the lab bridge while the lab frame has the focus.
 * The tabs, their labels and their order come from the project of `host.hello`. The lab frame is the frame of the
 * scene surface (the first surface with the capability `scene`).
 *
 * The Claude column, a dock tab, the content browser, the metrics graph and a pane of the split screen can open in
 * their own windows (panels/). The clock of the lab goes to their lab frames through the host (panels/hostLink.ts).
 * The host keeps the window layout of the checkout, and the page restores it at the start (panels/useWindowLayout.ts).
 */
import type { SurfaceId } from "@scenity/workbench-host/protocol";
import { CloudOff } from "lucide-vue-next";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useAgentLoop } from "./claude/useAgentLoop";
import { startFramePace } from "./desktop/framePace";
import { desktopLocalCalls } from "./desktop/localCalls";
import { createShellDrop, labFrameAt, listenShellDrop } from "./desktop/shellDrop";
import { makeDockHost } from "./dock/dockHost";
import { importDropHandler, scratchModelHandler } from "./imports/useImportDrop";
import { closeWindow, windowLabel } from "./host/closeWindow";
import { listenMenu } from "./host/menuEvents";
import { useHost, type HostApi } from "./host/useHost";
import { useHostRestart } from "./host/useHostRestart";
import BottomBar from "./layout/BottomBar.vue";
import ClaudeColumn from "./layout/ClaudeColumn.vue";
import HostMissing from "./layout/HostMissing.vue";
import TopBar from "./layout/TopBar.vue";
import { cn, SERVER_DOTS, since } from "./layout/ui";
import {
  focusPrompt,
  keyAction,
  menuAction,
  pageAction,
  paletteKey,
  surfaceOf,
  type WorkbenchAction,
} from "./layout/workbenchKeys";
import Checkouts from "./start/Checkouts.vue";
import SurfaceStack from "./surfaces/SurfaceStack.vue";
import { useSurfaceRelay } from "./surfaces/useSurface";
import { useSurfaceTabs } from "./surfaces/useSurfaceTabs";
import { useWorkbenchIndex } from "./index/useWorkbenchIndex";
import { SHOW_SERVER_READY } from "./layout/hiddenSurfaces";
import DetachCost from "./panels/DetachCost.vue";
import { linkFromHost, linkToHost } from "./panels/hostLink";
import { DOCK_TABS, kindOfTab } from "./panels/panelUrl";
import { useWindowLayout } from "./panels/useWindowLayout";

defineOptions({ name: "LabsWorkbench" });
const props = defineProps<{
  /** The host for a test; the page finds its own host without it. */
  readonly host?: HostApi;
}>();

const host = props.host ?? useHost();
const { state, checkout, greeted } = host;
// A workbench chord from a lab frame with the focus (the bridge event `key`, in a browser).
const relay = useSurfaceRelay(
  host.client,
  globalThis,
  (key) => {
    const action = keyAction(key);
    if (action !== null) act(action);
  },
  // The native snapshot and the MP4 of the labs app. A browser answers NO_NATIVE_…, and the host uses its fallback.
  desktopLocalCalls(),
  // A file that the user drops on the scene of a lab frame goes to the host (POST /imports).
  // The frame shows the result.
  // A drop of the desktop shell has no file in the frame: the page gives the host the path that it keeps.
  importDropHandler(
    host,
    () => relay,
    (drop) => shellDrop.take(drop),
  ),
  // A lab frame with scratch props gets their models from the host.
  scratchModelHandler(host, () => relay),
  // The clock link of the visible lab frame goes to the host. `onDetach` does "Open in a window" of the lab.
  // The relay finds the scene surface in the surface states of the host.
  {
    onLink: linkToHost(host.request, () => relay.idWith()),
    onDetach: (surface, where, event) => {
      windows.onFrameDetach(surface, where, event);
    },
    surfaces: () => host.surfaces.value,
  },
);
/** A call into the visible frame of the scene surface. The call fails when the project has no scene surface. */
function sceneCall(call: string, args: readonly unknown[], timeoutMs?: number): Promise<unknown> {
  const scene = relay.idWith();
  if (scene === null) return Promise.reject(new Error("The project has no scene surface."));
  return relay.call(scene, "visible", call, args, timeoutMs);
}
/**
 * The drag and drop of the labs app. The shell gives the file path and the window point of a drop. The page finds the
 * lab frame under that point and gives the lab the point in the frame. In a browser, this does nothing.
 */
const shellDrop = createShellDrop({
  call: (call, args) => sceneCall(call, args),
  frameAt: (at) => labFrameAt(document, at, relay.idWith()),
});
/** The frame pace of the main window for the indexer window of the labs app. In a browser, this does nothing. */
onBeforeUnmount(startFramePace(() => sceneCall("stats", [true], 900)));
/** The index reads of the lab frames, and the shadow frame that fills the index at idle time. */
useWorkbenchIndex(host, relay);
/** The before and after of the last turn, the notices and the Stop gate. */
const loop = useAgentLoop(host.client);
/** The host of the dock panels: the requests, the events and the run files. */
const dock = makeDockHost(host);
/** The clock link messages of the other windows go to the visible lab frame. */
onBeforeUnmount(linkFromHost({ request: host.request, on: (listener) => dock.on("link.message", listener) }, relay));
/** "Restart host" from the top bar. The supervisor of the host keeps the port and the token. */
const hostRestart = useHostRestart(host);
/** The Git state, the role of the page and the project of the host (`host.hello`). */
const access = computed(() => host.access?.value ?? null);
const role = computed(() => access.value?.role);
/** A folder with no Git has no Changes tab. */
const hiddenTabs = computed(() => (access.value?.git === false ? ["Changes"] : []));
/** The theme of the project manifest (`navy`, `light`, `dark`). Without a theme, the page keeps its theme. */
const THEMES: readonly string[] = ["navy", "light", "dark"];
watch(
  () => access.value?.project.theme ?? null,
  (theme) => {
    if (theme !== null && THEMES.includes(theme)) document.documentElement.dataset.theme = theme;
  },
  { immediate: true },
);
/** In the labs app, the top bar can close this window. Then the shell stops its host. */
const appWindow = windowLabel() !== null;

/** The key of the Claude column in the browser storage. */
const CLAUDE_KEY = "scenity.workbench.claude";
function readClaude(): boolean {
  try {
    return globalThis.localStorage.getItem(CLAUDE_KEY) !== "hidden";
  } catch {
    return true;
  }
}
const claudeOpen = ref(readClaude());
/** The open dock tab of the bottom bar. The window layout keeps it. */
const dockTab = ref<string | null>(null);
/** The detached windows and the saved layout of the checkout. */
const windows = useWindowLayout({ host, relay, claudeOpen, dockTab });
// A viewer cannot open a terminal or start an agent, so the page has no Claude column for a viewer.
const claudeShown = computed(() => claudeOpen.value && !windows.detached("claude") && role.value !== "viewer");
const detachedTabs = computed(() =>
  windows.layout.value.detached.flatMap((panel) => {
    const name = DOCK_TABS[panel.kind];
    return name === undefined ? [] : [name];
  }),
);

function toggleClaude(): void {
  claudeOpen.value = !claudeOpen.value;
  try {
    globalThis.localStorage.setItem(CLAUDE_KEY, claudeOpen.value ? "shown" : "hidden");
  } catch {
    // A blocked storage forgets the choice at the next load.
  }
}

/** "Open in a window", "Show the window" and "Dock back" of a dock tab. */
function onTabWindow(action: "detach" | "show" | "dock-back", name: string): void {
  const kind = kindOfTab(name);
  if (kind === null) return;
  if (action === "detach") void windows.detach(kind);
  else if (action === "show") void windows.show(kind);
  else void windows.dockBack(kind);
}

/** The surface tabs, from the project manifest. A restart of a surface opens the checkout again. */
const tabs = useSurfaceTabs(host);
const { kind, surface, restarting, restartError, restart } = tabs;
const serverStatus = computed(() => surface.value?.server.status ?? "none");
const pickCheckout = ref(false);
const showCheckouts = computed(() => greeted.value && (pickCheckout.value || checkout.value === null));
const view = ref<InstanceType<typeof SurfaceStack> | null>(null);

function pickSurface(next: SurfaceId): void {
  tabs.pick(next);
  view.value?.focus(next);
}

/** The time for the "last edit" words. It changes every five seconds. */
const now = ref(Date.now());
let tick: ReturnType<typeof setInterval> | null = null;
const status = computed(() => {
  if (hostRestart.note.value !== null) return hostRestart.note.value;
  if (state.value === "lost") return "The host connection is lost. Reconnecting.";
  if (state.value !== "connected") return "No host.";
  if (restartError.value !== null) return `Restart failed: ${restartError.value}`;
  const current = surface.value;
  const label = tabs.label(kind.value);
  if (current === null) {
    return checkout.value === null ? "No checkout is open." : `The checkout has no ${label.toLowerCase()} surface.`;
  }
  const port = current.server.port === null ? "" : ` on port ${String(current.server.port)}`;
  const edit = current.lastEdit;
  const last =
    edit === null ? "" : `. Last edit ${since(edit.at, now.value)} (${edit.file}${edit.reloaded ? ", reloaded" : ""})`;
  // The page hides the ready state (layout/hiddenSurfaces.ts). Then the line shows only the last edit.
  if (current.server.status === "ready" && !SHOW_SERVER_READY) return edit === null ? "" : `${last.slice(2)}.`;
  return `${label} dev server ${SERVER_DOTS[current.server.status].words}${port}${last}.`;
});

/** Open the Claude column and give the focus to its terminal or its prompt (⌘K). */
async function focusClaude(): Promise<void> {
  if (!claudeOpen.value) toggleClaude();
  await nextTick();
  focusPrompt(document.getElementById("workbench-claude"));
}

/** Do a workbench action: from a key of the page, a chord of a lab frame or the native menu of the app. */
function act(action: WorkbenchAction): void {
  const place = surfaceOf(action);
  if (place !== null) {
    // ⌘n puts the tab at place n in front (the order of the manifest).
    const next = tabs.tabs.value[place - 1]?.id;
    if (next !== undefined && tabs.available.value.includes(next)) pickSurface(next);
  } else if (action === "toggle-claude") toggleClaude();
  else if (action === "focus-claude") void focusClaude();
  // The app started a new host. The page reads the new endpoint when it loads (`host_endpoint` waits for the host).
  else globalThis.location.reload();
}

function onKey(event: KeyboardEvent): void {
  // ⌘P in the page opens the command palette of the lab frame.
  const scene = relay.idWith();
  if (scene !== null && paletteKey(event, kind.value === scene)) {
    event.preventDefault();
    view.value?.focus(scene);
    void sceneCall("openPalette", []).catch(() => undefined);
    return;
  }
  const action = pageAction(event);
  if (action === null) return;
  event.preventDefault();
  act(action);
}
let stopMenu: (() => void) | null = null;
let stopDrop: (() => void) | null = null;
let unmounted = false;
onMounted(() => {
  void listenShellDrop(shellDrop).then((stop) => {
    if (unmounted) stop?.();
    else stopDrop = stop;
  });
  globalThis.addEventListener("keydown", onKey);
  tick = setInterval(() => (now.value = Date.now()), 5_000);
  void listenMenu((id) => {
    const action = menuAction(id);
    if (action !== null) act(action);
  }).then((stop) => {
    if (unmounted) stop?.();
    else stopMenu = stop;
  });
});
onBeforeUnmount(() => {
  unmounted = true;
  stopMenu?.();
  stopDrop?.();
  globalThis.removeEventListener("keydown", onKey);
  if (tick !== null) clearInterval(tick);
});
</script>

<template>
  <div
    class="grid h-dvh grid-rows-[auto_auto_minmax(0,1fr)_auto] bg-surface-base text-body text-text-primary"
    data-testid="workbench"
  >
    <TopBar
      :checkout="checkout"
      :host-state="state"
      :server-status="serverStatus"
      :surface="kind"
      :tabs="tabs.tabs.value"
      :available="tabs.available.value"
      :claude-open="claudeOpen"
      :host-restarting="hostRestart.restarting.value"
      :app-window="appWindow"
      v-bind="role === undefined ? {} : { role }"
      @checkouts="pickCheckout = true"
      @surface="pickSurface"
      @claude="toggleClaude"
      @restart-host="hostRestart.restart"
      @close-window="closeWindow()"
    />
    <!-- The notice that the page retires. -->
    <p
      class="m-0 border-b border-border-subtle bg-surface-raised px-3 py-1 text-caption text-text-secondary"
      role="note"
      data-testid="workbench-retired"
    >
      The workbench page retires. Use Scenity Studio: run <code>scenity studio</code> and open the project in the Hub
      (docs/studio.md).
    </p>
    <main class="relative grid min-h-0">
      <p
        v-if="state === 'lost' && greeted"
        class="absolute inset-x-0 top-0 z-10 flex items-center justify-center gap-2 border-b border-status-negative bg-surface-overlay px-3 py-1.5 text-caption text-status-negative shadow-overlay"
        role="alert"
        data-testid="host-lost"
      >
        <CloudOff class="size-4" aria-hidden="true" />The host connection is lost. Reconnecting.
      </p>
      <p
        v-if="windows.blocked.value.length > 0"
        class="absolute inset-x-0 top-0 z-10 flex items-center justify-center gap-2 border-b border-border-subtle bg-surface-overlay px-3 py-1.5 text-caption shadow-overlay"
        role="status"
        data-testid="panels-blocked"
      >
        The browser did not open {{ windows.blocked.value.length }} detached window(s) of the saved layout.
        <button type="button" class="underline" data-testid="panels-reopen" @click="windows.reopen()">Open them</button>
      </p>
      <DetachCost v-if="windows.costAsk.value !== null" @answer="(ok) => windows.costAsk.value?.(ok)" />
      <HostMissing v-if="state === 'looking' || state === 'none'" :mode="state" :origin="null" />
      <HostMissing v-else-if="!greeted" mode="waiting" :origin="host.endpoint.value?.origin ?? null" />
      <Checkouts
        v-else-if="showCheckouts"
        :request="host.request"
        :open-checkout="host.openCheckout"
        :current="checkout?.path ?? null"
        :on="dock.on"
        @close="pickCheckout = false"
      />
      <div
        v-else
        :class="
          cn(
            'grid min-h-0 grid-cols-[minmax(0,1fr)]',
            claudeShown && 'max-md:grid-rows-[minmax(0,2fr)_minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_24rem]',
          )
        "
        data-testid="workspace"
      >
        <SurfaceStack
          ref="view"
          :stack="tabs.stack.value"
          :kind="kind"
          :label="tabs.label"
          :page-origin="host.pageOrigin"
          :relay="relay"
          :restarting="restarting"
          @restart="restart"
        />
        <ClaudeColumn
          v-if="claudeShown"
          :client="host.client.value"
          :checkout="checkout?.path ?? null"
          :loop="loop"
          detachable
          @detach="windows.detach('claude')"
        />
      </div>
    </main>
    <BottomBar
      v-model:open-tab="dockTab"
      :status="status"
      :dock="greeted ? dock : null"
      :detached="detachedTabs"
      :hidden="hiddenTabs"
      @detach="(name) => onTabWindow('detach', name)"
      @show="(name) => onTabWindow('show', name)"
      @dock-back="(name) => onTabWindow('dock-back', name)"
    />
  </div>
</template>
