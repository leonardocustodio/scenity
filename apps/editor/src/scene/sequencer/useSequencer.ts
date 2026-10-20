// SPDX-License-Identifier: Apache-2.0
/**
 * The state of the sequencer panel. It holds the open sequence and the scene as reactive values, and the clock of the
 * page. The clock has the time, play and pause, the steps and the loop between A and B of the lab play bar. The state
 * also holds the record mode, the selected track and key, and the actions. Each change of the sequence is a command
 * of the open sequence (pageSequence.ts) and one step of the one history. A drag of a key shows the new time
 * immediately and runs one command at its end.
 *
 * Keys (not in a text field): Space plays and pauses, and comma and period step 50 ms (Shift: 250 ms). [ and ] set A
 * and B, and \ clears the loop. Delete or Backspace in the panel deletes the selected key. Each key is a page command
 * of the key map (`clock.*`, `sequencer.deleteKey`), so the owner can change it. The clock is the clock state of the
 * page (clockState.ts), and the main toolbar also shows it. The command titles are Fluent messages of
 * `src/i18n/en-US/sequencer.ftl`.
 */
import { applySequenceChange, CommandError, EditError, type SequenceOp } from "@scenity/editor-core";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { SequenceDocument } from "@scenity/scene/sequence";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, type Ref } from "vue";
import { pageKeys, type PageKeyCommandSpec } from "../settings/pageKeys";
import { pageClockState, startClockState, type ClockState } from "./clockState";
import type { PageSequence } from "./pageSequence";
import { sequencerRows } from "./sequencerModel";
import { t } from "../../texts";

/** The parts of the page that the sequencer reads. */
export interface SequencerParts {
  readonly sequence: PageSequence;
  /** The selected entities of the page (the default entity of a new track). */
  readonly selected: () => readonly string[];
}

/** The steps of the clock are in the page clock state. */
export { STEP } from "./clockState";

/** A key of a track. */
export interface KeyRef {
  readonly track: number;
  readonly key: number;
}

/**
 * The clock of the page (the main toolbar shows the same clock). A panel with no clock of the page (a test of the
 * panel alone) starts its own clock while it is mounted.
 */
function useClock(page: PageSequence): ClockState {
  const shared = pageClockState();
  if (shared?.reads(page.time) === true) return shared;
  const own = startClockState({ time: page.time, duration: () => page.channel.doc.duration });
  onBeforeUnmount(() => own.stop());
  return own.clock;
}

/** The open sequence and the scene as reactive values. */
function useDocuments(page: PageSequence) {
  const sequence = shallowRef<SequenceDocument>(page.channel.doc);
  const scene = shallowRef<SceneDocument>(page.editor.doc);
  const recording = ref(page.recording);
  // The proposals of the agents, and the sequence with them (the ghosts of the Timeline).
  const proposals = shallowRef(page.proposals());
  const stops = [
    page.channel.listen((doc) => (sequence.value = doc)),
    page.editor.listen((doc) => (scene.value = doc)),
    page.listenRecord((on) => (recording.value = on)),
    page.listenProposals((next) => (proposals.value = next)),
  ];
  onBeforeUnmount(() => {
    for (const stop of stops) stop();
  });
  const proposed = computed(() => proposedSequence(sequence.value, proposals.value));
  return { sequence, scene, recording, proposals, proposed };
}

/** The sequence after the ops of the proposals. A proposal that does not apply to the sequence is ignored. */
export function proposedSequence(
  sequence: SequenceDocument,
  proposals: readonly { readonly edit: { readonly ops: readonly SequenceOp[] } }[],
): SequenceDocument {
  let doc = sequence;
  for (const proposal of proposals) {
    try {
      let next = doc;
      for (const op of proposal.edit.ops) next = applySequenceChange(next, op.change);
      doc = next;
    } catch {
      // A proposal on an old state of the sequence: the Timeline shows no ghost of it.
    }
  }
  return doc;
}

/** The drag of a key. Each new time shows on the start sequence with no step, and the end runs one command. */
function useKeyDrag(page: PageSequence, run: (id: string, args: Record<string, unknown>) => Promise<boolean>) {
  let start: SequenceDocument | null = null;
  return {
    begin: () => {
      start = page.channel.doc;
    },
    to: (ref: KeyRef, t: number) => {
      if (start === null) return;
      try {
        page.channel.setLive(applySequenceChange(start, { type: "moveKey", ...ref, t }));
      } catch (error) {
        if (!(error instanceof EditError)) throw error;
      }
    },
    end: async (ref: KeyRef, t: number | null): Promise<void> => {
      if (start === null) return;
      const from = start.tracks[ref.track]?.keys[ref.key]?.t;
      page.channel.setLive(start);
      start = null;
      if (t !== null && t !== from) await run("sequence.key.move", { ...ref, t });
    },
  };
}

/**
 * Delete and Backspace in the panel (the key context "sequencer") delete the selected key. The clock keys are
 * commands of the page clock state (clockState.ts).
 */
function useKeys(deleteKey: () => Promise<void>): void {
  const commands: PageKeyCommandSpec[] = [
    {
      ...{ id: "sequencer.deleteKey", title: t("sequencer-command-delete-key"), keys: ["Delete", "Backspace"] },
      keyContext: "sequencer",
      run: () => void deleteKey(),
    },
  ];
  let stop: (() => void) | null = null;
  onMounted(() => {
    stop = pageKeys().register(commands);
  });
  onBeforeUnmount(() => stop?.());
}

/** The state and the actions of the sequencer panel. */
export function useSequencer(parts: SequencerParts, panel: Ref<HTMLElement | null>) {
  const page = parts.sequence;
  const docs = useDocuments(page);
  const clock = useClock(page);
  const error = ref<string | null>(null);
  const selectedTrack = ref<number | null>(null);
  const selectedKey = ref<KeyRef | null>(null);
  // The rows include the proposals. A key or a track that only the proposals have is a ghost.
  const rows = computed(() => sequencerRows(docs.proposed.value, docs.scene.value));
  const run = async (id: string, args: Record<string, unknown> = {}): Promise<boolean> => {
    try {
      await page.run(id, args);
      error.value = null;
      return true;
    } catch (failure) {
      if (!(failure instanceof CommandError || failure instanceof EditError)) throw failure;
      error.value = failure.message;
      return false;
    }
  };
  const deleteKey = async (): Promise<void> => {
    const key = selectedKey.value;
    if (key !== null && (await run("sequence.key.delete", { ...key }))) selectedKey.value = null;
  };
  useKeys(deleteKey);
  onMounted(() => {
    if (panel.value !== null) panel.value.dataset.keyContext = "sequencer";
  });
  return {
    ...docs,
    time: clock.time,
    playing: clock.playing,
    speed: clock.speed,
    loopFrom: clock.loopFrom,
    loopTo: clock.loopTo,
    looping: clock.looping,
    seek: (at: number) => clock.seek(at),
    toggle: () => clock.toggle(),
    step: (direction: 1 | -1, long: boolean) => clock.step(direction, long),
    setLoop: (edge: "from" | "to") => clock.setLoop(edge),
    clearLoop: () => clock.clearLoop(),
    error,
    rows,
    selectedTrack,
    selectedKey,
    run,
    deleteKey,
    drag: useKeyDrag(page, run),
    selected: parts.selected,
    toggleRecord: () => page.setRecording(!page.recording),
    acceptProposals: () => page.acceptAll(),
    rejectProposals: () => page.rejectAll(),
  };
}

export type SequencerState = ReturnType<typeof useSequencer>;
