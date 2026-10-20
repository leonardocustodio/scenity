<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * One inspector of the dock: the panel of the selection, or of the entities that the lock
 * keeps (a locked inspector does not follow the selection), and the raw JSON switch. Each copy of the panel
 * ("Inspector 2") has its own lock and its own switch in the state of the panel, so the layout keeps them and two
 * locked inspectors show two entities.
 */
import { useI18n } from "@scenity/i18n";
import { Braces, Lock, LockOpen } from "lucide-vue-next";
import { computed } from "vue";
import { usePanelState } from "../../studio/extensions/api";
import InspectorPanel from "./InspectorPanel.vue";
import type { InspectorState } from "./inspectorState";
import { iconButton } from "./inspectorUi";

const props = defineProps<{
  state: InspectorState;
  /** A state that keeps some entities (the lock). */
  locked(ids: readonly string[]): InspectorState;
}>();
const { $t } = useI18n();

const lock = usePanelState<string[] | null>("locked", null);
const raw = usePanelState<boolean>("raw", false);
const kept = computed(() => (lock.value === null ? null : props.locked(lock.value)));
const shown = computed(() => kept.value ?? props.state);

function toggleLock(): void {
  lock.value = lock.value === null ? [...props.state.selected.value] : null;
}
</script>

<template>
  <div class="flex flex-col gap-1" :data-locked="lock === null ? undefined : '1'" data-testid="inspector-host">
    <div class="flex justify-end gap-0.5">
      <button
        type="button"
        :class="iconButton"
        :aria-pressed="raw"
        :aria-label="$t('inspector-raw')"
        :title="$t('inspector-raw')"
        data-testid="inspector-raw"
        @click="raw = !raw"
      >
        <Braces class="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        :class="iconButton"
        :aria-pressed="lock !== null"
        :aria-label="lock === null ? $t('inspector-lock') : $t('inspector-unlock')"
        :title="lock === null ? $t('inspector-lock') : $t('inspector-unlock')"
        data-testid="inspector-lock"
        @click="toggleLock"
      >
        <Lock v-if="lock !== null" class="size-3.5" aria-hidden="true" />
        <LockOpen v-else class="size-3.5" aria-hidden="true" />
      </button>
    </div>
    <InspectorPanel :key="lock?.join(',') ?? 'selection'" :state="shown" :raw="raw" />
  </div>
</template>
