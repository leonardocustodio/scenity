<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The banners across the top of the dock. A banner shows a state of the window, for example the play mode or the
 * restricted mode of a project, with an optional action.
 */
import { Button } from "@scenity/ui";
import type { WindowNotices } from "./dialogs";

const props = defineProps<{ notices: WindowNotices }>();
</script>

<template>
  <!-- The row is always in the window (empty when no banner shows), so the grid of the window keeps its rows. -->
  <div class="studio-banners" data-testid="studio-banners">
    <div
      v-for="banner in props.notices.state.banners"
      :key="banner.id"
      class="studio-banner"
      role="status"
      :data-tone="banner.tone"
      :data-banner="banner.id"
    >
      <span class="min-w-0 flex-1">{{ banner.text }}</span>
      <Button
        v-if="banner.action !== undefined"
        size="sm"
        :data-testid="banner.action.testId"
        @click="banner.action.run()"
      >
        {{ banner.action.label }}
      </Button>
    </div>
  </div>
</template>
