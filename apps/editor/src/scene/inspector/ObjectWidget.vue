<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The widget of a nested object of the inspector: a row for each field of the object, as the fields of a
 * component, at the path of the object.
 */
import type { WidgetModel } from "@scenity/editor-core";
import type { ComponentDefinition } from "@scenity/scene/components";
import FieldRow from "./FieldRow.vue";
import type { FieldPath } from "./inspectorState";

defineProps<{
  definition: ComponentDefinition;
  path: FieldPath;
  widget: Extract<WidgetModel, { kind: "object" }>;
}>();
</script>

<template>
  <div class="flex min-w-0 flex-1 flex-col gap-1 border-l border-border-subtle pl-2">
    <FieldRow
      v-for="item in widget.fields"
      :key="item.key"
      :definition="definition"
      :field="item"
      :path="[...path, item.key]"
      nested
    />
  </div>
</template>
