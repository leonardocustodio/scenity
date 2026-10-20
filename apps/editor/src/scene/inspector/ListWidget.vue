<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The list and map widgets of the inspector: a row for each item with the widget of the item and a remove
 * button, and an add button (a map asks for the key first). An item edit writes the item at its path; add and remove
 * write the whole list, or the one key of the map.
 *
 * The texts are Fluent messages of `src/i18n/en-US/inspector.ftl`. The label (the field name) and the item keys
 * are data (`translate="no"`).
 */
import { useI18n } from "@scenity/i18n";
import { initialValue, removeItem, type WidgetModel } from "@scenity/editor-core";
import { MESH_PART_PREFIX, type ComponentDefinition } from "@scenity/scene/components";
import { computed, ref, watch } from "vue";
import { useInspector, type FieldPath } from "./inspectorState";
import { button, field, fieldTestId, iconButton } from "./inspectorUi";
import ValueWidget from "./ValueWidget.vue";

const props = defineProps<{
  definition: ComponentDefinition;
  path: FieldPath;
  widget: Extract<WidgetModel, { kind: "list" | "map" }>;
  value: unknown;
  mixed: boolean;
  label: string;
}>();

const inspector = useInspector();
const { $t } = useI18n();
const testId = computed(() => fieldTestId(props.definition.id, props.path));
const newKey = ref("");

/** The rows: the key (an index for a list) and the value of each item. */
const rows = computed<{ key: string; value: unknown }[]>(() => {
  if (props.widget.kind === "list") {
    const list = Array.isArray(props.value) ? (props.value as unknown[]) : [];
    return list.map((value, index) => ({ key: String(index), value }));
  }
  const map = typeof props.value === "object" && props.value !== null ? (props.value as Record<string, unknown>) : {};
  return Object.keys(map)
    .sort()
    .map((key) => ({ key, value: map[key] }));
});

const canAdd = computed(
  () => props.widget.kind !== "list" || props.widget.max === undefined || rows.value.length < props.widget.max,
);
const canRemove = computed(() => props.widget.kind !== "list" || rows.value.length > (props.widget.min ?? 0));

function add(): void {
  const item = initialValue(props.widget.item, inspector.choices.value);
  if (props.widget.kind === "list") {
    const list = Array.isArray(props.value) ? (props.value as unknown[]) : [];
    inspector.set(props.definition, props.path, [...list, item]);
    return;
  }
  const key = newKey.value.trim();
  if (key === "") return;
  inspector.set(props.definition, [...props.path, key], item);
  newKey.value = "";
}

/** The keys of the parts of the model of the selected entity, as choices of the key field (no pointer). */
const partKeys = ref<readonly string[]>([]);
const partList = computed(() => `${testId.value}-parts`);
watch(
  () => [props.widget, inspector.selected.value[0]] as const,
  ([widget, entity]) => {
    partKeys.value = [];
    if (widget.kind !== "map" || widget.itemCustom !== "materialOverride" || entity === undefined) return;
    void inspector.partKeys(entity).then((keys) => (partKeys.value = keys));
  },
  { immediate: true },
);

/** An override of the part that the next click in the Scene view names (`mesh:<node>`). */
const picking = ref(false);
const pickNote = ref<string | null>(null);
async function pickPart(): Promise<void> {
  picking.value = true;
  pickNote.value = null;
  const picked = await inspector.pickPart();
  picking.value = false;
  if (picked === null) {
    pickNote.value = $t("inspector-pick-part-none");
    return;
  }
  const key = `${MESH_PART_PREFIX}${picked.part}`;
  if (rows.value.some((row) => row.key === key)) return;
  inspector.set(props.definition, [...props.path, key], initialValue(props.widget.item, inspector.choices.value));
}

function remove(key: string): void {
  if (props.widget.kind === "list") inspector.set(props.definition, props.path, removeItem(props.value, Number(key)));
  else inspector.set(props.definition, [...props.path, key], undefined);
}
</script>

<template>
  <div class="flex min-w-0 flex-1 flex-col gap-1" :data-testid="testId">
    <p v-if="mixed" class="text-caption text-text-secondary">{{ $t("inspector-list-mixed") }}</p>
    <div v-for="row in rows" :key="row.key" class="flex min-w-0 items-start gap-1">
      <span class="w-10 shrink-0 truncate pt-1 text-caption text-text-secondary" :title="row.key" translate="no">{{
        row.key
      }}</span>
      <ValueWidget
        :definition="definition"
        :path="[...path, row.key]"
        :widget="widget.item"
        :value="row.value"
        :values="[row.value]"
        :mixed="false"
        :label="`${label} ${row.key}`"
      />
      <button
        v-if="canRemove"
        type="button"
        :class="iconButton"
        :aria-label="$t('inspector-list-remove', { key: row.key })"
        :data-testid="`${testId}-remove-${row.key}`"
        @click="remove(row.key)"
      >
        ×
      </button>
    </div>
    <div v-if="canAdd" class="flex items-center gap-1">
      <input
        v-if="widget.kind === 'map'"
        v-model="newKey"
        type="text"
        :class="field"
        :placeholder="$t('inspector-list-key')"
        :aria-label="$t('inspector-list-key-label', { label })"
        :data-testid="`${testId}-key`"
        :list="partKeys.length > 0 ? partList : undefined"
        @keydown.enter.prevent="add"
      />
      <datalist v-if="partKeys.length > 0" :id="partList">
        <option v-for="key in partKeys" :key="key" :value="key" />
      </datalist>
      <button type="button" :class="[button, 'shrink-0']" :data-testid="`${testId}-add`" @click="add">
        {{ $t("inspector-list-add") }}
      </button>
      <button
        v-if="widget.kind === 'map' && widget.itemCustom === 'materialOverride' && inspector.canPickPart"
        type="button"
        :class="[button, 'shrink-0']"
        :aria-pressed="picking"
        :title="$t('inspector-pick-part-title')"
        :data-testid="`${testId}-pick`"
        @click="pickPart"
      >
        {{ picking ? $t("inspector-pick-part-wait") : $t("inspector-pick-part") }}
      </button>
    </div>
    <p v-if="pickNote !== null" class="text-caption text-text-secondary" role="status">{{ pickNote }}</p>
  </div>
</template>
