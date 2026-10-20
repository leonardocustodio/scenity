<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The reference widgets of the inspector. An asset reference (`asset:<id>`) picks an asset of
 * the project manifest of the kind of the field. An entity reference (`entity:<id>` or `entity:<id>#<sub>`) picks an
 * entity of the scene, and then one of its socket points or none. A value that the pickers do not know stays in the
 * list, so the widget never drops it.
 *
 * Beside a material asset, "Edit" opens it in the material editor of the page (material/materialEvents.ts).
 *
 * An asset of the Project window that drops on an asset reference sets it (only an asset of the kind of the
 * field); a row of the hierarchy that drops on an entity reference sets it.
 *
 * The texts are Fluent messages of `src/i18n/en-US/inspector.ftl`. The label (the field name), the asset
 * names, the entity names and the socket names are data: a select whose name is the label has `translate="no"`, and
 * its prompt option has `translate="yes"`.
 */
import { useI18n } from "@scenity/i18n";
import { assetRefId, assetsOfKind, entityRefParts, type WidgetModel } from "@scenity/editor-core";
import { assetRef, entityRef } from "@scenity/scene/refs";
import { computed } from "vue";
import { openMaterial } from "../material/materialEvents";
import { ASSET_DRAG_TYPE } from "../../assetBrowser/assetTypes";
import { ENTITY_DRAG_TYPE } from "../hierarchy/hierarchyUi";
import { useInspector } from "./inspectorState";
import { button, MIXED, selectField } from "./inspectorUi";

const props = defineProps<{
  widget: Extract<WidgetModel, { kind: "assetRef" | "entityRef" }>;
  value: unknown;
  mixed: boolean;
  label: string;
  testId: string;
}>();
const emit = defineEmits<{ change: [value: string] }>();

const inspector = useInspector();
const { $t } = useI18n();

const assets = computed(() => {
  const kind = props.widget.kind === "assetRef" ? props.widget.assetKind : undefined;
  const list = assetsOfKind(inspector.choices.value, kind).map((asset) => ({ id: asset.id, label: asset.label }));
  const now = assetRefId(props.value);
  return now === null || list.some((asset) => asset.id === now) ? list : [{ id: now, label: now }, ...list];
});
const assetNow = computed(() => (props.mixed ? "" : (assetRefId(props.value) ?? "")));
/** True when the value is a material asset of the manifest. */
const isMaterial = computed(
  () =>
    assetNow.value !== "" &&
    inspector.choices.value.assets.some((a) => a.id === assetNow.value && a.kind === "material"),
);

const target = computed(() => (props.mixed ? null : entityRefParts(props.value)));
const entities = computed(() => {
  const list = inspector.choices.value.entities;
  const now = target.value?.id;
  return now === undefined || list.some((entity) => entity.id === now)
    ? list
    : [{ id: now, label: now, subs: [] }, ...list];
});
const subs = computed(() => {
  const found = entities.value.find((entity) => entity.id === target.value?.id)?.subs ?? [];
  const sub = target.value?.sub;
  return sub === undefined || found.includes(sub) ? found : [sub, ...found];
});

/** The asset or the entity of a drop, when the field takes it. */
function dropped(event: DragEvent): string | null {
  const transfer = event.dataTransfer;
  if (transfer === null) return null;
  if (props.widget.kind === "assetRef") {
    const id = assetRefId(transfer.getData(ASSET_DRAG_TYPE));
    return id !== null && assets.value.some((asset) => asset.id === id) ? assetRef(id) : null;
  }
  const first = transfer.getData(ENTITY_DRAG_TYPE).split(",")[0] ?? "";
  return first === "" ? null : entityRef(first);
}

function onDragOver(event: DragEvent): void {
  const types = event.dataTransfer?.types ?? [];
  if (types.includes(props.widget.kind === "assetRef" ? ASSET_DRAG_TYPE : ENTITY_DRAG_TYPE)) event.preventDefault();
}

function onDrop(event: DragEvent): void {
  const value = dropped(event);
  if (value === null) return;
  event.preventDefault();
  emit("change", value);
}

function onAsset(event: Event): void {
  const id = (event.target as HTMLSelectElement).value;
  if (id !== "") emit("change", assetRef(id));
}

function onEntity(event: Event): void {
  const id = (event.target as HTMLSelectElement).value;
  if (id !== "") emit("change", entityRef(id));
}

function onSub(event: Event): void {
  const id = target.value?.id;
  const sub = (event.target as HTMLSelectElement).value;
  if (id !== undefined) emit("change", entityRef(id, sub === "" ? undefined : sub));
}
</script>

<template>
  <span v-if="widget.kind === 'assetRef'" class="flex min-w-0 flex-1 gap-1">
    <select
      :class="selectField"
      translate="no"
      :value="assetNow"
      :aria-label="label"
      :data-testid="testId"
      data-drop="asset"
      @change="onAsset"
      @dragover="onDragOver"
      @drop="onDrop"
    >
      <option value="" disabled translate="yes">{{ mixed ? MIXED : $t("inspector-asset-pick") }}</option>
      <option v-for="asset in assets" :key="asset.id" :value="asset.id">{{ asset.label }}</option>
    </select>
    <button
      v-if="isMaterial"
      type="button"
      :class="button"
      :title="$t('inspector-asset-edit-title')"
      :data-testid="`${testId}-edit`"
      @click="openMaterial(`asset:${assetNow}`)"
    >
      {{ $t("inspector-asset-edit") }}
    </button>
  </span>
  <span v-else class="flex min-w-0 flex-1 gap-1">
    <select
      :class="selectField"
      translate="no"
      :value="target?.id ?? ''"
      :aria-label="label"
      :data-testid="testId"
      data-drop="entity"
      @change="onEntity"
      @dragover="onDragOver"
      @drop="onDrop"
    >
      <option value="" disabled translate="yes">{{ mixed ? MIXED : $t("inspector-entity-pick") }}</option>
      <option v-for="entity in entities" :key="entity.id" :value="entity.id">{{ entity.label }}</option>
    </select>
    <select
      v-if="target !== null && subs.length > 0"
      :class="selectField"
      :value="target.sub ?? ''"
      :aria-label="$t('inspector-entity-socket', { label })"
      :data-testid="`${testId}-sub`"
      @change="onSub"
    >
      <option value="">{{ $t("inspector-entity-whole") }}</option>
      <option v-for="sub in subs" :key="sub" :value="sub" translate="no">#{{ sub }}</option>
    </select>
  </span>
</template>
