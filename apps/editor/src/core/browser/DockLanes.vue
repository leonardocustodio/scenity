<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The clip lanes of the dock: one lane for each member across the window of the play bar. A lane has a part for each
 * catalog clip (a solid color) or for each family without a clip ID (a pale color). Each family has one color. A hover
 * shows the clip and its times. A press seeks to its start.
 *
 * The texts are Fluent messages of `src/i18n/en-US/browser.ftl`.
 */
import { cn } from "@scenity/ui";
import { useI18n } from "@scenity/i18n";
import { computed } from "vue";
import { useLab } from "../labContext";
import { segmentLabel, type LaneSegment } from "../lanes";
import { memberLabel } from "../sequence";
import type { FrameStrip } from "./useFrameStrip";

const props = defineProps<{ readonly strip: FrameStrip }>();
const { clock, take, browser } = useLab();
const { $t } = useI18n();
const { range, lanes, lanesSource } = props.strip;

/** The colors of the families: token classes. A family always gets the same color. */
const PALETTE = [
  "bg-channel-ecg",
  "bg-channel-spo",
  "bg-status-info",
  "bg-status-caution",
  "bg-status-positive",
  "bg-accent-brand",
  "bg-alarm-low",
  "bg-alarm-medium",
  "bg-status-attention",
] as const;

function colorOf(family: string): string {
  let hash = 0;
  for (const char of family) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length] ?? "bg-status-neutral";
}

const rows = computed(() =>
  Object.entries(lanes.value)
    .filter(([, lane]) => lane.length > 0)
    .map(([member, lane]) => ({ member, name: memberLabel(member), lane })),
);

function place(segment: LaneSegment): { left: string; width: string } {
  const { from, to } = range.value;
  const span = Math.max(1, to - from);
  return {
    left: `${String(((segment.from - from) / span) * 100)}%`,
    width: `${String(((segment.to - segment.from) / span) * 100)}%`,
  };
}

function seek(segment: LaneSegment): void {
  clock.pause();
  clock.seek(segment.from);
  take.refresh();
}

const seconds = (ms: number): string => (ms / 1000).toFixed(2);

/**
 * The tracks of a catalog preset next to the lanes of its take. Each clip of a track is "drawn" when a lane of the
 * window has it, else "missing". A "missing" clip is a clip that the scene does not draw, or not in this window.
 */
const tracks = computed(() => {
  const preset = browser?.item.value?.preset;
  if (preset === undefined) return [];
  const drawn = new Set(
    Object.values(lanes.value).flatMap((lane) =>
      lane.flatMap((segment) => (segment.clip === null ? [] : [segment.clip])),
    ),
  );
  return preset.tracks.map((track) => ({
    track: track.track,
    clips: track.clips.map((clip) => ({ clip, drawn: drawn.has(clip) })),
  }));
});
</script>

<template>
  <div class="flex flex-col gap-0.5 px-2 pb-1 text-[0.625rem]" data-testid="dock-lanes" :data-source="lanesSource">
    <p v-if="rows.length === 0" class="text-text-secondary">
      {{ lanesSource === "live" ? $t("browser-lanes-live-empty") : $t("browser-lanes-empty") }}
    </p>
    <div v-for="row in rows" :key="row.member" class="flex items-center gap-1.5">
      <span class="w-10 shrink-0 truncate text-text-secondary" translate="no">{{ row.name }}</span>
      <div class="relative h-3.5 min-w-0 flex-1 rounded-[0.2rem] bg-surface-sunken">
        <button
          v-for="segment in row.lane"
          :key="`${segment.from}-${segmentLabel(segment)}`"
          type="button"
          :class="
            cn(
              'absolute inset-y-0 overflow-hidden rounded-[0.2rem] border-r border-surface-overlay px-1 text-left leading-[0.875rem] whitespace-nowrap text-surface-base',
              colorOf(segment.family),
              segment.clip === null && 'opacity-40',
            )
          "
          :style="place(segment)"
          :title="`${segmentLabel(segment)} · ${segment.family} · ${seconds(segment.from)}–${seconds(segment.to)} s`"
          :data-clip="segment.clip ?? ''"
          translate="no"
          @click="seek(segment)"
        >
          {{ segmentLabel(segment).replace(/^clip_/, "") }}
        </button>
      </div>
    </div>
    <div v-if="tracks.length > 0" class="mt-1 flex flex-col gap-0.5" data-testid="dock-tracks">
      <p class="text-text-secondary">
        {{ $t("browser-lanes-tracks", { item: browser?.item.value?.key ?? "" }) }}
      </p>
      <div v-for="row in tracks" :key="row.track" class="flex flex-wrap items-center gap-1">
        <span class="w-14 shrink-0 truncate text-text-secondary" translate="no">{{ row.track }}</span>
        <span
          v-for="(entry, index) in row.clips"
          :key="`${entry.clip}-${String(index)}`"
          :class="
            cn(
              'rounded-pill border px-1.5',
              entry.drawn ? 'border-status-positive text-status-positive' : 'border-border-subtle text-text-secondary',
            )
          "
          :title="entry.drawn ? $t('browser-lanes-drawn') : $t('browser-lanes-missing')"
          :data-drawn="entry.drawn"
          ><span translate="no">{{ entry.clip.replace(/^clip_/, "") }}</span></span
        >
      </div>
    </div>
  </div>
</template>
