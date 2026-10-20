<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * A resize handle of the dock. A drag changes a size in rem. The arrow keys change it by 1 rem (with Shift: 4 rem). A
 * double press restores the default. `axis` "y" is a handle between two rows, and "x" is a handle between two columns.
 * With `invert`, the size increases when the pointer moves up or left. The caller gives the texts: `label` for the
 * screen reader and `title` for the hover. The texts are Fluent messages of `src/i18n/en-US/browser.ftl`.
 */
import { cn } from "@scenity/ui";

const props = withDefaults(
  defineProps<{
    readonly axis: "x" | "y";
    readonly label: string;
    readonly title: string;
    readonly invert?: boolean;
  }>(),
  { invert: false },
);
const size = defineModel<number>({ required: true });
const emit = defineEmits<{ reset: [] }>();

let start: { pos: number; value: number; rem: number } | null = null;

function rootFont(): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

function onDown(event: PointerEvent): void {
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  start = { pos: props.axis === "x" ? event.clientX : event.clientY, value: size.value, rem: rootFont() };
}

function onMove(event: PointerEvent): void {
  if (start === null) return;
  const delta = ((props.axis === "x" ? event.clientX : event.clientY) - start.pos) / start.rem;
  size.value = start.value + (props.invert ? -delta : delta);
}

function onUp(): void {
  start = null;
}

function onKey(event: KeyboardEvent): void {
  const grow = props.axis === "x" ? ["ArrowRight", "ArrowLeft"] : ["ArrowDown", "ArrowUp"];
  const step = event.shiftKey ? 4 : 1;
  const sign = event.key === grow[0] ? 1 : event.key === grow[1] ? -1 : 0;
  if (sign === 0) return;
  event.preventDefault();
  event.stopPropagation();
  size.value += (props.invert ? -sign : sign) * step;
}
</script>

<template>
  <button
    type="button"
    :class="
      cn(
        'dock-resize group relative z-10 shrink-0 touch-none outline-none',
        axis === 'x' ? 'w-1.5 cursor-ew-resize self-stretch' : 'h-1.5 w-full cursor-ns-resize',
      )
    "
    :aria-label="label"
    :title="title"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
    @dblclick="emit('reset')"
    @keydown="onKey"
  >
    <span
      :class="
        cn(
          'absolute rounded-pill bg-border-subtle transition-colors group-hover:bg-accent-brand group-focus-visible:bg-accent-brand',
          axis === 'x' ? 'inset-y-1 left-1/2 w-0.5 -translate-x-1/2' : 'inset-x-0 top-1/2 h-0.5 -translate-y-1/2',
        )
      "
      aria-hidden="true"
    />
  </button>
</template>
