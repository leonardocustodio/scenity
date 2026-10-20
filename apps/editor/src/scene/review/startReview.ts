// SPDX-License-Identifier: Apache-2.0
/**
 * The start of the review of the page: the review state follows the proposals and the document. The start also makes
 * the Review panel, the status item ("5 changes wait", a press opens Review) and the Preview of a change set.
 *
 * Preview: the core draws the document after the whole change set (the view preview of the page, viewPreview.ts). A
 * change of the document or of the proposals ends the Preview first.
 */
import { markRaw } from "vue";
import type { ShallowRef } from "vue";
import { docOps } from "@scenity/editor-core";
import type { SceneOp } from "@scenity/scene/schema/entity";
import type { StudioShell } from "../../studio/shell/shell";
import type { SceneCommands } from "../hierarchy/sceneCommands";
import type { RuleChecker } from "../pageRules";
import type { ScenePageEditor } from "../sceneEditor";
import ReviewPanel from "./ReviewPanel.vue";
import { proposedDoc } from "./reviewModel";
import { createReviewState, setPageReview, type ReviewState } from "./reviewState";
import { createTaskGate, setPageTaskGate } from "./taskGate";
import { createViewPreview, setPageViewPreview, type ViewPreview } from "./viewPreview";

/** What the review reads of the page. */
export interface ReviewParts {
  readonly editor: ScenePageEditor;
  readonly commands: SceneCommands;
  readonly shell: Pick<StudioShell, "setPanel" | "showPanel" | "status">;
  /** Send scene ops to the core only (the Preview). */
  patch(ops: readonly SceneOp[]): Promise<unknown>;
  select(ids: readonly string[]): void;
  /** The rule check of the page and a picture of the view camera, for the gate of a background task. */
  readonly check?: RuleChecker | undefined;
  picture?(width: number): Promise<ImageBitmap | null>;
}

/** The Preview of a change set (its key, its start and its end). */
export interface ReviewPreview {
  /** The key of the preview that shows (a change set key), or null. */
  readonly key: ShallowRef<string | null>;
  set(key: string | null): void;
}

/** The Preview of a change set over the view preview of the page. */
function reviewPreview(preview: ViewPreview, review: ReviewState, editor: ScenePageEditor): ReviewPreview {
  return {
    key: preview.key,
    set(next) {
      const set = review.sets.value.find((item) => item.key === next);
      const doc = set === undefined ? null : proposedDoc(editor.doc, set, editor.registry);
      if (set === undefined || doc === null) preview.hide();
      else preview.show(set.key, doc);
    },
  };
}

/** Start the review of the page; the result stops it. */
export function startReview(parts: ReviewParts): () => void {
  const { editor, commands, shell } = parts;
  const review = createReviewState(commands, () => editor.doc);
  setPageReview(review);
  const view = createViewPreview({
    doc: () => editor.doc,
    registry: editor.registry,
    patch: (ops) => parts.patch(ops),
  });
  setPageViewPreview(view);
  setPageTaskGate(
    createTaskGate({
      editor,
      review,
      preview: view,
      check: parts.check,
      picture: (width) => parts.picture?.(width) ?? Promise.resolve(null),
    }),
  );
  const preview = reviewPreview(view, review, editor);
  let last = editor.doc;
  const refresh = (): void => {
    if (view.key.value !== null) view.hide();
    review.refresh();
    shell.status.set("review", review.count());
  };
  const stops = [
    commands.listenProposals(refresh),
    editor.listen((doc) => {
      if (doc === last) return;
      // A change of the person on a value that a waiting op also sets is a conflict.
      const step = editor.channel.history.steps().steps.at(-1);
      if ((step?.label?.actor?.kind ?? "person") === "person") {
        const paths = (docOps(last, doc, editor.registry) ?? []).flatMap((op) => (op.op === "set" ? [op.path] : []));
        review.personChanged(paths);
      }
      last = doc;
      refresh();
    }),
    shell.status.onPress("review", () => shell.showPanel("review"), "panel.open.review"),
  ];
  shell.setPanel("review", {
    component: ReviewPanel,
    props: {
      ...{ review, doc: () => editor.doc, select: (ids: readonly string[]) => parts.select(ids), preview },
      registry: markRaw(editor.registry),
    },
  });
  refresh();
  return () => {
    for (const stop of stops) stop();
    setPageReview(null);
    setPageViewPreview(null);
    setPageTaskGate(null);
  };
}
