<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The bottom bar of the workbench: the tabs of the dock and the status line. Changes, Runs and Review are the panels
 * of the change loop (`DockPanels`). Sessions lists the earlier Claude sessions. The status line also shows the active
 * run. The open tab is a model of the page (the window layout keeps it). "Open in a window" moves the open tab into
 * its own window. A tab in a window shows the buttons that bring the window to the front or dock it again. A project
 * folder with no Git has no Changes tab (`hidden`).
 */
import { ExternalLink } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import type { DockHost } from "../dock/dockHost";
import DockPanels from "../dock/DockPanels.vue";
import { button, tab } from "./ui";

const bar = defineProps<{
  /** The status line: what the host and the surface say now. */
  readonly status: string;
  /** The host of the dock panels, or null without a connected host (the tabs then show empty panels). */
  readonly dock?: DockHost | null;
  /** The open tab (the window layout of the page keeps it; `v-model:open-tab`). */
  readonly openTab?: string | null;
  /** The tabs that are in their own windows. */
  readonly detached?: readonly string[];
  /** The tabs that the page does not show (Changes without Git). */
  readonly hidden?: readonly string[];
}>();
const emit = defineEmits<{
  "update:openTab": [tab: string | null];
  detach: [tab: string];
  show: [tab: string];
  "dock-back": [tab: string];
}>();

/** The count of changed files and the run in progress, from the dock panels. */
const summary = ref<{ changes: number; running: string | null }>({ changes: 0, running: null });
// The tabs with a panel of DockPanels, the Picker tab included.
const DOCK_PANELS: readonly string[] = ["Changes", "Runs", "Review", "Sessions", "Picker"];

const TABS = ["Changes", "Runs", "Review", "Sessions", "Picker"] as const;
type DockTab = (typeof TABS)[number];
const isTab = (value: string | null | undefined): value is DockTab => (TABS as readonly unknown[]).includes(value);
const shownTabs = computed(() => TABS.filter((name) => !(bar.hidden ?? []).includes(name)));
const open = ref<DockTab | null>(isTab(bar.openTab) ? bar.openTab : null);
watch(
  () => bar.openTab,
  (value) => {
    if (value !== undefined) open.value = isTab(value) ? value : null;
  },
);
const panelId = computed(() => (open.value === null ? undefined : `dock-${open.value.toLowerCase()}`));
/** True when the open tab is in its own window: the bar shows its window buttons, not its panel. */
const away = computed(() => open.value !== null && (bar.detached ?? []).includes(open.value));

function toggle(name: DockTab): void {
  open.value = open.value === name ? null : name;
  emit("update:openTab", open.value);
}
</script>

<template>
  <footer
    class="flex flex-col border-t border-border-subtle bg-surface-raised text-caption"
    data-testid="workbench-bottom"
  >
    <DockPanels v-if="dock" :dock="dock" :open="away ? null : open" @summary="summary = $event" />
    <!-- A tab in its own window. -->
    <section
      v-if="away && open !== null"
      class="flex items-center gap-2 border-b border-border-subtle px-3 py-2"
      :aria-label="open"
      data-testid="dock-away"
    >
      <p class="mr-auto text-text-secondary">{{ open }} is in its own window.</p>
      <button type="button" :class="button" data-testid="dock-away-show" @click="emit('show', open)">
        Show the window
      </button>
      <button type="button" :class="button" data-testid="dock-away-back" @click="emit('dock-back', open)">
        Dock back
      </button>
    </section>
    <section
      v-if="open !== null && !away && !(dock && DOCK_PANELS.includes(open))"
      :id="panelId"
      class="h-40 border-b border-border-subtle px-3 py-2"
      :aria-label="open"
      :data-testid="panelId"
    >
      <h2 class="text-label">{{ open }}</h2>
    </section>
    <div class="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 px-2 py-0.5">
      <nav class="flex items-center gap-0.5" aria-label="Dock">
        <button
          v-for="name in shownTabs"
          :key="name"
          type="button"
          :class="tab(open === name)"
          :aria-expanded="open === name"
          :aria-controls="open === name ? panelId : undefined"
          :data-testid="`dock-tab-${name.toLowerCase()}`"
          @click="toggle(name)"
        >
          {{ name }}
          <span v-if="dock && name === 'Changes' && summary.changes > 0" class="text-text-secondary">{{
            summary.changes
          }}</span>
          <span v-if="dock && name === 'Runs' && summary.running !== null" class="text-status-caution">▶</span>
        </button>
      </nav>
      <button
        v-if="dock && open !== null && !away"
        type="button"
        class="inline-flex size-7 items-center justify-center rounded-control text-text-secondary hover:bg-surface-sunken hover:text-text-primary"
        :title="`Open ${open} in a window`"
        :aria-label="`Open ${open} in a window`"
        data-testid="dock-detach"
        @click="emit('detach', open)"
      >
        <ExternalLink class="size-4" aria-hidden="true" />
      </button>
      <p class="ml-auto min-w-0 truncate text-text-secondary" role="status" data-testid="status-line">
        <span v-if="summary.running !== null" class="text-status-caution" data-testid="status-run"
          >{{ summary.running }} ·
        </span>
        {{ status }}
      </p>
    </div>
  </footer>
</template>
