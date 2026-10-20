<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The top bar of the workbench. It has these parts:
 * - the app name;
 * - the checkout with its branch and its count of changed files (a press shows the checkouts);
 * - the surface tabs from the project manifest, in their order, with their labels;
 * - the state dots of the host and of the dev server;
 * - the Restart host button and the button of the Claude column (⌘\).
 * In the labs app, it also has "Close window": the shell then stops the host of the window. It shows the role of a
 * remote token (viewer, editor). Only an admin restarts the host, and a viewer has no Claude column.
 */
import { SURFACE_KEY_COUNT, type Checkout, type Role, type ServerStatus } from "@scenity/workbench-host/protocol";
import type { SurfaceId } from "@scenity/workbench-host/protocol";
import { FolderGit2, PanelRight, PanelRightClose, RotateCw, X } from "lucide-vue-next";
import type { HostState } from "../host/useHost";
import type { SurfaceTab } from "../surfaces/useSurfaceTabs";
import { baseName, cn, count, HOST_DOTS, iconTab, SERVER_DOTS, tab } from "./ui";
import { SHOW_SINGLE_TAB, SHOW_STATE_DOTS } from "./hiddenSurfaces";

defineProps<{
  readonly checkout: Checkout | null;
  readonly hostState: HostState;
  readonly serverStatus: ServerStatus | "none";
  /** The surface ID of the tab in front, or null. */
  readonly surface: SurfaceId | null;
  /** The tabs of the project, in their order. */
  readonly tabs: readonly SurfaceTab[];
  readonly claudeOpen: boolean;
  /** The surface IDs that the host lists for the checkout: the other tabs are off. */
  readonly available?: readonly SurfaceId[];
  /** True while the host restarts. */
  readonly hostRestarting?: boolean;
  /** True in a window of the labs app; the bar then shows "Close window". */
  readonly appWindow?: boolean;
  /** The role of the token of the page (absent: admin). */
  readonly role?: Role;
}>();
const emit = defineEmits<{
  checkouts: [];
  surface: [id: SurfaceId];
  claude: [];
  restartHost: [];
  closeWindow: [];
}>();

/** True when the host lists the surface. Without a list every tab is on. */
function ready(id: SurfaceId, available: readonly SurfaceId[] | undefined): boolean {
  return available === undefined || available.includes(id);
}
/** The title of a tab: its label and its key (⌘1 to ⌘9), or the words of a surface that the host does not run. */
function tabTitle(entry: SurfaceTab, at: number, available: readonly SurfaceId[] | undefined): string {
  const name = entry.label.toLowerCase();
  if (!ready(entry.id, available)) return `The host has no ${name} surface for this checkout`;
  return at < SURFACE_KEY_COUNT ? `The ${name} surface (⌘${String(at + 1)})` : `The ${name} surface`;
}
/** The label of the tab in front, for the state dot of its dev server. */
function frontLabel(tabs: readonly SurfaceTab[], id: SurfaceId | null): string {
  return tabs.find((entry) => entry.id === id)?.label ?? "Surface";
}
</script>

<template>
  <header
    class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle bg-surface-raised px-3 py-1.5 text-caption"
    data-testid="workbench-top-bar"
  >
    <!-- <h1 class="text-label whitespace-nowrap">Scenity</h1> -->
    <h1 class="text-label whitespace-nowrap">Scenity 3D</h1>
    <button
      v-if="checkout !== null"
      type="button"
      :class="cn(tab(), 'min-w-0 max-w-full')"
      :title="`${checkout.path} (show the checkouts)`"
      data-testid="top-checkout"
      @click="emit('checkouts')"
    >
      <FolderGit2 class="size-3.5 shrink-0" aria-hidden="true" />
      <span class="truncate font-mono text-text-primary">{{ checkout.branch ?? checkout.head.slice(0, 8) }}</span>
      <span class="whitespace-nowrap">{{ baseName(checkout.path) }}</span>
      <span v-if="checkout.changed > 0" class="whitespace-nowrap text-status-caution" data-testid="top-changed">
        {{ count(checkout.changed, "file") }} changed
      </span>
    </button>
    <!-- <nav class="flex items-center gap-0.5 md:mx-auto" aria-label="Surfaces"> -->
    <nav
      v-if="tabs.length > 1 || (tabs.length === 1 && SHOW_SINGLE_TAB)"
      class="flex items-center gap-0.5 md:mx-auto"
      aria-label="Surfaces"
    >
      <button
        v-for="(entry, at) in tabs"
        :key="entry.id"
        type="button"
        :class="tab(surface === entry.id)"
        :disabled="!ready(entry.id, available)"
        :aria-current="surface === entry.id ? 'page' : undefined"
        :aria-keyshortcuts="at < SURFACE_KEY_COUNT ? `Meta+${String(at + 1)}` : undefined"
        :title="tabTitle(entry, at, available)"
        :data-testid="`surface-tab-${entry.id}`"
        @click="emit('surface', entry.id)"
      >
        {{ entry.label }}
      </button>
    </nav>
    <div class="ml-auto flex items-center gap-3 md:ml-0">
      <span
        v-if="role !== undefined && role !== 'admin'"
        class="rounded-pill border border-border-subtle px-2 text-text-secondary"
        :title="`This page has a ${role} token: the host refuses the actions above the role.`"
        data-testid="top-role"
        >{{ role }}</span
      >
      <span
        v-if="SHOW_STATE_DOTS"
        class="inline-flex items-center gap-1.5"
        :title="`Host: ${HOST_DOTS[hostState].words}`"
        data-testid="dot-host"
      >
        <span :class="cn('size-2 rounded-pill', HOST_DOTS[hostState].color)" aria-hidden="true" />
        host<span class="sr-only">: {{ HOST_DOTS[hostState].words }}</span>
      </span>
      <button
        v-if="(hostState === 'connected' || hostRestarting) && (role ?? 'admin') === 'admin'"
        type="button"
        :class="iconTab()"
        aria-label="Restart host"
        title="Restart host: a new host process; the surfaces stay, terminals and runs end"
        :disabled="hostRestarting"
        data-testid="restart-host"
        @click="emit('restartHost')"
      >
        <RotateCw
          :class="cn('size-3.5', hostRestarting && 'animate-spin motion-reduce:animate-none')"
          aria-hidden="true"
        />
      </button>
      <span
        v-if="SHOW_STATE_DOTS"
        class="inline-flex items-center gap-1.5"
        :title="`${frontLabel(tabs, surface)} dev server: ${SERVER_DOTS[serverStatus].words}`"
        data-testid="dot-vite"
      >
        <span :class="cn('size-2 rounded-pill', SERVER_DOTS[serverStatus].color)" aria-hidden="true" />
        vite<span class="sr-only">: {{ SERVER_DOTS[serverStatus].words }}</span>
      </span>
      <button
        v-if="role !== 'viewer'"
        type="button"
        :class="iconTab()"
        :aria-label="claudeOpen ? 'Hide the Claude column (⌘\\)' : 'Show the Claude column (⌘\\)'"
        :title="claudeOpen ? 'Hide the Claude column (⌘\\)' : 'Show the Claude column (⌘\\)'"
        :aria-pressed="claudeOpen"
        aria-controls="workbench-claude"
        data-testid="toggle-claude"
        @click="emit('claude')"
      >
        <PanelRightClose v-if="claudeOpen" class="size-4" aria-hidden="true" />
        <PanelRight v-else class="size-4" aria-hidden="true" />
      </button>
      <button
        v-if="appWindow"
        type="button"
        :class="iconTab()"
        aria-label="Close window"
        title="Close window: the host of this window, its dev servers and its terminals stop (⌘W)"
        data-testid="close-window"
        @click="emit('closeWindow')"
      >
        <X class="size-4" aria-hidden="true" />
      </button>
    </div>
  </header>
</template>
