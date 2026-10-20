<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The checkpoint line of a prompt: the state at the start of the turn. Preview lists the changes since the checkpoint
 * (the entities of this window and the files of the turns). It also shows the scene of the checkpoint in the view.
 * Restore returns the scene and the files to the checkpoint as one step that undo reverts. It keeps the conversation.
 */
import { computed, ref } from "vue";
import { useI18n } from "@scenity/i18n";
import { History } from "lucide-vue-next";
import type { AgentStore } from "./agentStore";
import { checkpointPreviewKey } from "./agentWindow";

const props = defineProps<{ store: AgentStore; session: string; turn: number; at: number; running: boolean }>();
const { $t } = useI18n();
const open = ref(false);
const entities = ref<string[] | null>(null);
const files = ref<string[]>([]);
const key = computed(() => checkpointPreviewKey(props.session, props.turn));
const showing = computed(() => props.store.context?.previewKey() === key.value);
const time = computed(() => new Date(props.at).toLocaleTimeString());

async function toggle(): Promise<void> {
  open.value = !open.value;
  if (!open.value) {
    if (showing.value) props.store.context?.previewCheckpoint(props.session, props.turn, false);
    return;
  }
  entities.value = props.store.context?.checkpointDiff(props.session, props.turn) ?? null;
  files.value = await props.store.filesSince(props.turn);
}

function view(on: boolean): void {
  props.store.context?.previewCheckpoint(props.session, props.turn, on);
}

async function restore(): Promise<void> {
  if (showing.value) view(false);
  open.value = false;
  await props.store.restore(props.turn);
}
</script>

<template>
  <div class="flex flex-col gap-1 text-text-secondary" data-testid="agent-checkpoint" :data-turn="turn">
    <div class="flex items-center gap-2">
      <History class="size-icon-sm flex-none" aria-hidden="true" />
      <span class="min-w-0 flex-1 truncate">{{ $t("agent-checkpoint", { time }) }}</span>
      <button
        type="button"
        class="rounded-control px-2 hover:bg-surface-sunken"
        :aria-expanded="open"
        data-testid="agent-checkpoint-preview"
        @click="toggle"
      >
        {{ $t("agent-checkpoint-preview") }}
      </button>
      <button
        type="button"
        class="rounded-control px-2 hover:bg-surface-sunken disabled:opacity-(--sc-opacity-disabled)"
        :disabled="running"
        data-testid="agent-checkpoint-restore"
        @click="restore"
      >
        {{ $t("agent-checkpoint-restore") }}
      </button>
    </div>
    <div v-if="open" class="rounded-control border border-border-subtle p-2" data-testid="agent-checkpoint-diff">
      <p v-if="entities === null">{{ $t("agent-checkpoint-no-scene") }}</p>
      <p v-else-if="entities.length === 0 && files.length === 0">{{ $t("agent-checkpoint-same") }}</p>
      <p v-if="entities !== null && entities.length > 0" data-testid="agent-checkpoint-entities">
        {{ $t("agent-checkpoint-entities", { list: entities.join(", ") }) }}
      </p>
      <p v-if="files.length > 0" data-testid="agent-checkpoint-files">
        {{ $t("agent-checkpoint-files", { list: files.join(", ") }) }}
      </p>
      <span v-if="entities !== null" class="mt-1 flex items-center gap-2">
        <input
          type="checkbox"
          :checked="showing"
          :aria-label="$t('agent-checkpoint-view')"
          data-testid="agent-checkpoint-view"
          @change="view(($event.target as HTMLInputElement).checked)"
        />
        <span aria-hidden="true">{{ $t("agent-checkpoint-view") }}</span>
      </span>
    </div>
  </div>
</template>
