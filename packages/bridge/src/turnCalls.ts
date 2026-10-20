// SPDX-License-Identifier: Apache-2.0
/**
 * The turn calls of the editor window: "Undo the turn" of the studio host reverts the files
 * of a turn of an agent session and asks each window of the project to revert the document part. `turn.undo` reverts
 * the steps of the turn (the steps whose actor has the session and the turn) as one new step of the history and drops
 * the proposals of the turn that wait.
 *
 * `turn.checkpoint` keeps the scene of the window at the start of a turn; `turn.restore` puts the scene of a
 * checkpoint back as one new step (undo reverts it).
 */
import { argError, defineBridgeCall } from "./define";
import { isObject } from "./envelope";

/** The answer of `turn.undo`: the reverted steps, the dropped ops that waited, or the reason of a refusal. */
export interface TurnUndoAnswer {
  readonly steps: number;
  readonly dropped: number;
  readonly error: string | null;
}

/** The arguments of a turn call: the session and the turn. */
function turnArgs(name: string): (raw: readonly unknown[]) => [string, number] {
  return (raw) => {
    const [session, turn] = raw;
    if (typeof session !== "string" || session === "") argError(name, "the session is a text.");
    if (typeof turn !== "number" || !Number.isInteger(turn)) argError(name, "the turn is a whole number.");
    return [session, turn];
  };
}

function readUndo(raw: unknown): TurnUndoAnswer {
  if (!isObject(raw)) return { steps: 0, dropped: 0, error: "the window gave no answer" };
  return {
    steps: typeof raw.steps === "number" ? raw.steps : 0,
    dropped: typeof raw.dropped === "number" ? raw.dropped : 0,
    error: typeof raw.error === "string" ? raw.error : null,
  };
}

/** The editor call `turn.undo`. */
export const TURN_UNDO_CALL = defineBridgeCall({ name: "turn.undo", args: turnArgs("turn.undo"), result: readUndo });
/** The editor call `turn.checkpoint`: true when the window kept its scene. */
export const TURN_CHECKPOINT_CALL = defineBridgeCall({
  name: "turn.checkpoint",
  args: turnArgs("turn.checkpoint"),
  result: (raw: unknown) => raw === true,
});
/** The editor call `turn.restore` (the same answer as `turn.undo`: one step, or the reason of a refusal). */
export const TURN_RESTORE_CALL = defineBridgeCall({
  name: "turn.restore",
  args: turnArgs("turn.restore"),
  result: readUndo,
});
