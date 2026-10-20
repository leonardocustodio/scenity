<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The one panel component of the dock. It shows the content that the registry has for the panel ID, in a host element
 * with the key context of the panel. A panel with no content yet shows its empty state. The content keeps small values
 * in the layout with `usePanelState` (panelState.ts).
 */
import { computed, inject, onBeforeUnmount, provide, ref } from "vue";
import type { IDockviewPanelProps } from "dockview-vue";
import { useI18n } from "@scenity/i18n";
import { copyOf } from "./panels";
import { PANEL_STATE_KEY, PANEL_VISIBLE_KEY, paramsState } from "./panelState";
import EmptyState from "./EmptyState.vue";
import { DOCK_KEY, SHELL_KEY } from "./shell";

const props = defineProps<{ params: IDockviewPanelProps }>();
const { $t } = useI18n();
const shell = inject(SHELL_KEY);
const id = props.params.api.id;
const spec = computed(() => shell?.registry.get(id));
const content = computed(() => shell?.registry.content(id));
/** A copy of a panel ("Inspector 2") has no host ID: an ID names one element. */
const copy = copyOf(id).copy;
const dock = inject(DOCK_KEY, null);
// The state of the panel goes into its parameters in the layout of the dock.
provide(
  PANEL_STATE_KEY,
  paramsState(
    () => props.params.params as { state?: Record<string, unknown> } | undefined,
    (next) => props.params.api.updateParameters(next),
    () => dock?.value?.save(),
  ),
);
// True when the tab of the panel shows (a panel that stays mounted can be behind a different tab).
const visible = ref(props.params.api.isVisible);
const watching = props.params.api.onDidVisibilityChange((event) => (visible.value = event.isVisible));
onBeforeUnmount(() => watching.dispose());
provide(PANEL_VISIBLE_KEY, visible);
</script>

<template>
  <div class="studio-panel" :data-panel="id" :data-key-context="spec?.keyContext">
    <div
      v-if="content !== undefined"
      :id="copy === 1 ? content.hostId : undefined"
      :data-testid="copy === 1 ? content.hostId : undefined"
      :data-plain="content.plain === true ? '' : undefined"
      class="studio-panel-host"
    >
      <component :is="content.component" v-bind="content.props ?? {}" />
    </div>
    <!-- A panel with no content yet tells what to do next. -->
    <EmptyState v-else-if="spec !== undefined" :panel="id" />
    <p v-else class="studio-panel-note" role="status">{{ $t("panel-unknown") }}</p>
  </div>
</template>
