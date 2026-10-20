<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The sequencer panel of the scene page, a tab of the bottom dock in the edit mode. It has the play bar (play and
 * pause, steps, the time, the loop between A and B), the record mode and a form to add a track or a marker. It also
 * has the track list for each entity with the keys on the time ruler (SequencerTracks.vue). The curve editor of the
 * selected number track is in SequencerCurve.vue. Each change is a command and one step of the history.
 *
 * The head (SequencerHeader.vue) has the sequence picker, New sequence, the duration, the loop and the initial state.
 * The add form has the nine track kinds (a camera cut, an event and an action track belong to the sequence). The form
 * of the selected key is in SequencerKeyForm.vue.
 *
 * The texts are Fluent messages of `src/i18n/en-US/sequencer.ftl`. The track kinds and the entity names are data
 * values.
 */
import { useI18n } from "@scenity/i18n";
import { cn } from "@scenity/ui";
import { ChevronLeft, ChevronRight, Circle, Pause, Play, Repeat, SkipBack } from "lucide-vue-next";
import { computed, ref } from "vue";
import { button } from "../../core/labUi";
import type { PageSequence } from "./pageSequence";
import SequencerCurve from "./SequencerCurve.vue";
import SequencerHeader from "./SequencerHeader.vue";
import SequencerKeyForm from "./SequencerKeyForm.vue";
import { actionNames, sequenceKind, TRACK_KIND_ORDER, type TrackKindName } from "./keyForms";
import { secondsText } from "./sequencerModel";
import SequencerTracks from "./SequencerTracks.vue";
import { STEP, useSequencer } from "./useSequencer";

const { $t } = useI18n();
const props = defineProps<{
  readonly sequence: PageSequence;
  readonly selected: () => readonly string[];
  /** The sequence files of the project (for the picker). */
  sequences?(): Promise<readonly string[]>;
}>();

const panel = ref<HTMLElement | null>(null);
const state = useSequencer({ sequence: props.sequence, selected: props.selected }, panel);
const { time, playing, loopFrom, loopTo, looping, recording, error, scene, proposals } = state;
const doc = state.sequence;

/** The kinds of track that the form adds. */
const KINDS = TRACK_KIND_ORDER;
const kind = ref<TrackKindName>("transform");
const actions = computed(() => actionNames(doc.value));
const projectSequences = (): Promise<readonly string[]> => props.sequences?.() ?? Promise.resolve([]);
const entity = ref("");
const path = ref("");
const marker = ref("");
const entities = computed(() => Object.keys(scene.value.entities).sort());

function addTrack(): void {
  // A camera, an event and an action track have no entity, so the command gets no entity argument.
  const id = sequenceKind(kind.value) ? "" : entity.value === "" ? (props.selected()[0] ?? "") : entity.value;
  const args = {
    kind: kind.value,
    ...(id === "" ? {} : { entity: id }),
    ...(kind.value === "property" ? { path: path.value } : {}),
  };
  void state.run("sequence.track.add", args);
}

function addMarker(): void {
  void state.run("sequence.marker.add", { name: marker.value.trim() }).then((done) => {
    if (done) marker.value = "";
  });
}

const control = cn(button, "inline-flex size-7 shrink-0 items-center justify-center p-0");
const field = "h-7 rounded-control border border-border-subtle bg-surface-sunken px-1.5 text-caption text-text-primary";
</script>

<template>
  <section
    ref="panel"
    class="flex min-h-0 flex-col gap-1 p-1.5 text-caption text-text-primary"
    :aria-label="$t('sequencer-panel')"
    tabindex="-1"
    data-testid="sequencer"
    :data-time="time"
    :data-recording="recording ? '1' : '0'"
  >
    <SequencerHeader :state="state" :path="sequence.path" :sequences="projectSequences" />
    <div class="flex flex-wrap items-center gap-1" role="group" :aria-label="$t('sequencer-timeline')">
      <button
        type="button"
        :class="control"
        :aria-label="$t('sequencer-start')"
        :title="$t('sequencer-start')"
        @click="state.seek(0)"
      >
        <SkipBack class="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        :class="control"
        :aria-label="$t('sequencer-back', { ms: STEP.short })"
        :title="$t('sequencer-back-title')"
        @click="state.step(-1, $event.shiftKey)"
      >
        <ChevronLeft class="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        :class="cn(control, 'bg-accent-brand text-text-on-accent hover:bg-accent-brand-hover')"
        :aria-label="playing ? $t('sequencer-pause') : $t('sequencer-play')"
        :title="playing ? $t('sequencer-pause-title') : $t('sequencer-play-title')"
        data-testid="sequencer-play"
        @click="state.toggle()"
      >
        <Pause v-if="playing" class="size-3.5" aria-hidden="true" />
        <Play v-else class="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        :class="control"
        :aria-label="$t('sequencer-forward', { ms: STEP.short })"
        :title="$t('sequencer-forward-title')"
        @click="state.step(1, $event.shiftKey)"
      >
        <ChevronRight class="size-3.5" aria-hidden="true" />
      </button>
      <span class="min-w-24 font-mono tabular-nums" data-testid="sequencer-time"
        >{{ secondsText(time) }} / {{ secondsText(doc.duration) }}</span
      >
      <button
        type="button"
        :class="control"
        :title="$t('sequencer-loop-from-title')"
        data-testid="sequencer-loop-a"
        @click="state.setLoop('from')"
      >
        A
      </button>
      <button
        type="button"
        :class="control"
        :title="$t('sequencer-loop-to-title')"
        data-testid="sequencer-loop-b"
        @click="state.setLoop('to')"
      >
        B
      </button>
      <button
        type="button"
        :class="cn(control, looping && 'border-accent-brand text-accent-brand')"
        :aria-label="$t('sequencer-loop-clear')"
        :title="looping ? $t('sequencer-loop-on-title') : $t('sequencer-loop-off-title')"
        :disabled="loopFrom === null && loopTo === null"
        data-testid="sequencer-loop-clear"
        @click="state.clearLoop()"
      >
        <Repeat class="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        :class="
          cn(button, 'inline-flex h-7 items-center gap-1', recording && 'border-status-negative text-status-negative')
        "
        :aria-pressed="recording"
        :title="$t('sequencer-record-title')"
        data-testid="sequencer-record"
        @click="state.toggleRecord()"
      >
        <Circle class="size-3" :fill="recording ? 'currentColor' : 'none'" aria-hidden="true" />
        {{ $t("sequencer-record") }}
      </button>
      <span class="ml-auto flex items-center gap-1">
        <select
          v-model="kind"
          :class="field"
          :aria-label="$t('sequencer-track-kind')"
          data-testid="sequencer-track-kind"
        >
          <option v-for="item in KINDS" :key="item" :value="item" translate="no">{{ item }}</option>
        </select>
        <select
          v-if="!sequenceKind(kind)"
          v-model="entity"
          :class="field"
          :aria-label="$t('sequencer-track-entity')"
          data-testid="sequencer-track-entity"
        >
          <option value="">{{ $t("sequencer-track-selected") }}</option>
          <option v-for="id in entities" :key="id" :value="id" translate="no">
            {{ scene.entities[id]?.name ?? id }}
          </option>
        </select>
        <input
          v-if="kind === 'property'"
          v-model="path"
          :class="cn(field, 'w-28')"
          placeholder="camera/fov"
          :aria-label="$t('sequencer-track-path')"
          data-testid="sequencer-track-path"
        />
        <button type="button" :class="cn(button, 'h-7')" data-testid="sequencer-add-track" @click="addTrack">
          {{ $t("sequencer-add-track") }}
        </button>
        <input
          v-model="marker"
          :class="cn(field, 'w-24')"
          :placeholder="$t('sequencer-marker-sample')"
          :aria-label="$t('sequencer-marker-name')"
          data-testid="sequencer-marker-name"
          @keydown.enter="addMarker"
        />
        <button type="button" :class="cn(button, 'h-7')" data-testid="sequencer-add-marker" @click="addMarker">
          {{ $t("sequencer-add-marker") }}
        </button>
      </span>
    </div>
    <p v-if="error !== null" class="text-status-negative" role="alert" data-testid="sequencer-error">{{ error }}</p>
    <div
      v-if="proposals.length > 0"
      class="flex items-center gap-1 rounded-control border border-dashed border-accent-brand px-1.5 py-0.5"
      role="status"
      data-testid="sequencer-proposals"
    >
      <span class="flex-1">{{ $t("sequencer-proposals", { count: proposals.length }) }}</span>
      <button type="button" :class="button" data-testid="sequencer-accept-all" @click="state.acceptProposals()">
        {{ $t("sequencer-accept-all") }}
      </button>
      <button type="button" :class="button" data-testid="sequencer-reject-all" @click="state.rejectProposals()">
        {{ $t("sequencer-reject-all") }}
      </button>
    </div>
    <SequencerTracks :state="state" :actions="actions" class="min-h-0 flex-1" />
    <SequencerKeyForm :state="state" :actions="actions" />
    <SequencerCurve :state="state" />
  </section>
</template>
