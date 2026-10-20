<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The widget of the levels of detail of a model (`model.lod`): the chain of the levels from
 * the full detail to the last level, with the screen size where each level starts (the diameter of the model over the
 * height of the view). A bar shows the share of the sizes of each level. Add puts a level after the last one (at half
 * of its size), and Remove removes the last level (with no level, the field goes). A new size keeps the order
 * from large to small.
 */
import { useI18n } from "@scenity/i18n";
import type { ComponentDefinition } from "@scenity/scene/components";
import { computed } from "vue";
import { useInspector, type FieldPath } from "../inspectorState";
import { button, fieldTestId } from "../inspectorUi";
import NumberInput from "../NumberInput.vue";

const props = defineProps<{ definition: ComponentDefinition; path: FieldPath; value: unknown; label: string }>();
const { $t } = useI18n();
const inspector = useInspector();
const testId = computed(() => fieldTestId(props.definition.id, props.path));

/** The most levels after the full detail (the schema limit). */
const MAX_LEVELS = 8;
const lod = computed(() => {
  const value = typeof props.value === "object" && props.value !== null ? (props.value as Record<string, unknown>) : {};
  const screen = Array.isArray(value.screen)
    ? (value.screen as unknown[]).filter((item) => typeof item === "number")
    : [];
  return { on: props.value !== undefined, screen, hysteresis: value.hysteresis };
});
/** The share of the bar of each level: from the largest size to 0, the size of the full detail is twice the first. */
const bars = computed(() => {
  const sizes = lod.value.screen;
  const top = Math.max(1, (sizes[0] ?? 1) * 2);
  const edges = [top, ...sizes, 0];
  return edges.slice(1).map((edge, at) => Math.max(0.02, ((edges[at] ?? 0) - edge) / top));
});

const set = (path: FieldPath, value: unknown): void => inspector.set(props.definition, [...props.path, ...path], value);
/** A new size of a level, with the order from large to small. */
function size(index: number, value: number): void {
  const next = [...lod.value.screen];
  next[index] = value;
  set(
    ["screen"],
    next.sort((a, b) => b - a),
  );
}
function add(): void {
  const last = lod.value.screen.at(-1);
  if (!lod.value.on) inspector.set(props.definition, props.path, { screen: [0.5] });
  else set(["screen"], [...lod.value.screen, Math.max(0.01, (last ?? 1) / 2)]);
}
function remove(): void {
  if (lod.value.screen.length <= 1) inspector.set(props.definition, props.path, undefined);
  else set(["screen"], lod.value.screen.slice(0, -1));
}
</script>

<template>
  <div class="flex min-w-0 flex-1 flex-col gap-1" :data-testid="testId" :data-levels="lod.screen.length">
    <div
      v-if="lod.on"
      class="flex h-2 overflow-hidden rounded-control"
      role="img"
      :aria-label="$t('inspector-lod-bar')"
    >
      <span
        v-for="(share, at) in bars"
        :key="at"
        :class="at % 2 === 0 ? 'bg-accent-brand' : 'bg-border-strong'"
        :style="{ flexGrow: String(share) }"
      />
    </div>
    <p v-if="!lod.on" class="text-caption text-text-secondary">{{ $t("inspector-lod-none") }}</p>
    <div v-for="(edge, at) in lod.screen" :key="at" class="flex items-center gap-1">
      <span class="w-24 shrink-0 text-caption text-text-secondary">{{
        $t("inspector-lod-level", { level: at + 1 })
      }}</span>
      <NumberInput
        :value="edge"
        :limits="{ min: 0.01, max: 16, step: 0.05 }"
        :label="$t('inspector-lod-size', { level: at + 1 })"
        message
        :test-id="`${testId}-level-${at}`"
        @commit="(next: number) => size(at, next)"
      />
    </div>
    <div v-if="lod.on" class="flex items-center gap-1">
      <span class="w-24 shrink-0 text-caption text-text-secondary">{{ $t("inspector-lod-hysteresis") }}</span>
      <NumberInput
        :value="lod.hysteresis ?? 0"
        :limits="{ min: 0, max: 0.5, step: 0.01 }"
        :label="$t('inspector-lod-hysteresis')"
        message
        :test-id="`${testId}-hysteresis`"
        @commit="(next: number) => set(['hysteresis'], next)"
      />
    </div>
    <div class="flex gap-1">
      <button
        v-if="lod.screen.length < MAX_LEVELS"
        type="button"
        :class="button"
        :data-testid="`${testId}-add`"
        @click="add"
      >
        {{ $t("inspector-lod-add") }}
      </button>
      <button v-if="lod.on" type="button" :class="button" :data-testid="`${testId}-remove`" @click="remove">
        {{ $t("inspector-lod-remove") }}
      </button>
    </div>
  </div>
</template>
