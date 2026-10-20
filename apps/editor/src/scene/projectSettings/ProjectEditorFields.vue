<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Editor section of the Project settings window: the project values of the editor settings (the snaps and the grid
 * of `scenity.editor.json`). A change goes to the project file of the editor settings immediately, as in Preferences.
 */
import type { SettingPath } from "@scenity/editor-core";
import { useI18n } from "@scenity/i18n";
import { computed } from "vue";
import { field, selectField } from "../inspector/inspectorUi";
import { useSettingsPanel } from "../settings/useSettingsPanel";
import { messageIdOf, textOr } from "../../texts";

const { $t } = useI18n();
const state = useSettingsPanel();
const rows = computed(() => state.rows.value.filter((row) => row.field.scope === "project"));

function onField(path: SettingPath, type: string, event: Event): void {
  const target = event.target as HTMLInputElement | HTMLSelectElement;
  if (type === "boolean") void state.setValue(path, (target as HTMLInputElement).checked);
  else if (type === "number") {
    const value = Number(target.value);
    if (target.value.trim() !== "" && Number.isFinite(value)) void state.setValue(path, value);
  } else void state.setValue(path, target.value);
}
</script>

<template>
  <div class="flex flex-col gap-1" data-testid="project-editor-fields">
    <p class="text-text-secondary">{{ $t("project-editor-intro", { file: state.info.value.file }) }}</p>
    <p v-if="state.error.value !== null" class="text-status-negative" role="alert">{{ state.error.value }}</p>
    <div
      v-for="row in rows"
      :key="row.field.path"
      class="grid grid-cols-[12rem_minmax(0,1fr)] items-center gap-1"
      :data-testid="`project-setting-${row.field.path}`"
    >
      <!-- The label holds its control; "contents" keeps the label text and the control in the grid columns. -->
      <label class="contents" :for="`project-setting-${row.field.path}`">
        <span class="truncate">{{ textOr(messageIdOf("settings-field", row.field.path), row.field.label) }}</span>
        <select
          v-if="row.field.type === 'enum'"
          :id="`project-setting-${row.field.path}`"
          :class="selectField"
          :value="row.value"
          @change="onField(row.field.path, row.field.type, $event)"
        >
          <option v-for="value in row.field.values ?? []" :key="value" :value="value" translate="no">
            {{ value }}
          </option>
        </select>
        <input
          v-else-if="row.field.type === 'boolean'"
          :id="`project-setting-${row.field.path}`"
          type="checkbox"
          class="justify-self-start"
          :checked="row.value === true"
          @change="onField(row.field.path, row.field.type, $event)"
        />
        <input
          v-else
          :id="`project-setting-${row.field.path}`"
          :class="field"
          :type="row.field.type === 'number' ? 'number' : 'text'"
          :min="row.field.min"
          :max="row.field.max"
          :step="row.field.step"
          :value="row.value"
          @change="onField(row.field.path, row.field.type, $event)"
        />
      </label>
    </div>
  </div>
</template>
