<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * One node of the Project settings form (projectForm.ts): an input for a text, a number, a flag or a choice; the fields
 * of an object (an absent optional field has Add, a present one has Remove); the items of a list and the entries of a
 * map (with Add and Remove); the option choice of a union; JSON for a free value. The names of the fields are data of
 * the project schema. The view calls `set` with the path and the new value.
 */
import { useI18n } from "@scenity/i18n";
import { computed, ref } from "vue";
import { button, field as fieldClass, iconButton, selectField } from "../inspector/inspectorUi";
import { emptyOf, optionOf, pathText, renameKey, searchHit, type FormNode, type PathStep } from "./projectForm";

const props = defineProps<{
  node: FormNode;
  value: unknown;
  path: readonly PathStep[];
  query: string;
  /** The messages of the problems of each dotted path. */
  problems: ReadonlyMap<string, readonly string[]>;
  set: (path: readonly PathStep[], value: unknown) => void;
}>();
const { $t } = useI18n();
const at = computed(() => pathText(props.path));
const record = computed(() =>
  typeof props.value === "object" && props.value !== null && !Array.isArray(props.value)
    ? (props.value as Readonly<Record<string, unknown>>)
    : {},
);
const items = computed(() => (Array.isArray(props.value) ? (props.value as readonly unknown[]) : []));
const newKey = ref("");
const jsonError = ref(false);

/** The fields of an object that the search shows, each with the query for the nodes below it. */
const fields = computed(() =>
  props.node.kind !== "object"
    ? []
    : props.node.fields.flatMap((item) => {
        const hit = searchHit(item, props.query);
        return hit === null ? [] : [{ field: item, query: hit === "self" ? "" : props.query }];
      }),
);
const option = computed(() => (props.node.kind === "union" ? optionOf(props.node, props.value) : 0));
const chosen = computed(() => (props.node.kind === "union" ? (props.node.options[option.value]?.node ?? null) : null));

function onText(event: Event): void {
  props.set(props.path, (event.target as HTMLInputElement).value);
}
function onNumber(event: Event): void {
  const text = (event.target as HTMLInputElement).value.trim();
  const value = Number(text);
  if (text !== "" && Number.isFinite(value)) props.set(props.path, value);
}
function onJson(event: Event): void {
  try {
    props.set(props.path, JSON.parse((event.target as HTMLTextAreaElement).value) as unknown);
    jsonError.value = false;
  } catch {
    jsonError.value = true;
  }
}
function onOption(event: Event): void {
  if (props.node.kind !== "union") return;
  const next = props.node.options[Number((event.target as HTMLSelectElement).value)];
  if (next !== undefined) props.set(props.path, emptyOf(next.node));
}
function addEntry(): void {
  const key = newKey.value.trim();
  if (props.node.kind !== "map" || key === "" || key in record.value) return;
  props.set([...props.path, key], emptyOf(props.node.value));
  newKey.value = "";
}
function onKey(from: string, event: Event): void {
  props.set(props.path, renameKey(props.value, from, (event.target as HTMLInputElement).value.trim()));
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-0.5" :data-node="node.kind" :data-path="at">
    <template v-if="node.kind === 'object'">
      <div
        v-for="{ field, query: below } in fields"
        :key="field.name"
        class="flex min-w-0 flex-col gap-0.5 border-l border-border-subtle pl-1.5"
        :data-testid="`project-field-${pathText([...path, field.name])}`"
      >
        <div class="flex items-center gap-1">
          <span class="font-medium" translate="no" :title="field.description">{{ field.name }}</span>
          <span v-if="field.required" class="text-text-secondary" :title="$t('project-required')">*</span>
          <button
            v-if="record[field.name] === undefined"
            type="button"
            :class="button"
            :data-testid="`project-add-${pathText([...path, field.name])}`"
            @click="set([...path, field.name], emptyOf(field.node))"
          >
            {{ $t("project-add") }}
          </button>
          <button
            v-else-if="!field.required"
            type="button"
            :class="iconButton"
            :aria-label="$t('project-remove-field', { name: field.name })"
            :title="$t('project-remove-field', { name: field.name })"
            :data-testid="`project-remove-${pathText([...path, field.name])}`"
            @click="set([...path, field.name], undefined)"
          >
            ×
          </button>
        </div>
        <FormNodeView
          v-if="record[field.name] !== undefined"
          :node="field.node"
          :value="record[field.name]"
          :path="[...path, field.name]"
          :query="below"
          :problems="problems"
          :set="set"
        />
      </div>
    </template>
    <template v-else-if="node.kind === 'list'">
      <div v-for="(item, index) in items" :key="index" class="flex min-w-0 items-start gap-1">
        <FormNodeView
          class="flex-1"
          :node="node.item"
          :value="item"
          :path="[...path, index]"
          query=""
          :problems="problems"
          :set="set"
        />
        <button
          type="button"
          :class="iconButton"
          :aria-label="$t('project-remove-item')"
          :title="$t('project-remove-item')"
          :data-testid="`project-remove-${pathText([...path, index])}`"
          @click="set([...path, index], undefined)"
        >
          ×
        </button>
      </div>
      <button
        type="button"
        class="self-start"
        :class="button"
        :data-testid="`project-add-item-${at}`"
        @click="set([...path, items.length], emptyOf(node.item))"
      >
        {{ $t("project-add-item") }}
      </button>
    </template>
    <template v-else-if="node.kind === 'map'">
      <div
        v-for="(item, key) in record"
        :key="key"
        class="flex min-w-0 flex-col gap-0.5 border-l border-border-subtle pl-1.5"
      >
        <div class="flex items-center gap-1">
          <input
            :class="fieldClass"
            class="max-w-48"
            :value="key"
            :aria-label="$t('project-key')"
            translate="no"
            :data-testid="`project-key-${pathText([...path, key])}`"
            @change="onKey(String(key), $event)"
          />
          <button
            type="button"
            :class="iconButton"
            :aria-label="$t('project-remove-field', { name: key })"
            :title="$t('project-remove-field', { name: key })"
            :data-testid="`project-remove-${pathText([...path, key])}`"
            @click="set([...path, key], undefined)"
          >
            ×
          </button>
        </div>
        <FormNodeView
          :node="node.value"
          :value="item"
          :path="[...path, key]"
          query=""
          :problems="problems"
          :set="set"
        />
      </div>
      <div class="flex items-center gap-1">
        <input
          v-model="newKey"
          :class="fieldClass"
          class="max-w-48"
          :placeholder="$t('project-new-key')"
          :aria-label="$t('project-new-key')"
          :data-testid="`project-new-key-${at}`"
          @keydown.enter="addEntry"
        />
        <button type="button" :class="button" :data-testid="`project-add-entry-${at}`" @click="addEntry">
          {{ $t("project-add") }}
        </button>
      </div>
    </template>
    <template v-else-if="node.kind === 'union'">
      <select
        :class="selectField"
        class="max-w-48"
        :value="option"
        :aria-label="$t('project-option')"
        @change="onOption"
      >
        <option v-for="(item, index) in node.options" :key="index" :value="index" translate="no">
          {{ item.label }}
        </option>
      </select>
      <FormNodeView
        v-if="chosen !== null"
        :node="chosen"
        :value="value"
        :path="path"
        :query="query"
        :problems="problems"
        :set="set"
      />
    </template>
    <input
      v-else-if="node.kind === 'boolean'"
      type="checkbox"
      class="self-start"
      :checked="value === true"
      :aria-label="at"
      :data-testid="`project-input-${at}`"
      @change="set(path, ($event.target as HTMLInputElement).checked)"
    />
    <select
      v-else-if="node.kind === 'choice'"
      :class="selectField"
      :value="value"
      :aria-label="at"
      :data-testid="`project-input-${at}`"
      @change="onText"
    >
      <option v-for="choice in node.choices" :key="choice" :value="choice" translate="no">{{ choice }}</option>
    </select>
    <span v-else-if="node.kind === 'const'" class="text-text-secondary" translate="no">{{ String(node.value) }}</span>
    <input
      v-else-if="node.kind === 'number' || node.kind === 'integer'"
      type="number"
      :class="fieldClass"
      :value="value"
      :min="node.minimum"
      :max="node.maximum"
      :step="node.kind === 'integer' ? 1 : 'any'"
      :aria-label="at"
      :data-testid="`project-input-${at}`"
      @change="onNumber"
    />
    <textarea
      v-else-if="node.kind === 'json'"
      :class="fieldClass"
      class="font-mono"
      rows="2"
      :value="JSON.stringify(value)"
      :aria-label="at"
      :data-testid="`project-input-${at}`"
      @change="onJson"
    />
    <input
      v-else
      :class="fieldClass"
      :value="value"
      :aria-label="at"
      translate="no"
      :data-testid="`project-input-${at}`"
      @change="onText"
    />
    <p v-if="jsonError" class="text-status-negative">{{ $t("project-json-error") }}</p>
    <p
      v-for="message in node.kind === 'object' || node.kind === 'union' ? [] : (problems.get(at) ?? [])"
      :key="message"
      class="text-status-negative"
      translate="no"
      :data-testid="`project-problem-${at}`"
    >
      {{ message }}
    </p>
  </div>
</template>
