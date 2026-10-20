<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Takes panel of an adapted lab face (labFace.ts). It shows the take model of the lab face in the studio: the
 * takes and the named moments of a take. At a time, it shows the members of the state and the marks up to that time.
 * To play a take in the view, use the lab page.
 */
import { useI18n } from "@scenity/i18n";
import { computed, ref, useId } from "vue";
import type { LabTakeModel } from "./labFace";

const props = defineProps<{ sequence: LabTakeModel }>();
const { $t } = useI18n();
const takes = computed(() => props.sequence.takes);
const chosen = ref<string>(
  props.sequence.defaultTake ?? takes.value.find((take) => take.events.length > 0)?.name ?? "",
);
const takeId = useId();
const timeId = useId();
const time = ref(0);
const take = computed(() => takes.value.find((item) => item.name === chosen.value));
const length = computed(() => props.sequence.length(chosen.value));
const moments = computed(() => Object.entries(props.sequence.moments[chosen.value] ?? {}));
const members = computed(() => {
  const state = props.sequence.stateAt(take.value?.events ?? [], time.value);
  return props.sequence.members(state).map((id) => props.sequence.memberLabel?.(id) ?? id);
});
const marks = computed(() => props.sequence.marks(take.value?.events ?? [], time.value));

function choose(name: string): void {
  chosen.value = name;
  time.value = 0;
}
</script>

<template>
  <section class="flex flex-col gap-2 p-2 text-body text-text-primary" data-testid="lab-takes">
    <label class="flex items-center gap-2" :for="takeId">
      <span class="text-label text-text-secondary">{{ $t("lab-takes-take") }}</span>
      <select
        :id="takeId"
        class="rounded-control border border-border-strong bg-surface-raised px-1"
        :value="chosen"
        data-testid="lab-takes-take"
        @change="choose(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="item in takes" :key="item.name" :value="item.name" translate="no">{{ item.label }}</option>
      </select>
    </label>
    <label class="flex items-center gap-2" :for="timeId">
      <span class="text-label text-text-secondary">{{ $t("lab-takes-time") }}</span>
      <input
        :id="timeId"
        v-model.number="time"
        type="range"
        min="0"
        :max="length"
        step="50"
        :aria-valuetext="$t('lab-takes-ms', { time })"
        data-testid="lab-takes-time"
      />
      <output data-testid="lab-takes-at">{{ $t("lab-takes-ms", { time }) }}</output>
    </label>
    <div v-if="moments.length > 0" class="flex flex-wrap gap-1">
      <button
        v-for="[name, at] in moments"
        :key="name"
        type="button"
        class="rounded-control border border-border-strong bg-surface-raised px-1"
        :data-testid="`lab-takes-moment-${name}`"
        translate="no"
        @click="time = at"
      >
        {{ name }}
      </button>
    </div>
    <h3 class="text-label text-text-secondary">{{ $t("lab-takes-members") }}</h3>
    <ul data-testid="lab-takes-members">
      <li v-for="member in members" :key="member" translate="no">{{ member }}</li>
      <li v-if="members.length === 0" class="text-text-secondary">{{ $t("lab-takes-none") }}</li>
    </ul>
    <h3 class="text-label text-text-secondary">{{ $t("lab-takes-marks") }}</h3>
    <ul data-testid="lab-takes-marks">
      <li v-for="mark in marks" :key="`${mark.at}-${mark.label}`">
        {{ $t("lab-takes-ms", { time: mark.at }) }}: <span translate="no">{{ mark.label }}</span>
      </li>
      <li v-if="marks.length === 0" class="text-text-secondary">{{ $t("lab-takes-none") }}</li>
    </ul>
    <p class="text-caption text-text-secondary">{{ $t("lab-takes-note") }}</p>
  </section>
</template>
