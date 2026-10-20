<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Activity panel (the `activity` panel). It shows each run of a command as one line, the newest first. A line
 * shows the time, the actor (an agent with the colour of its session), the title, the outcome, and the call. A line
 * copies as a call of the script API or as a prompt for an agent.
 */
import { computed } from "vue";
import { useI18n } from "@scenity/i18n";
import { Copy, MessageSquareText } from "lucide-vue-next";
import { actorColour } from "../actorColour";
import { promptText, scriptText, type ActivityEntry, type ActivityLog } from "./activityLog";
import EmptyState from "../../studio/shell/EmptyState.vue";

const props = defineProps<{ log: ActivityLog }>();
const { $t } = useI18n();
const lines = computed(() => [...props.log.entries.value].reverse());

const time = (at: number): string => new Date(at).toLocaleTimeString();
const actorName = (entry: ActivityEntry): string =>
  entry.actor.kind === "person" ? $t("activity-person") : (entry.actor.name ?? $t(`activity-${entry.actor.kind}`));

function copy(text: string): void {
  void navigator.clipboard.writeText(text);
}
</script>

<template>
  <section
    class="flex h-full min-h-0 flex-col text-caption"
    :aria-label="$t('panel-activity')"
    data-testid="activity-panel"
  >
    <EmptyState v-if="lines.length === 0" panel="activity" :text="$t('activity-empty')" />
    <ol class="min-h-0 flex-1 overflow-auto" :aria-label="$t('activity-lines')">
      <li
        v-for="entry in lines"
        :key="entry.id"
        class="flex items-center gap-2 border-b border-border-subtle px-2 py-1"
        data-testid="activity-line"
        :data-command="entry.command"
        :data-outcome="entry.outcome"
      >
        <span class="w-20 flex-none text-text-secondary" translate="no">{{ time(entry.at) }}</span>
        <span class="flex w-32 flex-none items-center gap-1 truncate">
          <span
            class="size-2 flex-none rounded-full bg-border-strong"
            :style="entry.actor.colour === undefined ? undefined : { background: actorColour(entry.actor) }"
            aria-hidden="true"
          />
          {{ actorName(entry) }}
        </span>
        <span class="min-w-0 flex-1 truncate">{{ entry.title }}</span>
        <span class="flex-none text-text-secondary">{{ $t(`activity-outcome-${entry.outcome}`) }}</span>
        <button
          type="button"
          class="flex-none rounded-control p-1 hover:bg-surface-sunken"
          :title="$t('activity-copy-script')"
          :aria-label="$t('activity-copy-script')"
          data-testid="activity-copy-script"
          @click="copy(scriptText(entry))"
        >
          <Copy class="size-icon-sm" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="flex-none rounded-control p-1 hover:bg-surface-sunken"
          :title="$t('activity-copy-prompt')"
          :aria-label="$t('activity-copy-prompt')"
          data-testid="activity-copy-prompt"
          @click="copy(promptText(entry))"
        >
          <MessageSquareText class="size-icon-sm" aria-hidden="true" />
        </button>
      </li>
    </ol>
  </section>
</template>
