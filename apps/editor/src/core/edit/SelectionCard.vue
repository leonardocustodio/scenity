<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The card of the selected item. It shows the ID, slot, asset file, place, tune keys, bone and near work points of the
 * item, and the warnings of a drag. It has undo and redo, and "Save placement" (the dry run with its lines, then the
 * apply). It also has the marks and "Ask Claude". "Ask Claude" sends a typed request with the picked block to the
 * Claude terminal or the chat of the workbench.
 *
 * While a layout check fails (`gate`: one line for each failed check), "Save placement" stops and the card shows the
 * numbers. With a reason of the owner, the save continues, and the reason goes with it. The card lists the checks of
 * the save (`saveChecks` of editor/layout.ts), each with its numbers.
 *
 * The header is the grip of the cards (`place`, editor/usePanelPlace.ts). A drag moves the cards to a different part
 * of the screen, and a double click returns them. The fold button shows only the header, so the card stays open but
 * small.
 *
 * The texts are Fluent messages of `src/i18n/en-US/card.ftl`. The IDs, the paths and the numbers are data.
 */
import { cn } from "@scenity/ui";
import { ChevronDown, ChevronUp, GripVertical, X } from "lucide-vue-next";
import { useI18n } from "@scenity/i18n";
import { computed, ref } from "vue";
import { button } from "../labUi";
import type { PanelPlace } from "../editor/usePanelPlace";
import type { DragMode } from "./placeDrag";
import { pickedLines, type PickedItem } from "./pickedItem";
import { changedLines, type PlacementView } from "./placement";
import type { SaveCheck } from "../editor/layout";

const props = defineProps<{
  readonly item: PickedItem;
  readonly dragging: DragMode | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly inWorkbench: boolean;
  readonly placement: PlacementView | null;
  readonly commands: { readonly dry: string; readonly apply: string } | null;
  readonly askStatus: string | null;
  readonly marking: boolean;
  readonly markCount: number;
  /** The lines of the failed layout checks (the save stops), or null. */
  readonly gate?: readonly string[] | null;
  /** The checks of the save, or null. */
  readonly checks?: readonly SaveCheck[] | null;
  /** The place of the cards: the header drags them (editor/usePanelPlace.ts). */
  readonly place?: PanelPlace;
}>();

const { $t } = useI18n();

/** The message IDs of the drag modes. */
const DRAG_WORDS: Readonly<Record<DragMode, string>> = {
  move: "card-drag-move",
  turn: "card-drag-turn",
  lift: "card-drag-lift",
};

/** True when the card shows only its header. */
const folded = ref(false);

/** The mark of the status of a check of the save. */
const MARKS: Readonly<Record<SaveCheck["status"], string>> = { pass: "✓", fail: "✗", note: "•" };

const emit = defineEmits<{
  clear: [];
  undo: [];
  redo: [];
  save: [dry: boolean, override?: string];
  ask: [text: string];
  marking: [on: boolean];
  clearMarks: [];
}>();

const request = ref("");
// The reason of the owner to save while a layout check fails.
const reason = ref("");
const blocked = computed(() => (props.gate ?? []).length > 0 && reason.value.trim() === "");

/** Save with the reason of the owner while a check fails. */
function save(dry: boolean): void {
  const why = reason.value.trim();
  if ((props.gate ?? []).length > 0 && why !== "") emit("save", dry, why);
  else emit("save", dry);
}
const fmt = (value: number): string => value.toFixed(3);
const changes = computed(() => (props.placement === null ? [] : changedLines(props.placement.output)));
const dryPassed = computed(() => props.placement?.dry === true && props.placement.status === "passed");

function send(): void {
  if (request.value.trim() === "") return;
  emit("ask", request.value);
  request.value = "";
}

// The commands of Save placement are hidden. Remove the comment marks to show them again.
// async function copy(text: string): Promise<void> {
//   try {
//     await navigator.clipboard.writeText(text);
//   } catch {
//     // A page without the clipboard: the text stays on the card for a manual copy.
//   }
// }
</script>

<template>
  <section
    class="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-1.5 rounded-card bg-surface-overlay/95 px-3 py-2 text-caption shadow-overlay"
    :aria-label="$t('card-selection')"
    data-scene-control
    data-testid="lab-selection"
  >
    <header class="flex items-center gap-2">
      <div
        :class="
          cn('flex min-w-0 flex-1 touch-none items-center gap-2 select-none', place !== undefined && 'cursor-move')
        "
        role="button"
        tabindex="0"
        :aria-label="$t('card-grip')"
        :title="place === undefined ? undefined : $t('card-grip-title')"
        data-testid="lab-selection-grip"
        @pointerdown="place?.grab($event)"
        @pointermove="place?.move($event)"
        @pointerup="place?.drop($event)"
        @pointercancel="place?.drop($event)"
        @dblclick="place?.reset()"
        @keydown="place?.key($event)"
      >
        <GripVertical v-if="place !== undefined" class="size-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
        <span class="text-label" translate="no" data-testid="lab-selection-id">{{ item.kind }} · {{ item.id }}</span>
        <span v-if="dragging !== null" class="text-text-secondary">{{ $t(DRAG_WORDS[dragging]) }}</span>
      </div>
      <button
        type="button"
        :class="cn(button, 'ml-auto inline-flex size-7 items-center justify-center p-0')"
        :title="folded ? $t('card-unfold') : $t('card-fold-title')"
        :aria-label="folded ? $t('card-unfold') : $t('card-fold')"
        :aria-expanded="!folded"
        data-testid="lab-selection-fold"
        @click="folded = !folded"
      >
        <ChevronDown v-if="folded" class="size-3.5" aria-hidden="true" />
        <ChevronUp v-else class="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        :class="cn(button, 'inline-flex size-7 items-center justify-center p-0')"
        :title="$t('card-clear-title')"
        :aria-label="$t('card-clear')"
        @click="emit('clear')"
      >
        <X class="size-3.5" aria-hidden="true" />
      </button>
    </header>
    <div v-show="!folded" class="contents" data-testid="lab-selection-body">
      <dl class="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono tabular-nums">
        <template v-if="item.slot !== null">
          <dt class="text-text-secondary">{{ $t("card-field-slot") }}</dt>
          <dd class="m-0" translate="no">{{ item.slot }}</dd>
        </template>
        <template v-if="item.asset !== null">
          <dt class="text-text-secondary">{{ $t("card-field-asset") }}</dt>
          <dd class="m-0 truncate" :title="item.asset.file" translate="no" data-testid="lab-selection-asset">
            {{ item.asset.id }} · {{ item.asset.file }}
          </dd>
        </template>
        <template v-if="item.place !== null">
          <dt class="text-text-secondary">{{ $t("card-field-place") }}</dt>
          <dd class="m-0" translate="no" data-testid="lab-selection-place">
            {{ fmt(item.place.x) }}, {{ fmt(item.place.y) }}, {{ fmt(item.place.z) }} · {{ item.place.yawDeg }}°
          </dd>
        </template>
        <template v-if="item.bone !== null">
          <dt class="text-text-secondary">{{ $t("card-field-bone") }}</dt>
          <dd class="m-0" translate="no" data-testid="lab-selection-bone">{{ item.bone }}</dd>
        </template>
        <template v-if="item.near.length > 0">
          <dt class="text-text-secondary">{{ $t("card-field-near") }}</dt>
          <dd class="m-0 truncate" translate="no">
            {{ item.near.map((near) => `${near.name} ${near.cm} cm`).join(", ") }}
          </dd>
        </template>
      </dl>
      <ul v-if="item.tunes.length > 0" class="m-0 list-none p-0 font-mono" :aria-label="$t('card-tune-keys')">
        <li
          v-for="row in item.tunes"
          :key="row.path"
          :class="row.tuned ? 'text-text-primary' : 'text-text-secondary'"
          translate="no"
        >
          {{ row.path }} = {{ row.value }}
        </li>
      </ul>
      <p
        v-for="warning in item.warnings"
        :key="warning"
        class="m-0 text-status-caution"
        role="status"
        data-testid="lab-selection-warning"
      >
        {{ warning }}
      </p>
      <p v-if="item.kind === 'prop' || item.kind === 'scratch'" class="m-0 text-text-secondary">
        {{ $t("card-prop-keys") }}
      </p>
      <p v-if="item.kind === 'prop'" class="m-0 text-text-secondary">{{ $t("card-prop-propose") }}</p>
      <div
        v-if="commands !== null && gate !== undefined && gate !== null && gate.length > 0"
        class="flex flex-col gap-0.5"
        data-testid="lab-save-gate"
      >
        <span class="text-status-caution" role="status">
          {{ $t("card-gate", { count: gate.length }) }}
        </span>
        <span
          v-for="line in gate"
          :key="line"
          class="truncate font-mono text-status-caution"
          :title="line"
          translate="no"
          >{{ line }}</span
        >
        <input
          v-model="reason"
          class="min-h-8 rounded-control border border-border-subtle bg-surface-sunken px-2 text-caption"
          :placeholder="$t('card-override-placeholder')"
          :aria-label="$t('card-override')"
          data-testid="lab-save-override"
        />
      </div>
      <ul v-if="checks != null" class="m-0 flex list-none flex-col gap-0.5 p-0" data-testid="lab-save-checks">
        <li
          v-for="check in checks"
          :key="check.id"
          :class="check.status === 'fail' ? 'text-status-caution' : 'text-text-secondary'"
          :data-check="check.id"
          :data-status="check.status"
        >
          {{ MARKS[check.status] }} {{ check.text }}
          <span v-if="check.id === 'runtime' && check.lines.length > 0" class="block truncate font-mono">{{
            check.lines.join(" · ")
          }}</span>
        </li>
      </ul>
      <div class="flex flex-wrap gap-1">
        <button type="button" :class="button" :disabled="!canUndo" :title="$t('card-undo-title')" @click="emit('undo')">
          {{ $t("card-undo") }}
        </button>
        <button type="button" :class="button" :disabled="!canRedo" :title="$t('card-redo-title')" @click="emit('redo')">
          {{ $t("card-redo") }}
        </button>
        <button
          v-if="commands !== null && inWorkbench"
          type="button"
          :class="button"
          data-testid="lab-save-placement"
          :disabled="blocked"
          @click="save(true)"
        >
          {{ $t("card-save-dry") }}
        </button>
        <button
          v-if="dryPassed"
          type="button"
          :class="button"
          data-testid="lab-save-placement-apply"
          :disabled="blocked"
          @click="save(false)"
        >
          {{ $t("card-save-apply") }}
        </button>
        <button type="button" :class="button" :aria-pressed="marking" @click="emit('marking', !marking)">
          {{ marking ? $t("card-mark-done") : $t("card-mark") }}
        </button>
        <button v-if="markCount > 0" type="button" :class="button" @click="emit('clearMarks')">
          {{ $t("card-marks-clear", { count: markCount }) }}
        </button>
      </div>
      <!-- The commands of Save placement are hidden. Remove the comment marks to show them again.
    <div
      v-if="commands !== null && !inWorkbench && !blocked"
      class="flex flex-col gap-0.5"
      data-testid="lab-placement-commands"
    >
      <span class="text-text-secondary">Save placement: run in the repo root</span>
      <span v-if="(gate ?? []).length > 0" class="text-text-secondary">Put the reason into the commit message.</span>
      <button
        v-for="command in [commands.dry, commands.apply]"
        :key="command"
        type="button"
        :class="cn(button, 'truncate text-left font-mono')"
        :title="`Copy: ${command}`"
        @click="copy(command)"
      >
        {{ command }}
      </button>
    </div> -->
      <pre
        v-if="placement !== null"
        class="m-0 max-h-28 overflow-auto rounded-control bg-surface-sunken p-1.5 font-mono whitespace-pre-wrap"
        :translate="placement.dry ? undefined : 'no'"
        data-testid="lab-placement-output"
        >{{ placement.dry ? $t("card-placement-dry", { status: placement.status }) : placement.status }}
{{ changes.length > 0 ? changes.join("\n") : placement.output }}</pre>
      <!-- The part of a scratch prop (scratch/ScratchCard.vue). -->
      <slot />
      <form class="flex gap-1" @submit.prevent="send">
        <input
          v-model="request"
          class="min-h-8 flex-1 rounded-control border border-border-subtle bg-surface-sunken px-2 text-caption"
          :placeholder="inWorkbench ? $t('card-ask-placeholder-workbench') : $t('card-ask-placeholder')"
          :aria-label="$t('card-ask')"
          data-testid="lab-ask"
        />
        <button type="submit" :class="button" data-testid="lab-ask-send">{{ $t("card-ask-send") }}</button>
      </form>
      <p v-if="askStatus !== null" class="m-0 text-text-secondary" role="status" data-testid="lab-ask-status">
        {{ askStatus }}
      </p>
      <details class="text-text-secondary">
        <summary>{{ $t("card-picked-block") }}</summary>
        <pre class="m-0 font-mono whitespace-pre-wrap" data-testid="lab-picked-block">{{
          pickedLines(item).join("\n")
        }}</pre>
      </details>
    </div>
  </section>
</template>
