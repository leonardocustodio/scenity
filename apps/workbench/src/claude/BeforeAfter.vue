<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The before and after of a turn of Claude. The card shows the frame at the URL state of the turn start, before the
 * prompt and after the edits, side by side or under a slider. It also shows the motion of the turn window before and
 * after (TurnSheets.vue), and the files of the turn. The host sends them with `agent.turn` and keeps every turn in its
 * state folder. The list picks an earlier turn. The owner does nothing for the newest turn. Reduced motion: nothing
 * animates.
 */
import type { SavedTurn } from "@scenity/workbench-host/protocol";
import { Columns2, Maximize2, SplitSquareHorizontal } from "lucide-vue-next";
import { computed, ref } from "vue";
import CompareDialog from "../compare/CompareDialog.vue";
import { turnPairs } from "../compare/comparePairs";
import PictureImg from "../layout/PictureImg.vue";
import { cn, field, iconTab } from "../layout/ui";
import TurnSheets from "./TurnSheets.vue";
import type { TurnDisplay, TurnKey } from "./useTurnHistory";

const props = withDefaults(
  defineProps<{
    readonly turn: TurnDisplay | null;
    /** The saved turns, the newest first. */
    readonly turns?: readonly SavedTurn[];
    /** The turn that the owner picked, or null for the newest. */
    readonly selected?: TurnKey | null;
  }>(),
  { turns: () => [], selected: null },
);
const emit = defineEmits<{ select: [key: TurnKey | null] }>();

type Mode = "side" | "slider";
const mode = ref<Mode>("side");
/** The share of the after picture under the slider (0 to 100). */
const split = ref(50);
/** The compare view of the turn (the frame and the motion before and after, large). */
const comparing = ref(false);

/** The ID of a picture of the host; PictureImg.vue shows it as an object URL. */
function source(picture: TurnDisplay["before"]): string | null {
  return picture?.id ?? null;
}
const before = computed(() => (props.turn === null ? null : source(props.turn.before)));
const after = computed(() => (props.turn === null ? null : source(props.turn.after)));
const title = computed(() => {
  const turn = props.turn;
  if (turn === null) return "";
  // The label names an edit that loaded the page again.
  const reload = turn.reloaded ? " · reloaded" : "";
  return `Turn ${String(turn.turn)}${reload}`;
});

/** The value of the turn list: `<session> <turn>`, or "" for the newest turn. */
const picked = computed(() =>
  props.selected === null ? "" : `${props.selected.session} ${String(props.selected.turn)}`,
);
function label(item: SavedTurn): string {
  const prompt = item.prompt === "" ? "" : ` · ${item.prompt.slice(0, 40)}`;
  const files = item.files.length === 1 ? "1 file" : `${String(item.files.length)} files`;
  return `Turn ${String(item.turn)} · ${files}${item.reloaded ? " · reloaded" : ""}${prompt}`;
}
function pick(value: string): void {
  const item = props.turns.find((entry) => `${entry.session} ${String(entry.turn)}` === value);
  emit("select", item === undefined ? null : { session: item.session, turn: item.turn });
}
</script>

<template>
  <section
    v-if="turn !== null || turns.length > 0"
    class="flex shrink-0 flex-col gap-1.5 border-t border-border-subtle p-2"
    aria-label="Before and after of a turn"
    data-testid="before-after"
  >
    <div class="flex items-center gap-1">
      <h3 class="mr-auto text-label">
        Before and after
        <span class="text-caption text-text-secondary" data-testid="before-after-title">{{ title }}</span>
      </h3>
      <div class="flex gap-0.5" role="tablist" aria-label="View">
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'side'"
          :class="iconTab(mode === 'side')"
          title="Side by side"
          data-testid="before-after-side"
          @click="mode = 'side'"
        >
          <Columns2 class="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'slider'"
          :class="iconTab(mode === 'slider')"
          title="Slider"
          data-testid="before-after-slider"
          @click="mode = 'slider'"
        >
          <SplitSquareHorizontal class="size-4" aria-hidden="true" />
        </button>
      </div>
      <button
        type="button"
        :class="iconTab(false)"
        title="Compare large"
        aria-label="Compare large"
        :disabled="turn === null"
        data-testid="before-after-compare"
        @click="comparing = true"
      >
        <Maximize2 class="size-4" aria-hidden="true" />
      </button>
      <CompareDialog
        v-if="comparing && turn !== null"
        :pairs="turnPairs(turn)"
        :title="title"
        @close="comparing = false"
      />
    </div>
    <div v-if="turns.length > 0" class="flex items-center gap-1.5 text-caption text-text-secondary">
      <span class="shrink-0" aria-hidden="true">Turn</span>
      <select
        :class="field"
        :value="picked"
        aria-label="The turn in the panel"
        data-testid="turn-history"
        @change="pick(($event.target as HTMLSelectElement).value)"
      >
        <option value="">The newest turn</option>
        <option v-for="item in turns" :key="`${item.session} ${item.turn}`" :value="`${item.session} ${item.turn}`">
          {{ label(item) }}
        </option>
      </select>
    </div>
    <p v-if="turn === null" class="text-caption text-text-secondary">The pictures of the turn load.</p>
    <template v-else>
      <div v-if="mode === 'side'" class="grid grid-cols-2 gap-1">
        <figure
          v-for="item in [
            { label: 'Before', src: before },
            { label: 'After', src: after },
          ]"
          :key="item.label"
        >
          <PictureImg
            v-if="item.src !== null"
            :picture="item.src"
            :alt="`${item.label} the turn`"
            class="block w-full rounded-control bg-surface-sunken"
            :data-testid="`before-after-${item.label.toLowerCase()}`"
          />
          <p v-else class="grid aspect-[16/10] place-items-center rounded-control bg-surface-sunken text-caption">
            No picture
          </p>
          <figcaption class="text-caption text-text-secondary">{{ item.label }}</figcaption>
        </figure>
      </div>
      <div v-else class="flex flex-col gap-1">
        <div class="relative overflow-hidden rounded-control bg-surface-sunken" data-testid="before-after-stack">
          <PictureImg v-if="before !== null" :picture="before" alt="Before the turn" class="block w-full" />
          <PictureImg
            v-if="after !== null"
            :picture="after"
            alt="After the turn"
            class="absolute inset-0 block w-full"
            :style="{ clipPath: `inset(0 0 0 ${String(split)}%)` }"
          />
        </div>
        <div class="flex items-center gap-2 text-caption text-text-secondary">
          <span aria-hidden="true">Before</span>
          <input
            v-model.number="split"
            type="range"
            min="0"
            max="100"
            class="flex-1"
            aria-label="The share of the before picture"
            data-testid="before-after-range"
          />
          <span aria-hidden="true">After</span>
        </div>
      </div>
      <p v-if="turn.after === null" class="text-caption text-status-caution" role="status">
        No after picture yet: the frame gave none.
      </p>
      <TurnSheets :before="turn.beforeSheet" :after="turn.afterSheet" :window="turn.window" />
      <ul :class="cn('flex flex-col font-mono text-caption text-text-secondary')" data-testid="before-after-files">
        <li v-for="file in turn.files" :key="file" class="truncate" :title="file">{{ file }}</li>
      </ul>
    </template>
  </section>
</template>
