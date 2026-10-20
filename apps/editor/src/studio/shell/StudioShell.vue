<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The editor window. The title bar has the menu bar and the workspace tabs. The toolbar has the file bar, the gizmo
 * bar and the clock of the page, the history buttons and the Layout menu. Under the toolbar are the dock with the
 * panels and the status row. Each panel of the dock is the panel component with the content of the registry. On a
 * small screen, a rail on each edge holds the tabs of the folded sides.
 */
import { onBeforeUnmount, provide, shallowRef } from "vue";
import { useI18n } from "@scenity/i18n";
import { DockviewVue, type DockviewReadyEvent, type VueComponent } from "dockview-vue";
import AdoptElement from "./AdoptElement.vue";
import HistoryButtons from "./HistoryButtons.vue";
import BannerRow from "./BannerRow.vue";
import DialogHost from "./DialogHost.vue";
import SearchBox from "./SearchBox.vue";
import KeySheet from "./KeySheet.vue";
import StatusBar from "./StatusBar.vue";
import DockPanel from "./DockPanel.vue";
import DockTab from "./DockTab.vue";
import EdgeRail from "./EdgeRail.vue";
import MenuBar from "./MenuBar.vue";
import LayoutMenu from "./LayoutMenu.vue";
import WorkspaceTabs from "./WorkspaceTabs.vue";
import TourCard from "../tour/TourCard.vue";
import TutorialCard from "../tutorials/TutorialCard.vue";
import { Dock, PANEL_COMPONENT, TAB_COMPONENT } from "./dock";
import { shellCommands, type ShellCommandSpec } from "./dockCommands";
import { panelTitle } from "./panels";
import { DOCK_KEY, SHELL_KEY, type ShellContext } from "./shell";

const props = defineProps<{ context: ShellContext }>();
provide(SHELL_KEY, props.context);
const { $t } = useI18n();
const dock = shallowRef<Dock | null>(null);
const body = shallowRef<HTMLElement | null>(null);
const commands = shallowRef<readonly ShellCommandSpec[]>([]);
provide(DOCK_KEY, dock);
const THEME = { name: "studio", className: "studio-dock-theme", colorScheme: "dark" as const };
// The props of a panel and of a tab come from dockview: the components take the props that dockview gives.
const PANELS: Record<string, VueComponent> = { [PANEL_COMPONENT]: DockPanel as unknown as VueComponent };
const TABS: Record<string, VueComponent> = { [TAB_COMPONENT]: DockTab as unknown as VueComponent };

let stopFold: () => void = () => undefined;
onBeforeUnmount(() => stopFold());

function onReady(event: DockviewReadyEvent): void {
  const registry = props.context.registry;
  const ready = new Dock(event.api, registry, props.context.workspaces, (id) => panelTitle(registry, id, $t));
  if (props.context.defaults !== undefined) ready.defaults = props.context.defaults;
  ready.start();
  stopFold = ready.fold.start(() => {
    const box = body.value?.getBoundingClientRect();
    return box === undefined ? null : { width: box.width, height: box.height };
  });
  commands.value = shellCommands({ dock: ready, registry, notices: props.context.notices, t: $t });
  dock.value = ready;
  props.context.ready(ready, commands.value);
}
</script>

<template>
  <div class="studio-shell" data-testid="studio-shell">
    <div class="studio-titlebar" data-testid="studio-titlebar">
      <MenuBar
        v-if="dock !== null"
        :dock="dock"
        :registry="props.context.registry"
        :commands="commands"
        :port="props.context.commands"
      />
      <WorkspaceTabs v-if="dock !== null" :dock="dock" :commands="commands" />
    </div>
    <div class="studio-top" data-testid="studio-top">
      <AdoptElement :element="props.context.regions.bar" />
      <AdoptElement :element="props.context.regions.tools" />
      <AdoptElement :element="props.context.regions.clock" />
      <HistoryButtons
        v-if="props.context.commands !== undefined"
        :status="props.context.status"
        :port="props.context.commands"
      />
      <LayoutMenu v-if="dock !== null" :dock="dock" :commands="commands" />
    </div>
    <BannerRow :notices="props.context.notices" />
    <div ref="body" class="studio-body">
      <EdgeRail v-if="dock !== null" :fold="dock.fold" side="left" />
      <DockviewVue class="studio-dock" :theme="THEME" :components="PANELS" :tab-components="TABS" @ready="onReady" />
      <EdgeRail v-if="dock !== null" :fold="dock.fold" side="right" />
    </div>
    <div class="studio-statusrow">
      <StatusBar :status="props.context.status" />
      <AdoptElement :element="props.context.regions.status" />
    </div>
    <DialogHost :notices="props.context.notices" />
    <!-- The tour of the window. -->
    <TourCard :open="(id: string) => dock?.open(id)" />
    <!-- The card of a tutorial (Help → Tutorials). -->
    <TutorialCard />
    <SearchBox v-if="props.context.search !== undefined" :search="props.context.search" />
    <KeySheet
      v-if="props.context.keySheet !== undefined && props.context.commands !== undefined"
      :sheet="props.context.keySheet"
      :rows="() => props.context.commands?.keyRows() ?? []"
    />
  </div>
</template>
