<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * A texture slot of the material panel: the texture asset of the slot (a picker of the texture assets of the project,
 * or none). With a texture, the slot also shows the colour space, the repeat and the offset. Each change is one step.
 * The slot shows the picture of the texture, and a texture asset that drops on the slot goes into it.
 *
 * The texts are Fluent messages of `src/i18n/en-US/material.ftl`. The texture names and the colour spaces are
 * data values. The slot labels of `@scenity/editor-core` get the messages `material-map-<slot>`.
 */
import { useI18n } from "@scenity/i18n";
import { SLOT_LABELS, type MapSetting } from "@scenity/editor-core";
import {
  COLOUR_SPACES,
  SLOT_COLOUR_SPACES,
  type MaterialSlot,
  type MaterialTexture,
} from "@scenity/scene/schema/material";
import { computed, ref } from "vue";
import { ASSET_DRAG_TYPE, ASSET_KIND_DRAG_TYPE } from "../../assetBrowser/assetTypes";
import { selectField } from "../inspector/inspectorUi";
import { messageIdOf, textOr } from "../../texts";
import NumberInput from "../inspector/NumberInput.vue";
import type { IndexEntry } from "./pageMaterials";
import { assetName } from "./useMaterialPanel";

const props = defineProps<{
  name: MaterialSlot;
  map: MaterialTexture | undefined;
  textures: readonly IndexEntry[];
  /** The pictures of the assets (asset ID → URL). */
  stills?: ReadonlyMap<string, string>;
}>();
const emit = defineEmits<{ texture: [ref: string | null]; setting: [key: MapSetting, value: unknown] }>();

const { $t } = useI18n();
const testId = computed(() => `material-slot-${props.name}`);
const now = computed(() => props.map?.texture ?? "");
/** The texture assets, and the texture of the slot when the index does not have it. */
const options = computed(() => {
  const list = props.textures.map((entry) => ({ ref: `asset:${entry.id}`, label: assetName(entry) }));
  return now.value === "" || list.some((item) => item.ref === now.value)
    ? list
    : [{ ref: now.value, label: now.value }, ...list];
});
const repeat = computed(() => props.map?.repeat ?? [1, 1]);
const offset = computed(() => props.map?.offset ?? [0, 0]);
const pair = (values: readonly number[], index: number, value: number): number[] =>
  values.map((part, at) => (at === index ? value : part));

/** The picture of the texture of the slot, or null. */
const picture = computed(() => props.stills?.get(now.value.replace(/^asset:/, "")) ?? null);
const over = ref(false);

/** True when a drag carries a texture asset of the asset browser or of the Project window. */
function carriesTexture(event: DragEvent): boolean {
  const types = event.dataTransfer?.types ?? [];
  return types.includes(ASSET_DRAG_TYPE);
}
function onDragOver(event: DragEvent): void {
  if (!carriesTexture(event)) return;
  event.preventDefault();
  over.value = true;
}
/** A texture that drops on the slot goes into it (another kind of asset does nothing). */
function onDrop(event: DragEvent): void {
  over.value = false;
  const ref = event.dataTransfer?.getData(ASSET_DRAG_TYPE) ?? "";
  if (ref === "") return;
  event.preventDefault();
  const kind = event.dataTransfer?.getData(ASSET_KIND_DRAG_TYPE) ?? "";
  const known = props.textures.some((entry) => `asset:${entry.id}` === ref);
  if (ref !== "" && (kind === "texture" || known)) emit("texture", ref);
}

function onTexture(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  emit("texture", value === "" ? null : value);
}
</script>

<template>
  <div class="flex flex-col gap-0.5 border-b border-border-subtle pb-1" :data-testid="testId">
    <div class="flex items-center gap-1">
      <span class="w-24 shrink-0 truncate text-text-secondary">{{
        textOr(messageIdOf("material-map", name), SLOT_LABELS[name])
      }}</span>
      <img
        v-if="picture !== null"
        :src="picture"
        alt=""
        class="size-7 shrink-0 rounded-control border border-border-subtle object-cover"
        :data-testid="`${testId}-picture`"
      />
      <select
        :class="[selectField, over && 'outline-2 outline-accent-brand']"
        :value="now"
        :aria-label="textOr(messageIdOf('material-map', name), SLOT_LABELS[name])"
        :title="$t('material-texture-drop')"
        :data-testid="`${testId}-texture`"
        data-drop="texture"
        @change="onTexture"
        @dragover="onDragOver"
        @dragleave="over = false"
        @drop="onDrop"
      >
        <option value="">{{ $t("material-texture-none") }}</option>
        <option v-for="option in options" :key="option.ref" :value="option.ref" translate="no">
          {{ option.label }}
        </option>
      </select>
    </div>
    <template v-if="map !== undefined">
      <div class="flex items-center gap-1 pl-2">
        <span class="w-22 shrink-0 text-text-secondary">{{ $t("material-colour-space") }}</span>
        <select
          :class="selectField"
          :value="map.colorSpace ?? SLOT_COLOUR_SPACES[name]"
          :aria-label="$t('material-colour-space')"
          :data-testid="`${testId}-colorSpace`"
          @change="emit('setting', 'colorSpace', ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="space in COLOUR_SPACES" :key="space" :value="space" translate="no">{{ space }}</option>
        </select>
      </div>
      <span class="flex items-center gap-1 pl-2">
        <span class="w-22 shrink-0 text-text-secondary">{{ $t("material-repeat") }}</span>
        <NumberInput
          v-for="axis in 2"
          :key="axis"
          :value="repeat[axis - 1]"
          :limits="{ step: 0.1 }"
          :grip="['U', 'V'][axis - 1]"
          :label="$t('material-repeat-axis', { axis: ['U', 'V'][axis - 1] ?? '' })"
          :test-id="`${testId}-repeat-${axis - 1}`"
          @commit="(value: number) => emit('setting', 'repeat', pair(repeat, axis - 1, value))"
        />
      </span>
      <span class="flex items-center gap-1 pl-2">
        <span class="w-22 shrink-0 text-text-secondary">{{ $t("material-offset") }}</span>
        <NumberInput
          v-for="axis in 2"
          :key="axis"
          :value="offset[axis - 1]"
          :limits="{ step: 0.05 }"
          :grip="['U', 'V'][axis - 1]"
          :label="$t('material-offset-axis', { axis: ['U', 'V'][axis - 1] ?? '' })"
          :test-id="`${testId}-offset-${axis - 1}`"
          @commit="(value: number) => emit('setting', 'offset', pair(offset, axis - 1, value))"
        />
      </span>
    </template>
  </div>
</template>
