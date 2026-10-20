<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The settings tab of the bottom dock of the scene page. It shows the editor settings, each with its scope (the
 * settings file of the project or this browser) and the source of its value. It also shows the key map: the keys of
 * each command, a change by a key press, the reset to the default keys and the conflicts. The layout of the project
 * (the side panels and a reset) is also in the tab. Each change stays after a reload. The settings show in groups
 * under their headings, with the preferences of the studio host (HostPreferencesFields.vue) and a search over the
 * labels.
 *
 * The texts are Fluent messages of `src/i18n/en-US/settings.ftl`. The labels of the settings come from
 * `@scenity/editor-core` and stay in English. The IDs, the keys and the values of a setting are data values.
 */
import { pageTheme, THEMES, type ThemeName } from "../../studio/shell/theme";
import type { SettingPath } from "@scenity/editor-core";
import { useI18n } from "@scenity/i18n";
import { button, field, selectField } from "../inspector/inspectorUi";
import { computed, ref } from "vue";
import { messageIdOf, textOr } from "../../texts";
import HostPreferencesFields from "./HostPreferencesFields.vue";
import PluginSettingsFields from "./PluginSettingsFields.vue";
import PoolControls from "./PoolControls.vue";
import UsageLogFields from "../usage/UsageLogFields.vue";
import { keyLabel, useSettingsPanel } from "./useSettingsPanel";

const { $t } = useI18n();
const state = useSettingsPanel();
const { rows, commands, conflicted, error, notice, query, capture, layout, keymap, info } = state;

/** The value of a number, text or select field after a change. */
function onField(path: SettingPath, type: string, event: Event): void {
  const target = event.target as HTMLInputElement | HTMLSelectElement;
  if (type === "boolean") void state.setValue(path, (target as HTMLInputElement).checked);
  else if (type === "number") {
    const value = Number(target.value);
    if (target.value.trim() !== "" && Number.isFinite(value)) void state.setValue(path, value);
  } else void state.setValue(path, target.value);
}

/** The message of each source of a value. */
const SOURCE_TEXT = {
  project: () => $t("settings-source-project"),
  user: () => $t("settings-source-user"),
  default: () => $t("settings-source-default"),
} as const;
// The search of Preferences over the labels and the paths of the settings.
const find = ref("");
function matches(...texts: string[]): boolean {
  const words = find.value.trim().toLowerCase();
  return words === "" || texts.some((text) => text.toLowerCase().includes(words));
}
const labelOf = (row: (typeof rows.value)[number]): string =>
  textOr(messageIdOf("settings-field", row.field.path), row.field.label);
/** The rows that the search shows, with the heading of the group before the first row of each group. */
const shownRows = computed(() =>
  rows.value
    .filter((row) => matches(labelOf(row), row.field.path))
    .map((row, index, all) => {
      const group = row.field.path.split(".")[0] ?? "";
      return { row, heading: index === 0 || all[index - 1]?.field.path.split(".")[0] !== group ? group : null };
    }),
);
// The theme of the editor window (studio/shell/theme.ts).
const theme = pageTheme();
</script>

<template>
  <section
    class="flex min-h-0 gap-4 overflow-auto p-1.5 text-caption text-text-primary"
    :aria-label="$t('settings-panel')"
    data-testid="settings-panel"
    :data-loaded="info.loaded ? '1' : '0'"
  >
    <div class="flex w-80 shrink-0 flex-col gap-1">
      <h3 class="font-semibold">{{ $t("settings-editor") }}</h3>
      <p class="text-text-secondary">{{ $t("settings-intro", { file: info.file }) }}</p>
      <input
        v-model="find"
        type="search"
        :class="field"
        :placeholder="$t('settings-search')"
        :aria-label="$t('settings-search')"
        data-testid="settings-search"
      />
      <p v-if="error !== null" class="text-status-negative" role="alert" data-testid="settings-error">{{ error }}</p>
      <template v-for="{ row, heading } in shownRows" :key="row.field.path">
        <h4 v-if="heading !== null" class="mt-1 font-medium" :data-testid="`settings-group-${heading}`">
          {{ textOr(`settings-group-${heading}`, heading) }}
        </h4>
        <div class="grid grid-cols-[8rem_1fr_auto] items-center gap-1" :data-testid="`setting-row-${row.field.path}`">
          <!-- The label holds its control; "contents" keeps the label text and the control in the grid columns. -->
          <label :for="`setting-${row.field.path}`" class="contents">
            <span class="truncate" :title="$t('settings-field-title', { path: row.field.path })">{{
              textOr(messageIdOf("settings-field", row.field.path), row.field.label)
            }}</span>
            <select
              v-if="row.field.type === 'enum'"
              :id="`setting-${row.field.path}`"
              :class="selectField"
              :value="row.value"
              :data-testid="`setting-${row.field.path}`"
              @change="onField(row.field.path, row.field.type, $event)"
            >
              <option v-for="value in row.field.values ?? []" :key="value" :value="value" translate="no">
                {{ value }}
              </option>
            </select>
            <input
              v-else-if="row.field.type === 'boolean'"
              :id="`setting-${row.field.path}`"
              type="checkbox"
              :checked="row.value === true"
              :data-testid="`setting-${row.field.path}`"
              @change="onField(row.field.path, row.field.type, $event)"
            />
            <input
              v-else
              :id="`setting-${row.field.path}`"
              :class="field"
              :type="row.field.type === 'number' ? 'number' : 'text'"
              :min="row.field.min"
              :max="row.field.max"
              :step="row.field.step"
              :value="row.value"
              :data-testid="`setting-${row.field.path}`"
              @change="onField(row.field.path, row.field.type, $event)"
            />
          </label>
          <span class="flex items-center gap-1 whitespace-nowrap text-text-secondary">
            <span translate="no">{{ row.field.unit ?? "" }}</span>
            <span
              :title="row.field.scope === 'project' ? $t('settings-scope-project') : $t('settings-scope-user')"
              :data-testid="`setting-source-${row.field.path}`"
              :data-source="row.source"
              >{{ SOURCE_TEXT[row.source]() }}</span
            >
            <button
              type="button"
              :class="button"
              :disabled="row.source === 'default'"
              :title="$t('settings-reset-value')"
              :data-testid="`setting-reset-${row.field.path}`"
              @click="state.setValue(row.field.path, undefined)"
            >
              ↺
            </button>
          </span>
        </div>
      </template>
      <HostPreferencesFields :matches="matches" />
      <!-- The sections of the plugins. -->
      <PluginSettingsFields :matches="matches" scope="user" />
      <template v-if="matches($t('settings-theme'), $t('settings-theme-name'), $t('settings-contrast'))">
        <h3 class="mt-2 font-semibold">{{ $t("settings-theme") }}</h3>
        <label for="settings-theme" class="flex items-center gap-2">
          {{ $t("settings-theme-name") }}
          <select
            id="settings-theme"
            class="rounded-control border border-border-strong bg-surface-raised px-1.5 py-0.5"
            :value="theme.choice.value.theme"
            data-testid="settings-theme"
            @change="void theme.set({ theme: ($event.target as HTMLSelectElement).value as ThemeName })"
          >
            <option v-for="name in THEMES" :key="name" :value="name">{{ $t(`settings-theme-${name}`) }}</option>
          </select>
        </label>
        <label for="settings-contrast" class="flex items-center gap-1">
          <input
            id="settings-contrast"
            type="checkbox"
            :checked="theme.choice.value.contrast === 'more'"
            data-testid="settings-contrast"
            @change="void theme.set({ contrast: ($event.target as HTMLInputElement).checked ? 'more' : 'standard' })"
          />
          {{ $t("settings-contrast") }}
        </label>
      </template>
      <template v-if="matches($t('settings-layout'), $t('settings-layout-left'), $t('settings-layout-right'))">
        <h3 class="mt-2 font-semibold">{{ $t("settings-layout") }}</h3>
        <label for="settings-layout-left" class="flex items-center gap-1">
          <input
            id="settings-layout-left"
            type="checkbox"
            :checked="layout.leftOpen !== false"
            data-testid="layout-left"
            @change="state.setPanel('left', ($event.target as HTMLInputElement).checked)"
          />
          {{ $t("settings-layout-left") }}
        </label>
        <label for="settings-layout-right" class="flex items-center gap-1">
          <input
            id="settings-layout-right"
            type="checkbox"
            :checked="layout.rightOpen !== false"
            data-testid="layout-right"
            @change="state.setPanel('right', ($event.target as HTMLInputElement).checked)"
          />
          {{ $t("settings-layout-right") }}
        </label>
        <button
          type="button"
          :class="button"
          class="self-start"
          data-testid="layout-reset"
          @click="state.resetLayout()"
        >
          {{ $t("settings-layout-reset") }}
        </button>
      </template>
      <!-- Advanced: the scene pool of the machine. -->
      <PoolControls v-if="matches($t('settings-advanced'), $t('pool'), $t('pool-hint'))" class="mt-2" />
      <!-- The usage log of a study. -->
      <UsageLogFields v-if="matches($t('usage-title'), $t('usage-hint'))" class="mt-2" />
    </div>
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <div class="flex items-center gap-2">
        <h3 class="font-semibold">{{ $t("settings-keys") }}</h3>
        <input
          v-model="query"
          :class="field"
          class="max-w-60"
          :placeholder="$t('settings-keys-search')"
          data-testid="keymap-search"
        />
      </div>
      <p v-if="capture !== null" class="text-accent-brand" data-testid="keymap-capture">
        {{ $t("settings-keys-capture", { id: capture.id }) }}
      </p>
      <p v-if="notice !== null" class="text-status-warning" data-testid="keymap-notice">{{ notice }}</p>
      <ul v-if="keymap.conflicts.length > 0" class="text-status-negative" data-testid="keymap-conflicts">
        <!-- A conflict holds data values only: a key, command IDs and contexts. -->
        <li v-for="conflict in keymap.conflicts" :key="conflict.chord" translate="no">
          {{ keyLabel(conflict.chord) }}: {{ conflict.commands.join(", ") }} ({{ conflict.contexts.join(", ") }})
        </li>
      </ul>
      <div class="min-h-0 overflow-auto">
        <table class="w-full border-collapse">
          <tbody>
            <tr
              v-for="command in commands"
              :key="command.id"
              class="border-b border-border-subtle"
              :class="conflicted.has(command.id) && 'text-status-negative'"
              :data-testid="`key-row-${command.id}`"
              :data-keys="command.keys.join(' ')"
            >
              <td class="py-0.5 pr-2">
                {{ textOr(messageIdOf("settings-command", command.id), command.title) }}
                <span class="text-text-secondary" translate="no">{{ command.id }}</span>
              </td>
              <td class="pr-2 text-text-secondary" translate="no">{{ command.context }}</td>
              <td class="pr-2 whitespace-nowrap">
                <kbd
                  v-for="key in command.keys"
                  :key="key"
                  translate="no"
                  class="mr-1 rounded-control border border-border-subtle px-1"
                  >{{ keyLabel(key) }}</kbd
                >
                <span v-if="command.keys.length === 0" class="text-text-secondary">{{ $t("settings-keys-none") }}</span>
              </td>
              <td
                v-if="command.keyKind === 'modal'"
                class="text-text-secondary"
                :data-testid="`key-fixed-${command.id}`"
              >
                {{ $t("settings-keys-fixed") }}
              </td>
              <td v-else class="whitespace-nowrap">
                <button
                  type="button"
                  :class="button"
                  :data-testid="`key-change-${command.id}`"
                  @click="state.startCapture(command.id)"
                >
                  {{ $t("settings-keys-change") }}
                </button>
                <button
                  type="button"
                  :class="button"
                  :data-testid="`key-add-${command.id}`"
                  @click="state.startCapture(command.id, true)"
                >
                  {{ $t("settings-keys-add") }}
                </button>
                <button
                  type="button"
                  :class="button"
                  :disabled="command.keys.length === 0"
                  :data-testid="`key-clear-${command.id}`"
                  @click="state.setKeys(command.id, [])"
                >
                  {{ $t("settings-keys-clear") }}
                </button>
                <button
                  type="button"
                  :class="button"
                  :disabled="command.keys.join() === command.defaults.join()"
                  :data-testid="`key-reset-${command.id}`"
                  @click="state.setKeys(command.id, null)"
                >
                  {{ $t("settings-keys-reset") }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
