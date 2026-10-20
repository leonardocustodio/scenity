<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The time line of the 3D room lab. It has play and pause, steps of 50 ms (250 ms with Shift), the speed, and a loop
 * between two times (A and B). It also has a scrub track with a mark at each event of the take and at each phase change
 * of a member. The keys: Space plays and pauses, and comma and period make a step (the arrow keys turn the camera). [
 * and ] set A and B, and \\ clears the loop. A seek shows the frame of that time immediately. The lab state is a
 * function of the time, and the scene removes its frame history.
 *
 * The window mode of the content browser: with a `window`, the track covers only the time of the open item. The time
 * starts at the start of the window, and "Whole take" shows the full take again.
 *
 * The texts are Fluent messages of `src/i18n/en-US/lab-core.ftl`.
 */
import { useI18n } from "@scenity/i18n";
import { cn } from "@scenity/ui";
import { ChevronLeft, ChevronRight, Maximize2, Pause, Play, Repeat, SkipBack } from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import LabIndexPreview from "./LabIndexPreview.vue";
import { useLab } from "./labContext";
// The overview strip is hidden. Remove the comment marks to show it again.
// import LabOverview from "./LabOverview.vue";
import { button, typingInto } from "./labUi";
import { momentsOf, phaseMarks, takeEnd } from "./sequence";
import { SPEEDS } from "./useLabClock";
import { editorScene } from "./sceneSource";

const props = withDefaults(
  defineProps<{
    /** The time of the open item of the content browser, or null for the full take. */
    window?: { readonly from: number; readonly to: number } | null;
  }>(),
  { window: null },
);
const emit = defineEmits<{ whole: [] }>();
const { $t } = useI18n();
const { clock, take, track } = useLab();
const { running, speed, displayMs } = clock;
const events = take.events;

/** A step of the step buttons and of the comma and period keys (ms), and with Shift. */
const STEP = { short: 50, long: 250 } as const;
/** The end of the track: the end of a view track, else after the last event (at least 20 s) and past the clock. */
const end = computed(() =>
  track.value !== null
    ? track.value.duration
    : Math.max(20_000, takeEnd(events.value) + 10_000, Math.ceil((displayMs.value + 2_000) / 5_000) * 5_000),
);

/** The start and the end of the track: the window of the open item, else the take. */
const start = computed(() => props.window?.from ?? 0);
const stop = computed(() => props.window?.to ?? end.value);

interface Mark {
  readonly at: number;
  readonly label: string;
  readonly kind: "event" | "phase" | "moment";
}

/**
 * The marks of the track: the events and the phase changes of the members (from the pure lab state), or the phase
 * changes of the tasks of a view track.
 */
const marks = computed<readonly Mark[]>(() => {
  if (track.value !== null)
    return editorScene()
      .trackMarks(track.value)
      .map((mark) => ({ ...mark, kind: "phase" as const }));
  const list: Mark[] = events.value.map((event) => ({
    at: event.at,
    kind: "event" as const,
    // A timed prop place shows its slot.
    label: `${event.kind}${"member" in event ? ` ${event.member}` : ""}${event.kind === "prop" ? ` ${event.slot}` : ""}`,
  }));
  // The named moments of the take (of the plugin): the key frames of the take.
  for (const [name, at] of Object.entries(momentsOf(take.base.value)))
    list.push({ at, kind: "moment", label: $t("lab-timeline-moment", { name }) });
  // The phase marks come from one scan per list of events (the plugin), not from a replay per update.
  for (const mark of phaseMarks(events.value, end.value)) list.push({ ...mark, kind: "phase" });
  return list;
});

function share(at: number): string {
  const span = Math.max(1, stop.value - start.value);
  return `${String(Math.min(100, Math.max(0, ((at - start.value) / span) * 100)))}%`;
}

/** The marks in the track (all of them, or those of the window). */
const shownMarks = computed(() => marks.value.filter((mark) => mark.at >= start.value && mark.at <= stop.value));

function timeText(ms: number): string {
  const seconds = ms / 1000;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}:${(seconds - minutes * 60).toFixed(2).padStart(5, "0")}`;
}

function seek(ms: number): void {
  // The take refreshes its state at the seek.
  clock.seek(Math.max(0, ms));
}

function step(direction: 1 | -1, long: boolean): void {
  if (running.value) clock.pause();
  seek(clock.simNow() + direction * (long ? STEP.long : STEP.short));
}

function onScrub(event: Event): void {
  seek(Number((event.target as HTMLInputElement).value));
}

// The time under the pointer for the hover preview of the frame index.
const hoverAt = ref<number | null>(null);
const hoverLeft = ref("0%");
function onHover(event: PointerEvent): void {
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  if (box.width <= 0) return;
  const part = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
  hoverAt.value = Math.round(start.value + part * (stop.value - start.value));
  hoverLeft.value = `${String(part * 100)}%`;
}

function toggle(): void {
  clock.toggle();
  take.refresh();
}

// ---------------------------------------------------------------------------------------------
// The loop between A and B.

const { loopFrom, loopTo } = clock;
const looping = computed(() => loopFrom.value !== null && loopTo.value !== null && loopTo.value > loopFrom.value);
let loopFrame: number | null = null;

function watchLoop(): void {
  loopFrame = null;
  if (!looping.value || !running.value) return;
  if (clock.simNow() >= (loopTo.value ?? 0) || clock.simNow() < (loopFrom.value ?? 0)) seek(loopFrom.value ?? 0);
  loopFrame = requestAnimationFrame(watchLoop);
}

// Also run immediately: an item of the content browser can set the loop and run the clock before the time line mounts
// (`review=<family>`, `item=` of the URL).
watch(
  [looping, running],
  () => {
    if (loopFrame !== null) cancelAnimationFrame(loopFrame);
    loopFrame = null;
    if (looping.value && running.value) loopFrame = requestAnimationFrame(watchLoop);
  },
  { immediate: true },
);

function setLoop(edge: "from" | "to"): void {
  const now = Math.round(clock.simNow());
  if (edge === "from") loopFrom.value = now;
  else loopTo.value = now;
}

function clearLoop(): void {
  loopFrom.value = null;
  loopTo.value = null;
}

// ---------------------------------------------------------------------------------------------
// Keys.

function onKey(event: KeyboardEvent): void {
  if (event.ctrlKey || event.metaKey || event.altKey || typingInto(event.target)) return;
  const done = () => {
    event.preventDefault();
  };
  if (event.code === "Space" && !event.repeat) {
    done();
    toggle();
  } else if (event.code === "Comma") {
    done();
    step(-1, event.shiftKey);
  } else if (event.code === "Period") {
    done();
    step(1, event.shiftKey);
  } else if (event.code === "BracketLeft") {
    done();
    setLoop("from");
  } else if (event.code === "BracketRight") {
    done();
    setLoop("to");
  } else if (event.code === "Backslash") {
    done();
    clearLoop();
  }
}

onMounted(() => {
  globalThis.addEventListener("keydown", onKey);
});
onBeforeUnmount(() => {
  globalThis.removeEventListener("keydown", onKey);
  if (loopFrame !== null) cancelAnimationFrame(loopFrame);
});

const control = cn(button, "inline-flex size-8 shrink-0 items-center justify-center p-0 pointer-coarse:size-11");
</script>

<template>
  <div
    class="flex items-center gap-1.5 bg-surface-overlay/90 px-2 py-1.5 text-caption shadow-overlay max-sm:flex-wrap"
    role="group"
    :aria-label="$t('lab-timeline')"
    data-scene-control
    data-testid="lab-timeline"
  >
    <button
      type="button"
      :class="control"
      :aria-label="$t('lab-timeline-start')"
      :title="$t('lab-timeline-start')"
      @click="seek(start)"
    >
      <SkipBack class="size-4" aria-hidden="true" />
    </button>
    <button
      type="button"
      :class="control"
      :aria-label="$t('lab-timeline-back', { ms: STEP.short })"
      :title="$t('lab-timeline-back-title')"
      @click="step(-1, $event.shiftKey)"
    >
      <ChevronLeft class="size-4" aria-hidden="true" />
    </button>
    <button
      type="button"
      :class="cn(control, 'bg-accent-brand text-text-on-accent hover:bg-accent-brand-hover')"
      :aria-label="running ? $t('lab-timeline-pause') : $t('lab-timeline-play')"
      :title="running ? $t('lab-timeline-pause-title') : $t('lab-timeline-play-title')"
      data-testid="lab-timeline-play"
      @click="toggle"
    >
      <Pause v-if="running" class="size-4" aria-hidden="true" />
      <Play v-else class="size-4" aria-hidden="true" />
    </button>
    <button
      type="button"
      :class="control"
      :aria-label="$t('lab-timeline-forward', { ms: STEP.short })"
      :title="$t('lab-timeline-forward-title')"
      @click="step(1, $event.shiftKey)"
    >
      <ChevronRight class="size-4" aria-hidden="true" />
    </button>
    <span
      class="min-w-16 font-mono whitespace-nowrap tabular-nums"
      :aria-label="$t('lab-timeline-sim-time')"
      :title="window === null ? undefined : $t('lab-timeline-take-time', { time: timeText(displayMs) })"
      data-testid="lab-timeline-time"
      >{{
        window === null
          ? timeText(displayMs)
          : `${timeText(Math.max(0, displayMs - window.from))} / ${timeText(window.to - window.from)}`
      }}</span
    >
    <!-- On a phone, the track has a row of its own under the buttons. -->
    <div
      class="relative flex h-8 min-w-0 flex-1 items-center max-sm:order-last max-sm:basis-full"
      @pointermove="onHover"
      @pointerleave="hoverAt = null"
    >
      <!-- The overview strip of the frame index over the track, and the hover preview of the time.
      The overview strip is hidden. Remove the comment marks to show it again.
      <LabOverview :start="start" :stop="stop" class="absolute inset-x-0 bottom-full mb-1" @seek="seek" /> -->
      <LabIndexPreview :at="hoverAt" :left="hoverLeft" />
      <!-- The loop between A and B under the track. -->
      <div
        v-if="loopFrom !== null"
        class="pointer-events-none absolute inset-y-1.5 rounded-control bg-accent-brand/20"
        :style="{ left: share(loopFrom), right: `calc(100% - ${share(loopTo ?? stop)})` }"
        aria-hidden="true"
      />
      <!-- The marks: an event of the take (tall) and a phase change (short). -->
      <span
        v-for="mark in shownMarks"
        :key="`${mark.kind}-${mark.at}-${mark.label}`"
        :class="
          cn(
            'pointer-events-none absolute w-px',
            mark.kind === 'event'
              ? 'inset-y-1 bg-accent-brand'
              : mark.kind === 'moment'
                ? 'inset-y-0.5 w-0.5 bg-status-caution'
                : 'inset-y-2.5 bg-text-secondary',
          )
        "
        :style="{ left: share(mark.at) }"
        :title="$t('lab-timeline-mark', { time: timeText(mark.at), label: mark.label })"
        aria-hidden="true"
      />
      <input
        id="lab-timeline-track"
        :aria-label="$t('lab-timeline-track')"
        class="relative w-full"
        type="range"
        :min="start"
        :max="stop"
        step="10"
        :value="displayMs"
        data-testid="lab-timeline-track"
        @input="onScrub"
      />
    </div>
    <select
      id="lab-timeline-speed"
      :aria-label="$t('lab-timeline-speed')"
      :value="speed"
      class="h-8 rounded-control border border-border-subtle bg-surface-sunken px-1 text-caption"
      @change="clock.setSpeed(Number(($event.target as HTMLSelectElement).value))"
    >
      <option v-for="value in SPEEDS" :key="value" :value="value">{{ value }}×</option>
    </select>
    <button
      type="button"
      :class="control"
      :aria-label="$t('lab-timeline-loop-from')"
      :title="$t('lab-timeline-loop-from-title')"
      @click="setLoop('from')"
    >
      A
    </button>
    <button
      type="button"
      :class="control"
      :aria-label="$t('lab-timeline-loop-to')"
      :title="$t('lab-timeline-loop-to-title')"
      @click="setLoop('to')"
    >
      B
    </button>
    <button
      type="button"
      :class="cn(control, looping && 'border-accent-brand text-accent-brand')"
      :aria-label="$t('lab-timeline-clear-loop')"
      :title="looping ? $t('lab-timeline-loop-on') : $t('lab-timeline-no-loop')"
      :disabled="loopFrom === null && loopTo === null"
      @click="clearLoop"
    >
      <Repeat class="size-4" aria-hidden="true" />
    </button>
    <button
      v-if="window !== null"
      type="button"
      :class="cn(control, 'w-auto gap-1 px-2')"
      :title="$t('lab-timeline-whole-title')"
      data-testid="lab-timeline-whole"
      @click="emit('whole')"
    >
      <Maximize2 class="size-4" aria-hidden="true" /><span class="max-sm:sr-only">{{ $t("lab-timeline-whole") }}</span>
    </button>
  </div>
</template>
