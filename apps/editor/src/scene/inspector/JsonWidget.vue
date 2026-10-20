<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The JSON widget of the inspector: a value that no other widget fits (for example an override list of a
 * prefab instance) shows as its JSON text; a change writes the parsed value, and a text that does not parse shows
 * the error and writes nothing.
 *
 * The placeholder is a Fluent message of `src/i18n/en-US/inspector.ftl`. The JSON text and the label (the field
 * name) are data, so the field has `translate="no"`.
 */
import { useI18n } from "@scenity/i18n";
import { jsonText, parseJson } from "@scenity/editor-core";
import { computed, ref } from "vue";
import { field, MIXED } from "./inspectorUi";

const props = defineProps<{ value: unknown; mixed: boolean; label: string; testId: string }>();
const emit = defineEmits<{ change: [value: unknown] }>();
const { $t } = useI18n();

const text = computed(() => (props.mixed ? "" : jsonText(props.value)));
const problem = ref<string | null>(null);

function onChange(event: Event): void {
  const parsed = parseJson((event.target as HTMLTextAreaElement).value);
  problem.value = parsed.ok ? null : parsed.reason;
  if (parsed.ok) emit("change", parsed.value);
}
</script>

<template>
  <span class="flex min-w-0 flex-1 flex-col gap-0.5">
    <textarea
      :class="[field, 'min-h-12 font-mono']"
      translate="no"
      :value="text"
      :placeholder="mixed ? MIXED : $t('inspector-json-placeholder')"
      :aria-label="label"
      :data-testid="testId"
      spellcheck="false"
      @change="onChange"
    />
    <span v-if="problem !== null" class="text-caption text-text-secondary" role="alert">{{ problem }}</span>
  </span>
</template>
