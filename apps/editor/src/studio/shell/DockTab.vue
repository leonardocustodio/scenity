<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The tab of a panel in the dock: the icon and the title from the registry, and a close button
 * for a panel that can close. A press on the tab shows the panel (the dock does it).
 */
import { computed, inject } from "vue";
import type { IDockviewPanelHeaderProps } from "dockview-vue";
import { useI18n } from "@scenity/i18n";
import { X } from "lucide-vue-next";
import { panelTitle, UNKNOWN_PANEL_ICON } from "./panels";
import { SHELL_KEY } from "./shell";

const props = defineProps<{ params: IDockviewPanelHeaderProps }>();
const { $t } = useI18n();
const shell = inject(SHELL_KEY);
const id = props.params.api.id;
const spec = computed(() => shell?.registry.get(id));
const title = computed(() => (shell === undefined ? id : panelTitle(shell.registry, id, $t)));

function close(): void {
  props.params.api.close();
}
</script>

<template>
  <span class="studio-tab" :data-testid="`dock-tab-${id}`" :data-panel="id" :title="title">
    <component :is="spec?.icon ?? UNKNOWN_PANEL_ICON" class="studio-tab-icon" aria-hidden="true" />
    <span class="studio-tab-title">{{ title }}</span>
    <!-- The tab is a control (role "tab"), thus the close button is for the pointer only. The keyboard closes a panel
    with the Delete key on its tab or with the "panel.close" command. -->
    <span
      v-if="spec?.closable !== false"
      class="studio-tab-close"
      aria-hidden="true"
      :title="$t('panel-close', { title })"
      :data-testid="`dock-close-${id}`"
      @pointerdown.stop
      @click.stop="close"
    >
      <X />
    </span>
  </span>
</template>
