<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The rail of tabs on one edge of a small window: a tab for each panel of the folded side. A press shows the side
 * with the panel. A press on the tab of the panel that shows folds the side again.
 */
import { computed, inject } from "vue";
import { useI18n } from "@scenity/i18n";
import type { DockFold, FoldSide } from "./fold";
import { panelTitle, UNKNOWN_PANEL_ICON } from "./panels";
import { SHELL_KEY } from "./shell";

const props = defineProps<{ fold: DockFold; side: FoldSide }>();
const { $t } = useI18n();
const shell = inject(SHELL_KEY);
const state = props.fold.state;
const tabs = computed(() =>
  state[props.side].map((id) => ({
    id,
    icon: shell?.registry.get(id)?.icon ?? UNKNOWN_PANEL_ICON,
    title: shell === undefined ? id : panelTitle(shell.registry, id, $t),
    shown: state.shown === props.side && state.active === id,
  })),
);
</script>

<template>
  <div
    v-if="state.folded && tabs.length > 0"
    class="studio-rail"
    role="toolbar"
    aria-orientation="vertical"
    :aria-label="$t(`fold-${props.side}`)"
    :data-side="props.side"
    :data-testid="`studio-rail-${props.side}`"
  >
    <button
      v-for="tab in tabs"
      :key="tab.id"
      type="button"
      class="studio-rail-tab"
      :aria-pressed="tab.shown"
      :data-testid="`rail-tab-${tab.id}`"
      :data-command="`panel.open.${tab.id}`"
      @click="props.fold.press(tab.id)"
    >
      <component :is="tab.icon" class="studio-tab-icon" aria-hidden="true" />
      <span>{{ tab.title }}</span>
    </button>
  </div>
</template>
