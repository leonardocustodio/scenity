<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The scene edit layer on the scene: the marks and the card of the selected item. The pointer of the scene goes
 * through useSceneEdit.ts (Room3DLab.vue), and this layer shows its state. A selected scratch prop adds its part to the
 * card (scratch/ScratchCard.vue).
 *
 * With `commands`, each button of the card runs its command of the registry (editor/commands.ts), and the command
 * palette (⌘P, editor/CommandPalette.vue) shows. Without `commands`, the buttons call the scene edit directly.
 *
 * While proposals wait, their card (editor/ProposalCard.vue) shows next to the card of the selection. Its buttons run
 * the owner-only commands `proposal.*`.
 *
 * The layout status (from the plugin, `layoutStatusCard`) shows above the card of the selection. While a layout check
 * fails, the card of the selection stops "Save placement". The card of the proposals shows the checks that each
 * proposal breaks or repairs.
 *
 * The card of a prop can have parts from the plugin (`overlays.propCard`). The card lists the checks of the save (from
 * the plugin): the layout checks, the assets and the licence register, and the runtime gates. A failed check stops the
 * save and shows its numbers.
 */
import { computed } from "vue";
import CommandPalette from "../editor/CommandPalette.vue";
import { checkLine, compareReports, layoutStatusCard, saveChecks, type ProposalLayout } from "../editor/layout";
import ProposalCard from "../editor/ProposalCard.vue";
import { usePanelPlace } from "../editor/usePanelPlace";
import type { CommandRunner } from "../editor/useCommands";
import ScratchCard from "../scratch/ScratchCard.vue";
import type { Scratch } from "../scratch/useScratch";
import MarksLayer from "./MarksLayer.vue";
import { editorPlugin } from "../plugin";
import SelectionCard from "./SelectionCard.vue";
import type { EditPanel } from "./useEditPanel";
import type { SceneEdit } from "./useSceneEdit";

/** The card of the layout status and the parts of the card of a prop come from the plugin. */
const LayoutStatus = layoutStatusCard();
const PropCard = editorPlugin().overlays.propCard;

const props = defineProps<{
  readonly edit: SceneEdit;
  readonly panel: EditPanel;
  readonly scratch?: Scratch;
  readonly commands?: CommandRunner;
}>();

/** Run the command of a button. Without a registry, use the direct call. */
function act(command: string, args: Readonly<Record<string, number | string | boolean>>, direct: () => void): void {
  if (props.commands === undefined) direct();
  else props.commands.key(command, args);
}

/** The selected scratch prop, or null. */
const scratchItem = computed(() => {
  const target = props.edit.selection.value;
  if (target?.kind !== "scratch") return null;
  return props.scratch?.items.value.find((item) => item.id === target.id) ?? null;
});

function duplicate(id: string): void {
  act("scratch.duplicate", {}, () => {
    const copy = props.scratch?.api.duplicate(id) ?? null;
    if (copy !== null) props.edit.select({ kind: "scratch", id: copy });
  });
}

function remove(id: string): void {
  act("scratch.remove", {}, () => {
    props.edit.select(null);
    props.scratch?.api.remove(id);
  });
}

function promote(id: string, dry: boolean): void {
  act("scratch.promote", { dry }, () => {
    props.scratch?.api.promote(id, dry);
  });
}

function onAsk(text: string): void {
  act("ask", { text }, () => {
    void props.panel.ask(text);
  });
}

/** "Save placement", with the reason of the owner while a layout check fails. */
function save(dry: boolean, override?: string): void {
  act("placement.save", override === undefined ? { dry } : { dry, override }, () => {
    props.panel.savePlacement(dry, override);
  });
}

/** The layout checks of the editor, or null (a page or a test without them). */
const layout = computed(() => props.panel.layout ?? null);

/** The lines of the failed layout checks (the save stops), or null. */
const gate = computed(() => {
  const failed = layout.value?.report.value.failed ?? [];
  return failed.length === 0 ? null : failed.map(checkLine);
});

/** The checks of "Save placement" (null without the layout checks or without place values). */
const checks = computed(() => {
  const report = layout.value?.report.value;
  if (report === undefined || props.panel.commands() === null) return null;
  const scratch = props.scratch?.items.value.length ?? 0;
  return saveChecks({ report, values: props.panel.values(), scratch });
});

/** The layout checks of each proposal: the operations of the proposal applied to the current inputs. */
const proposalLayouts = computed((): ReadonlyMap<string, ProposalLayout> => {
  const checks = layout.value;
  const proposals = props.commands?.proposals.value ?? [];
  if (checks === null) return new Map();
  const now = checks.report.value;
  return new Map(proposals.map((item) => [item.id, compareReports(now, checks.check({ ops: item.edit.ops }))]));
});

function setExpanded(open: boolean): void {
  layout.value?.setExpanded(open);
}

/** The layout status shows while an item is selected, proposals wait, a check fails or the owner opens it. */
const statusShown = computed(() => {
  const checks = layout.value;
  if (checks === null) return false;
  const waiting = (props.commands?.proposals.value.length ?? 0) > 0;
  return props.panel.item.value !== null || waiting || checks.expanded.value || gate.value !== null;
});

function setMarking(on: boolean): void {
  act(on ? "marks.start" : "marks.stop", {}, () => {
    props.panel.setMarking(on);
  });
}
// The cards move together. The header of the card of the selection drags them (editor/usePanelPlace.ts).
const cardsPlace = usePanelPlace("scenity.labs.cardsPlace");
</script>

<template>
  <MarksLayer :marks="panel.marks.value" :marking="panel.marking.value" @update:marks="panel.setMarks" />
  <!-- The card of the selection is at the right, and the card of the proposals is next to it. -->
  <div
    class="pointer-events-none absolute top-14 right-3 z-20 flex flex-row-reverse items-start gap-2"
    :style="cardsPlace.style.value"
    data-testid="lab-cards"
  >
    <!-- The layout status is above the card of the selection. -->
    <div class="flex flex-col items-end gap-2">
      <LayoutStatus
        v-if="statusShown && layout !== null"
        class="pointer-events-auto"
        :report="layout.report.value"
        :expanded="layout.expanded.value"
        @update:expanded="setExpanded"
      />
      <SelectionCard
        v-if="panel.item.value !== null"
        class="pointer-events-auto"
        :place="cardsPlace"
        :gate="gate"
        :checks="checks"
        :item="panel.item.value"
        :dragging="edit.dragging.value"
        :can-undo="edit.history.canUndo.value"
        :can-redo="edit.history.canRedo.value"
        :in-workbench="panel.inWorkbench()"
        :placement="panel.placement.value"
        :commands="panel.commands()"
        :ask-status="panel.askStatus.value"
        :marking="panel.marking.value"
        :mark-count="panel.marks.value.length"
        @clear="act('selection.clear', {}, () => edit.select(null))"
        @undo="act('history.undo', {}, () => edit.history.undo())"
        @redo="act('history.redo', {}, () => edit.history.redo())"
        @save="save"
        @ask="onAsk"
        @marking="setMarking"
        @clear-marks="act('marks.clear', {}, () => panel.setMarks([]))"
      >
        <PropCard v-if="PropCard !== null && panel.item.value.kind === 'prop'" />
        <ScratchCard
          v-if="scratchItem !== null && scratch !== undefined"
          :item="scratchItem"
          :in-workbench="panel.inWorkbench()"
          :promotion="scratch.promotion.value"
          @duplicate="duplicate(scratchItem.id)"
          @remove="remove(scratchItem.id)"
          @promote="(dry: boolean) => promote(scratchItem?.id ?? '', dry)"
        />
      </SelectionCard>
    </div>
    <ProposalCard
      v-if="commands !== undefined && commands.proposals.value.length > 0"
      class="pointer-events-auto"
      :proposals="commands.proposals.value"
      :layouts="proposalLayouts"
      @accept="(id: string) => commands?.key('proposal.accept', { id })"
      @reject="(id: string) => commands?.key('proposal.reject', { id })"
      @accept-all="commands?.key('proposal.acceptAll')"
      @reject-all="commands?.key('proposal.rejectAll')"
    />
  </div>
  <CommandPalette
    v-if="commands !== undefined"
    :open="commands.paletteOpen.value"
    :commands="commands.listings.value"
    :run="commands.palette"
    :status="commands.status.value"
    @update:open="commands.setPalette"
  />
</template>
