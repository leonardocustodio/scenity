<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The header of the dock of the content browser. It has the button that opens and closes the full dock, the toggles
 * of its parts (the timeline, the folders, the browser) and the button that restores the default layout. "Open in a
 * window" moves the content browser into its own window (follow/detach.ts).
 *
 * The texts are Fluent messages of `src/i18n/en-US/browser.ftl`.
 */
import { cn } from "@scenity/ui";
import { ChevronDown, ChevronUp, ExternalLink, Film, LayoutGrid, PanelLeft, RotateCcw } from "lucide-vue-next";
import { useI18n } from "@scenity/i18n";
import type { Component } from "vue";
import type { DockLayout } from "./dockLayout";

const props = defineProps<{
  readonly layout: DockLayout;
  readonly title: string;
  /** Show "Open in a window" (not in the separate window of the content browser). */
  readonly detachable?: boolean;
}>();
const emit = defineEmits<{ reset: []; detach: [] }>();
const { $t } = useI18n();

type Part = "timeline" | "tree" | "browser";
/** The parts with the message IDs of their name and of the titles that show and hide them. */
const PARTS: readonly {
  readonly part: Part;
  readonly label: string;
  readonly show: string;
  readonly hide: string;
  readonly icon: Component;
}[] = [
  {
    part: "timeline",
    label: "browser-part-timeline",
    show: "browser-part-show-timeline",
    hide: "browser-part-hide-timeline",
    icon: Film,
  },
  {
    part: "tree",
    label: "browser-folders",
    show: "browser-part-show-folders",
    hide: "browser-part-hide-folders",
    icon: PanelLeft,
  },
  {
    part: "browser",
    label: "browser-part-browser",
    show: "browser-part-show-browser",
    hide: "browser-part-hide-browser",
    icon: LayoutGrid,
  },
];

/** Show or hide a part. When the folders show, the browser also shows. */
function toggle(part: Part): void {
  const layout = props.layout;
  layout.open = true;
  layout[part] = !layout[part];
  if (part === "tree" && layout.tree) layout.browser = true;
}

/** Open or close the full dock. */
function toggleDock(): void {
  const layout = props.layout;
  layout.open = !layout.open;
}

/** True when a part shows. */
function shown(part: Part): boolean {
  const layout = props.layout;
  if (part === "tree") return layout.browser && layout.tree;
  return layout[part];
}
</script>

<template>
  <div class="flex h-7 shrink-0 items-center gap-1 border-b border-border-subtle px-1.5 text-caption">
    <button
      type="button"
      class="inline-flex h-6 min-w-0 items-center gap-1 rounded-control px-1.5 text-text-secondary hover:bg-surface-raised hover:text-text-primary"
      :aria-expanded="layout.open"
      :title="layout.open ? $t('browser-dock-close') : $t('browser-dock-open')"
      data-testid="dock-toggle"
      @click="toggleDock"
    >
      <ChevronDown v-if="layout.open" class="size-3.5 shrink-0" aria-hidden="true" />
      <ChevronUp v-else class="size-3.5 shrink-0" aria-hidden="true" />
      <span class="truncate">{{ title }}</span>
    </button>
    <div class="ml-auto flex items-center gap-0.5" role="group" :aria-label="$t('browser-dock-parts')">
      <button
        v-for="entry in PARTS"
        :key="entry.part"
        type="button"
        :class="
          cn(
            'inline-flex h-6 items-center gap-1 rounded-control px-1.5 hover:bg-surface-raised',
            // The pressed part: the primary text on a raised surface, for sufficient contrast.
            layout.open && shown(entry.part)
              ? 'bg-surface-raised text-text-primary'
              : 'text-text-secondary hover:text-text-primary',
          )
        "
        :aria-pressed="layout.open && shown(entry.part)"
        :title="$t(shown(entry.part) ? entry.hide : entry.show)"
        :data-testid="`dock-part-${entry.part}`"
        @click="toggle(entry.part)"
      >
        <component :is="entry.icon" class="size-3.5" aria-hidden="true" />
        <span class="max-md:sr-only">{{ $t(entry.label) }}</span>
      </button>
      <button
        type="button"
        class="inline-flex size-6 items-center justify-center rounded-control text-text-secondary hover:bg-surface-raised"
        :title="$t('browser-dock-reset')"
        :aria-label="$t('browser-dock-reset')"
        data-testid="dock-layout-reset"
        @click="emit('reset')"
      >
        <RotateCcw class="size-3.5" aria-hidden="true" />
      </button>
      <button
        v-if="detachable"
        type="button"
        class="inline-flex size-6 items-center justify-center rounded-control text-text-secondary hover:bg-surface-raised"
        :title="$t('browser-dock-detach')"
        :aria-label="$t('browser-dock-detach')"
        data-testid="dock-detach"
        @click="emit('detach')"
      >
        <ExternalLink class="size-3.5" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
