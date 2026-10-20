<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Sessions tab with its parts: the Claude sessions of the checkout (Sessions.vue), the background runs, the
 * experiment log and the settings of the checkout. A switch at the top shows one part.
 */
import { ref } from "vue";
import { tab } from "../layout/ui";
import BackgroundRuns from "./BackgroundRuns.vue";
import CheckoutOptions from "./CheckoutOptions.vue";
import type { DockHost } from "./dockHost";
import ExperimentLog from "./ExperimentLog.vue";
import Sessions from "./Sessions.vue";

defineOptions({ name: "DockSessionsTabs" });
defineProps<{ readonly dock: DockHost }>();

const PARTS = [
  { id: "sessions", label: "Claude sessions" },
  { id: "background", label: "Background runs" },
  { id: "log", label: "Experiment log" },
  { id: "settings", label: "Checkout settings" },
] as const;
type Part = (typeof PARTS)[number]["id"];
const part = ref<Part>("sessions");
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-2">
    <nav class="flex items-center gap-0.5" aria-label="Sessions parts">
      <button
        v-for="item in PARTS"
        :key="item.id"
        type="button"
        :class="tab(part === item.id)"
        :aria-pressed="part === item.id"
        :data-testid="`sessions-part-${item.id}`"
        @click="part = item.id"
      >
        {{ item.label }}
      </button>
    </nav>
    <div class="min-h-0 flex-1">
      <Sessions v-if="part === 'sessions'" :dock="dock" />
      <BackgroundRuns v-else-if="part === 'background'" :dock="dock" />
      <ExperimentLog v-else-if="part === 'log'" :dock="dock" />
      <CheckoutOptions v-else :dock="dock" />
    </div>
  </div>
</template>
