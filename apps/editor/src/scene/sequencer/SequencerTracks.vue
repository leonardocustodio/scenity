<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The track list and the time ruler of the sequencer. It has a group for each entity and a row for each track (the
 * audio tracks of an entity are in its group). Each track has its keys on its lane. The ruler shows the markers and
 * the time of the clock. A press on the ruler seeks and a drag scrubs. A drag of a key moves it (one step at the end).
 * A click selects a key (Delete deletes it) or a track (the curve editor shows it). A drag of a marker moves it. "+"
 * adds a key at the time of the clock, and "×" removes the track.
 *
 * The lanes show a window of the time line (timeWindow.ts). ⌘ or Ctrl and the wheel zoom at the pointer, and the
 * wheel pans. The −, + and Fit buttons also zoom. A drag of a key or of a marker snaps to the clock, the markers and
 * the other keys, else to 100 ms. Alt gives the exact time.
 *
 * A clip from the clip browser that drops on the tracks becomes an animation key at the time of the drop. The time
 * snaps as for a key drag. The key goes on the animation track of the entity of the clip. If there is no such track, a
 * new track starts with the key.
 *
 * The rows include the proposals of the agents. A track or a key that only a proposal has is a ghost until the owner
 * accepts it. A ghost is a dashed mark that ignores a press.
 *
 * The texts are Fluent messages of `src/i18n/en-US/sequencer.ftl`. The entity names, the track labels and the marker
 * names show in elements with `translate="no"`.
 */
import { useI18n } from "@scenity/i18n";
import { cn } from "@scenity/ui";
import { Plus, X } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import AudioWave from "./AudioWave.vue";
import { CLIP_DRAG_TYPE, clipCommand, readClipDrag } from "../clips/clipBrowser";
import { firstKeyFields } from "./keyForms";
import { secondsText } from "./sequencerModel";
import {
  fullWindow,
  panWindow,
  snapTime,
  windowShare,
  windowTicks,
  windowTimeAt,
  zoomWindow,
  type TimeWindow,
} from "./timeWindow";
import type { Actor } from "@scenity/editor-core";
import { actorColour } from "../actorColour";
import { proposedSequence, type KeyRef, type SequencerState } from "./useSequencer";

const { $t } = useI18n();
const props = defineProps<{
  readonly state: SequencerState;
  /** The action names (the first value of a new action key). */
  readonly actions?: readonly string[];
}>();
const { rows, sequence, time, selectedTrack, selectedKey, loopFrom, loopTo, scene } = props.state;

/** True for a track that only a proposal has. */
const ghostTrack = (track: number): boolean => sequence.value.tracks[track] === undefined;
/** True for a key that only a proposal has (the base track has no equal key). */
function ghostKey(track: number, index: number): boolean {
  const base = sequence.value.tracks[track];
  const key = props.state.proposed.value.tracks[track]?.keys[index];
  if (base === undefined || key === undefined) return true;
  const text = JSON.stringify(key);
  return !base.keys.some((item) => JSON.stringify(item) === text);
}

/**
 * The actor of the proposal of a ghost key (the session of an agent), or null. The proposal is the first proposal
 * whose ops alone give the key.
 */
function ghostActor(track: number, index: number): Actor | null {
  if (!ghostKey(track, index)) return null;
  const text = JSON.stringify(props.state.proposed.value.tracks[track]?.keys[index]);
  for (const proposal of props.state.proposals.value) {
    const alone = proposedSequence(sequence.value, [proposal]);
    if (alone.tracks[track]?.keys.some((item) => JSON.stringify(item) === text) === true)
      return proposal.edit.actor ?? null;
  }
  return null;
}

/** The name of a key for its tooltip, with the agent of its proposal. */
function keyTitle(label: string, track: number, index: number, t: number): string {
  const actor = ghostActor(track, index);
  const words = $t("sequencer-key-title", { track: label, time: secondsText(t) });
  return actor === null ? words : `${words} · ${$t("sequencer-key-proposed", { name: actor.name ?? "" })}`;
}

/** Add a key at the time of the clock, with a first value for a kind with no value of the frame. */
function addKey(index: number): void {
  const track = sequence.value.tracks[index];
  const value = track === undefined ? undefined : firstKeyFields(track, scene.value, props.actions ?? []);
  void props.state.run("sequence.key.add", {
    track: index,
    ...(value === undefined ? {} : { value: JSON.stringify(value) }),
  });
}

const ruler = ref<HTMLElement | null>(null);
const duration = computed(() => sequence.value.duration);
const view = ref<TimeWindow>(fullWindow(duration.value));
// A new duration shows the whole time line again.
watch(duration, (next) => (view.value = fullWindow(next)));
const ticks = computed(() => windowTicks(view.value));
const markers = computed(() => Object.entries(sequence.value.markers ?? {}).sort(([, a], [, b]) => a - b));
const left = (t: number): string => `${String(windowShare(t, view.value))}%`;
/** True for a time in the window. */
const shown = (t: number): boolean => t >= view.value.from && t <= view.value.to;

/** The time under a pointer, from the box of the ruler (every lane has its width). */
function timeAt(event: MouseEvent): number {
  const box = ruler.value?.getBoundingClientRect();
  if (box === undefined || box.width <= 0) return 0;
  return windowTimeAt(event.clientX - box.left, box.width, view.value, duration.value);
}

/** The ms of one px of a lane. */
function msPerPx(): number {
  const width = ruler.value?.getBoundingClientRect().width ?? 0;
  return width <= 0 ? 0 : (view.value.to - view.value.from) / width;
}

/** The times that a drag snaps to: the clock, the markers and the keys (not the dragged key). */
function snapTimes(skip?: KeyRef, marker?: string): number[] {
  const keys = rows.value.flatMap((row) =>
    row.kind === "group"
      ? []
      : row.keys.filter((key) => skip?.track !== row.track || skip.key !== key.index).map((key) => key.t),
  );
  return [time.value, ...markers.value.filter(([name]) => name !== marker).map(([, at]) => at), ...keys];
}

/** ⌘ or Ctrl and the wheel zoom at the pointer; the wheel pans. */
function onWheel(event: WheelEvent): void {
  if (event.ctrlKey || event.metaKey) {
    view.value = zoomWindow(view.value, event.deltaY > 0 ? 1.25 : 0.8, timeAt(event), duration.value);
  } else {
    const delta = event.deltaX !== 0 ? event.deltaX : event.shiftKey ? event.deltaY : 0;
    if (delta === 0) return;
    view.value = panWindow(view.value, delta * msPerPx(), duration.value);
  }
  event.preventDefault();
}

/** A zoom of the buttons at the middle of the window (Fit: the whole time line). */
function zoom(factor: number | null): void {
  const middle = (view.value.from + view.value.to) / 2;
  view.value = factor === null ? fullWindow(duration.value) : zoomWindow(view.value, factor, middle, duration.value);
}

/** A drag of the pointer: `move` at each move, `end` at the release, with the event of each. */
function follow(
  event: PointerEvent,
  move: (t: number, next: PointerEvent) => void,
  end: (t: number, next: PointerEvent) => void,
): void {
  const target = event.currentTarget as HTMLElement;
  target.setPointerCapture(event.pointerId);
  const onMove = (next: PointerEvent): void => move(timeAt(next), next);
  const onUp = (next: PointerEvent): void => {
    target.removeEventListener("pointermove", onMove);
    target.removeEventListener("pointerup", onUp);
    target.removeEventListener("pointercancel", onUp);
    end(timeAt(next), next);
  };
  target.addEventListener("pointermove", onMove);
  target.addEventListener("pointerup", onUp);
  target.addEventListener("pointercancel", onUp);
}

function onRuler(event: PointerEvent): void {
  if (event.button !== 0) return;
  props.state.seek(timeAt(event));
  follow(
    event,
    (t) => props.state.seek(t),
    (t) => props.state.seek(t),
  );
}

function onKey(event: PointerEvent, ref: KeyRef): void {
  if (event.button !== 0) return;
  event.stopPropagation();
  selectedKey.value = ref;
  selectedTrack.value = ref.track;
  props.state.drag.begin();
  const near = snapTimes(ref);
  const snapped = (t: number, next: PointerEvent): number => snapTime(t, near, msPerPx(), next.altKey);
  follow(
    event,
    (t, next) => props.state.drag.to(ref, snapped(t, next)),
    (t, next) => void props.state.drag.end(ref, snapped(t, next)),
  );
}

/** The time of a marker during its drag, by name. */
const markerDrag = ref<{ name: string; t: number } | null>(null);

function onMarker(event: PointerEvent, name: string): void {
  if (event.button !== 0) return;
  event.stopPropagation();
  markerDrag.value = { name, t: sequence.value.markers?.[name] ?? 0 };
  const near = snapTimes(undefined, name);
  const snapped = (t: number, next: PointerEvent): number => snapTime(t, near, msPerPx(), next.altKey);
  follow(
    event,
    (t, next) => (markerDrag.value = { name, t: snapped(t, next) }),
    (t, next) => {
      markerDrag.value = null;
      const at = snapped(t, next);
      if (at !== sequence.value.markers?.[name]) void props.state.run("sequence.marker.move", { name, t: at });
    },
  );
}

function markerAt(name: string, t: number): number {
  return markerDrag.value?.name === name ? markerDrag.value.t : t;
}

/** A clip from the clip browser over the tracks: the drop copies it. */
function onClipOver(event: DragEvent): void {
  if (event.dataTransfer?.types.includes(CLIP_DRAG_TYPE) !== true) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
}

/** A dropped clip becomes an animation key at the time of the drop. */
function onClipDrop(event: DragEvent): void {
  const drag = readClipDrag(event.dataTransfer?.getData(CLIP_DRAG_TYPE) ?? "");
  if (drag === null) return;
  event.preventDefault();
  const t = snapTime(timeAt(event), snapTimes(), msPerPx(), event.altKey);
  const { command, args } = clipCommand(sequence.value, drag, t);
  void props.state.run(command, args);
}

const selectedKeyOf = (track: number, key: number): boolean =>
  selectedKey.value?.track === track && selectedKey.value.key === key;
const iconButton =
  "inline-flex size-5 items-center justify-center rounded-control text-text-secondary hover:text-text-primary";
</script>

<template>
  <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -- a clip drop on the tracks; "Add at the playhead" of the clip browser is the keyboard form. -->
  <div
    class="grid min-h-0 grid-cols-[11rem_1fr] overflow-y-auto"
    data-testid="sequencer-tracks"
    :data-from="view.from"
    :data-to="view.to"
    @wheel="onWheel"
    @dragover="onClipOver"
    @drop="onClipDrop"
  >
    <div class="sticky top-0 z-10 flex h-8 items-center gap-1 bg-surface-overlay text-text-secondary">
      <span class="min-w-0 flex-1 truncate">{{ $t("sequencer-tracks") }}</span>
      <button
        type="button"
        :class="iconButton"
        :title="$t('sequencer-zoom-out')"
        :aria-label="$t('sequencer-zoom-out')"
        data-testid="sequencer-zoom-out"
        @click="zoom(2)"
      >
        −
      </button>
      <button
        type="button"
        :class="iconButton"
        :title="$t('sequencer-zoom-in')"
        :aria-label="$t('sequencer-zoom-in')"
        data-testid="sequencer-zoom-in"
        @click="zoom(0.5)"
      >
        +
      </button>
      <button
        type="button"
        :class="cn(iconButton, 'w-auto px-1')"
        :title="$t('sequencer-zoom-fit')"
        data-testid="sequencer-zoom-fit"
        @click="zoom(null)"
      >
        {{ $t("sequencer-zoom-fit-short") }}
      </button>
    </div>
    <div
      ref="ruler"
      class="sticky top-0 z-10 h-8 cursor-ew-resize overflow-hidden border-b border-border-subtle bg-surface-overlay"
      data-testid="sequencer-ruler"
      @pointerdown="onRuler"
    >
      <div
        v-if="loopFrom !== null"
        class="pointer-events-none absolute inset-y-1 bg-accent-brand/20"
        :style="{ left: left(loopFrom), right: `calc(100% - ${left(loopTo ?? duration)})` }"
      />
      <span
        v-for="tick in ticks"
        :key="tick"
        class="pointer-events-none absolute top-0 border-l border-border-subtle pl-0.5 text-caption leading-none text-text-secondary"
        :style="{ left: left(tick) }"
        >{{ secondsText(tick) }}</span
      >
      <button
        v-for="[name, at] in markers.filter(([, time]) => shown(time))"
        :key="name"
        type="button"
        class="absolute bottom-0 h-3 -translate-x-1/2 rounded-sm bg-status-caution px-1 py-px text-caption leading-none text-surface-sunken"
        :style="{ left: left(markerAt(name, at)) }"
        :title="$t('sequencer-marker-title', { name, time: secondsText(at) })"
        :data-testid="`sequencer-marker-${name}`"
        translate="no"
        @pointerdown="onMarker($event, name)"
      >
        {{ name }}
      </button>
      <span
        v-if="shown(time)"
        class="pointer-events-none absolute inset-y-0 w-px bg-accent-brand"
        :style="{ left: left(time) }"
      />
    </div>
    <template v-for="row in rows" :key="row.id">
      <div
        v-if="row.kind === 'group'"
        class="col-span-2 mt-1 truncate font-medium"
        :data-testid="`sequencer-group-${row.entity ?? ''}`"
        :translate="row.entity === null ? undefined : 'no'"
      >
        {{ row.entity === null ? $t("sequencer-group-sequence") : row.label }}
      </div>
      <template v-else>
        <div
          :class="
            cn(
              'flex h-6 items-center gap-1 truncate pl-2',
              selectedTrack === row.track && 'text-accent-brand',
              ghostTrack(row.track) && 'italic text-accent-brand',
            )
          "
          :data-ghost="ghostTrack(row.track) ? '1' : undefined"
          :data-testid="`sequencer-track-${row.track}`"
        >
          <button
            type="button"
            class="flex-1 truncate text-left"
            translate="no"
            :title="row.label"
            :aria-pressed="selectedTrack === row.track"
            @click="selectedTrack = row.track"
          >
            {{ row.label }}
          </button>
          <button
            v-if="!ghostTrack(row.track)"
            type="button"
            :class="iconButton"
            :aria-label="$t('sequencer-key-add')"
            :title="$t('sequencer-key-add')"
            :data-testid="`sequencer-key-add-${row.track}`"
            @click.stop="addKey(row.track)"
          >
            <Plus class="size-3.5" aria-hidden="true" />
          </button>
          <button
            v-if="!ghostTrack(row.track)"
            type="button"
            :class="iconButton"
            :aria-label="$t('sequencer-track-remove')"
            :title="$t('sequencer-track-remove')"
            :data-testid="`sequencer-track-remove-${row.track}`"
            @click.stop="state.run('sequence.track.remove', { track: row.track })"
          >
            <X class="size-3.5" aria-hidden="true" />
          </button>
        </div>
        <div
          class="relative h-6 overflow-hidden border-b border-border-subtle/50"
          :data-testid="`sequencer-lane-${row.track}`"
        >
          <AudioWave
            v-if="sequence.tracks[row.track]?.kind === 'audio'"
            :track="sequence.tracks[row.track]!"
            :scene="scene"
            :duration="duration"
            :view="view"
          />
          <span
            v-if="shown(time)"
            class="pointer-events-none absolute inset-y-0 w-px bg-accent-brand/60"
            :style="{ left: left(time) }"
          />
          <button
            v-for="key in row.keys.filter((item) => shown(item.t))"
            :key="`${key.index}-${key.t}`"
            type="button"
            :class="
              cn(
                'absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-text-primary',
                selectedKeyOf(row.track, key.index) ? 'bg-accent-brand' : 'bg-surface-raised',
                ghostKey(row.track, key.index) && 'pointer-events-none border-dashed border-accent-brand opacity-70',
              )
            "
            :data-ghost="ghostKey(row.track, key.index) ? '1' : undefined"
            :data-actor="ghostActor(row.track, key.index)?.name"
            :style="{
              left: left(key.t),
              ...(ghostActor(row.track, key.index) === null
                ? {}
                : { borderColor: actorColour(ghostActor(row.track, key.index) ?? {}) }),
            }"
            :title="keyTitle(row.label, row.track, key.index, key.t)"
            :aria-label="$t('sequencer-key', { time: secondsText(key.t) })"
            :data-testid="`sequencer-key-${row.track}-${key.index}`"
            :data-t="key.t"
            @pointerdown="onKey($event, { track: row.track, key: key.index })"
          />
        </div>
      </template>
    </template>
    <p v-if="rows.length === 0" class="col-span-2 p-2 text-text-secondary">
      {{ $t("sequencer-empty") }}
    </p>
  </div>
</template>
