<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The History panel: the undo stack, the oldest step first, with the actor of each step and
 * the steps of one agent turn in a group in the colour of its session. The step now has a mark; the undone steps are
 * pale. A click on a step goes to it in one action.
 */
import { computed } from "vue";
import { useI18n } from "@scenity/i18n";
import type { Actor } from "@scenity/editor-core";
import { actorColour } from "../actorColour";
import { historyGroups, type HistoryRow } from "./historyRows";

const props = defineProps<{ rows: () => readonly HistoryRow[]; goTo(index: number): void }>();
const { $t } = useI18n();
const groups = computed(() => historyGroups(props.rows()));

const actorName = (actor: Actor | null): string =>
  actor === null || actor.kind === "person" ? $t("history-person") : (actor.name ?? $t(`history-actor-${actor.kind}`));
const dot = (actor: Actor | null): Record<string, string> | undefined =>
  actor?.colour === undefined ? undefined : { background: actorColour(actor) };
</script>

<template>
  <section
    class="flex h-full min-h-0 flex-col text-caption"
    :aria-label="$t('panel-history')"
    data-testid="history-panel"
  >
    <ol class="min-h-0 flex-1 overflow-auto" :aria-label="$t('history-steps')">
      <li v-for="group in groups" :key="group.key" :data-set="group.set ?? undefined" data-testid="history-group">
        <p
          v-if="group.set !== null"
          class="flex items-center gap-1 px-2 pt-1 text-text-secondary"
          data-testid="history-group-head"
        >
          <span class="size-2 flex-none rounded-full bg-border-strong" :style="dot(group.actor)" aria-hidden="true" />
          {{ $t("history-turn", { name: actorName(group.actor), turn: group.actor?.turn ?? 0 }) }}
        </p>
        <ol>
          <li v-for="row in group.rows" :key="row.index">
            <button
              type="button"
              class="flex w-full items-center gap-2 border-b border-border-subtle px-2 py-1 text-left hover:bg-surface-sunken"
              :class="{ 'text-text-secondary': row.undone, 'font-semibold': row.current, 'pl-5': group.set !== null }"
              :aria-current="row.current ? 'step' : undefined"
              :data-index="row.index"
              :data-undone="row.undone ? '' : undefined"
              data-testid="history-step"
              @click="goTo(row.index)"
            >
              <span class="w-6 flex-none text-right text-text-secondary" translate="no">{{ row.index }}</span>
              <span class="min-w-0 flex-1 truncate">{{ row.title }}</span>
              <span class="flex w-28 flex-none items-center gap-1 truncate text-text-secondary">
                <span
                  class="size-2 flex-none rounded-full bg-border-strong"
                  :style="dot(row.actor)"
                  aria-hidden="true"
                />
                {{ actorName(row.actor) }}
              </span>
            </button>
          </li>
        </ol>
      </li>
    </ol>
  </section>
</template>
