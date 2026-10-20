<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The semantic diff view (semanticDiff.ts): the changes of a scene or a prefab by entity and
 * component, or of a sequence by track and key time. Each changed value shows its field, the old value and the new
 * value. A press on an entity name calls `select` when the view has it (the entity in the Scene view).
 */
import { useI18n } from "@scenity/i18n";
import { computed } from "vue";
import { valueText } from "../review/reviewModel";
import { changeCount, type ChangeState, type DocumentDiff } from "./semanticDiff";

const props = defineProps<{ diff: DocumentDiff; select?: (id: string) => void }>();
const { $t } = useI18n();
const count = computed(() => changeCount(props.diff));
const MARK: Readonly<Record<ChangeState, string>> = {
  added: "text-status-positive",
  removed: "text-status-negative",
  changed: "text-text-primary",
};
/** The key time in seconds with ms. */
const seconds = (t: number): string => `${(t / 1000).toFixed(3)} s`;
</script>

<template>
  <div class="flex flex-col gap-1 text-caption" data-testid="semantic-diff" :data-count="String(count)">
    <p v-if="count === 0" class="text-text-secondary">{{ $t("diff-view-none") }}</p>
    <ul v-if="diff.values.length > 0" class="flex flex-col">
      <li
        v-for="item in diff.values"
        :key="item.field"
        class="grid grid-cols-[10rem_1fr_1fr] gap-1"
        data-diff="top"
        :data-field="item.field"
      >
        <span translate="no">{{ item.field }}</span>
        <span class="text-status-negative line-through" translate="no">{{ valueText(item.before) }}</span>
        <span class="text-status-positive" translate="no">{{ valueText(item.after) }}</span>
      </li>
    </ul>
    <section
      v-for="entity in diff.entities"
      :key="entity.id"
      class="flex flex-col gap-0.5 border-l border-border-subtle pl-1.5"
      :data-entity="entity.id"
      :data-state="entity.state"
    >
      <div class="flex items-center gap-1">
        <button
          v-if="select !== undefined && entity.state !== 'removed'"
          type="button"
          class="font-medium hover:underline"
          :class="MARK[entity.state]"
          translate="no"
          @click="select(entity.id)"
        >
          {{ entity.name }}
        </button>
        <span v-else class="font-medium" :class="MARK[entity.state]" translate="no">{{ entity.name }}</span>
        <span class="text-text-secondary">{{ $t(`diff-view-${entity.state}`) }}</span>
      </div>
      <p v-if="entity.parent !== undefined" class="pl-1.5" data-diff="parent">
        {{
          $t("diff-view-parent", {
            before: entity.parent.before ?? $t("diff-view-root"),
            after: entity.parent.after ?? $t("diff-view-root"),
          })
        }}
      </p>
      <div
        v-for="item in entity.values"
        :key="item.field"
        class="grid grid-cols-[10rem_1fr_1fr] gap-1 pl-1.5"
        :data-field="item.field"
      >
        <span translate="no">{{ item.field }}</span>
        <span class="text-status-negative line-through" translate="no">{{ valueText(item.before) }}</span>
        <span class="text-status-positive" translate="no">{{ valueText(item.after) }}</span>
      </div>
      <div
        v-for="part in entity.components"
        :key="part.component"
        class="flex flex-col pl-1.5"
        :data-component="part.component"
        :data-state="part.state"
      >
        <span :class="MARK[part.state]">
          <span translate="no">{{ part.component }}</span>
          <span v-if="part.state !== 'changed'" class="text-text-secondary"> {{ $t(`diff-view-${part.state}`) }}</span>
        </span>
        <div
          v-for="item in part.values"
          :key="item.field"
          class="grid grid-cols-[10rem_1fr_1fr] gap-1 pl-1.5"
          :data-field="`${part.component}.${item.field}`"
        >
          <span translate="no">{{ item.field }}</span>
          <span class="text-status-negative line-through" translate="no">{{ valueText(item.before) }}</span>
          <span class="text-status-positive" translate="no">{{ valueText(item.after) }}</span>
        </div>
      </div>
    </section>
    <section
      v-for="track in diff.tracks"
      :key="track.track"
      class="flex flex-col gap-0.5 border-l border-border-subtle pl-1.5"
      :data-track="track.track"
      :data-state="track.state"
    >
      <div class="flex items-center gap-1">
        <span class="font-medium" :class="MARK[track.state]" translate="no">{{ track.track }}</span>
        <span class="text-text-secondary">{{ $t(`diff-view-${track.state}`) }}</span>
      </div>
      <div
        v-for="item in track.values"
        :key="item.field"
        class="grid grid-cols-[10rem_1fr_1fr] gap-1 pl-1.5"
        :data-field="item.field"
      >
        <span translate="no">{{ item.field }}</span>
        <span class="text-status-negative line-through" translate="no">{{ valueText(item.before) }}</span>
        <span class="text-status-positive" translate="no">{{ valueText(item.after) }}</span>
      </div>
      <div
        v-for="key in track.keys"
        :key="`${key.t}-${key.state}`"
        class="flex flex-col pl-1.5"
        :data-key-time="String(key.t)"
        :data-state="key.state"
      >
        <span :class="MARK[key.state]">
          {{ $t("diff-view-key", { time: seconds(key.t) }) }}
          <span v-if="key.state !== 'changed'" class="text-text-secondary"> {{ $t(`diff-view-${key.state}`) }}</span>
        </span>
        <div
          v-for="item in key.values"
          :key="item.field"
          class="grid grid-cols-[10rem_1fr_1fr] gap-1 pl-1.5"
          :data-field="item.field"
        >
          <span translate="no">{{ item.field }}</span>
          <span class="text-status-negative line-through" translate="no">{{ valueText(item.before) }}</span>
          <span class="text-status-positive" translate="no">{{ valueText(item.after) }}</span>
        </div>
      </div>
    </section>
  </div>
</template>
