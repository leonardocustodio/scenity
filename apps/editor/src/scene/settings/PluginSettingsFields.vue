<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The sections of the plugins in Preferences or in Project settings (the `settings` point of a studio face, by its
 * scope). Each section is a form from the JSON Schema of the values of a plugin (the form of Project settings), with
 * the values of the person. `matches` gives the search of Preferences: a section shows when its title has the search
 * words.
 */
import { computed } from "vue";
import FormNodeView from "../projectSettings/FormNodeView.vue";
import { checkValue, pathText, projectNode, setIn, type PathStep } from "../projectSettings/projectForm";
import { PLUGIN_SETTINGS, type PluginSettingsSection } from "../../studio/extensions/pluginSettings";
import { t } from "../../texts";

const props = defineProps<{
  matches: (...texts: string[]) => boolean;
  /** The scope of the sections: Preferences ("user") or Project settings ("project"). */
  scope: "user" | "project";
}>();
const sections = computed(() =>
  PLUGIN_SETTINGS.filter(
    (section) => section.scope === props.scope && props.matches(section.title(), section.plugin),
  ).map((section) => {
    const node = projectNode(section.schema);
    const problems = new Map<string, string[]>();
    for (const problem of checkValue(node, section.store.ref.value)) {
      const at = problem.path === "" ? pathText([]) : problem.path;
      problems.set(at, [...(problems.get(at) ?? []), t(problem.id, problem.args)]);
    }
    return { section, node, problems };
  }),
);
function set(section: PluginSettingsSection, path: readonly PathStep[], value: unknown): void {
  section.store.set(setIn(section.store.value(), path, value) as Readonly<Record<string, unknown>>);
}
</script>

<template>
  <div
    v-for="{ section, node, problems } in sections"
    :key="section.plugin"
    :data-testid="`settings-plugin-${section.plugin}`"
  >
    <h3 class="mt-2 font-semibold">{{ section.title() }}</h3>
    <FormNodeView
      :node="node"
      :value="section.store.ref.value"
      :path="[]"
      query=""
      :problems="problems"
      :set="(path, value) => set(section, path, value)"
    />
  </div>
</template>
