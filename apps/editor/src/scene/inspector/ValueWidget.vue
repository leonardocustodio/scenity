<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The widget of one value of the inspector. It shows the widget of the model (`WidgetModel` of
 * `@scenity/editor-core`) and writes each change through the inspector state, at the path of the value. Numbers,
 * vectors, a quaternion (Euler degrees), a colour, an enum, a switch and a text are here; the references, curves,
 * lists, maps, objects, choices and JSON have their own widgets.
 *
 * The texts are Fluent messages of `src/i18n/en-US/inspector.ftl`. The label (the field name), the enum values
 * and the stored text are data: a field that holds only data has `translate="no"`.
 */
import { useI18n } from "@scenity/i18n";
import { colourHex, colourValue, eulerDegrees, mixedParts, quaternionOf, type WidgetModel } from "@scenity/editor-core";
import type { ComponentDefinition } from "@scenity/scene/components";
import type { Vec3 } from "@scenity/scene/math";
import { Switch } from "@scenity/ui";
import { computed } from "vue";
import ChoiceWidget from "./ChoiceWidget.vue";
import CurveWidget from "./CurveWidget.vue";
import { useInspector, type FieldPath } from "./inspectorState";
import { field, fieldTestId, MIXED, selectField } from "./inspectorUi";
import JsonWidget from "./JsonWidget.vue";
import ListWidget from "./ListWidget.vue";
import NumberInput from "./NumberInput.vue";
import ObjectWidget from "./ObjectWidget.vue";
import RefWidget from "./RefWidget.vue";

const props = defineProps<{
  definition: ComponentDefinition;
  path: FieldPath;
  widget: WidgetModel;
  value: unknown;
  /** The value of each subject (for the mixed parts of a vector). */
  values: readonly unknown[];
  mixed: boolean;
  label: string;
}>();

const inspector = useInspector();
const { $t } = useI18n();
const testId = computed(() => fieldTestId(props.definition.id, props.path));
const AXES = ["X", "Y", "Z", "W"];

const set = (value: unknown, path: FieldPath = props.path) => inspector.set(props.definition, path, value);
const dragTo = (value: unknown, path: FieldPath = props.path) => inspector.dragTo(props.definition, path, value);

/** The parts of a vector, and the parts where the subjects differ. */
const parts = computed(() => (Array.isArray(props.value) ? (props.value as unknown[]) : []));
const vectorMixed = computed(() => (props.widget.kind === "vector" ? mixedParts(props.values, props.widget.size) : []));

/** The Euler degrees of a quaternion, and the axes where the subjects differ. */
const degrees = computed(() => eulerDegrees(props.value));
const degreesMixed = computed(() => mixedParts(props.values.map(eulerDegrees), 3));
const turned = (axis: number, value: number): unknown => {
  const next: Vec3 = [...degrees.value];
  next[axis] = value;
  return quaternionOf(next);
};

const hex = computed(() => colourHex(props.value));
const onColour = (event: Event) => set(colourValue((event.target as HTMLInputElement).value, props.value));
const onHex = (event: Event) => {
  const text = (event.target as HTMLInputElement).value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(text)) set(colourValue(text, props.value));
};
const onSelect = (event: Event) => set((event.target as HTMLSelectElement).value);
const onText = (event: Event) => set((event.target as HTMLInputElement | HTMLTextAreaElement).value);
</script>

<template>
  <NumberInput
    v-if="widget.kind === 'number'"
    :value="value"
    :mixed="mixed"
    :limits="widget"
    :label="label"
    :test-id="testId"
    @commit="set"
    @drag-start="inspector.dragStart()"
    @drag-move="dragTo"
    @drag-end="inspector.dragEnd"
  />
  <span v-else-if="widget.kind === 'vector'" class="flex min-w-0 flex-1 gap-1">
    <NumberInput
      v-for="axis in widget.size"
      :key="axis"
      :value="parts[axis - 1]"
      :mixed="vectorMixed[axis - 1]"
      :limits="widget"
      :grip="AXES[axis - 1]"
      :label="`${label} ${AXES[axis - 1]}`"
      :test-id="`${testId}-${axis - 1}`"
      @commit="(next: number) => set(next, [...path, String(axis - 1)])"
      @drag-start="inspector.dragStart()"
      @drag-move="(next: number) => dragTo(next, [...path, String(axis - 1)])"
      @drag-end="inspector.dragEnd"
    />
  </span>
  <span v-else-if="widget.kind === 'quaternion'" class="flex min-w-0 flex-1 gap-1" :title="$t('inspector-angle-title')">
    <NumberInput
      v-for="axis in 3"
      :key="axis"
      :value="degrees[axis - 1]"
      :mixed="degreesMixed[axis - 1]"
      :limits="{ step: 1 }"
      :grip="AXES[axis - 1]"
      :label="$t('inspector-angle', { label, axis: AXES[axis - 1] ?? '' })"
      message
      :test-id="`${testId}-${axis - 1}`"
      @commit="(next: number) => set(turned(axis - 1, next))"
      @drag-start="inspector.dragStart()"
      @drag-move="(next: number) => dragTo(turned(axis - 1, next))"
      @drag-end="inspector.dragEnd"
    />
  </span>
  <span v-else-if="widget.kind === 'colour'" class="flex min-w-0 flex-1 items-center gap-1">
    <input
      type="color"
      class="h-7 w-9 shrink-0 cursor-pointer rounded-control border border-border-subtle bg-transparent"
      translate="no"
      :value="hex"
      :aria-label="label"
      :data-testid="testId"
      @change="onColour"
    />
    <input
      type="text"
      :class="field"
      :value="mixed ? '' : hex"
      :placeholder="mixed ? MIXED : $t('inspector-colour-placeholder')"
      :aria-label="$t('inspector-colour-hex', { label })"
      :data-testid="`${testId}-hex`"
      @change="onHex"
    />
  </span>
  <select
    v-else-if="widget.kind === 'enum'"
    :class="selectField"
    translate="no"
    :value="mixed ? '' : value"
    :aria-label="label"
    :data-testid="testId"
    @change="onSelect"
  >
    <option v-if="mixed" value="" disabled>{{ MIXED }}</option>
    <option v-for="option in widget.options" :key="option" :value="option">{{ option }}</option>
  </select>
  <Switch
    v-else-if="widget.kind === 'boolean'"
    :model-value="value === true"
    translate="no"
    :aria-label="label"
    :data-testid="testId"
    :data-mixed="mixed ? '1' : undefined"
    @update:model-value="(on: boolean) => set(on)"
  />
  <component
    :is="widget.multiline ? 'textarea' : 'input'"
    v-else-if="widget.kind === 'string'"
    :class="field"
    translate="no"
    :value="mixed ? '' : (value ?? '')"
    :placeholder="mixed ? MIXED : ''"
    :aria-label="label"
    :data-testid="testId"
    @change="onText"
  />
  <RefWidget
    v-else-if="widget.kind === 'assetRef' || widget.kind === 'entityRef'"
    :widget="widget"
    :value="value"
    :mixed="mixed"
    :label="label"
    :test-id="testId"
    @change="set"
  />
  <CurveWidget
    v-else-if="widget.kind === 'curve'"
    :definition="definition"
    :path="path"
    :widget="widget"
    :value="value"
    :mixed="mixed"
    :label="label"
  />
  <ListWidget
    v-else-if="widget.kind === 'list' || widget.kind === 'map'"
    :definition="definition"
    :path="path"
    :widget="widget"
    :value="value"
    :mixed="mixed"
    :label="label"
  />
  <ObjectWidget v-else-if="widget.kind === 'object'" :definition="definition" :path="path" :widget="widget" />
  <ChoiceWidget
    v-else-if="widget.kind === 'choice'"
    :definition="definition"
    :path="path"
    :widget="widget"
    :value="value"
    :values="values"
    :mixed="mixed"
    :label="label"
  />
  <JsonWidget v-else :value="value" :mixed="mixed" :label="label" :test-id="testId" @change="set" />
</template>
