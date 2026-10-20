// SPDX-License-Identifier: Apache-2.0
/**
 * The scene editor of the lab page. It applies an edit (ops.ts) to the tune values of the page and to the events of
 * the live take, as one step of the history (editHistory.ts). The tune values and the events are inputs of the frame,
 * so the URL (`tune`, `rec`) and `frameKey` change immediately. The editor does not apply the source ops of an edit.
 * They wait as pending runs. The command runner (useCommands.ts) sends "Save placement" to the host and settles its
 * run. The other source ops wait.
 *
 * The script API (`globalThis.__room3dLab`) gets `applyEdit`, `editHistory` and `pendingRuns`, next to the scene edit
 * methods (edit/useEditPanel.ts).
 *
 * The editor holds the layout checks of the page (`useLayoutChecks` of layout.ts). While a layout check fails, an edit
 * with the source op of "Save placement" stops. It throws the numbers and changes nothing. The argument `override` of
 * `placement.save` (a reason of the owner) lets the edit continue. The reason goes with the placement to the host.
 *
 * The history is the one history of `@scenity/editor-core`. With the scratch list of the page, a scratch move,
 * duplicate or delete is also a step.
 *
 * With the clock of the page, an edit (or an undo or a redo) that changes the events of the take causes a seek to the
 * current time. The scene then reads the events again from the start of the take, as a reload of the URL does. Without
 * the seek, a stopped clock keeps the frame of the events before the edit. For example, a member walks from its
 * initial place, and the walk does not move while the clock is stopped. Then the frame is not the frame of the URL.
 */
import { tunables } from "@scenity/runtime-dev";
import { shallowRef, type Ref, type ShallowRef } from "vue";
import { installApi } from "../edit/useEditPanel";
import type { ScratchEntry } from "../scratch/scratchList";
import type { LabEvent } from "../sequence";
import type { LabClock } from "../useLabClock";
import { CommandError, PLACEMENT_TOOL } from "./commandKit";
import { useEditHistory, type EditSteps, type EditTake, type EditUndo } from "./editHistory";
import { editProblems, pendingRuns, sourceOps, type Edit, type PendingRun } from "./ops";
import { useLayoutChecks, type LayoutChecks } from "./layout";

/** The result of an edit: a step of the history or no change, and its source ops as pending runs. */
export interface EditResult {
  /** True when the tune or event ops changed an input (one step of the history). */
  readonly applied: boolean;
  readonly pending: readonly PendingRun[];
}

export interface Editor {
  readonly history: EditUndo;
  /** The layout checks of the current inputs, and the gate of "Save placement". */
  readonly layout: LayoutChecks;
  /** The source ops of the applied edits that wait for a run of their tool, in their sequence. */
  readonly pending: ShallowRef<readonly PendingRun[]>;
  /** Apply an edit. An edit with a problem (an unknown tune path, an incorrect event) throws and changes nothing. */
  apply(edit: Edit): EditResult;
  /**
   * Remove a pending run from the list, because its tool ran on another path. For example, "Save placement" goes to the
   * host as the `placement` bridge event.
   */
  settle(run: PendingRun): void;
}

/** The editor methods of the script API. */
export interface LabEditorApi {
  /** Apply an edit `{ id, title, ops }` (ops.ts) as one step of the history. */
  applyEdit(edit: Edit): EditResult;
  /** The steps of the history of the tune values and of the events of edits. */
  editHistory(): EditSteps;
  /** The source ops that wait for a run. */
  pendingRuns(): PendingRun[];
}

export interface EditorParts {
  readonly tunes: Ref<Record<string, number>>;
  /** The live take. With its `events` (useLabTake.ts), the layout checks read the `place` events of the take. */
  readonly take: EditTake & { readonly events?: { readonly value: readonly LabEvent[] } };
  /** Add the editor methods to the script API (default: true). The tests set false. */
  readonly api?: boolean;
  /** The clock of the page. A change of the events of edits seeks to the current time. */
  readonly clock?: Pick<LabClock, "seek" | "simNow">;
  /** The scratch list of the page. Its changes are steps of the one history. */
  readonly scratch?: Ref<ScratchEntry[]>;
}

/** The take of the history, with a seek to the current time after each change of its events. */
function replayingTake(take: EditTake, clock: Pick<LabClock, "seek" | "simNow"> | undefined): EditTake {
  if (clock === undefined) return take;
  return {
    panel: () => take.panel(),
    setEvents: (events) => {
      take.setEvents(events);
      clock.seek(clock.simNow());
    },
  };
}

/** The gate of the layout checks for the "Save placement" ops of an edit. A failed check throws its numbers. */
function gatePlacement(edit: Edit, layout: LayoutChecks): void {
  for (const op of sourceOps(edit.ops)) {
    if (op.tool !== PLACEMENT_TOOL || op.args.placement !== true) continue;
    const override = typeof op.args.override === "string" ? op.args.override : undefined;
    const words = layout.gate(override);
    if (words !== null) throw new CommandError(words);
  }
}

export function useEditor(parts: EditorParts): Editor {
  const defaults = new Map(tunables().map((item) => [item.path, item.default]));
  const history = useEditHistory(parts.tunes, replayingTake(parts.take, parts.clock), parts.scratch);
  const pending = shallowRef<readonly PendingRun[]>([]);
  const { take } = parts;
  const layout = useLayoutChecks({
    tunes: parts.tunes,
    events: () => take.events?.value ?? take.panel(),
    ...(parts.api === false ? { api: false } : {}),
  });
  const editor: Editor = {
    history,
    layout,
    pending,
    apply(edit) {
      const problems = editProblems(edit, (path) => defaults.has(path));
      if (problems.length > 0) throw new Error(`The edit is not valid. ${problems.join(" ")}`);
      gatePlacement(edit, layout);
      const runs = pendingRuns(edit);
      const applied = history.record(edit, defaults);
      if (runs.length > 0) pending.value = [...pending.value, ...runs];
      return { applied, pending: runs };
    },
    settle(run) {
      pending.value = pending.value.filter((item) => item !== run);
    },
  };
  if (parts.api !== false) {
    const api: LabEditorApi = {
      applyEdit: (edit) => editor.apply(edit),
      editHistory: () => history.steps(),
      pendingRuns: () => [...pending.value],
    };
    installApi(api);
  }
  return editor;
}
