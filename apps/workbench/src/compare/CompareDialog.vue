<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The compare view of the workbench: two pictures of a pair, large, over the page. The pictures are side by side or
 * as a wipe (B over A, cut at the line: A on the left, B on the right). A turn opens the view with the frame and the
 * motion before and after. The picker opens it with the sheets of two candidates. The pair tabs change the pair and
 * keep the view and the line. Thus the frame and the motion show the same cut. Keys: Escape closes, W toggles the
 * wipe, S swaps A and B, the arrow keys move the line. The lab page has the same view for takes (`?view=compare`).
 *
 * Developer page: its text is not in Fluent (tools/wording-allowlist.json).
 */
import { ArrowRightLeft, Columns2, SplitSquareHorizontal, X } from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import PictureImg from "../layout/PictureImg.vue";
import { cn, iconButton, iconTab, tab } from "../layout/ui";
import { swapPair, type ComparePair, type CompareSide } from "./comparePairs";

const props = defineProps<{ readonly pairs: readonly ComparePair[]; readonly title: string }>();
const emit = defineEmits<{ close: [] }>();

type Mode = "side" | "wipe";
const mode = ref<Mode>("side");
const split = ref(50);
const index = ref(0);
const swapped = ref(false);
const stage = ref<HTMLElement | null>(null);
let dragging = false;

const pair = computed<ComparePair | null>(() => {
  const chosen = props.pairs[Math.min(index.value, props.pairs.length - 1)] ?? null;
  return chosen === null ? null : swapped.value ? swapPair(chosen) : chosen;
});

const time = (side: CompareSide) => (side.simMs === null ? "" : `${(side.simMs / 1000).toFixed(2)} s`);

function onDown(event: PointerEvent): void {
  dragging = true;
  splitAt(event);
}

function onMove(event: PointerEvent): void {
  if (dragging) splitAt(event);
}

function onUp(): void {
  dragging = false;
}

function splitAt(event: PointerEvent): void {
  const box = stage.value?.getBoundingClientRect();
  if (box === undefined || box.width <= 0) return;
  split.value = Math.round(Math.min(100, Math.max(0, ((event.clientX - box.left) / box.width) * 100)));
}

/** The keys of the view; no key of the page under it (the keys of the picker) acts while the view is open. */
function onKey(event: KeyboardEvent): void {
  event.stopPropagation();
  const target = event.target as HTMLElement | null;
  if (target !== null && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) && event.key !== "Escape") return;
  if (event.key === "Escape") emit("close");
  else if (event.key === "w" || event.key === "W") mode.value = mode.value === "wipe" ? "side" : "wipe";
  else if (event.key === "s" || event.key === "S") swapped.value = !swapped.value;
  else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    split.value = Math.min(100, Math.max(0, split.value + (event.key === "ArrowLeft" ? -5 : 5)));
  } else return;
  event.preventDefault();
}
onMounted(() => globalThis.addEventListener("keydown", onKey, true));
onBeforeUnmount(() => globalThis.removeEventListener("keydown", onKey, true));
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex flex-col gap-2 bg-surface-scrim p-4 text-caption text-text-primary"
      role="dialog"
      aria-modal="true"
      :aria-label="`Compare: ${title}`"
      data-testid="compare-dialog"
      :data-mode="mode"
    >
      <header class="flex flex-wrap items-center gap-2 rounded-card bg-surface-raised px-3 py-2 shadow-overlay">
        <h2 class="mr-auto text-label">Compare · {{ title }}</h2>
        <div v-if="pairs.length > 1" class="flex gap-0.5" role="tablist" aria-label="Pair">
          <button
            v-for="(item, at) in pairs"
            :key="item.label"
            type="button"
            role="tab"
            :aria-selected="at === index"
            :class="tab(at === index)"
            :data-testid="`compare-pair-${item.label.toLowerCase()}`"
            @click="index = at"
          >
            {{ item.label }}
          </button>
        </div>
        <div class="flex gap-0.5" role="tablist" aria-label="View">
          <button
            type="button"
            role="tab"
            :aria-selected="mode === 'side'"
            :class="iconTab(mode === 'side')"
            title="Side by side"
            data-testid="compare-side"
            @click="mode = 'side'"
          >
            <Columns2 class="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="mode === 'wipe'"
            :class="iconTab(mode === 'wipe')"
            title="Wipe (W)"
            data-testid="compare-wipe-mode"
            @click="mode = 'wipe'"
          >
            <SplitSquareHorizontal class="size-4" aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          :class="iconButton"
          title="Swap A and B (S)"
          data-testid="compare-swap"
          @click="swapped = !swapped"
        >
          <ArrowRightLeft class="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          :class="iconButton"
          title="Close (Escape)"
          data-testid="compare-close"
          @click="emit('close')"
        >
          <X class="size-4" aria-hidden="true" />
        </button>
      </header>
      <template v-if="pair !== null">
        <div v-if="mode === 'side'" class="grid min-h-0 flex-1 grid-cols-2 gap-2">
          <figure v-for="(side, at) in [pair.a, pair.b]" :key="at" class="flex min-h-0 flex-col gap-1">
            <div class="grid min-h-0 flex-1 place-items-center overflow-hidden rounded-control bg-surface-sunken">
              <PictureImg
                v-if="side.picture !== null"
                :picture="side.picture"
                :alt="side.label"
                class="max-h-full max-w-full object-contain"
                :data-testid="`compare-${at === 0 ? 'a' : 'b'}`"
              />
              <img
                v-else-if="side.url !== null"
                :src="side.url"
                :alt="side.label"
                class="max-h-full max-w-full object-contain"
                :data-testid="`compare-${at === 0 ? 'a' : 'b'}`"
              />
              <p v-else class="text-text-secondary">No picture</p>
            </div>
            <figcaption class="flex gap-2 text-text-secondary">
              <span class="font-mono text-text-primary">{{ at === 0 ? "A" : "B" }}</span
              >{{ side.label }}
              <span class="ml-auto font-mono">{{ time(side) }}</span>
            </figcaption>
          </figure>
        </div>
        <div v-else class="flex min-h-0 flex-1 flex-col gap-1">
          <div
            ref="stage"
            class="relative min-h-0 flex-1 cursor-ew-resize touch-none overflow-hidden rounded-control bg-surface-sunken select-none"
            data-testid="compare-stage"
            @pointerdown="onDown"
            @pointermove="onMove"
            @pointerup="onUp"
            @pointerleave="onUp"
          >
            <template v-for="(side, at) in [pair.a, pair.b]" :key="at">
              <PictureImg
                v-if="side.picture !== null"
                :picture="side.picture"
                :alt="side.label"
                class="absolute inset-0 size-full object-contain"
                :style="at === 1 ? { clipPath: `inset(0 0 0 ${String(split)}%)` } : undefined"
                :data-testid="`compare-${at === 0 ? 'a' : 'b'}`"
              />
              <img
                v-else-if="side.url !== null"
                :src="side.url"
                :alt="side.label"
                class="absolute inset-0 size-full object-contain"
                :style="at === 1 ? { clipPath: `inset(0 0 0 ${String(split)}%)` } : undefined"
                :data-testid="`compare-${at === 0 ? 'a' : 'b'}`"
              />
            </template>
            <div
              class="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-text-primary"
              :style="{ left: `${String(split)}%` }"
              data-testid="compare-line"
            />
          </div>
          <div class="flex items-center gap-2 rounded-card bg-surface-raised px-3 py-1.5 text-text-secondary">
            <span class="truncate">A {{ pair.a.label }}</span>
            <input
              v-model.number="split"
              type="range"
              min="0"
              max="100"
              :class="cn('flex-1')"
              aria-label="The line of the wipe: the share of A"
              data-testid="compare-split"
            />
            <span class="truncate">B {{ pair.b.label }}</span>
          </div>
        </div>
      </template>
    </div>
  </Teleport>
</template>
