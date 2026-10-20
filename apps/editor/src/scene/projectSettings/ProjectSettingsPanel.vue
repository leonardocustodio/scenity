<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Project settings window: each field of `scenity.project.json` as a form from the JSON Schema of the project file.
 * The fields are in sections (General, Assets, Plugins, Rules, Quality, Build, Release, Workbench and Editor), with a
 * search over the names and the descriptions of the fields. The checks of the form show immediately. Save sends the
 * value to the dev server, where the reader of `@scenity/scene` checks it again and writes canonical JSON.
 */
import PluginSettingsFields from "../settings/PluginSettingsFields.vue";
import { useI18n } from "@scenity/i18n";
import { computed, onMounted, ref, shallowRef } from "vue";
import { button, field as fieldClass } from "../inspector/inspectorUi";
import FormNodeView from "./FormNodeView.vue";
import ProjectEditorFields from "./ProjectEditorFields.vue";
import { readProjectSettings, writeProjectSettings, type ServerCheck } from "./projectCalls";
import { checkValue, projectNode, searchHit, setIn, type FormNode, type PathStep } from "./projectForm";
import { sectionsOf } from "./projectSections";

const props = defineProps<{ base: string; saved?: () => void }>();
const { $t } = useI18n();
const file = ref("");
const root = shallowRef<FormNode | null>(null);
const value = shallowRef<unknown>(null);
const savedText = ref("");
const server = shallowRef<readonly ServerCheck[]>([]);
const failure = ref<string | null>(null);
const busy = ref(false);
const query = ref("");
/** A plugin section shows when its title or its plugin has each word of the search. */
const pluginMatch = (...texts: string[]): boolean => {
  const hay = texts.join(" ").toLowerCase();
  return query.value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
};
const active = ref("general");

async function load(): Promise<void> {
  try {
    const settings = await readProjectSettings(props.base);
    file.value = settings.file;
    root.value = projectNode(settings.schema);
    value.value = settings.project;
    savedText.value = JSON.stringify(settings.project);
    server.value = settings.checks;
    failure.value = null;
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error);
  }
}
onMounted(() => void load());

const sections = computed(() => (root.value === null ? [] : sectionsOf(root.value)));
/** The sections to show: the active one, or each section with a hit of the search. */
const shown = computed(() =>
  query.value.trim() === ""
    ? sections.value.filter((item) => item.section.id === active.value)
    : sections.value.filter((item) => item.fields.some((field) => searchHit(field, query.value) !== null)),
);
const local = computed(() => (root.value === null ? [] : checkValue(root.value, value.value)));
/** The messages of the checks of the form and of the server, by dotted path. */
const problems = computed(() => {
  const map = new Map<string, string[]>();
  const add = (path: string, message: string): void => {
    map.set(path, [...(map.get(path) ?? []), message]);
  };
  for (const problem of local.value) add(problem.path, $t(problem.id, problem.args));
  for (const check of server.value)
    add(check.path, check.kind === "missing" ? $t("project-check-missing", { path: check.detail }) : check.detail);
  return map;
});
const dirty = computed(() => JSON.stringify(value.value) !== savedText.value);

function set(path: readonly PathStep[], next: unknown): void {
  value.value = setIn(value.value, path, next);
  // A check of the server is about the value that it read: an edit makes it old.
  server.value = server.value.filter((check) => check.kind === "missing");
}

async function save(): Promise<void> {
  busy.value = true;
  try {
    const answer = await writeProjectSettings(props.base, value.value);
    server.value = answer.checks;
    failure.value = answer.ok ? null : (answer.reason ?? null);
    if (answer.ok) {
      savedText.value = JSON.stringify(value.value);
      props.saved?.();
    }
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error);
  } finally {
    busy.value = false;
  }
}

function revert(): void {
  value.value = JSON.parse(savedText.value) as unknown;
  server.value = [];
}
</script>

<template>
  <section
    class="flex min-h-0 flex-1 gap-2 overflow-hidden p-1.5 text-caption text-text-primary"
    :aria-label="$t('panel-project-settings')"
    data-testid="project-settings"
    :data-loaded="root === null ? '0' : '1'"
    :data-dirty="dirty ? '1' : '0'"
  >
    <nav class="flex w-40 shrink-0 flex-col gap-0.5" :aria-label="$t('project-sections')">
      <input
        v-model="query"
        type="search"
        :class="fieldClass"
        :placeholder="$t('project-settings-search')"
        :aria-label="$t('project-settings-search')"
        data-testid="project-settings-search"
      />
      <button
        v-for="{ section } in sections"
        :key="section.id"
        type="button"
        class="rounded-control px-1.5 py-0.5 text-left hover:bg-surface-raised"
        :class="section.id === active && query === '' ? 'bg-surface-raised font-medium' : ''"
        :aria-current="section.id === active && query === '' ? 'true' : undefined"
        :data-testid="`project-section-${section.id}`"
        @click="
          active = section.id;
          query = '';
        "
      >
        {{ $t(section.title) }}
      </button>
    </nav>
    <div class="flex min-w-0 flex-1 flex-col gap-1 overflow-hidden">
      <p v-if="failure !== null" class="text-status-negative" role="alert" data-testid="project-failure">
        {{ failure }}
      </p>
      <div v-if="root !== null" class="flex min-h-0 flex-1 flex-col gap-2 overflow-auto pr-1">
        <div v-for="{ section, fields } in shown" :key="section.id" class="flex flex-col gap-1">
          <h3 class="font-semibold">{{ $t(section.title) }}</h3>
          <ProjectEditorFields v-if="section.id === 'editor'" />
          <FormNodeView
            v-else
            :node="{ kind: 'object', fields }"
            :value="value"
            :path="[]"
            :query="query"
            :problems="problems"
            :set="set"
          />
        </div>
        <!-- The project settings of the plugins (`.scenity/plugin-settings.json`). -->
        <PluginSettingsFields scope="project" :matches="pluginMatch" />
        <p v-if="shown.length === 0" class="text-text-secondary">{{ $t("project-settings-search-none") }}</p>
      </div>
      <div
        v-if="problems.size > 0"
        class="flex max-h-24 flex-col overflow-auto border-t border-border-subtle pt-1"
        data-testid="project-problems"
        :data-count="String([...problems.values()].flat().length)"
      >
        <p v-for="[path, messages] in problems" :key="path" class="text-status-negative">
          <span translate="no">{{ path === "" ? file : path }}</span
          >: {{ messages.join("; ") }}
        </p>
      </div>
      <div class="flex items-center gap-1">
        <button
          type="button"
          :class="button"
          :disabled="!dirty || busy || local.length > 0"
          data-testid="project-save"
          @click="save"
        >
          {{ $t("project-save") }}
        </button>
        <button type="button" :class="button" :disabled="!dirty || busy" data-testid="project-revert" @click="revert">
          {{ $t("project-revert") }}
        </button>
        <span class="text-text-secondary" translate="no">{{ file }}</span>
      </div>
    </div>
  </section>
</template>
