<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The settings of the Hub: the theme, the contrast, the language and the number of recent projects (the preferences
 * of the user state on the host), and the doctor of this machine.
 */
import { computed } from "vue";
import { useI18n } from "@scenity/i18n";
import { Select, Switch } from "@scenity/ui";
import DoctorList from "./DoctorList.vue";
import { changeLanguage, languageOptions, THEMES } from "./look";
import type { Preferences } from "./studioApi";
import type { Hub } from "./useHub";

const props = defineProps<{ hub: Hub }>();
const { $t } = useI18n();
const preferences = computed(() => props.hub.state.studio?.preferences ?? null);

const themes = () => THEMES.map((value) => ({ value, label: $t(`hub-theme-${value}`) }));

function save(change: Partial<Preferences>): void {
  void props.hub.savePreferences(change);
}
</script>

<template>
  <div v-if="preferences !== null" class="flex max-w-3xl flex-col gap-8" data-testid="hub-settings">
    <section class="grid grid-cols-[12rem_1fr] items-center gap-4">
      <span id="settings-theme" class="text-label">{{ $t("hub-settings-theme") }}</span>
      <Select
        :model-value="preferences.theme"
        :options="themes()"
        aria-labelledby="settings-theme"
        class="w-56"
        data-testid="settings-theme"
        @update:model-value="save({ theme: $event as Preferences['theme'] })"
      />
      <span id="settings-contrast" class="text-label">{{ $t("hub-settings-contrast") }}</span>
      <Switch
        :model-value="preferences.contrast === 'more'"
        aria-labelledby="settings-contrast"
        @update:model-value="save({ contrast: $event ? 'more' : 'standard' })"
      />
      <span id="settings-language" class="text-label">{{ $t("hub-settings-language") }}</span>
      <Select
        :model-value="preferences.locale"
        :options="languageOptions()"
        aria-labelledby="settings-language"
        translate="no"
        class="w-56"
        @update:model-value="changeLanguage(props.hub, $event)"
      />
      <label for="settings-recent" class="contents">
        <span class="text-label">{{ $t("hub-settings-recent") }}</span>
        <input
          id="settings-recent"
          type="number"
          min="1"
          max="50"
          :value="preferences.recentCount"
          class="min-h-10 w-24 rounded-control border border-border-strong bg-surface-raised px-3 text-body"
          @change="
            save({ recentCount: Math.max(1, Math.min(50, Number(($event.target as HTMLInputElement).value) || 1)) })
          "
        />
      </label>
    </section>
    <DoctorList :hub="props.hub" />
  </div>
</template>
