<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The dock of the content browser at the bottom of the lab. Its parts are a header with the toggles of the parts, the
 * timeline (the play bar, the frame strip and the clip lanes), and the browser. The browser has the tree of folders,
 * the path with the search and the grid of tiles. The inspector of the open item is a tab of the side panel, because
 * its text is too long for the dock. Each part opens and closes. A resize handle changes each size: the height of the
 * dock (its top edge), the height of the frames (the edge under the timeline) and the width of the folders. The
 * browser storage keeps the layout (dockLayout.ts). The key B shows or hides the browser, and Shift+B shows or hides
 * the full dock. The browser part has tabs (dockTabs.ts): first the tabs of the plugin (for example "Clips and
 * presets", the content browser of DockContentBrowser.vue), then the core tab "Assets" (the generic asset browser).
 *
 * The texts are Fluent messages of `src/i18n/en-US/browser.ftl`.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "@scenity/i18n";
import { cn } from "@scenity/ui";
import LabTimeline from "../LabTimeline.vue";
import { useLab } from "../labContext";
import { typingInto } from "../labUi";
import DockHeader from "./DockHeader.vue";
// The clip lanes are hidden. Remove the comment marks to show them again.
// import DockLanes from "./DockLanes.vue";
// The frames of the strip are hidden. Remove the comment marks to show them again.
// import DockStrip from "./DockStrip.vue";
import { clampSize, defaultLayout, heightOf, type LayoutSize } from "./dockLayout";
import { dockTabs } from "./dockTabs";
import ResizeHandle from "./ResizeHandle.vue";
import type { LabBrowser } from "./useBrowser";
import { useFrameStrip } from "./useFrameStrip";
import { detachDock } from "../follow/detach";

const props = defineProps<{
  readonly browser: LabBrowser;
  readonly timeline: boolean;
  /** The content browser in its separate window (`only=dock`). The dock fills the page and does not detach. */
  readonly fill?: boolean;
}>();
const lab = useLab();
const { $t } = useI18n();

const { item, layout } = props.browser;

// The tabs of the browser part: first the tabs of the plugin (for example the content browser), then the core tabs.
const tabs = dockTabs();
const tabValue = ref(tabs[0]?.value ?? "");
const activeTab = computed(() => tabs.find((tab) => tab.value === tabValue.value) ?? tabs[0]);

/** The strip and the lanes are hidden. Set this value to true to show them again. */
const STRIP_SHOWN = false as boolean;
/** The strip and the lanes show with the timeline, and only for the take of the lab (no live source). */
const stripActive = computed(
  () => STRIP_SHOWN && layout.open && layout.timeline && props.timeline && lab.mock === null && lab.trackName === null,
);
const strip = useFrameStrip(lab, stripActive);
// The script API reads the strip.
props.browser.attachStrip(strip);
// When an item opens, it fills its strip immediately, before it plays.
watch(props.browser.opened, () => void strip.autoFill());
onBeforeUnmount(() => {
  props.browser.attachStrip(null);
});

/** The size of 1rem in CSS pixels. */
function rootFont(): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

/** A size of the layout, kept in its limits (the v-model of a resize handle). */
function sized(size: LayoutSize) {
  return computed({
    get: () => layout[size],
    set: (value: number) => {
      layout[size] = clampSize(size, value, rootFont());
    },
  });
}
const height = sized("height");
const stripHeight = sized("stripHeight");

/** Move the content browser into its own window. Then this page hides its dock. */
function detach(): void {
  detachDock(() => {
    if (lab.browser !== null) lab.browser.dock.value = "hidden";
  });
}

function reset(size?: LayoutSize): void {
  const base = defaultLayout();
  if (size === undefined) Object.assign(layout, base);
  else layout[size] = base[size];
}

function onKey(event: KeyboardEvent): void {
  if (event.code !== "KeyB" || event.ctrlKey || event.metaKey || event.altKey || typingInto(event.target)) return;
  event.preventDefault();
  if (event.shiftKey) {
    layout.open = !layout.open;
    return;
  }
  layout.open = true;
  layout.browser = !layout.browser;
}

onMounted(() => globalThis.addEventListener("keydown", onKey));
onBeforeUnmount(() => globalThis.removeEventListener("keydown", onKey));

const title = computed(() => {
  const open = item.value;
  return open === null
    ? $t("browser-dock-title")
    : $t("browser-dock-title-item", { item: open.clip?.id ?? open.title });
});
</script>

<template>
  <section
    class="lab-dock relative z-10 flex shrink-0 flex-col border-t border-border-subtle bg-surface-overlay text-text-primary"
    :class="fill && 'min-h-0 flex-1'"
    :aria-label="$t('browser-dock-title')"
    data-scene-control
    :data-height="heightOf(layout)"
    :style="!fill && layout.open && layout.browser ? { height: `${String(height + 1.75)}rem` } : undefined"
    :data-fill="fill || undefined"
    data-testid="lab-dock"
  >
    <!-- The top edge sets the height of the dock while the browser shows. -->
    <ResizeHandle
      v-if="!fill && layout.open && layout.browser"
      v-model="height"
      axis="y"
      invert
      :label="$t('browser-dock-height')"
      :title="$t('browser-dock-height-title')"
      class="absolute inset-x-0 -top-0.75"
      data-testid="dock-handle"
      @reset="reset('height')"
    />
    <DockHeader :layout="layout" :title="title" :detachable="!fill" @reset="reset()" @detach="detach" />
    <!-- The timeline stays in the page when it is hidden. Thus its keys (Space, comma, period) continue to operate. -->
    <div
      v-if="timeline"
      v-show="layout.open && layout.timeline"
      class="flex shrink-0 flex-col"
      :style="{ '--strip-h': `${String(stripHeight)}rem` }"
      data-testid="dock-timeline"
    >
      <LabTimeline :window="browser.window.value" @whole="browser.wholeTake()" />
      <template v-if="stripActive">
        <!-- The frames of the strip are hidden. Remove the comment marks to show them again.
        <DockStrip :slots="browser.slots.value" :strip="strip" @update:slots="(value) => browser.setSlots(value)" /> -->
        <!-- The clip lanes are hidden. Remove the comment marks to show them again.
        <DockLanes :strip="strip" /> -->
      </template>
      <!-- The frames of the strip are hidden. Remove the comment marks to show them again.
      <ResizeHandle
        v-if="stripActive && layout.browser"
        v-model="stripHeight"
        axis="y"
        label="The height of the frames"
        data-testid="dock-strip-handle"
        @reset="reset('stripHeight')"
      /> -->
    </div>
    <div v-if="layout.open && layout.browser" class="flex min-h-0 flex-1 flex-col" data-testid="dock-browser">
      <div
        v-if="tabs.length > 1"
        class="flex h-6 shrink-0 items-center gap-0.5 border-b border-border-subtle px-1.5 text-caption"
        role="tablist"
        :aria-label="$t('browser-dock-tabs')"
      >
        <button
          v-for="tab in tabs"
          :key="tab.value"
          type="button"
          role="tab"
          :aria-selected="tab.value === activeTab?.value"
          :class="
            cn(
              'h-5 rounded-control px-1.5 hover:bg-surface-raised',
              tab.value === activeTab?.value ? 'bg-surface-raised text-text-primary' : 'text-text-secondary',
            )
          "
          :data-testid="`dock-tab-${tab.value}`"
          @click="tabValue = tab.value"
        >
          {{ tab.label }}
        </button>
      </div>
      <component :is="activeTab.component" v-if="activeTab !== undefined" :browser="browser" />
    </div>
  </section>
</template>
