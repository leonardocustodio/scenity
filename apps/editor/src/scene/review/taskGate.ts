// SPDX-License-Identifier: Apache-2.0
/**
 * The gate and the pictures of a background task in the editor window. The turns of a task wait in Review, so the
 * gate checks the document after the change sets of its session. The core draws that document (the view preview), the
 * rules run on it, and then the core draws the editor document again. The pictures of the review pack come the same
 * way: the view camera before and after those change sets. `look` gives the picture after the change sets of a
 * session (the grid of frames of a group of tasks). The core draws one preview at a time, so the checks and the
 * pictures run one after another.
 */
import { shallowRef } from "vue";
import type { BridgeCapture, TaskGateAnswer } from "@scenity/bridge";
import { gateRules } from "@scenity/rules";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { t } from "../../texts";
import type { RuleChecker } from "../pageRules";
import { encodeBitmap } from "../scenePicture";
import type { ScenePageEditor } from "../sceneEditor";
import { proposedDoc } from "./reviewModel";
import type { ReviewState } from "./reviewState";
import type { ViewPreview } from "./viewPreview";

/** The width of a picture of a review pack (px). */
const PACK_WIDTH = 960;

/** What the gate and the pictures read of the page. */
export interface TaskGateParts {
  readonly editor: Pick<ScenePageEditor, "doc" | "registry">;
  readonly review: Pick<ReviewState, "sets">;
  readonly preview: ViewPreview;
  /** The rule check of the page (absent: a page with no rules check). */
  readonly check?: RuleChecker | undefined;
  /** A picture of the view camera (absent: no pictures). */
  picture?(width: number): Promise<ImageBitmap | null>;
}

export interface TaskGate {
  gate(session: string): Promise<TaskGateAnswer>;
  frames(session: string): Promise<BridgeCapture[]>;
  /** The view camera after the change sets of a session, or null. */
  look(session: string, width: number): Promise<ImageBitmap | null>;
  /** The document after the change sets of a session (the host writes it into the worktree of a task). */
  document(session: string): { readonly doc: SceneDocument; readonly sets: number };
}

/** The document after the change sets of a session that wait, and the count of those sets. */
export function sessionDoc(parts: TaskGateParts, session: string): { doc: SceneDocument; sets: number } {
  const sets = parts.review.sets.value.filter((set) => set.actor.session === session);
  let doc = parts.editor.doc;
  for (const set of sets) doc = proposedDoc(doc, set, parts.editor.registry) ?? doc;
  return { doc, sets: sets.length };
}

/** Run a step while the core draws a document (no preview when it is the editor document). */
async function drawing<T>(parts: TaskGateParts, key: string, doc: SceneDocument, step: () => Promise<T>): Promise<T> {
  if (doc === parts.editor.doc) return step();
  parts.preview.show(key, doc);
  try {
    return await step();
  } finally {
    parts.preview.hide();
  }
}

/** Make the gate and the pictures of the tasks of a page. */
export function createTaskGate(parts: TaskGateParts): TaskGate {
  const picture = async (): Promise<BridgeCapture | null> => {
    const bitmap = (await parts.picture?.(PACK_WIDTH)) ?? null;
    return bitmap === null ? null : { simMs: null, ...(await encodeBitmap(bitmap)) };
  };
  // One call at a time: each call waits for the end of the call before it.
  let last: Promise<unknown> = Promise.resolve();
  const queued = <T>(step: () => Promise<T>): Promise<T> => {
    const next = last.then(step, step);
    last = next.catch(() => undefined);
    return next;
  };
  return {
    gate: (session) =>
      queued(async () => {
        const { doc, sets } = sessionDoc(parts, session);
        const { check } = parts;
        if (check === undefined) return { passed: true, message: t("tasks-no-rules"), sets };
        const verdicts = await drawing(parts, `task:${session}`, doc, () => check(doc));
        const decision = gateRules(verdicts);
        return { passed: decision.passed, message: decision.message, sets };
      }),
    frames: (session) =>
      queued(async () => {
        const { doc } = sessionDoc(parts, session);
        const before = await picture();
        const after = await drawing(parts, `task:${session}`, doc, picture);
        return [before, after].filter((item): item is BridgeCapture => item !== null);
      }),
    look: (session, width) =>
      queued(() => {
        const { doc } = sessionDoc(parts, session);
        return drawing(parts, `task:${session}`, doc, async () => (await parts.picture?.(width)) ?? null);
      }),
    document: (session) => sessionDoc(parts, session),
  };
}

/** The task gate of the page: a reactive cell. */
const current = shallowRef<TaskGate | null>(null);

/** The task gate of the page, or null before the edit mode starts it. */
export function pageTaskGate(): TaskGate | null {
  return current.value;
}

export function setPageTaskGate(gate: TaskGate | null): void {
  current.value = gate;
}
