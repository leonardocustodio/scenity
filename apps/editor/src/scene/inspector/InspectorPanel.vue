<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The inspector panel of the scene page, on the right side in the edit mode. It shows the selected entities (or the
 * scene when nothing is selected): the name, the entities of a prefab instance with their overrides, a section for each
 * shared component, and the "add component" menu with the components of the registry (plugin components too). Each edit
 * is scene ops and one step of the history.
 *
 * The prefab section also has "Open prefab" (the prefab mode of the page), "Apply to prefab" and "Revert": for the
 * instance they act on all its overrides, for a prefab entity on the overrides of that entity. Each is a command of the
 * page and one step of the history.
 *
 * The panel also has the header of one entity (InspectorHeader.vue: the ID, the visible switch, the tags), the
 * component cards with their icons and menus, "Add component" with a search and groups (AddComponent.vue), and the raw
 * JSON mode (EntityJson.vue). The lock and more than one inspector are InspectorHost.vue.
 *
 * Its texts are Fluent messages of `src/i18n/en-US/inspector.ftl`. The entity names, the component names and the group
 * names are data (`translate="no"`).
 */
import { instanceOverrides, prefabEntities } from "@scenity/editor-core";
import { useI18n } from "@scenity/i18n";
import { computed, provide } from "vue";
import AddComponent from "./AddComponent.vue";
import ComponentSection from "./ComponentSection.vue";
import EntityJson from "./EntityJson.vue";
import InspectorHeader from "./InspectorHeader.vue";
import { INSPECTOR_KEY, type InspectorState } from "./inspectorState";
import { button, field, MIXED } from "./inspectorUi";

const props = defineProps<{
  state: InspectorState;
  /** The raw JSON mode (the JSON of the one entity in place of the component cards). */
  raw?: boolean;
}>();
provide(INSPECTOR_KEY, props.state);
const { $t } = useI18n();

const { subjects, components, selected, error, source } = props.state;

const entities = computed(() => subjects.value.filter((subject) => subject.kind !== "scene"));
/** The title: a panel message, or the name of the one selected entity (data). */
const title = computed(() => {
  if (selected.value.length === 0) return { text: $t("inspector-title-scene"), data: false };
  if (entities.value.length === 0) return { text: $t("inspector-title-none"), data: false };
  if (entities.value.length > 1)
    return { text: $t("inspector-title-many", { count: entities.value.length }), data: false };
  const only = entities.value[0];
  return { text: only === undefined ? "" : (only.entity.name ?? only.id), data: true };
});
const names = computed(() => entities.value.map((subject) => subject.entity.name ?? ""));
const nameMixed = computed(() => names.value.some((name) => name !== names.value[0]));

/** The prefab entities of a selected instance, and the instance of a selected prefab entity. */
const instance = computed(() => {
  const only = entities.value.length === 1 ? entities.value[0] : undefined;
  if (only === undefined) return null;
  const id = only.kind === "prefab" ? only.instance : only.id;
  const list = prefabEntities(source.value, id);
  return list.length === 0 ? null : { id, list, overrides: instanceOverrides(source.value.doc, id).length };
});

/** The scope of the prefab actions: the selected prefab entity, else the whole instance. */
const prefabScope = computed(() => {
  const found = instance.value;
  const only = entities.value[0];
  if (found === null || only === undefined) return null;
  if (only.kind !== "prefab") return { args: { instance: found.id }, what: "all", count: found.overrides };
  const count = found.list.find((choice) => choice.id === only.id)?.overrides ?? 0;
  return { args: { instance: found.id, entity: only.entityId }, what: "entity", count };
});

function onName(event: Event): void {
  props.state.rename((event.target as HTMLInputElement).value);
}
</script>

<template>
  <aside
    class="flex flex-col gap-2 text-caption text-text-primary"
    :aria-label="$t('inspector-panel')"
    :data-selection="selected.join(',')"
  >
    <header class="flex items-center justify-between gap-2">
      <h2 class="truncate text-label" :translate="title.data ? 'no' : undefined" data-testid="inspector-title">
        {{ title.text }}
      </h2>
      <button
        v-if="selected.length > 0"
        type="button"
        :class="button"
        data-testid="inspector-scene"
        :title="$t('inspector-scene-title')"
        @click="state.select([])"
      >
        {{ $t("inspector-scene") }}
      </button>
    </header>
    <label v-if="entities.length > 0" for="scene-inspector-name" class="flex items-center gap-1">
      <span class="w-28 shrink-0">{{ $t("inspector-name") }}</span>
      <input
        id="scene-inspector-name"
        type="text"
        :class="field"
        translate="no"
        :value="nameMixed ? '' : names[0]"
        :placeholder="nameMixed ? MIXED : entities[0]?.id"
        data-testid="inspector-name"
        @change="onName"
      />
    </label>
    <InspectorHeader />
    <section v-if="instance !== null" class="flex flex-col gap-1" :aria-label="$t('inspector-prefab-entities')">
      <h3 class="text-caption text-text-secondary">{{ $t("inspector-prefab-entities") }}</h3>
      <div class="flex flex-wrap gap-1">
        <button
          type="button"
          :class="button"
          :aria-pressed="selected[0] === instance.id"
          :data-testid="`inspector-prefab-${instance.id}`"
          @click="state.select([instance.id])"
        >
          {{ $t("inspector-prefab-instance")
          }}<span v-if="instance.overrides > 0">
            · {{ $t("inspector-overridden", { count: instance.overrides }) }}</span
          >
        </button>
        <button
          v-for="choice in instance.list"
          :key="choice.id"
          type="button"
          :class="button"
          :aria-pressed="selected[0] === choice.id"
          :data-testid="`inspector-prefab-${choice.id}`"
          @click="state.select([choice.id])"
        >
          <span translate="no">{{ choice.label }}</span
          ><span v-if="choice.overrides > 0"> · {{ $t("inspector-overridden", { count: choice.overrides }) }}</span>
        </button>
      </div>
      <div v-if="prefabScope !== null" class="flex flex-wrap gap-1" :aria-label="$t('inspector-prefab-actions')">
        <button
          type="button"
          :class="button"
          :title="$t('inspector-prefab-open-title')"
          data-testid="inspector-prefab-open"
          @click="state.openPrefab(instance.id)"
        >
          {{ $t("inspector-prefab-open") }}
        </button>
        <button
          type="button"
          :class="button"
          :disabled="prefabScope.count === 0"
          :title="
            prefabScope.what === 'all' ? $t('inspector-prefab-apply-instance') : $t('inspector-prefab-apply-entity')
          "
          data-testid="inspector-prefab-apply"
          @click="state.prefabRun('prefab.apply', prefabScope.args)"
        >
          {{ $t("inspector-prefab-apply") }}
        </button>
        <button
          type="button"
          :class="button"
          :disabled="prefabScope.count === 0"
          :title="
            prefabScope.what === 'all'
              ? $t('inspector-prefab-revert-instance-title')
              : $t('inspector-prefab-revert-entity-title')
          "
          data-testid="inspector-prefab-revert"
          @click="state.prefabRun('prefab.revert', prefabScope.args)"
        >
          {{ prefabScope.what === "all" ? $t("inspector-prefab-revert-all") : $t("inspector-prefab-revert-entity") }}
        </button>
        <!-- The entities of the prefab become plain entities of the scene. -->
        <button
          v-if="prefabScope.what === 'all'"
          type="button"
          :class="button"
          :title="$t('inspector-prefab-unpack-title')"
          data-testid="inspector-prefab-unpack"
          @click="state.prefabRun('prefab.unpack', { instance: instance.id })"
        >
          {{ $t("inspector-prefab-unpack") }}
        </button>
      </div>
    </section>
    <EntityJson v-if="raw === true" />
    <template v-else>
      <ComponentSection v-for="definition in components" :key="definition.id" :definition="definition" />
      <AddComponent />
    </template>
    <p v-if="error !== null" class="text-caption text-text-secondary" role="alert" data-testid="inspector-error">
      {{ error }}
    </p>
  </aside>
</template>
