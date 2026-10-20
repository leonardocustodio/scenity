<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The clip browser of the selected entity with a model: the clips of its model and of the
 * clip source of its animator, with the length of each clip. A clip goes on the timeline as an animation key: a drag
 * onto a lane of the timeline puts it at the time of the drop, and "Add at the playhead" puts it at the time of the
 * clock. Preview plays the clip on the entity in the Scene view at the time of the clock, in a loop; the sequence does
 * not change. The timeline and the preview need an open sequence. Each key is a command and one step of the history.
 */
import { useI18n } from "@scenity/i18n";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { SequenceDocument } from "@scenity/scene/sequence";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { usePanelVisible } from "../../studio/shell/panelState";
import { button } from "../inspector/inspectorUi";
import { secondsText } from "../sequencer/sequencerModel";
import {
  CLIP_DRAG_TYPE,
  clipCommand,
  clipDragText,
  clipRows,
  type ClipDrag,
  type ClipParts,
  type ClipRow,
} from "./clipBrowser";

const props = defineProps<{
  doc: { readonly value: SceneDocument };
  selected: { readonly value: readonly string[] };
  /** The clip names of the model of each entity (the inspect report). */
  report(): Promise<{ entities: readonly { id: string; parts?: ClipParts }[] } | null>;
  /** The open sequence, or null. */
  sequence(): SequenceDocument | null;
  /** The time of the clock (ms). */
  time(): number;
  /** Run a command of the sequencer; the reason of a refusal, or null. */
  run(command: string, args: Readonly<Record<string, unknown>>): Promise<string | null>;
  /** Play a clip on an entity in the Scene view (null: stop). */
  preview(value: ClipDrag | null): void;
}>();
const { $t } = useI18n();
const visible = usePanelVisible();

const entity = computed(() => {
  const id = props.selected.value[0];
  return id !== undefined && props.doc.value.entities[id]?.components.model !== undefined ? id : null;
});
const parts = shallowRef<ClipParts | undefined>(undefined);
const open = ref(false);
const rows = computed(() =>
  entity.value === null ? [] : clipRows(props.doc.value.entities[entity.value]?.components ?? {}, parts.value),
);
const previewing = ref<string | null>(null);
const reason = ref<string | null>(null);
const rowKey = (row: ClipRow): string => `${row.asset}#${row.name}`;

let timer: ReturnType<typeof setInterval> | null = null;
async function refresh(): Promise<void> {
  open.value = props.sequence() !== null;
  if (!visible.value || entity.value === null) return;
  const report = await props.report();
  parts.value = report?.entities.find((item) => item.id === entity.value)?.parts;
}
onMounted(() => {
  void refresh();
  timer = setInterval(() => void refresh(), 500);
});

function stopPreview(): void {
  if (previewing.value === null) return;
  previewing.value = null;
  props.preview(null);
}
// A new entity or a closed sequence stops the preview.
watch([entity, open], () => {
  parts.value = undefined;
  stopPreview();
  void refresh();
});
onBeforeUnmount(() => {
  if (timer !== null) clearInterval(timer);
  stopPreview();
});

function togglePreview(row: ClipRow): void {
  if (entity.value === null) return;
  if (previewing.value === rowKey(row)) {
    stopPreview();
    return;
  }
  previewing.value = rowKey(row);
  props.preview({ entity: entity.value, clip: row.asset, name: row.name });
}

/** Put a clip on the timeline at the time of the clock. */
async function addAtPlayhead(row: ClipRow): Promise<void> {
  const sequence = props.sequence();
  if (entity.value === null || sequence === null) return;
  const { command, args } = clipCommand(
    sequence,
    { entity: entity.value, clip: row.asset, name: row.name },
    props.time(),
  );
  reason.value = await props.run(command, args);
}

function onDragStart(event: DragEvent, row: ClipRow): void {
  if (entity.value === null || event.dataTransfer === null) return;
  event.dataTransfer.setData(CLIP_DRAG_TYPE, clipDragText(entity.value, row));
  event.dataTransfer.effectAllowed = "copy";
}

const name = computed(() =>
  entity.value === null ? "" : (props.doc.value.entities[entity.value]?.name ?? entity.value),
);
</script>

<template>
  <section
    class="flex h-full min-h-0 flex-col gap-2 overflow-auto p-2 text-caption"
    :aria-label="$t('panel-clips')"
    :data-entity="entity ?? ''"
    :data-clips="rows.length"
    :data-previewing="previewing ?? ''"
    data-testid="clips-panel"
  >
    <p v-if="entity === null" class="text-text-secondary">{{ $t("clips-none") }}</p>
    <template v-else>
      <p v-if="rows.length === 0" class="text-text-secondary">{{ $t("clips-empty", { name }) }}</p>
      <p v-if="!open" class="text-text-secondary" data-testid="clips-no-sequence">{{ $t("clips-no-sequence") }}</p>
      <ul class="flex flex-col gap-0.5" :aria-label="$t('clips-list', { name })">
        <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -- a drag of a clip onto the timeline; "Add at the playhead" is the keyboard form. -->
        <li
          v-for="row in rows"
          :key="rowKey(row)"
          class="flex cursor-grab items-center gap-1 rounded-control px-1 py-0.5 hover:bg-surface-hover"
          draggable="true"
          :title="$t('clips-drag')"
          :data-clip="row.name"
          :data-from="row.from"
          data-testid="clip-row"
          @dragstart="onDragStart($event, row)"
        >
          <span class="min-w-0 flex-1 truncate font-mono" translate="no">{{ row.name }}</span>
          <span v-if="row.from === 'source'" class="text-text-secondary">{{ $t("clips-from-source") }}</span>
          <span v-if="row.seconds !== null" class="text-text-secondary tabular-nums">
            {{ secondsText(row.seconds * 1000) }}
          </span>
          <button
            type="button"
            :class="button"
            :disabled="!open"
            :aria-pressed="previewing === rowKey(row)"
            :aria-label="$t('clips-preview-name', { clip: row.name })"
            data-testid="clip-preview"
            @click="togglePreview(row)"
          >
            {{ previewing === rowKey(row) ? $t("clips-preview-stop") : $t("clips-preview") }}
          </button>
          <button
            type="button"
            :class="button"
            :disabled="!open"
            :aria-label="$t('clips-add-name', { clip: row.name })"
            data-testid="clip-add"
            @click="addAtPlayhead(row)"
          >
            {{ $t("clips-add") }}
          </button>
        </li>
      </ul>
      <p v-if="reason !== null" class="text-status-negative" role="alert">{{ reason }}</p>
    </template>
  </section>
</template>
