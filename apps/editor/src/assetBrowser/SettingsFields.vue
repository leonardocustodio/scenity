<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The fields of the settings form of an importer: a flag, a choice or a text for each
 * field of `settingsForm.ts`, and the fields of more parts under "More". The import dialog and the import again of the
 * asset inspector show it. The texts stay with the parent, so a change emits the new text of the field.
 */
import { useI18n } from "@scenity/i18n";
import type { SettingField } from "./settingsForm";

const props = defineProps<{
  fields: readonly SettingField[];
  /** The text of each field (a field with no text shows its default). */
  texts: Readonly<Record<string, string>>;
  /** The start of the element IDs (unique on the page). */
  idPrefix: string;
}>();
const emit = defineEmits<{ set: [name: string, value: string] }>();
const { $t } = useI18n();
const fieldId = (name: string): string => `${props.idPrefix}-${name}`;
const textOf = (field: SettingField): string => props.texts[field.name] ?? field.fallback;
const input = "h-7 rounded-control border border-border-subtle bg-surface-sunken px-1.5 text-caption text-text-primary";
</script>

<template>
  <template v-for="advanced in [false, true]" :key="String(advanced)">
    <component
      :is="advanced ? 'details' : 'div'"
      v-if="fields.some((item) => item.advanced === advanced)"
      class="flex flex-col gap-1"
    >
      <summary v-if="advanced" class="cursor-pointer">{{ $t("assets-import-more") }}</summary>
      <label
        v-for="field in fields.filter((item) => item.advanced === advanced)"
        :key="field.name"
        class="flex items-center gap-1"
        :title="field.description"
        :for="fieldId(field.name)"
      >
        <span class="w-28 shrink-0 font-mono" translate="no">{{ field.name }}</span>
        <input
          v-if="field.kind === 'boolean'"
          :id="fieldId(field.name)"
          type="checkbox"
          :checked="textOf(field) === 'true'"
          :data-testid="`import-setting-${field.name}`"
          @change="emit('set', field.name, String(($event.target as HTMLInputElement).checked))"
        />
        <select
          v-else-if="field.kind === 'choice'"
          :id="fieldId(field.name)"
          :class="input"
          :value="textOf(field)"
          :data-testid="`import-setting-${field.name}`"
          @change="emit('set', field.name, ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="choice in field.choices" :key="choice" :value="choice" translate="no">{{ choice }}</option>
        </select>
        <input
          v-else
          :id="fieldId(field.name)"
          type="text"
          :class="[input, field.kind === 'json' ? 'w-56 font-mono' : 'w-28']"
          :value="textOf(field)"
          :placeholder="field.choices.join(' · ')"
          :data-testid="`import-setting-${field.name}`"
          @change="emit('set', field.name, ($event.target as HTMLInputElement).value)"
        />
      </label>
    </component>
  </template>
</template>
