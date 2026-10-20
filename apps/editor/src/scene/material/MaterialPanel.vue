<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The material tab of the bottom dock of the scene page. It shows the open material asset (its type, its name, its file
 * and the entities that use it), and its values and texture slots from the schema. It also has the assignment of the
 * material to a part of the selected entity, and a new material from the current values. The scene is the live
 * preview: each change shows on each entity that uses the asset. A swatch beside the values shows the colour, the
 * roughness and the metalness. The swatch also shows the colour map. The presets set the values in one step. A texture
 * drops on its slot. A material that drops on a part in the Scene view goes on that part.
 *
 * The texts are Fluent messages of `src/i18n/en-US/material.ftl`. The material data (names, paths, types and
 * entity IDs) shows in elements with `translate="no"`. The value labels and groups of `@scenity/editor-core` get the
 * messages `material-field-<key>` and `material-group-<group>` (the English of the package when a message is missing).
 */
import { useI18n } from "@scenity/i18n";
import { MATERIAL_TYPES } from "@scenity/scene/schema/material";
import { materialValue } from "@scenity/editor-core";
import { computed, ref } from "vue";
import { button, field, selectField } from "../inspector/inspectorUi";
import MaterialValue from "./MaterialValue.vue";
import TextureSlot from "./TextureSlot.vue";
import { MATERIAL_PRESETS } from "./materialPresets";
import { messageIdOf, textOr } from "../../texts";
import { assetName, useMaterialPanel, type MaterialPanelParts } from "./useMaterialPanel";

const { $t } = useI18n();
const props = defineProps<{ readonly parts: MaterialPanelParts }>();
const state = useMaterialPanel(props.parts);
const { status, current, doc, fields, slots, dirty, path, users, materialAssets, textures, selected, targets, stills } =
  state;

/** The label of a field and the name of its group in the page locale. */
const fieldText = (key: string, label: string): string => textOr(messageIdOf("material-field", key), label);
const groupText = (group: string | undefined): string =>
  group === undefined ? "" : textOr(messageIdOf("material-group", group), group);

const newName = ref("");
const part = ref<string>("");
/** The part of the assignment: the chosen part when the entity has it, else its first part. */
const chosen = computed(() => {
  const keys = targets.value.map((target) => target.key ?? "");
  return keys.includes(part.value) ? part.value : (keys[0] ?? "");
});

/** The picture of the colour map on the ball, multiplied by the colour (null with no colour map). */
const swatchMap = computed(() => {
  const texture = doc.value?.maps?.colour?.texture;
  const picture = texture === undefined ? undefined : stills.value.get(texture.replace(/^asset:/, ""));
  return picture === undefined ? null : { backgroundImage: `url("${picture}")` };
});

/** The swatch of the material: a lit ball in CSS from the colour, the roughness and the metalness. */
const swatch = computed(() => {
  const now = doc.value;
  if (now === null) return {};
  const colour = String(materialValue(now, "colour"));
  const rough = Number(materialValue(now, "roughness") ?? 0.5);
  const metal = Number(materialValue(now, "metalness") ?? 0);
  const shine = (1 - rough) * 0.85 + 0.1;
  const size = 8 + rough * 40;
  const shade = Math.round(30 + metal * 40);
  return {
    background: `radial-gradient(circle at 35% 30%, color-mix(in srgb, white ${(shine * 100).toFixed(0)}%, transparent) 0, transparent ${size.toFixed(0)}%), radial-gradient(circle at 50% 45%, ${colour} 45%, color-mix(in srgb, ${colour} ${String(100 - shade)}%, black) 100%)`,
  };
});

function onOpen(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  if (value !== "") state.open(value);
}

function onCreate(): void {
  const name = newName.value.trim();
  if (name === "") return;
  state.create(name);
  newName.value = "";
}
</script>

<template>
  <section
    class="flex min-h-0 gap-3 overflow-auto p-1.5 text-caption text-text-primary"
    :aria-label="$t('material-panel')"
    data-testid="material-panel"
    :data-material="current ?? ''"
    :data-dirty="dirty ? '1' : '0'"
  >
    <div class="flex w-56 shrink-0 flex-col gap-1">
      <select
        :class="selectField"
        :value="current ?? ''"
        :aria-label="$t('material-asset')"
        data-testid="material-open"
        @change="onOpen"
      >
        <option value="" disabled>{{ $t("material-open") }}</option>
        <option v-for="entry in materialAssets" :key="entry.id" :value="`asset:${entry.id}`" translate="no">
          {{ assetName(entry) }}
        </option>
      </select>
      <template v-if="doc !== null">
        <div class="flex items-center gap-2">
          <span
            class="relative size-14 shrink-0 overflow-hidden rounded-full border border-border-subtle"
            :style="swatch"
            data-testid="material-swatch"
          >
            <span
              v-if="swatchMap !== null"
              class="absolute inset-0 bg-cover bg-center mix-blend-multiply"
              :style="swatchMap"
              data-testid="material-swatch-map"
            />
          </span>
          <div class="flex min-w-0 flex-col gap-0.5">
            <span class="truncate text-text-secondary" translate="no" :title="path"
              >{{ path }}{{ dirty ? " •" : "" }}</span
            >
            <span class="text-text-secondary" data-testid="material-users">
              {{ $t("material-users", { count: users.length }) }}
            </span>
          </div>
        </div>
        <div class="flex flex-wrap gap-1" role="group" :aria-label="$t('material-presets')">
          <button
            v-for="preset in MATERIAL_PRESETS"
            :key="preset.id"
            type="button"
            :class="button"
            :data-preset="preset.id"
            data-testid="material-preset"
            @click="state.preset(preset.id)"
          >
            {{ $t(`material-preset-${preset.id}`) }}
          </button>
        </div>
        <div class="flex items-center gap-1">
          <span class="w-12 shrink-0 text-text-secondary">{{ $t("material-type") }}</span>
          <select
            :class="selectField"
            :value="doc.type"
            :aria-label="$t('material-type-label')"
            data-testid="material-type"
            @change="state.setValue('type', ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="type in MATERIAL_TYPES" :key="type" :value="type" translate="no">{{ type }}</option>
          </select>
        </div>
        <div class="flex items-center gap-1">
          <span class="w-12 shrink-0 text-text-secondary">{{ $t("material-name") }}</span>
          <input
            type="text"
            :class="field"
            :value="doc.name ?? ''"
            :aria-label="$t('material-name-label')"
            data-testid="material-name"
            @change="state.setValue('name', ($event.target as HTMLInputElement).value.trim() || undefined)"
          />
        </div>
        <button type="button" :class="button" :disabled="!dirty" data-testid="material-save" @click="state.save()">
          {{ $t("material-save") }}
        </button>
      </template>
      <span class="flex gap-1">
        <input
          v-model="newName"
          type="text"
          :class="field"
          :placeholder="$t('material-new-name')"
          :aria-label="$t('material-new-name')"
          data-testid="material-new-name"
          @keydown.enter="onCreate"
        />
        <button type="button" :class="button" data-testid="material-new" @click="onCreate">
          {{ $t("material-new") }}
        </button>
      </span>
      <p class="truncate text-text-secondary" role="status" data-testid="material-status" :title="status">
        {{ status }}
      </p>
    </div>
    <div v-if="doc !== null" class="flex min-w-64 flex-1 flex-col gap-0.5 overflow-auto" data-testid="material-values">
      <div v-for="item in fields" :key="item.key" class="flex items-center gap-1">
        <span class="w-28 shrink-0 truncate text-text-secondary" :title="groupText(item.group)">{{
          fieldText(item.key, item.label)
        }}</span>
        <MaterialValue
          :widget="item.widget"
          :value="materialValue(doc, item.key)"
          :own="Object.hasOwn(doc, item.key)"
          :label="fieldText(item.key, item.label)"
          :test-id="`material-field-${item.key}`"
          @set="(value: unknown) => state.setValue(item.key, value)"
          @live="(value: unknown) => state.liveValue(item.key, value)"
          @end="(cancel: boolean) => state.endLive(cancel)"
        />
      </div>
    </div>
    <div v-if="doc !== null" class="flex w-72 shrink-0 flex-col gap-1 overflow-auto" data-testid="material-slots">
      <TextureSlot
        v-for="slot in slots"
        :key="slot"
        :name="slot"
        :map="doc.maps?.[slot]"
        :textures="textures"
        :stills="stills"
        @texture="(ref: string | null) => state.setMap(slot, ref)"
        @setting="(key, value) => state.setMapSetting(slot, key, value)"
      />
    </div>
    <div v-if="doc !== null" class="flex w-56 shrink-0 flex-col gap-1" data-testid="material-assign-section">
      <span class="font-medium">{{ $t("material-assign-section") }}</span>
      <span v-if="selected === null" class="truncate text-text-secondary">{{ $t("material-select-entity") }}</span>
      <span v-else class="truncate text-text-secondary" translate="no">{{ selected }}</span>
      <select
        v-if="targets.length > 0"
        v-model="part"
        :class="selectField"
        :aria-label="$t('material-part')"
        data-testid="material-assign-part"
      >
        <option v-for="target in targets" :key="target.key ?? ''" :value="target.key ?? ''">
          {{ target.material === current ? $t("material-part-this", { part: target.label }) : target.label }}
        </option>
      </select>
      <span v-else-if="selected !== null" class="text-text-secondary">{{ $t("material-no-parts") }}</span>
      <button
        type="button"
        :class="button"
        :disabled="targets.length === 0"
        data-testid="material-assign"
        @click="state.assign(chosen === '' ? null : chosen)"
      >
        {{ doc.name === undefined ? $t("material-assign-unnamed") : $t("material-assign", { name: doc.name }) }}
      </button>
    </div>
  </section>
</template>
