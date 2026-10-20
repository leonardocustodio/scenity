// SPDX-License-Identifier: Apache-2.0
/**
 * The view layer of an editor page. It keeps the document that the runtime draws (the scene document with the view
 * overlay of view.ts). It gives the scene ops of each change for the "patch" message. With an empty view state the ops
 * of a document change go to the runtime as they are. No Vue import.
 */
import { diffDocuments } from "@scenity/scene/ops";
import type { EntityDocument } from "@scenity/scene/schema/documents";
import type { SceneOp } from "@scenity/scene/schema/entity";
import { EMPTY_VIEW, isEmptyView, viewOverlay, type SceneView } from "./view";

export class ViewLayer<D extends EntityDocument = EntityDocument> {
  #doc: D;
  #view: SceneView = EMPTY_VIEW;
  /** The current document of the runtime. */
  #shown: D;

  constructor(doc: D) {
    this.#doc = doc;
    this.#shown = doc;
  }

  /** The current view state. */
  get view(): SceneView {
    return this.#view;
  }

  /** The document that the runtime draws at this time. */
  get shown(): D {
    return this.#shown;
  }

  /** After a change of the document: the ops for the runtime. `ops` are the ops of the change itself. */
  docOps(doc: D, ops: readonly SceneOp[]): readonly SceneOp[] {
    const plain = this.#shown === this.#doc && isEmptyView(this.#view);
    this.#doc = doc;
    if (!plain) return this.#update();
    this.#shown = doc;
    return ops;
  }

  /** After a change of the view state: the ops for the runtime (empty when the drawn document does not change). */
  viewOps(view: SceneView): readonly SceneOp[] {
    this.#view = view;
    return this.#update();
  }

  #update(): readonly SceneOp[] {
    const next = viewOverlay(this.#doc, this.#view);
    const ops = next === this.#shown ? [] : diffDocuments(this.#shown, next);
    this.#shown = next;
    return ops;
  }
}
