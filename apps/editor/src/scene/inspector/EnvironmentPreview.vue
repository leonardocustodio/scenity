<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The live preview of an environment hint of the inspector: the fog over the distance, the
 * bloom of a row of bright samples, the ambient occlusion in a corner, and the selection outline of a box. It follows
 * the value of its field at each edit and at each step of a number drag (environmentPreviews.ts). The fields of the
 * hint stay under it. The colours of the user come from the values; the others are tokens (inspector.css).
 */
import { colourHex } from "@scenity/editor-core";
import { useI18n } from "@scenity/i18n";
import type { ComponentDefinition } from "@scenity/scene/components";
import { computed } from "vue";
import { aoPreview, bloomPreview, fogPreview, outlinePreview, type PreviewWidget } from "./environmentPreviews";
import { useInspector } from "./inspectorState";

const props = defineProps<{ kind: PreviewWidget; definition: ComponentDefinition; value: unknown }>();
const { $t } = useI18n();
const inspector = useInspector();

const fog = computed(() => fogPreview(props.value));
/** The fog strip: the background of the scene at the camera, the fog colour where the fog is full. */
const fogStyle = computed(() => ({
  "--fog": fog.value.colour,
  "--background": colourHex(inspector.state(props.definition, ["background"]).value),
}));
const bloom = computed(() => bloomPreview(props.value));
const ao = computed(() => aoPreview(props.value));
const outline = computed(() => outlinePreview(props.value));
const off = computed(
  () =>
    (props.kind === "bloom" && !bloom.value.on) ||
    (props.kind === "ambientOcclusion" && !ao.value.on) ||
    (props.kind === "selectionOutline" && !outline.value.on),
);
const caption = computed(() => {
  if (off.value) return $t("inspector-preview-off");
  if (props.kind === "fog")
    return fog.value.on
      ? $t("inspector-preview-fog", { distance: fog.value.distance })
      : $t("inspector-preview-no-fog");
  return $t(`inspector-preview-${props.kind}`);
});
</script>

<template>
  <figure class="sc-env-preview" :data-kind="kind" :data-off="off ? '1' : undefined" data-testid="inspector-preview">
    <div
      v-if="kind === 'fog'"
      class="sc-env-fog"
      role="img"
      :aria-label="caption"
      :style="fogStyle"
      :data-stops="fog.stops.join(' ')"
      data-testid="inspector-preview-fog"
    >
      <span v-for="(share, at) in fog.stops" :key="at" :style="{ '--share': String(share) }" />
    </div>
    <div v-else-if="kind === 'bloom'" class="sc-env-bloom" role="img" :aria-label="caption">
      <span
        v-for="sample in bloom.samples"
        :key="sample.brightness"
        class="sc-env-bloom-sample"
        :style="{
          '--brightness': String(Math.min(1, sample.brightness / 2)),
          '--glow': String(sample.glow),
          '--spread': String(bloom.spread),
        }"
        :data-glow="sample.glow"
        data-testid="inspector-preview-sample"
      />
    </div>
    <div
      v-else-if="kind === 'ambientOcclusion'"
      class="sc-env-ao"
      role="img"
      :aria-label="caption"
      :style="{ '--dark': String(ao.darkness), '--width': String(ao.width) }"
      :data-dark="ao.darkness"
      data-testid="inspector-preview-ao"
    />
    <div v-else class="sc-env-outline-stage" role="img" :aria-label="caption">
      <span
        class="sc-env-outline"
        :style="{
          '--colour': outline.on ? outline.colour : 'transparent',
          '--thickness': String(outline.thickness),
          '--opacity': String(outline.opacity),
        }"
        :data-colour="outline.colour"
        :data-thickness="outline.thickness"
        data-testid="inspector-preview-outline"
      />
    </div>
    <figcaption class="text-caption text-text-secondary">{{ caption }}</figcaption>
  </figure>
</template>
