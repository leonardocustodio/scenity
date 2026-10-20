<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The curve widget of the inspector: a small picture of the curve and a row for each key or point. A key
 * has a time and a value; a point is a vector (the picture shows x and z from above). A change of a time sorts the
 * keys again. Add and remove are one step each; a drag of a number is one step at its end.
 *
 * The texts are Fluent messages of `src/i18n/en-US/inspector.ftl`. The label (the field name) and the column
 * names (the keys of the schema) are data.
 */
import { useI18n } from "@scenity/i18n";
import { addCurveItem, curvePoints, curvePolyline, removeItem, sortKeys, type WidgetModel } from "@scenity/editor-core";
import type { ComponentDefinition } from "@scenity/scene/components";
import { computed } from "vue";
import { useInspector, type FieldPath } from "./inspectorState";
import { button, fieldTestId, iconButton } from "./inspectorUi";
import NumberInput from "./NumberInput.vue";

const props = defineProps<{
  definition: ComponentDefinition;
  path: FieldPath;
  widget: Extract<WidgetModel, { kind: "curve" }>;
  value: unknown;
  mixed: boolean;
  label: string;
}>();

const inspector = useInspector();
const { $t } = useI18n();
const WIDTH = 240;
const HEIGHT = 48;
const testId = computed(() => fieldTestId(props.definition.id, props.path));
const items = computed(() => (Array.isArray(props.value) ? (props.value as unknown[]) : []));
const line = computed(() => curvePolyline(curvePoints(props.widget, props.value), WIDTH, HEIGHT));

/** The parts of a row: the time and the value of a key, or the axes of a point. */
const columns = computed(() =>
  props.widget.form === "keys"
    ? [props.widget.time, props.widget.value]
    : ["x", "y", "z", "w"].slice(0, props.widget.size).map((_, index) => String(index)),
);

function part(item: unknown, column: string): unknown {
  return Array.isArray(item) ? (item as unknown[])[Number(column)] : (item as Record<string, unknown>)[column];
}

/** The list with one number changed (and the keys sorted by time). */
function changed(index: number, column: string, number: number): unknown {
  const list = items.value.map((item, at) => {
    if (at !== index) return item;
    if (Array.isArray(item)) return (item as unknown[]).map((old, axis) => (String(axis) === column ? number : old));
    return { ...(item as Record<string, unknown>), [column]: number };
  });
  return sortKeys(props.widget, list);
}

const set = (value: unknown) => inspector.set(props.definition, props.path, value);
const dragTo = (value: unknown) => inspector.dragTo(props.definition, props.path, value);
</script>

<template>
  <div class="flex min-w-0 flex-1 flex-col gap-1" :data-testid="testId">
    <svg
      :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
      class="h-12 w-full rounded-control bg-surface-sunken"
      role="img"
      :aria-label="
        widget.form === 'keys'
          ? $t('inspector-curve-keys', { label, count: items.length })
          : $t('inspector-curve-points', { label, count: items.length })
      "
    >
      <polyline :points="line" fill="none" stroke="currentColor" stroke-width="1.5" class="text-accent-brand" />
    </svg>
    <p v-if="mixed" class="text-caption text-text-secondary">{{ $t("inspector-curve-mixed") }}</p>
    <div v-for="(item, index) in items" :key="index" class="flex items-center gap-1">
      <NumberInput
        v-for="column in columns"
        :key="column"
        :value="part(item, column)"
        :limits="{ step: column === 't' || column === 'time' ? 10 : 0.01 }"
        :grip="widget.form === 'keys' ? column : ['X', 'Y', 'Z', 'W'][Number(column)]"
        :label="`${label} ${index + 1} ${column}`"
        :test-id="`${testId}-${index}-${column}`"
        @commit="(next: number) => set(changed(index, column, next))"
        @drag-start="inspector.dragStart()"
        @drag-move="(next: number) => dragTo(changed(index, column, next))"
        @drag-end="inspector.dragEnd"
      />
      <button
        type="button"
        :class="iconButton"
        :aria-label="
          widget.form === 'keys'
            ? $t('inspector-curve-remove-key', { index: index + 1 })
            : $t('inspector-curve-remove-point', { index: index + 1 })
        "
        @click="set(removeItem(value, index))"
      >
        ×
      </button>
    </div>
    <button
      type="button"
      :class="[button, 'self-start']"
      :data-testid="`${testId}-add`"
      @click="set(addCurveItem(widget, value))"
    >
      {{ widget.form === "keys" ? $t("inspector-curve-add-key") : $t("inspector-curve-add-point") }}
    </button>
  </div>
</template>
