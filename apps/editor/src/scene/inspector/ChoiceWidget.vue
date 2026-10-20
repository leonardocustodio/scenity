<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The widget of a value with some forms: a light target is a point or an entity, a fog is linear or exp2.
 * The select shows the form of the value; a new form writes the first value of that form.
 *
 * The form names are Fluent messages of `src/i18n/en-US/inspector.ftl`. The tag of an object form (an enum
 * value of the schema) is data (`translate="no"`).
 */
import { choiceIndex, initialValue, type WidgetModel } from "@scenity/editor-core";
import { useI18n } from "@scenity/i18n";
import type { ComponentDefinition } from "@scenity/scene/components";
import { computed } from "vue";
import { useInspector, type FieldPath } from "./inspectorState";
import { fieldTestId, selectField } from "./inspectorUi";
import ValueWidget from "./ValueWidget.vue";

const props = defineProps<{
  definition: ComponentDefinition;
  path: FieldPath;
  widget: Extract<WidgetModel, { kind: "choice" }>;
  value: unknown;
  values: readonly unknown[];
  mixed: boolean;
  label: string;
}>();

const inspector = useInspector();
const { $t } = useI18n();

/** The message ID of the name of each form kind (the kinds that `formLabel` of `@scenity/editor-core` names). */
const FORM_NAMES: Partial<Record<WidgetModel["kind"], string>> = {
  object: "inspector-form-object",
  vector: "inspector-form-vector",
  entityRef: "inspector-form-entity",
  assetRef: "inspector-form-asset",
  colour: "inspector-form-colour",
  number: "inspector-form-number",
  string: "inspector-form-text",
  boolean: "inspector-form-switch",
  list: "inspector-form-list",
  map: "inspector-form-map",
  curve: "inspector-form-curve",
};

/** The name of a form: the tag of an object form (data, `data: true`), else the message of its kind. */
function formName(option: WidgetModel): { text: string; data: boolean } {
  if (option.kind === "object") {
    const tag = option.fields.find((item) => item.widget.kind === "enum" && item.widget.options.length === 1);
    const value = tag?.widget.kind === "enum" ? tag.widget.options[0] : undefined;
    if (value !== undefined) return { text: value, data: true };
  }
  const id = FORM_NAMES[option.kind];
  return id === undefined ? { text: option.kind, data: true } : { text: $t(id), data: false };
}
const index = computed(() => choiceIndex(props.widget, props.value));
const form = computed(() => props.widget.options[index.value] ?? { kind: "json" as const });

function onForm(event: Event): void {
  const option = props.widget.options[Number((event.target as HTMLSelectElement).value)];
  if (option !== undefined) inspector.set(props.definition, props.path, initialValue(option, inspector.choices.value));
}
</script>

<template>
  <div class="flex min-w-0 flex-1 flex-col gap-1">
    <select
      :class="selectField"
      :value="value === undefined ? '' : String(index)"
      :aria-label="$t('inspector-form', { label })"
      :data-testid="`${fieldTestId(definition.id, path)}-form`"
      @change="onForm"
    >
      <option value="" disabled>{{ $t("inspector-form-none") }}</option>
      <option
        v-for="(option, at) in widget.options"
        :key="at"
        :value="String(at)"
        :translate="formName(option).data ? 'no' : undefined"
      >
        {{ formName(option).text }}
      </option>
    </select>
    <ValueWidget
      v-if="value !== undefined"
      :definition="definition"
      :path="path"
      :widget="form"
      :value="value"
      :values="values"
      :mixed="mixed"
      :label="label"
    />
  </div>
</template>
