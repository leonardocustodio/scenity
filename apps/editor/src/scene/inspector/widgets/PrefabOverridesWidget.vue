<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The widget of the overrides of a prefab instance (`prefab.overrides`): one row for each op on the prefab
 * document, as the entity of the prefab, the place of the value and the new value. Apply puts one override (with the
 * overrides of the same field) into the prefab, so each instance gets it. Revert removes one override (the value of
 * the prefab returns), and Revert all removes each override. Each revert is one undo step.
 * The entity IDs, the paths and the values are data (`translate="no"`).
 */
import { useI18n } from "@scenity/i18n";
import type { ComponentDefinition } from "@scenity/scene/components";
import { computed } from "vue";
import { useInspector, type FieldPath } from "../inspectorState";
import { button, fieldTestId } from "../inspectorUi";
import { overrideRows, overrideScope } from "./overrideRows";

const props = defineProps<{ definition: ComponentDefinition; path: FieldPath; value: unknown; label: string }>();
const { $t } = useI18n();
const inspector = useInspector();
const testId = computed(() => fieldTestId(props.definition.id, props.path));
const ops = computed(() => (Array.isArray(props.value) ? (props.value as unknown[]) : []));
const rows = computed(() => overrideRows(ops.value));

/** Apply the scope of one override to the prefab (the overrides of the same field go with it). */
function apply(index: number): void {
  const instance = inspector.selected.value[0];
  const scope = overrideScope(ops.value[index]);
  if (instance !== undefined && scope !== null) void inspector.prefabRun("prefab.apply", { instance, ...scope });
}

function revert(index: number): void {
  inspector.set(
    props.definition,
    props.path,
    ops.value.filter((_, at) => at !== index),
  );
}
</script>

<template>
  <div class="flex min-w-0 flex-1 flex-col gap-1" :data-testid="testId" :data-count="rows.length">
    <p v-if="rows.length === 0" class="text-caption text-text-secondary">{{ $t("inspector-overrides-none") }}</p>
    <div
      v-for="row in rows"
      :key="row.index"
      class="flex min-w-0 items-center gap-1 border-l-2 border-studio-override-bar pl-1"
      data-testid="inspector-override-row"
    >
      <span class="min-w-0 flex-1 truncate text-caption" :title="row.detail" translate="no">
        <span class="text-text-secondary">{{ row.kind }}</span> {{ row.place }}
        <span v-if="row.value !== null" class="text-text-secondary">= {{ row.value }}</span>
      </span>
      <button
        type="button"
        :class="[button, 'shrink-0']"
        :aria-label="$t('inspector-overrides-apply-one', { place: row.place })"
        :data-testid="`${testId}-apply-${row.index}`"
        @click="apply(row.index)"
      >
        {{ $t("inspector-overrides-apply") }}
      </button>
      <button
        type="button"
        :class="[button, 'shrink-0']"
        :aria-label="$t('inspector-overrides-revert-one', { place: row.place })"
        :data-testid="`${testId}-revert-${row.index}`"
        @click="revert(row.index)"
      >
        {{ $t("inspector-overrides-revert") }}
      </button>
    </div>
    <button
      v-if="rows.length > 1"
      type="button"
      :class="[button, 'self-start']"
      :data-testid="`${testId}-revert-all`"
      @click="inspector.set(definition, path, [])"
    >
      {{ $t("inspector-overrides-revert-all") }}
    </button>
  </div>
</template>
