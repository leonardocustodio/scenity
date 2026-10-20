<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * A tool card of the transcript: the sentence of the call, its state, the first line of the result, the pictures of
 * the result, "Show in the scene" for the entities of the call, and a fold with the raw call (the input and the full
 * result).
 */
import { computed } from "vue";
import { useI18n } from "@scenity/i18n";
import { Crosshair } from "lucide-vue-next";
import type { AgentItem } from "./agentClient";
import { cardOf, type CardNames } from "./agentCards";

const props = defineProps<{
  item: Extract<AgentItem, { kind: "tool" }>;
  names: CardNames;
  known: (id: string) => boolean;
  show: ((ids: readonly string[]) => void) | null;
}>();
const { $t } = useI18n();
const card = computed(() => cardOf(props.item, props.names, props.known));
const raw = computed(() => JSON.stringify(props.item.input, null, 2));
const pictureUrl = (id: string): string => `/api/agent/pictures/${encodeURIComponent(id)}`;
</script>

<template>
  <article
    class="rounded-control border border-border-subtle px-2 py-1"
    data-testid="agent-card"
    :data-tool="item.name"
    :data-state="card.state"
    :data-error="item.isError || undefined"
  >
    <header class="flex items-center gap-2">
      <span class="min-w-0 flex-1 truncate font-medium" data-testid="agent-card-title">{{ card.title }}</span>
      <span class="flex-none text-text-secondary">{{ $t(`agent-card-state-${card.state}`) }}</span>
      <button
        v-if="show !== null && card.targets.length > 0"
        type="button"
        class="flex min-h-6 min-w-6 flex-none items-center justify-center rounded-control hover:bg-surface-sunken"
        :title="$t('agent-card-show-scene')"
        :aria-label="$t('agent-card-show-scene')"
        data-testid="agent-card-show"
        @click="show?.(card.targets)"
      >
        <Crosshair class="size-icon-sm" aria-hidden="true" />
      </button>
    </header>
    <pre
      v-if="card.output && item.result !== null"
      class="mt-1 max-h-48 overflow-auto rounded-control bg-surface-sunken p-1 whitespace-pre-wrap"
      translate="no"
      data-testid="agent-card-output"
      >{{ item.result }}</pre>
    <p
      v-else-if="card.outcome !== null && card.outcome !== ''"
      class="truncate text-text-secondary"
      :title="card.outcome"
    >
      {{ card.outcome }}
    </p>
    <div v-if="item.pictures.length > 0" class="mt-1 flex flex-wrap gap-1">
      <img
        v-for="id in item.pictures"
        :key="id"
        :src="pictureUrl(id)"
        :alt="$t('agent-card-picture')"
        class="max-h-32 rounded-control border border-border-subtle"
        data-testid="agent-card-picture"
      />
    </div>
    <details class="mt-1">
      <summary class="cursor-default text-text-secondary">{{ $t("agent-card-raw") }}</summary>
      <pre class="overflow-auto whitespace-pre-wrap text-text-secondary" translate="no" data-testid="agent-card-raw">{{
        `${item.name} ${raw}`
      }}</pre>
      <pre v-if="item.result !== null" class="overflow-auto whitespace-pre-wrap" translate="no">{{ item.result }}</pre>
    </details>
  </article>
</template>
