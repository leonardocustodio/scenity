<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The control panel of the 3D room lab: the title, the keys help, the button that hides the panel, and the tabs. The
 * tabs are the tabs of the plugin and the View tab. The Inspector tab (the open item of the content browser) and the
 * Tune tab are hidden. The texts are Fluent messages of `src/i18n/en-US/lab-core.ftl`. The plugin gives the labels of
 * its tabs.
 */
import { useI18n } from "@scenity/i18n";
import { cn, Tabs } from "@scenity/ui";
import { CircleHelp, X } from "lucide-vue-next";
import { ref } from "vue";
// The Inspector tab is hidden. Remove the comment marks to show it again.
// import DockDetail from "<the inspector of the plugin>";
import LabHelp from "./LabHelp.vue";
// The Tune tab is hidden. Remove the comment marks to show it again.
// import LabTuneTab from "./LabTuneTab.vue";
import { button } from "./labUi";
// import { useLab } from "./labContext";
import LabViewTab from "./LabViewTab.vue";
import { editorPlugin } from "./plugin";

/** The tab in use: a press on a member in the scene shows the team tab. */
const tab = defineModel<string>("tab", { required: true });
const emit = defineEmits<{ hide: [] }>();
const { $t } = useI18n();
// The Inspector tab is hidden. Remove the comment marks to show it again.
// const { browser, selectedId } = useLab();
//
// /** The "Team tab" button of the inspector: the member in the team tab. */
// function showMember(id: string): void {
//   selectedId.value = id;
//   tab.value = "team";
// }
/** The tabs of the plugin come before the View tab. */
const PLUGIN_TABS = editorPlugin().tabs.filter((item) => item.at !== "view");
const TABS = [
  // The Inspector tab is hidden. Remove the comment marks to show it again.
  // { value: "inspector", label: "Inspector" },
  ...PLUGIN_TABS.map((item) => ({ value: item.value, label: item.label })),
  { value: "view", label: $t("lab-tab-view") },
  // The Tune tab is hidden. Remove the comment marks to show it again.
  // { value: "tune", label: "Tune" },
] as const;
/** The dialog of the keys and the controls (the help button under the title). */
const helpOpen = ref(false);
</script>

<template>
  <aside
    id="room3d-lab-panel"
    class="flex min-h-0 flex-col border-l border-border-subtle bg-surface-raised text-caption max-md:fixed max-md:inset-0 max-md:z-20 max-md:w-full max-md:border-l-0"
  >
    <header class="flex flex-col gap-3 border-b border-border-subtle p-3">
      <div class="flex items-start justify-between gap-2">
        <div class="flex flex-col">
          <!-- <h1 class="text-subtitle">Scenity Editor</h1> -->
          <h1 class="text-subtitle" translate="no">Scenity 3D</h1>
          <div class="flex items-center gap-1.5">
            <p class="text-text-secondary">{{ $t("lab-panel-help-hint") }}</p>
            <!-- The keys and the controls of the lab. -->
            <button
              type="button"
              class="inline-flex size-6 items-center justify-center rounded-pill text-text-secondary hover:bg-surface-sunken hover:text-text-primary pointer-coarse:size-9"
              :aria-label="$t('lab-panel-help')"
              :title="$t('lab-panel-help')"
              data-testid="lab-help-open"
              @click="helpOpen = true"
            >
              <CircleHelp class="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        <button
          type="button"
          :class="cn(button, 'inline-flex size-9 shrink-0 items-center justify-center p-0 pointer-coarse:size-11')"
          :aria-label="$t('lab-panel-hide')"
          :title="$t('lab-panel-hide')"
          aria-controls="room3d-lab-panel"
          :aria-expanded="true"
          @click="emit('hide')"
        >
          <X class="size-4" aria-hidden="true" />
        </button>
      </div>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto p-3">
      <Tabs v-model="tab" :tabs="TABS" :label="$t('lab-panel-tabs')" class="lab-panel-tabs">
        <!-- The open item of the content browser.
        The Inspector tab is hidden. Remove the comment marks to show it again.
        <template #inspector><DockDetail :item="browser?.item.value ?? null" @team="showMember" /></template> -->
        <template v-for="item in PLUGIN_TABS" :key="item.value" #[item.value]
          ><component :is="item.component"
        /></template>
        <template #view><LabViewTab /></template>
        <!-- The Tune tab is hidden. Remove the comment marks to show it again.
        <template #tune><LabTuneTab /></template> -->
      </Tabs>
    </div>
    <LabHelp v-model:open="helpOpen" />
  </aside>
</template>

<style scoped>
/*
 * The tabs on one line in the panel of 25 rem: no wrap, less space at the sides, and the caption size. The shared Tabs
 * of @scenity/ui keep their size in other places.
 */
.lab-panel-tabs :deep([role="tablist"]) {
  flex-wrap: nowrap;
  justify-content: space-between;
  gap: 0;
}

.lab-panel-tabs :deep([role="tab"]) {
  padding-inline: var(--sc-space-2);
  font-size: var(--sc-font-size-12);
  white-space: nowrap;
}
</style>
