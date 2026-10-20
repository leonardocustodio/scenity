<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The preferences of the person on the studio host in Preferences. They are the language, the number of recent
 * projects, autosave, and the defaults of new agent sessions (the permission mode, the budget, the model and the
 * effort). The Hub shows the same values. Outside the studio, a note tells where the values are. `matches` gives the
 * search of Preferences: a field shows when its label has the search words.
 */
import { isDisplayLocale } from "@scenity/i18n";
import { useI18n } from "@scenity/i18n";
import { computed, ref } from "vue";
import { languageOptions } from "../../hub/look";
import type { AgentMode, Preferences } from "../../hub/studioApi";
import { hostPreferences } from "../../studio/shell/hostPreferences";
import { editorI18n } from "../../texts";
import { field, selectField } from "../inspector/inspectorUi";

const props = defineProps<{ matches: (...texts: string[]) => boolean }>();
const { $t } = useI18n();
const host = hostPreferences();
const preferences = host.value;
const error = ref<string | null>(null);
const MODES: readonly AgentMode[] = ["ask", "review", "auto"];

async function save(change: Partial<Preferences>): Promise<void> {
  error.value = await host.save(change);
}
function saveAgent(change: Partial<Preferences["agent"]>): void {
  const agent = preferences.value?.agent;
  if (agent !== undefined) void save({ agent: { ...agent, ...change } });
}
function onLanguage(event: Event): void {
  const locale = (event.target as HTMLSelectElement).value;
  if (!isDisplayLocale(locale)) return;
  editorI18n().setLocale(locale);
  void save({ locale });
}
/** A text of the agent defaults. An empty text removes the value. */
function onAgentText(key: "model" | "effort", event: Event): void {
  const agent = preferences.value?.agent;
  if (agent === undefined) return;
  const text = (event.target as HTMLInputElement).value.trim();
  const rest = Object.fromEntries(Object.entries(agent).filter(([name]) => name !== key)) as Preferences["agent"];
  void save({ agent: text === "" ? rest : { ...rest, [key]: text } });
}

const shows = computed(() => ({
  language: props.matches($t("hub-settings-language"), "locale"),
  recent: props.matches($t("hub-settings-recent")),
  autosave: props.matches($t("settings-autosave"), "autosave"),
  mode: props.matches($t("hub-agents-mode"), "agent"),
  budget: props.matches($t("hub-agents-budget"), "agent"),
  model: props.matches($t("settings-agent-model"), "agent"),
  effort: props.matches($t("settings-agent-effort"), "agent"),
}));
const any = computed(() => Object.values(shows.value).some(Boolean));
</script>

<template>
  <div v-if="any" class="flex flex-col gap-1" data-testid="settings-host">
    <h3 class="mt-2 font-semibold">{{ $t("settings-host") }}</h3>
    <p v-if="preferences === null" class="text-text-secondary" data-testid="settings-host-none">
      {{ $t("settings-host-none") }}
    </p>
    <div v-else class="grid grid-cols-[minmax(0,1fr)_10rem] items-center gap-1">
      <label v-if="shows.language" class="contents" for="settings-host-locale">
        <span>{{ $t("hub-settings-language") }}</span>
        <select
          id="settings-host-locale"
          :class="selectField"
          :value="preferences.locale"
          data-testid="settings-host-locale"
          @change="onLanguage"
        >
          <option v-for="option in languageOptions()" :key="option.value" :value="option.value" translate="no">
            {{ option.label }}
          </option>
        </select>
      </label>
      <label v-if="shows.recent" class="contents" for="settings-host-recent">
        <span>{{ $t("hub-settings-recent") }}</span>
        <input
          id="settings-host-recent"
          type="number"
          min="1"
          max="50"
          :class="field"
          :value="preferences.recentCount"
          data-testid="settings-host-recent"
          @change="
            save({ recentCount: Math.max(1, Math.min(50, Number(($event.target as HTMLInputElement).value) || 1)) })
          "
        />
      </label>
      <label v-if="shows.autosave" class="contents" for="settings-host-autosave">
        <span>{{ $t("settings-autosave") }}</span>
        <input
          id="settings-host-autosave"
          type="checkbox"
          class="justify-self-start"
          :checked="preferences.autosave"
          data-testid="settings-host-autosave"
          @change="save({ autosave: ($event.target as HTMLInputElement).checked })"
        />
      </label>
      <label v-if="shows.mode" class="contents" for="settings-host-mode">
        <span>{{ $t("hub-agents-mode") }}</span>
        <select
          id="settings-host-mode"
          :class="selectField"
          :value="preferences.agent.mode"
          data-testid="settings-host-mode"
          @change="saveAgent({ mode: ($event.target as HTMLSelectElement).value as AgentMode })"
        >
          <option v-for="mode in MODES" :key="mode" :value="mode">{{ $t(`hub-mode-${mode}`) }}</option>
        </select>
      </label>
      <label v-if="shows.budget" class="contents" for="settings-host-budget">
        <span>{{ $t("hub-agents-budget") }}</span>
        <input
          id="settings-host-budget"
          type="number"
          min="0"
          step="0.5"
          :class="field"
          :value="preferences.agent.budgetUsd"
          data-testid="settings-host-budget"
          @change="saveAgent({ budgetUsd: Math.max(0, Number(($event.target as HTMLInputElement).value) || 0) })"
        />
      </label>
      <label v-if="shows.model" class="contents" for="settings-host-model">
        <span>{{ $t("settings-agent-model") }}</span>
        <input
          id="settings-host-model"
          :class="field"
          :value="preferences.agent.model ?? ''"
          translate="no"
          data-testid="settings-host-model"
          @change="onAgentText('model', $event)"
        />
      </label>
      <label v-if="shows.effort" class="contents" for="settings-host-effort">
        <span>{{ $t("settings-agent-effort") }}</span>
        <input
          id="settings-host-effort"
          :class="field"
          :value="preferences.agent.effort ?? ''"
          translate="no"
          data-testid="settings-host-effort"
          @change="onAgentText('effort', $event)"
        />
      </label>
    </div>
    <p v-if="error !== null" class="text-status-negative" role="alert">{{ error }}</p>
  </div>
</template>
