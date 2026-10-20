<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * A number field of the inspector: a text field that writes on Enter or on blur, the arrow keys (one step; Shift: ten
 * steps), and a drag of the grip to the left of it. In a drag, the value changes immediately, and the release writes
 * one step of the history (Escape restores the start value). A mixed value shows an empty field with "—".
 *
 * The grip texts are Fluent messages of `src/i18n/en-US/inspector.ftl`. The label is data (a field name) unless
 * `message` says that it is a Fluent message; the field of a data label has `translate="no"`.
 */
import { useI18n } from "@scenity/i18n";
import { dragNumber, numberText, parseNumber, type NumberLimits } from "@scenity/editor-core";
import { computed, nextTick, ref } from "vue";
import { field, MIXED } from "./inspectorUi";

const props = defineProps<{
  value: unknown;
  mixed?: boolean | undefined;
  limits: Partial<NumberLimits>;
  /** The text of the grip (an axis name), or none for "↔". */
  grip?: string | undefined;
  label: string;
  /** True when the label is a Fluent message, false (the default) when it is data. */
  message?: boolean | undefined;
  testId: string;
}>();
const { $t } = useI18n();
const emit = defineEmits<{
  commit: [value: number];
  dragStart: [];
  dragMove: [value: number];
  dragEnd: [cancel: boolean];
}>();

const input = ref<HTMLInputElement | null>(null);
const text = computed(() => (props.mixed ? "" : numberText(props.value)));

/** Show the value of the document again (after a refused or an equal value). */
async function resync(): Promise<void> {
  await nextTick();
  if (input.value !== null && document.activeElement !== input.value) input.value.value = text.value;
}

function commit(): void {
  const typed = input.value?.value ?? "";
  if (typed === text.value) return;
  const value = parseNumber(typed, props.limits);
  if (value !== null) emit("commit", value);
  void resync();
}

function onKey(event: KeyboardEvent): void {
  if (event.key === "Enter") {
    commit();
    return;
  }
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  event.preventDefault();
  const start = typeof props.value === "number" ? props.value : 0;
  const pixels = (event.key === "ArrowUp" ? 4 : -4) * (event.shiftKey ? 10 : 1);
  emit("commit", dragNumber(start, pixels, props.limits));
}

/** The drag of the grip that runs: the pointer, the start x and the start value. */
let drag: { pointer: number; x: number; start: number; moved: boolean } | null = null;

function down(event: PointerEvent): void {
  if (event.button !== 0 || drag !== null) return;
  event.preventDefault();
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  const start = typeof props.value === "number" && !props.mixed ? props.value : 0;
  drag = { pointer: event.pointerId, x: event.clientX, start, moved: false };
}

function move(event: PointerEvent): void {
  if (drag?.pointer !== event.pointerId) return;
  const pixels = event.clientX - drag.x;
  if (!drag.moved && Math.abs(pixels) < 3) return;
  if (!drag.moved) {
    drag.moved = true;
    emit("dragStart");
  }
  emit("dragMove", dragNumber(drag.start, pixels, props.limits, { shift: event.shiftKey, alt: event.altKey }));
}

function up(cancel: boolean): void {
  const moved = drag?.moved === true;
  drag = null;
  if (moved) emit("dragEnd", cancel);
}

function onGripKey(event: KeyboardEvent): void {
  if (event.key === "Escape") up(true);
}
</script>

<template>
  <span class="flex min-w-0 flex-1 items-center gap-0.5">
    <button
      type="button"
      class="cursor-ew-resize touch-none px-0.5 text-text-secondary select-none"
      :title="$t('inspector-drag-title', { label })"
      :aria-label="$t('inspector-drag', { label })"
      :data-testid="`${testId}-grip`"
      tabindex="-1"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="up(false)"
      @pointercancel="up(true)"
      @keydown="onGripKey"
    >
      <span translate="no">{{ grip ?? "↔" }}</span>
    </button>
    <input
      ref="input"
      type="text"
      inputmode="decimal"
      :class="[field, 'sc-numeric']"
      :translate="message === true ? undefined : 'no'"
      :value="text"
      :placeholder="mixed ? MIXED : ''"
      :aria-label="label"
      :data-testid="testId"
      @change="commit"
      @keydown="onKey"
    />
  </span>
</template>
