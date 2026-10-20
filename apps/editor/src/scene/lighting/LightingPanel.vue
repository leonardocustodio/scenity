<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Lighting window: the look of the whole scene in one panel. The presets set the values of the environment in one
 * step (lightingPresets.ts). The environment maps of the project show as pictures, and a press uses one. The fields of
 * the `environment` component follow (the background, the tone mapping, the exposure, the fog and the effects, with
 * their previews). The lights of the scene have their
 * intensity and a press that selects them. "Ask the agent to light this" sends a request to the agent of the window.
 */
import { useI18n } from "@scenity/i18n";
import type { EnvironmentValue } from "@scenity/scene/components";
import { Button } from "@scenity/ui";
import { Sparkles } from "lucide-vue-next";
import { computed, provide } from "vue";
import type { AssetListEntry } from "../../assetBrowser/assetTypes";
import ComponentSection from "../inspector/ComponentSection.vue";
import { INSPECTOR_KEY, type InspectorState } from "../inspector/inspectorState";
import NumberInput from "../inspector/NumberInput.vue";
import { activePreset, LIGHTING_PRESETS, withPreset } from "./lightingPresets";

const props = defineProps<{
  /** The inspector state of the scene (no entity). */
  state: InspectorState;
  /** The environment maps of the project, and the folder of the project for their pictures. */
  maps: () => readonly AssetListEntry[];
  base: string;
  /** Change a field of the light of an entity (one step). */
  setLight(entity: string, field: string, value: unknown): void;
  select(id: string): void;
  /** Ask the agent of the window, or null when the window has no agent. */
  ask: () => ((text: string) => void) | null;
}>();
const { $t } = useI18n();
provide(INSPECTOR_KEY, props.state);

const environment = computed(() => props.state.doc.value.environment as Readonly<EnvironmentValue> | undefined);
const definition = computed(() => props.state.components.value.find((item) => item.id === "environment") ?? null);
const active = computed(() => activePreset(environment.value));
const mapNow = computed(() => environment.value?.map ?? null);

function preset(id: string): void {
  const found = LIGHTING_PRESETS.find((item) => item.id === id);
  if (found !== undefined && definition.value !== null)
    props.state.set(definition.value, [], withPreset(environment.value, found));
}
function useMap(id: string | null): void {
  if (definition.value !== null) props.state.set(definition.value, ["map"], id === null ? undefined : `asset:${id}`);
}

/** The lights of the scene: the ID, the name, the type and the intensity. */
const lights = computed(() =>
  Object.entries(props.state.doc.value.entities)
    .filter(([, entity]) => entity.components.light !== undefined)
    .map(([id, entity]) => {
      const light = entity.components.light as { type?: string; intensity?: number };
      return { id, name: entity.name ?? id, type: light.type ?? "", intensity: light.intensity ?? 1 };
    }),
);
const asker = computed(() => props.ask());
const still = (asset: AssetListEntry): string | null =>
  asset.still === null ? null : `${props.base}${encodeURI(asset.still)}`;
</script>

<template>
  <section
    class="flex flex-col gap-3 text-caption text-text-primary"
    :aria-label="$t('panel-lighting')"
    data-testid="lighting-panel"
  >
    <div class="flex flex-col gap-1">
      <h3 class="text-label">{{ $t("lighting-presets") }}</h3>
      <div class="flex flex-wrap gap-1" role="group" :aria-label="$t('lighting-presets')">
        <Button
          v-for="item in LIGHTING_PRESETS"
          :key="item.id"
          size="sm"
          :variant="active === item.id ? 'primary' : 'secondary'"
          :aria-pressed="active === item.id"
          :data-preset="item.id"
          data-testid="lighting-preset"
          @click="preset(item.id)"
        >
          {{ $t(`lighting-preset-${item.id}`) }}
        </Button>
      </div>
    </div>
    <div class="flex flex-col gap-1">
      <h3 class="text-label">{{ $t("lighting-maps") }}</h3>
      <div class="grid grid-cols-3 gap-1" role="group" :aria-label="$t('lighting-maps')">
        <button
          type="button"
          class="flex aspect-video items-center justify-center rounded-control border border-border-subtle bg-surface-sunken"
          :aria-pressed="mapNow === null"
          data-testid="lighting-map-none"
          @click="useMap(null)"
        >
          {{ $t("lighting-map-none") }}
        </button>
        <button
          v-for="asset in maps()"
          :key="asset.id"
          type="button"
          class="relative overflow-hidden rounded-control border border-border-subtle aria-pressed:border-accent-brand"
          :aria-pressed="mapNow === `asset:${asset.id}`"
          :title="asset.source"
          :data-asset="asset.id"
          translate="no"
          data-testid="lighting-map"
          @click="useMap(asset.id)"
        >
          <img v-if="still(asset) !== null" :src="still(asset) ?? ''" alt="" class="aspect-video w-full object-cover" />
          <span class="block truncate px-1" translate="no">{{ asset.name }}</span>
        </button>
      </div>
    </div>
    <ComponentSection v-if="definition !== null" :definition="definition" />
    <div class="flex flex-col gap-1">
      <h3 class="text-label">{{ $t("lighting-lights") }}</h3>
      <p v-if="lights.length === 0" class="text-text-secondary">{{ $t("lighting-no-lights") }}</p>
      <div
        v-for="light in lights"
        :key="light.id"
        class="flex items-center gap-1"
        :data-light="light.id"
        data-testid="lighting-light"
      >
        <button
          type="button"
          class="min-w-0 flex-1 truncate text-left hover:underline"
          translate="no"
          @click="select(light.id)"
        >
          {{ light.name }} <span class="text-text-secondary">{{ light.type }}</span>
        </button>
        <NumberInput
          :value="light.intensity"
          :limits="{ min: 0, step: 0.1 }"
          :label="$t('lighting-intensity', { name: light.name })"
          message
          :test-id="`lighting-intensity-${light.id}`"
          @commit="(value: number) => setLight(light.id, 'intensity', value)"
        />
      </div>
    </div>
    <Button
      size="sm"
      variant="secondary"
      class="self-start"
      :disabled="asker === null"
      :title="asker === null ? $t('lighting-ask-none') : undefined"
      data-testid="lighting-ask"
      @click="asker?.($t('lighting-ask-prompt'))"
    >
      <Sparkles class="size-icon-sm" aria-hidden="true" />{{ $t("lighting-ask") }}
    </Button>
  </section>
</template>
