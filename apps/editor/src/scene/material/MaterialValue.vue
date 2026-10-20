<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The widget of one value of the material panel: the widget model of the schema (a number, a pair of
 * numbers, a colour, an enum, a switch). A number drag and a colour pick change the material immediately (`live`), and
 * their end is one step of the history (`end`). The reset button removes the value: the runtime then uses its default.
 *
 * The texts are Fluent messages of `src/i18n/en-US/material.ftl`. The enum options are data values.
 */
import { useI18n } from "@scenity/i18n";
import { colourHex, colourValue, type WidgetModel } from "@scenity/editor-core";
import { Switch } from "@scenity/ui";
import { computed } from "vue";
import { field, iconButton, selectField } from "../inspector/inspectorUi";
import NumberInput from "../inspector/NumberInput.vue";

const props = defineProps<{
  widget: WidgetModel;
  value: unknown;
  /** True when the document gives the value (false: the default shows). */
  own: boolean;
  label: string;
  testId: string;
}>();
const emit = defineEmits<{ set: [value: unknown]; live: [value: unknown]; end: [cancel: boolean] }>();

const { $t } = useI18n();
const hex = computed(() => colourHex(props.value));
const pair = computed(() => (Array.isArray(props.value) ? (props.value as number[]) : [0, 0]));
const setPart = (index: number, next: number): unknown => pair.value.map((part, at) => (at === index ? next : part));

function onPick(event: Event): void {
  emit("live", colourValue((event.target as HTMLInputElement).value, props.value));
}

function onHex(event: Event): void {
  const text = (event.target as HTMLInputElement).value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(text)) emit("set", colourValue(text, props.value));
}
</script>

<template>
  <span class="flex min-w-0 flex-1 items-center gap-1">
    <NumberInput
      v-if="widget.kind === 'number'"
      :value="value"
      :limits="widget"
      :label="label"
      :test-id="testId"
      @commit="(next: number) => emit('set', next)"
      @drag-move="(next: number) => emit('live', next)"
      @drag-end="(cancel: boolean) => emit('end', cancel)"
    />
    <span v-else-if="widget.kind === 'vector'" class="flex min-w-0 flex-1 gap-1">
      <NumberInput
        v-for="axis in widget.size"
        :key="axis"
        :value="pair[axis - 1]"
        :limits="widget"
        :grip="['X', 'Y'][axis - 1]"
        :label="`${label} ${['X', 'Y'][axis - 1]}`"
        :test-id="`${testId}-${axis - 1}`"
        @commit="(next: number) => emit('set', setPart(axis - 1, next))"
        @drag-move="(next: number) => emit('live', setPart(axis - 1, next))"
        @drag-end="(cancel: boolean) => emit('end', cancel)"
      />
    </span>
    <template v-else-if="widget.kind === 'colour'">
      <input
        type="color"
        class="h-7 w-9 shrink-0 cursor-pointer rounded-control border border-border-subtle bg-transparent"
        :value="hex"
        :aria-label="label"
        :data-testid="testId"
        @input="onPick"
        @change="emit('end', false)"
      />
      <input
        type="text"
        :class="field"
        :value="hex"
        :placeholder="$t('material-hex-sample')"
        :aria-label="$t('material-hex', { label })"
        :data-testid="`${testId}-hex`"
        @change="onHex"
      />
    </template>
    <select
      v-else-if="widget.kind === 'enum'"
      :class="selectField"
      :value="value"
      :aria-label="label"
      :data-testid="testId"
      @change="emit('set', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="option in widget.options" :key="option" :value="option" translate="no">{{ option }}</option>
    </select>
    <Switch
      v-else-if="widget.kind === 'boolean'"
      :model-value="value === true"
      :aria-label="label"
      :data-testid="testId"
      @update:model-value="(on: boolean) => emit('set', on)"
    />
    <span v-else class="text-text-secondary">{{ JSON.stringify(value) }}</span>
    <button
      v-if="own"
      type="button"
      :class="iconButton"
      :title="$t('material-reset', { label })"
      :data-testid="`${testId}-reset`"
      @click="emit('set', undefined)"
    >
      ↺
    </button>
  </span>
</template>
