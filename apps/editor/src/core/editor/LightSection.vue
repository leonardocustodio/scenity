<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Light section of the Tune tab. It has the key light handle switch (the key I), and an intensity slider of the
 * key, the fill and the sky light. It also has a colour field of each light and of the ground colour of the sky light.
 * A slider gesture is one step of the undo history (useLight.ts `preview` and `commit`). A colour change runs
 * `light.colour`. The values are tune values of `light` (model/light.ts). "Save placement" writes them into the source
 * with `labs tune-apply`.
 *
 * The texts are Fluent messages of `src/i18n/en-US/palette.ftl`.
 */
import { useI18n } from "@scenity/i18n";
import { cn, Slider, Switch } from "@scenity/ui";
import { FieldLabel } from "@scenity/ui/components/field";
import { RotateCcw } from "lucide-vue-next";
import { computed, inject } from "vue";
import { button } from "../labUi";
import { hexOf, intensityOps, parseColour, type ColourPart, type LightPart } from "./lightEdit";
import { LIGHT_TOOL } from "./useLight";

const { $t } = useI18n();
const context = inject(LIGHT_TOOL, null);
const light = computed(() => context?.tool.view.value ?? null);

/** The lights of the section with the message IDs of the label, the slider and the colour field. */
const LIGHTS: readonly {
  readonly part: LightPart;
  readonly label: string;
  readonly intensity: string;
  readonly colour: string;
}[] = [
  {
    part: "key",
    label: "palette-light-key",
    intensity: "palette-light-key-intensity",
    colour: "palette-light-key-colour",
  },
  {
    part: "fill",
    label: "palette-light-fill",
    intensity: "palette-light-fill-intensity",
    colour: "palette-light-fill-colour",
  },
  {
    part: "sky",
    label: "palette-light-sky",
    intensity: "palette-light-sky-intensity",
    colour: "palette-light-sky-colour",
  },
];

function intensity(part: LightPart): number {
  return light.value?.[part].intensity ?? 0;
}

function colour(part: ColourPart): string {
  const now = light.value;
  if (now === null) return hexOf([0, 0, 0]);
  return hexOf(part === "ground" ? now.sky.ground : now[part].colour);
}

function onSlide(part: LightPart, value: number[] | undefined): void {
  const next = value?.[0];
  if (next !== undefined) context?.tool.preview(intensityOps(part, next));
}

function onColour(part: ColourPart, event: Event): void {
  const rgb = parseColour((event.target as HTMLInputElement).value);
  if (rgb !== null) context?.tool.colour(part, rgb);
}

function onShow(on: boolean): void {
  context?.run("light.show", { on });
}
</script>

<template>
  <section
    v-if="context !== null && light !== null"
    class="flex flex-col gap-1.5"
    :aria-label="$t('palette-light')"
    data-testid="lab-light"
  >
    <div class="flex items-center justify-between gap-2">
      <h3 class="text-label text-text-secondary">{{ $t("palette-light") }}</h3>
      <div class="flex items-center gap-2">
        <FieldLabel for="lab-light-handle">{{ $t("palette-light-handle") }}</FieldLabel>
        <Switch id="lab-light-handle" :model-value="context.tool.shown.value" @update:model-value="onShow" />
        <button
          type="button"
          :class="cn(button, 'inline-flex size-9 items-center justify-center p-0 pointer-coarse:size-11')"
          :aria-label="$t('palette-light-reset')"
          :title="$t('palette-light-reset')"
          data-testid="lab-light-reset"
          @click="context.run('light.reset')"
        >
          <RotateCcw class="size-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
    <div v-for="item in LIGHTS" :key="item.part" class="grid grid-cols-[2.5rem_1fr_3rem_2rem] items-center gap-2">
      <span>{{ $t(item.label) }}</span>
      <Slider
        :label="$t(item.intensity)"
        :model-value="[intensity(item.part)]"
        :min="0"
        :max="6"
        :step="0.05"
        :data-testid="`lab-light-${item.part}`"
        @update:model-value="(value: number[] | undefined) => onSlide(item.part, value)"
        @value-commit="context.tool.commit()"
      />
      <span class="text-right font-mono tabular-nums">{{ intensity(item.part).toFixed(2) }}</span>
      <input
        type="color"
        class="h-8 w-8 cursor-pointer rounded-control border border-border-default bg-transparent p-0"
        :aria-label="$t(item.colour)"
        :value="colour(item.part)"
        :data-testid="`lab-light-${item.part}-colour`"
        @change="onColour(item.part, $event)"
      />
    </div>
    <div class="grid grid-cols-[2.5rem_1fr_3rem_2rem] items-center gap-2">
      <span>{{ $t("palette-light-ground") }}</span>
      <span class="text-text-secondary">{{ $t("palette-light-ground-hint") }}</span>
      <span />
      <input
        type="color"
        class="h-8 w-8 cursor-pointer rounded-control border border-border-default bg-transparent p-0"
        :aria-label="$t('palette-light-ground-colour')"
        :value="colour('ground')"
        data-testid="lab-light-ground-colour"
        @change="onColour('ground', $event)"
      />
    </div>
    <p class="text-text-secondary">{{ $t("palette-light-help") }}</p>
  </section>
</template>
