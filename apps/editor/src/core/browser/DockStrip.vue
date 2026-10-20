<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The frame strip of the dock: a picture of the scene at each slot of the window of the play bar, with the playhead
 * above the pictures. A press on a frame seeks to its time. Shift with a press sets the start (A), then the end (B) of
 * the loop. A hover shows the frame larger with its time. The zoom gives 8, 16 or 32 slots, and a long window scrolls
 * horizontally. "Fill" captures the empty slots immediately. The strip also fills itself while the clock plays.
 *
 * The texts are Fluent messages of `src/i18n/en-US/browser.ftl`.
 */
import { cn } from "@scenity/ui";
import { ImagePlus, RefreshCw } from "lucide-vue-next";
import { useI18n } from "@scenity/i18n";
import { computed } from "vue";
import { useLab } from "../labContext";
import { clockText } from "../labUi";
import { STRIP_SLOTS, type StripSlots } from "./browserUrl";
import type { FrameStrip, StripSlot } from "./useFrameStrip";

const props = defineProps<{ readonly strip: FrameStrip }>();
const slotsModel = defineModel<StripSlots>("slots", { required: true });
const { clock, take } = useLab();
const { $t } = useI18n();
const { slots, range, filling, fill, refresh } = props.strip;

const playhead = computed(() => {
  const { from, to } = range.value;
  const share = (clock.displayMs.value - from) / Math.max(1, to - from);
  return share < 0 || share > 1 ? null : `${String(share * 100)}%`;
});
const empty = computed(() => slots.value.filter((slot) => slot.url === null).length);

function timeOf(slot: StripSlot): string {
  const at = slot.simMs ?? slot.at;
  return `${clockText(at)}.${String(Math.round(at % 1000)).padStart(3, "0")}`;
}

function press(slot: StripSlot, event: MouseEvent): void {
  const at = Math.round(slot.simMs ?? slot.at);
  if (event.shiftKey) {
    if (clock.loopFrom.value === null || clock.loopTo.value !== null) {
      clock.loopFrom.value = at;
      clock.loopTo.value = null;
    } else {
      clock.loopTo.value = at;
    }
    return;
  }
  clock.pause();
  clock.seek(at);
  take.refresh();
}

function onZoom(event: Event): void {
  const value = Number((event.target as HTMLSelectElement).value);
  slotsModel.value = STRIP_SLOTS.find((item) => item === value) ?? 16;
}
</script>

<template>
  <div class="flex items-stretch gap-1.5 px-2 pb-1" data-testid="dock-strip">
    <div class="relative min-w-0 flex-1 overflow-x-auto">
      <ol
        class="dock-strip m-0 grid list-none gap-0.5 p-0"
        :style="{
          gridTemplateColumns: `repeat(${String(slots.length)}, minmax(calc(var(--strip-h, 3.75rem) * 4 / 3), 1fr))`,
        }"
      >
        <li v-for="slot in slots" :key="slot.index" class="dock-strip__slot relative">
          <button
            type="button"
            :class="
              cn(
                'dock-strip__frame block w-full overflow-hidden rounded-[0.2rem] bg-surface-sunken outline-none',
                'focus-visible:ring-2 focus-visible:ring-focus-ring',
              )
            "
            :title="$t('browser-strip-frame-title', { time: timeOf(slot) })"
            :aria-label="$t('browser-strip-frame', { time: timeOf(slot) })"
            :data-testid="`dock-strip-${String(slot.index)}`"
            :data-filled="slot.url !== null"
            :data-stale="slot.stale === true ? 'true' : undefined"
            @click="press(slot, $event)"
          >
            <img
              v-if="slot.url !== null"
              :src="slot.url"
              alt=""
              :class="cn('size-full object-cover', slot.stale === true && 'opacity-60 grayscale')"
              draggable="false"
            />
          </button>
          <img
            v-if="slot.url !== null"
            :src="slot.url"
            alt=""
            class="dock-strip__zoom pointer-events-none absolute bottom-full left-1/2 z-30 mb-1 hidden w-60 max-w-none -translate-x-1/2 rounded-control shadow-overlay"
          />
        </li>
      </ol>
      <span
        v-if="playhead !== null"
        class="pointer-events-none absolute inset-y-0 w-0.5 bg-accent-brand"
        :style="{ left: playhead }"
        aria-hidden="true"
      />
    </div>
    <div class="flex shrink-0 flex-col justify-center gap-1 text-[0.6875rem]">
      <select
        :value="slotsModel"
        class="h-6 rounded-control border border-border-subtle bg-surface-sunken px-1"
        :aria-label="$t('browser-strip-zoom')"
        @change="onZoom"
      >
        <option v-for="value in STRIP_SLOTS" :key="value" :value="value">
          {{ $t("browser-strip-slots", { count: value }) }}
        </option>
      </select>
      <div class="flex gap-1">
        <button
          type="button"
          class="inline-flex h-6 flex-1 items-center justify-center gap-1 rounded-control border border-border-subtle bg-surface-sunken px-1 disabled:opacity-50"
          :disabled="filling || empty === 0"
          :title="empty === 0 ? $t('browser-strip-full') : $t('browser-strip-fill-title', { count: empty })"
          data-testid="dock-strip-fill"
          @click="fill()"
        >
          <ImagePlus class="size-3.5" aria-hidden="true" />{{ filling ? "…" : $t("browser-strip-fill") }}
        </button>
        <button
          type="button"
          class="inline-flex size-6 items-center justify-center rounded-control border border-border-subtle bg-surface-sunken"
          :title="$t('browser-strip-refresh-title')"
          :aria-label="$t('browser-strip-refresh')"
          @click="refresh()"
        >
          <RefreshCw class="size-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* The resize handle under the timeline sets the height of a frame. */
.dock-strip__frame {
  height: var(--strip-h, 3.75rem);
}

.dock-strip__slot:hover .dock-strip__zoom {
  display: block;
}
</style>
