<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * One component of the inspector: the header (the label, the ID, fold and remove) and a row for each field,
 * with the fields of a group under the name of the group. The model comes from the schema and the editor hints of the
 * component, so a component of a plugin needs no code here.
 *
 * For one selected prefab entity with overrides in the component, the header also has "Apply" (the overrides
 * of the component go into the prefab) and "Revert" (the overrides go). Each is a command and one step of the history.
 *
 * The texts are Fluent messages of `src/i18n/en-US/inspector.ftl`. The component name, the component ID and
 * the group names come from the schema: they are data (`translate="no"`).
 */
import { componentModel, inScope } from "@scenity/editor-core";
import { useI18n } from "@scenity/i18n";
import type { ComponentDefinition } from "@scenity/scene/components";
import { computed, ref } from "vue";
import { Menu } from "@scenity/ui";
import { Ellipsis } from "lucide-vue-next";
import { useAgentAsk } from "../../studio/extensions/api";
import { DOCS_URL } from "../searchProviders";
import { pagePresets } from "../presets/pagePresets";
import { pageKeys } from "../settings/pageKeys";
import { componentIcon } from "./componentIcons";
import { docsLinkOf } from "../extensions/docsLinks";
import { componentDocsUrl } from "../panelDocs";
import FieldRow from "./FieldRow.vue";
import { useInspector } from "./inspectorState";
import { button, iconButton } from "./inspectorUi";
import { pageModel } from "./componentTexts";

const props = defineProps<{ definition: ComponentDefinition }>();
// The docs of a plugin component from its plugin, else the page of the built-in components.
const docs = computed(
  () =>
    docsLinkOf(`component:${props.definition.id}`) ??
    (props.definition.id.includes(".") ? null : componentDocsUrl(props.definition.id)),
);

const inspector = useInspector();
const agent = useAgentAsk();
const { $t } = useI18n();
// The labels in the language of the page.
const model = computed(() => pageModel(componentModel(props.definition)));
const open = ref(true);

/** The scope of the component for one selected prefab entity with overrides in it, else null. */
const prefabScope = computed(() => {
  const list = inspector.subjects.value;
  const only = list.length === 1 ? list[0] : undefined;
  if (only?.kind !== "prefab") return null;
  const scope = { entity: only.entityId, component: props.definition.id };
  return only.overrides.some((op) => inScope(op, scope)) ? { instance: only.instance, ...scope } : null;
});

/**
 * The menu of the card: Reset, Copy and Paste values, Remove, Docs, Ask the agent. "Save as a
 * preset" and an item for each preset of the person of this component.
 */
const menuItems = computed(() => {
  const one = inspector.one() !== null;
  return [
    { value: "reset", label: $t("inspector-card-reset") },
    { value: "copy", label: $t("inspector-card-copy"), disabled: !one },
    { value: "paste", label: $t("inspector-card-paste"), disabled: !inspector.canPaste(props.definition) },
    { value: "remove", label: $t("inspector-card-remove"), disabled: props.definition.site !== "component" },
    { value: "docs", label: $t("inspector-card-docs") },
    { value: "ask", label: $t("inspector-card-ask"), disabled: !agent.can.value },
    { value: "save-preset", label: $t("inspector-card-save-preset"), disabled: !one },
    ...(pagePresets()?.of(props.definition.id) ?? []).map((preset) => ({
      value: `preset:${preset.id}`,
      label: $t("inspector-card-apply-preset", { name: preset.name }),
    })),
  ];
});

/** A refusal of a preset command shows in the error line of the inspector. */
function fail(error: unknown): void {
  inspector.error.value = error instanceof Error ? error.message : String(error);
}

function onMenu(value: string): void {
  const definition = props.definition;
  if (value === "reset") inspector.reset(definition, []);
  else if (value === "copy") inspector.copyValues(definition);
  else if (value === "paste") inspector.pasteValues(definition);
  else if (value === "remove") inspector.remove(definition);
  else if (value === "docs")
    window.open(`${DOCS_URL}formats.md#${encodeURIComponent(definition.id)}`, "_blank", "noopener");
  else if (value === "save-preset")
    void pageKeys()
      .execute("preset.save", { entity: inspector.one() ?? "", component: definition.id })
      .catch(fail);
  else if (value.startsWith("preset:"))
    void pageKeys()
      .execute(`preset.apply.${value.slice(7)}`, {})
      .catch(fail);
  else if (value === "ask") {
    const entity = inspector.one() ?? "";
    agent.ask($t("inspector-card-ask-prompt", { component: model.value.label, entity }));
  }
}

/** The fields with no group first, then each group in the order of its first field. */
const groups = computed(() => {
  const out = new Map<string, typeof model.value.fields>();
  for (const field of model.value.fields) {
    const name = field.group ?? "";
    out.set(name, [...(out.get(name) ?? []), field]);
  }
  return [...out].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : 0));
});
</script>

<template>
  <section
    class="flex flex-col gap-1.5 border-t border-border-subtle pt-2"
    :aria-labelledby="`inspector-label-${definition.id}`"
    :data-testid="`inspector-component-${definition.id}`"
    :data-docs="docs ?? undefined"
  >
    <header class="flex items-center gap-1">
      <button
        type="button"
        class="flex min-w-0 flex-1 items-center gap-1 text-left"
        :aria-expanded="open"
        @click="open = !open"
      >
        <span class="text-text-secondary" aria-hidden="true">{{ open ? "▾" : "▸" }}</span>
        <component
          :is="componentIcon(definition.id)"
          class="size-3.5 shrink-0 text-text-secondary"
          aria-hidden="true"
        />
        <span :id="`inspector-label-${definition.id}`" class="truncate text-label text-text-primary" translate="no">{{
          model.label
        }}</span>
        <span class="truncate font-mono text-caption text-text-secondary" translate="no">{{ definition.id }}</span>
      </button>
      <!-- The docs of the component, when its plugin gives a link. -->
      <a
        v-if="docs !== null"
        :href="docs"
        target="_blank"
        rel="noopener"
        :class="button"
        :title="$t('inspector-component-docs', { component: model.label })"
        :data-testid="`inspector-docs-${definition.id}`"
        >?</a
      >
      <template v-if="prefabScope !== null">
        <button
          type="button"
          :class="button"
          :title="$t('inspector-component-apply-title', { component: model.label })"
          :data-testid="`inspector-apply-${definition.id}`"
          @click="inspector.prefabRun('prefab.apply', prefabScope)"
        >
          {{ $t("inspector-component-apply") }}
        </button>
        <button
          type="button"
          :class="button"
          :title="$t('inspector-component-revert-title', { component: model.label })"
          :data-testid="`inspector-revert-${definition.id}`"
          @click="inspector.prefabRun('prefab.revert', prefabScope)"
        >
          {{ $t("inspector-component-revert") }}
        </button>
      </template>
      <Menu :items="menuItems" @select="onMenu">
        <template #trigger>
          <button
            type="button"
            :class="iconButton"
            :aria-label="$t('inspector-card-menu', { component: model.label })"
            :title="$t('inspector-card-menu', { component: model.label })"
            :data-testid="`inspector-menu-${definition.id}`"
          >
            <Ellipsis class="size-3.5" aria-hidden="true" />
          </button>
        </template>
      </Menu>
      <button
        v-if="definition.site === 'component'"
        type="button"
        :class="iconButton"
        :title="$t('inspector-component-remove', { component: model.label })"
        :data-testid="`inspector-remove-${definition.id}`"
        @click="inspector.remove(definition)"
      >
        ×
      </button>
    </header>
    <template v-if="open">
      <template v-for="[group, fields] in groups" :key="group">
        <h4 v-if="group !== ''" class="pt-1 text-caption text-text-secondary" translate="no">{{ group }}</h4>
        <FieldRow
          v-for="field in fields"
          :key="field.key"
          :definition="definition"
          :field="field"
          :path="field.key === '' ? [] : [field.key]"
        />
      </template>
    </template>
  </section>
</template>
