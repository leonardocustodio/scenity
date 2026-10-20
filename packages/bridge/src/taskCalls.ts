// SPDX-License-Identifier: Apache-2.0
/**
 * The task calls of the editor window: the studio host runs the gate of a background task
 * and makes its review pack over the window of the project. `task.gate` checks the rules on the document after the
 * change sets of the session that wait (the core draws that document for the check, then the editor document again).
 * `task.frames` gives two pictures of the view camera: the scene now and the scene after those change sets.
 * `task.document` gives the scene file of the window and its text after those change sets (the host writes it into the
 * worktree of a task before the check of the project).
 */
import type { BridgeCapture } from "./base";
import { argError, defineBridgeCall } from "./define";
import { isObject } from "./envelope";

/** The answer of `task.gate`: the result of the rules, its words, the count of the checked change sets. */
export interface TaskGateAnswer {
  readonly passed: boolean;
  /** The words of the decision ("The rules pass." or the rules that fail). */
  readonly message: string;
  /** The change sets of the session in the checked document. */
  readonly sets: number;
}

/** The arguments of a task call: the session. */
function sessionArgs(name: string): (raw: readonly unknown[]) => [string] {
  return (raw) => {
    const [session] = raw;
    if (typeof session !== "string" || session === "") argError(name, "the session is a text.");
    return [session];
  };
}

/** The answer of `task.document`: the scene file of the window (in the project) and its text after the change sets. */
export interface TaskDocumentAnswer {
  readonly path: string;
  /** The scene document after the change sets of the session, as canonical JSON. */
  readonly text: string;
  readonly sets: number;
}

function readDocumentAnswer(raw: unknown): TaskDocumentAnswer {
  if (!isObject(raw) || typeof raw.path !== "string" || typeof raw.text !== "string")
    throw new Error("task.document: the window gave no document.");
  return { path: raw.path, text: raw.text, sets: typeof raw.sets === "number" ? raw.sets : 0 };
}

function readGate(raw: unknown): TaskGateAnswer {
  if (!isObject(raw) || typeof raw.passed !== "boolean") throw new Error("task.gate: the window gave no result.");
  return {
    passed: raw.passed,
    message: typeof raw.message === "string" ? raw.message : "",
    sets: typeof raw.sets === "number" ? raw.sets : 0,
  };
}

function readFrames(raw: unknown): BridgeCapture[] {
  if (!Array.isArray(raw)) throw new Error("task.frames: the window gave no pictures.");
  return raw.filter((item): item is BridgeCapture => isObject(item) && typeof item.mime === "string");
}

/** The editor call `task.gate`. */
export const TASK_GATE_CALL = defineBridgeCall({ name: "task.gate", args: sessionArgs("task.gate"), result: readGate });
/** The editor call `task.frames`: the picture before and the picture after the change sets of the session. */
export const TASK_FRAMES_CALL = defineBridgeCall({
  name: "task.frames",
  args: sessionArgs("task.frames"),
  result: readFrames,
});
/** The editor call `task.document`: the scene file of the window after the change sets of the session. */
export const TASK_DOCUMENT_CALL = defineBridgeCall({
  name: "task.document",
  args: sessionArgs("task.document"),
  result: readDocumentAnswer,
});
