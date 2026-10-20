<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Variants panel: the variants of the scene (its override layers). Show puts a variant in the view, and the base
 * scene stays the document (Base shows it again). Apply puts the ops of a variant into the base scene as one step.
 * "Make from the edits" writes a new variant of the edits since the last save. Compare takes a picture of two variants
 * and shows them with a wipe. The slider moves the edge between the two pictures.
 */
import { useI18n } from "@scenity/i18n";
import { Select } from "@scenity/ui";
import { computed, nextTick, ref, shallowRef } from "vue";
import { button, field } from "../inspector/inspectorUi";
import { BASE, type PageVariants } from "./pageVariants";

const props = defineProps<{
  variants: PageVariants;
  /** The current names of the variants of the scene. */
  names: { readonly value: readonly string[] };
  /** A picture of the view with a variant (BASE: the base scene), or null. */
  picture(name: string): Promise<ImageBitmap | null>;
}>();
const { $t } = useI18n();

const name = ref("");
const reason = ref<string | null>(null);
const options = computed(() => [
  { value: "*base", label: $t("variants-base") },
  ...props.names.value.map((value) => ({ value, label: value })),
]);
const choice = (value: string): string => (value === "*base" ? BASE : value);
const left = ref("*base");
const right = ref("*base");
const wipe = ref(50);
const pictures = shallowRef<{ left: ImageBitmap; right: ImageBitmap } | null>(null);
const leftCanvas = ref<HTMLCanvasElement | null>(null);
const rightCanvas = ref<HTMLCanvasElement | null>(null);
const busy = ref(false);

async function make(): Promise<void> {
  reason.value = await props.variants.makeFromEdits(name.value);
  if (reason.value === null) name.value = "";
}

async function apply(variant: string): Promise<void> {
  reason.value = await props.variants.applyToBase(variant);
}

/** Take the pictures of the two variants, then show the base scene again. */
async function compare(): Promise<void> {
  busy.value = true;
  try {
    const shown = props.variants.shown.value;
    const a = await props.picture(choice(left.value));
    const b = await props.picture(choice(right.value));
    await props.variants.show(shown);
    pictures.value = a === null || b === null ? null : { left: a, right: b };
    if (pictures.value === null) reason.value = $t("variants-no-picture");
    await nextTick();
    for (const [canvas, image] of [
      [leftCanvas.value, a],
      [rightCanvas.value, b],
    ] as const) {
      if (canvas === null || image === null) continue;
      canvas.width = image.width;
      canvas.height = image.height;
      canvas.getContext("2d")?.drawImage(image, 0, 0);
    }
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section
    class="flex h-full min-h-0 flex-col gap-2 overflow-auto p-1 text-caption"
    :aria-label="$t('panel-variants')"
    :data-shown="variants.shown.value"
    data-testid="variants-panel"
  >
    <ul :aria-label="$t('variants-list')">
      <li class="flex items-center gap-1 py-0.5" data-variant="" data-testid="variants-row">
        <span class="min-w-0 flex-1">{{ $t("variants-base") }}</span>
        <button
          type="button"
          :class="button"
          :aria-pressed="variants.shown.value === ''"
          data-testid="variants-show"
          @click="variants.show('')"
        >
          {{ $t("variants-show") }}
        </button>
      </li>
      <li
        v-for="variant in names.value"
        :key="variant"
        class="flex items-center gap-1 py-0.5"
        :data-variant="variant"
        data-testid="variants-row"
      >
        <span class="min-w-0 flex-1 truncate" translate="no">{{ variant }}</span>
        <button
          type="button"
          :class="button"
          :aria-pressed="variants.shown.value === variant"
          data-testid="variants-show"
          @click="variants.show(variant)"
        >
          {{ $t("variants-show") }}
        </button>
        <button type="button" :class="button" data-testid="variants-apply" @click="apply(variant)">
          {{ $t("variants-apply") }}
        </button>
      </li>
    </ul>
    <div class="flex gap-1">
      <input
        v-model="name"
        type="text"
        :class="field"
        :placeholder="$t('variants-new-name')"
        :aria-label="$t('variants-new-name')"
        data-testid="variants-new-name"
        @keydown.enter="make"
      />
      <button type="button" :class="button" data-testid="variants-make" @click="make">{{ $t("variants-make") }}</button>
    </div>
    <div class="flex flex-wrap items-center gap-1">
      <Select v-model="left" :options="options" class="w-32" :aria-label="$t('variants-compare-left')" />
      <Select v-model="right" :options="options" class="w-32" :aria-label="$t('variants-compare-right')" />
      <button type="button" :class="button" :disabled="busy" data-testid="variants-compare" @click="compare">
        {{ $t("variants-compare") }}
      </button>
    </div>
    <figure v-if="pictures !== null" class="flex flex-col gap-1" data-testid="variants-wipe">
      <div class="relative w-full">
        <canvas ref="leftCanvas" class="block w-full" data-testid="variants-wipe-left" />
        <canvas
          ref="rightCanvas"
          class="absolute inset-0 block w-full"
          :style="{ clipPath: `inset(0 0 0 ${String(wipe)}%)` }"
          data-testid="variants-wipe-right"
        />
      </div>
      <input
        v-model.number="wipe"
        type="range"
        min="0"
        max="100"
        :aria-label="$t('variants-wipe')"
        data-testid="variants-wipe-slider"
      />
    </figure>
    <p v-if="reason !== null || variants.error.value !== null" class="text-text-secondary" role="alert">
      {{ reason ?? variants.error.value }}
    </p>
  </section>
</template>
