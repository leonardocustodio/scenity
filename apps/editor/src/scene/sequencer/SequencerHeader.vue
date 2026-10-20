<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The head of the Timeline. It has the sequence picker (the sequences of the project, and a choice opens that
 * sequence) and New sequence. It also has the duration (seconds), the loop flag and the initial state of the
 * simulations (JSON by plugin ID). Each change is a command (`sequence.open`, `sequence.new`, `sequence.settings`). A
 * change of the settings is one step of the history.
 */
import { useI18n } from "@scenity/i18n";
import { Select } from "@scenity/ui";
import { computed, onMounted, ref, useId, watch } from "vue";
import { button } from "../../core/labUi";
import { pageKeys } from "../settings/pageKeys";
import type { SequencerState } from "./useSequencer";

const props = defineProps<{
  readonly state: SequencerState;
  /** The path of the open sequence. */
  readonly path: string;
  /** The sequence files of the project. */
  sequences(): Promise<readonly string[]>;
}>();
const { $t } = useI18n();
const doc = props.state.sequence;
const ids = { duration: useId(), loop: useId() };

const paths = ref<readonly string[]>([props.path]);
onMounted(async () => {
  const found = await props.sequences().catch(() => []);
  paths.value = [...new Set([props.path, ...found])].sort();
});
const options = computed(() => paths.value.map((value) => ({ value, label: value })));
const picked = ref(props.path);
watch(picked, (next) => {
  if (next !== props.path) void pageKeys().execute("sequence.open", { path: next });
});

const seconds = ref((doc.value.duration / 1000).toFixed(2));
watch(
  () => doc.value.duration,
  (next) => (seconds.value = (next / 1000).toFixed(2)),
);
function setDuration(): void {
  const ms = Math.round(Number(seconds.value.replace(",", ".")) * 1000);
  if (!Number.isFinite(ms) || ms <= 0 || ms === doc.value.duration) {
    seconds.value = (doc.value.duration / 1000).toFixed(2);
    return;
  }
  void props.state.run("sequence.settings", { duration: ms });
}

const initial = ref(JSON.stringify(doc.value.initial ?? {}, null, 2));
watch(
  () => doc.value.initial,
  (next) => (initial.value = JSON.stringify(next ?? {}, null, 2)),
);
function setInitial(): void {
  const text = initial.value.trim();
  void props.state.run("sequence.settings", { initial: text === "" || text === "{}" ? "null" : text });
}

const field = "h-7 rounded-control border border-border-subtle bg-surface-sunken px-1.5 text-caption text-text-primary";
</script>

<template>
  <div
    class="flex flex-wrap items-center gap-1"
    role="group"
    :aria-label="$t('sequencer-head')"
    data-testid="sequencer-head"
  >
    <Select
      v-model="picked"
      :options="options"
      class="w-56"
      :aria-label="$t('sequencer-picker')"
      translate="no"
      data-testid="sequencer-picker"
    />
    <button type="button" :class="button" data-testid="sequencer-new" @click="pageKeys().execute('sequence.new', {})">
      {{ $t("sequencer-new") }}
    </button>
    <label class="flex items-center gap-1" :for="ids.duration">
      {{ $t("sequencer-duration") }}
      <input
        :id="ids.duration"
        v-model="seconds"
        type="text"
        inputmode="decimal"
        :class="[field, 'w-16 text-right']"
        data-testid="sequencer-duration"
        @keydown.enter="setDuration"
        @blur="setDuration"
      />
      {{ $t("sequencer-seconds") }}
    </label>
    <label class="flex items-center gap-1" :for="ids.loop">
      <input
        :id="ids.loop"
        type="checkbox"
        :checked="doc.loop === true"
        data-testid="sequencer-loop"
        @change="state.run('sequence.settings', { loop: ($event.target as HTMLInputElement).checked })"
      />
      {{ $t("sequencer-loop") }}
    </label>
    <details class="relative" data-testid="sequencer-initial">
      <summary class="cursor-pointer select-none">{{ $t("sequencer-initial") }}</summary>
      <div
        class="absolute z-20 mt-1 flex w-72 flex-col gap-1 rounded-control border border-border-strong bg-surface-overlay p-2"
      >
        <textarea
          v-model="initial"
          rows="6"
          :class="[field, 'h-auto font-mono']"
          :aria-label="$t('sequencer-initial')"
          data-testid="sequencer-initial-json"
        />
        <button type="button" :class="button" data-testid="sequencer-initial-apply" @click="setInitial">
          {{ $t("sequencer-initial-apply") }}
        </button>
      </div>
    </details>
  </div>
</template>
