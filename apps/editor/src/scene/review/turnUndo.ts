// SPDX-License-Identifier: Apache-2.0
/**
 * "Undo the turn" in the editor window: one new step of the history reverts the steps of one turn of an agent session
 * (their actor has the session and the turn). This also works when steps of the person came after them. The inverse
 * of each step comes from the scene of the history before and after it. The inverses apply from the newest step to the
 * oldest on the current document. The waiting proposals of the turn go away.
 */
import { docOps, SCENE_CHANNEL } from "@scenity/editor-core";
import { applyOps } from "@scenity/scene";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { SceneOp } from "@scenity/scene/schema/entity";
import { t } from "../../texts";
import type { ScenePageEditor } from "../sceneEditor";

/** What an undo of a turn did: the reverted steps, or the reason of a refusal. */
export interface TurnRevert {
  readonly steps: number;
  readonly error: string | null;
}

/** Revert the steps of a turn of a session as one step ("Undo the turn 2 of Chairs"). */
export function revertTurn(editor: ScenePageEditor, session: string, turn: number): TurnRevert {
  const { index, steps } = editor.channel.history.steps();
  const hits: number[] = [];
  for (let at = 1; at <= index; at += 1) {
    const actor = steps[at]?.label?.actor;
    if (actor?.session === session && actor.turn === turn) hits.push(at);
  }
  if (hits.length === 0) return { steps: 0, error: null };
  let doc = editor.doc;
  const ops: SceneOp[] = [];
  for (const at of hits.reverse()) {
    const after = steps[at]?.values[SCENE_CHANNEL] as SceneDocument | undefined;
    const before = steps[at - 1]?.values[SCENE_CHANNEL] as SceneDocument | undefined;
    const back = after === undefined || before === undefined ? null : docOps(after, before, editor.registry);
    if (back === null) return { steps: 0, error: t("review-undo-no-inverse") };
    const applied = applyOps(doc, back, editor.registry);
    if (!applied.ok) return { steps: 0, error: applied.reason };
    doc = applied.doc;
    ops.push(...back);
  }
  const name = steps[hits[0] ?? 0]?.label?.actor?.name ?? session;
  const reason = editor.apply(ops, t("review-undo-turn", { turn, name }));
  return { steps: reason === null ? hits.length : 0, error: reason };
}
