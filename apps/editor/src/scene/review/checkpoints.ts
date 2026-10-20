// SPDX-License-Identifier: Apache-2.0
/**
 * The checkpoints of the editor window: at the start of each turn of an agent session, the studio host asks the window
 * to keep its scene (`turn.checkpoint`). The transcript shows each checkpoint with Preview and Restore. Preview shows
 * the entities that changed after the checkpoint, and the scene of the checkpoint in the view. Restore applies the
 * scene of the checkpoint as one new step (undo reverts it), and the host restores the files. The
 * window keeps the newest `CHECKPOINTS_MAX` checkpoints.
 */
import { shallowRef } from "vue";
import { docOps, sceneOpEntity } from "@scenity/editor-core";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { t } from "../../texts";
import type { ScenePageEditor } from "../sceneEditor";
import type { TurnRevert } from "./turnUndo";

/** The most checkpoints that a window keeps. */
export const CHECKPOINTS_MAX = 50;

/** The scenes of the checkpoints by `<session>#<turn>`, the oldest first. */
const kept = shallowRef<ReadonlyMap<string, SceneDocument>>(new Map());

const keyOf = (session: string, turn: number): string => `${session}#${String(turn)}`;

/** Keep the scene of the window for the start of a turn. */
export function keepCheckpoint(editor: ScenePageEditor, session: string, turn: number): boolean {
  const next = new Map(kept.value);
  next.set(keyOf(session, turn), editor.doc);
  while (next.size > CHECKPOINTS_MAX) next.delete(next.keys().next().value ?? "");
  kept.value = next;
  return true;
}

/** The scene of a checkpoint, or null (the window did not keep it). */
export function checkpointOf(session: string, turn: number): SceneDocument | null {
  return kept.value.get(keyOf(session, turn)) ?? null;
}

/** The names of the entities that changed after a checkpoint, or null with no checkpoint. */
export function checkpointDiff(editor: ScenePageEditor, session: string, turn: number): string[] | null {
  const doc = checkpointOf(session, turn);
  if (doc === null) return null;
  const ops = docOps(doc, editor.doc, editor.registry) ?? [];
  const ids = [...new Set(ops.map((op) => sceneOpEntity(op)).filter((id): id is string => id !== null))];
  return ids.map((id) => editor.doc.entities[id]?.name ?? doc.entities[id]?.name ?? id);
}

/** Restore the scene of a checkpoint as one step; no step when the scene is the same. */
export function restoreCheckpoint(editor: ScenePageEditor, session: string, turn: number): TurnRevert {
  const doc = checkpointOf(session, turn);
  if (doc === null) return { steps: 0, error: t("review-no-checkpoint") };
  const ops = docOps(editor.doc, doc, editor.registry);
  if (ops === null) return { steps: 0, error: t("review-undo-no-inverse") };
  if (ops.length === 0) return { steps: 0, error: null };
  const reason = editor.apply(ops, t("review-restore", { turn }));
  return { steps: reason === null ? 1 : 0, error: reason };
}
