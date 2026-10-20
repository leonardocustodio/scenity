<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The layout of the split screen in the View tab: 1 pane, 2 side by side, 2 stacked, 3 (one large and two small) or
 * 2 × 2. The keys ⌥1 to ⌥4 also choose a layout.
 *
 * The texts are Fluent messages of `src/i18n/en-US/panes.ftl`.
 */
import { useI18n } from "@scenity/i18n";
import { PANE_LAYOUTS, type PaneLayout } from "@scenity/runtime-dev";
import { cn } from "@scenity/ui";
import { useLab } from "../labContext";
import { segment, segmentOn } from "../labUi";

const { $t } = useI18n();
const { panes } = useLab();

/** The message ID of the label of each layout. */
const LABELS: Readonly<Record<PaneLayout, string>> = {
  "1": "panes-layout-one",
  "2h": "panes-layout-side",
  "2v": "panes-layout-stacked",
  "3": "panes-layout-three",
  "2x2": "panes-layout-grid",
};
</script>

<template>
  <section v-if="panes != null" class="flex flex-col gap-1.5" :aria-label="$t('panes-split')">
    <h3 class="text-label text-text-secondary">{{ $t("panes-split") }}</h3>
    <div class="flex rounded-control bg-surface-sunken p-0.5" role="radiogroup" :aria-label="$t('panes-layout-label')">
      <button
        v-for="layout in PANE_LAYOUTS"
        :key="layout"
        type="button"
        role="radio"
        :aria-checked="panes.layout.value === layout"
        :class="cn(segment, panes.layout.value === layout && segmentOn)"
        :data-testid="`lab-panes-${layout}`"
        @click="panes.setLayout(layout)"
      >
        {{ $t(LABELS[layout]) }}
      </button>
    </div>
    <p class="text-text-secondary">{{ $t("panes-layout-help") }}</p>
  </section>
</template>
