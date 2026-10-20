<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Picker tab: N candidates as tiles, each with the contact sheet of the same window and cameras. Outside a text
 * field, the keys 1 to 9 pick a tile and S skips. A line of text gives the reason. A pick writes the pairwise labels to
 * `apps/editor/intents/<intent>/labels.jsonl`.
 */
import type { PickCandidate } from "@scenity/workbench-host/protocol";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { button, cn, field } from "../layout/ui";
import type { DockHost } from "./dockHost";
import type { RunFiles } from "./runFile";
import PictureImg from "../layout/PictureImg.vue";
import CompareDialog from "../compare/CompareDialog.vue";
import { usePickerCompare } from "../compare/usePickerCompare";
import { useDefaultSequence } from "./defaultSequence";
import { sheetPicture, usePicker } from "./usePicker";

defineOptions({ name: "DockPicker" });
const props = defineProps<{
  readonly dock: Pick<DockHost, "request" | "on" | "defaultSequence">;
  readonly files: RunFiles;
}>();

const picker = usePicker(props.dock);
const intent = ref("");
const take = ref("");
useDefaultSequence(take, () => props.dock.defaultSequence?.());
const from = ref<number | string>(6000);
const to = ref<number | string>(8000);
const step = ref<number | string>(500);
const cameras = ref("overview");
const chosen = ref<string[]>([]);
const tuneLabel = ref("");
const tuneText = ref("");
const why = ref("");

const chosenCandidates = computed(() => picker.candidates.value.filter((item) => chosen.value.includes(item.id)));

function make(): void {
  const window = {
    take: take.value.trim(),
    from: Number(from.value),
    to: Number(to.value),
    step: Number(step.value),
    cameras: cameras.value
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name !== ""),
  };
  void picker.run(window, chosenCandidates.value);
}

function addTune(): void {
  if (tuneText.value.trim() === "") return;
  picker.addTune(tuneLabel.value, tuneText.value);
  chosen.value = [...chosen.value, picker.candidates.value.at(-1)?.id ?? ""];
  tuneLabel.value = "";
  tuneText.value = "";
}

async function pick(index: number | null): Promise<void> {
  if (intent.value.trim() === "") {
    picker.error.value = "Give the intent of the pick first (the labels file goes under it).";
    return;
  }
  if (await picker.pick(intent.value.trim(), index, why.value.trim())) why.value = "";
}

/** The picture ID of the sheet of a tune candidate (an ID of the picture store of the host), or null. */
function picture(item: PickCandidate): string | null {
  const sheet = picker.sheets.value[item.id];
  return sheet === undefined ? null : sheetPicture(sheet);
}

/** The object URL of the sheet of a worktree candidate (a run file), or null. */
function image(item: PickCandidate): string | null {
  const sheet = picker.sheets.value[item.id];
  if (sheet === undefined) return null;
  return sheet.run !== null && sheet.image !== null ? props.files.url(sheet.run, sheet.image) : null;
}

/** Two marked tiles open in the compare view, the sheet of the first mark as A. */
const compare = usePickerCompare(
  () => picker.shown.value,
  (item) => ({ label: item.label, picture: picture(item), url: image(item), simMs: null }),
);

/** The keys of the pick: 1 to 9 pick a tile, S skips. A key in a text field types as usual. */
function onKey(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  if (target !== null && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
  if (event.metaKey || event.ctrlKey || event.altKey || picker.shown.value.length === 0) return;
  const index = Number(event.key) - 1;
  if (Number.isInteger(index) && index >= 0 && index < picker.shown.value.length) {
    event.preventDefault();
    void pick(index);
  } else if (event.key === "s" || event.key === "S") {
    event.preventDefault();
    void pick(null);
  }
}
onMounted(() => globalThis.addEventListener("keydown", onKey));
onBeforeUnmount(() => globalThis.removeEventListener("keydown", onKey));
</script>

<template>
  <div class="grid h-full min-h-0 grid-cols-[18rem_minmax(0,1fr)] gap-3 text-caption" data-testid="dock-picker-tab">
    <form class="flex min-h-0 flex-col gap-1.5 overflow-y-auto" @submit.prevent="make">
      <input
        v-model="intent"
        :class="cn(field, 'font-mono')"
        placeholder="intent (for example reach-left)"
        aria-label="Intent"
        data-testid="picker-intent"
      />
      <div class="grid grid-cols-2 gap-1">
        <input v-model="take" :class="field" aria-label="Take" placeholder="take" />
        <input v-model="cameras" :class="field" aria-label="Cameras" placeholder="cameras, comma-separated" />
        <input v-model.number="from" type="number" :class="field" aria-label="From (ms)" />
        <input v-model.number="to" type="number" :class="field" aria-label="To (ms)" />
        <input v-model.number="step" type="number" :class="field" aria-label="Step (ms)" />
        <button type="button" :class="button" @click="picker.load()">Reload candidates</button>
      </div>
      <ul class="flex flex-col gap-0.5" aria-label="Candidates">
        <li v-for="item in picker.candidates.value" :key="item.id">
          <label :for="`pick-${item.id}`" class="flex items-center gap-1.5">
            <input
              :id="`pick-${item.id}`"
              v-model="chosen"
              type="checkbox"
              :value="item.id"
              :data-testid="`picker-choose-${item.id}`"
            />
            <span class="truncate" :title="item.kind === 'tune' ? item.tune : item.path">
              {{ item.label }} <span class="text-text-secondary">({{ item.kind }})</span>
            </span>
          </label>
        </li>
      </ul>
      <div class="flex gap-1">
        <input v-model="tuneLabel" :class="cn(field, 'w-24')" placeholder="label" aria-label="Label of the tune set" />
        <input
          v-model="tuneText"
          :class="field"
          placeholder="path:value,…"
          aria-label="Tune set"
          data-testid="picker-tune"
        />
        <button type="button" :class="button" data-testid="picker-add" @click="addTune">Add</button>
      </div>
      <button
        type="submit"
        :class="button"
        :disabled="chosen.length < 2 || chosen.length > 9"
        data-testid="picker-make"
      >
        Make the sheets ({{ chosen.length }})
      </button>
      <p v-if="picker.error.value !== null" class="text-status-negative" role="alert">{{ picker.error.value }}</p>
      <p v-if="picker.notice.value !== null" class="text-status-positive" role="status" data-testid="picker-notice">
        {{ picker.notice.value }}
      </p>
    </form>
    <section class="flex min-h-0 flex-col gap-2" aria-label="Tiles">
      <div v-if="picker.shown.value.length > 0" class="flex items-center gap-1">
        <input v-model="why" :class="field" placeholder="why (optional)" aria-label="Why" data-testid="picker-why" />
        <button type="button" :class="button" data-testid="picker-skip" @click="pick(null)">Skip (S)</button>
      </div>
      <p v-else class="text-text-secondary">Choose 2 to 9 candidates and make the sheets. Then press 1 to 9 to pick.</p>
      <ul class="grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-y-auto">
        <li
          v-for="(item, index) in picker.shown.value"
          :key="item.id"
          class="flex flex-col gap-1 rounded-control border border-border-subtle p-1"
          data-testid="picker-tile"
        >
          <div class="flex items-center gap-1">
            <button type="button" class="flex min-w-0 flex-1 items-center gap-1.5 text-left" @click="pick(index)">
              <kbd class="rounded-control border border-border-strong px-1 font-mono">{{ index + 1 }}</kbd>
              <span class="truncate">{{ item.label }}</span>
            </button>
            <button
              type="button"
              :class="
                cn(button, 'shrink-0 px-1.5 py-0', compare.marked.value.includes(item.id) && 'border-accent-brand')
              "
              :aria-pressed="compare.marked.value.includes(item.id)"
              title="Mark two tiles to compare them"
              :data-testid="`picker-compare-${index}`"
              @click="compare.toggle(item)"
            >
              Compare
            </button>
          </div>
          <PictureImg
            v-if="picture(item) !== null"
            :picture="picture(item)"
            :alt="`Sheet of ${item.label}`"
            class="w-full object-contain"
          />
          <img
            v-else-if="image(item) !== null"
            :src="image(item) ?? undefined"
            :alt="`Sheet of ${item.label}`"
            class="w-full object-contain"
          />
          <p v-else-if="picker.sheets.value[item.id]?.error" class="text-status-negative">
            {{ picker.sheets.value[item.id]?.error }}
          </p>
          <span
            v-else
            class="h-24 w-full animate-pulse rounded-control bg-surface-sunken motion-reduce:animate-none"
            aria-hidden="true"
          />
        </li>
      </ul>
    </section>
    <CompareDialog
      v-if="compare.pairs.value !== null"
      :pairs="compare.pairs.value"
      title="Picker sheets"
      @close="compare.close()"
    />
  </div>
</template>
