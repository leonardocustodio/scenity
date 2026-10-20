// SPDX-License-Identifier: Apache-2.0
/**
 * The preview of a document in the Scene view: the core draws another document (the result of a change set, or the
 * scene of a checkpoint) while the editor document, the history and the panels stay as they are. The page sends the ops
 * to that document to the core. At the end, it sends the return ops to the editor document. A change of the editor
 * document ends the preview first. One preview shows at a time; its key names it.
 */
import { shallowRef, type ShallowRef } from "vue";
import { docOps } from "@scenity/editor-core";
import { applyOps, type ComponentRegistry } from "@scenity/scene";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { SceneOp } from "@scenity/scene/schema/entity";

export interface ViewPreview {
  /** The key of the preview that shows, or null. */
  readonly key: ShallowRef<string | null>;
  /** Show a document under a key (the preview before it ends). */
  show(key: string, doc: SceneDocument): void;
  /** End the preview: the core draws the editor document again. */
  hide(): void;
}

/** What a preview reads of the page. */
export interface ViewPreviewParts {
  /** The current editor document. */
  doc(): SceneDocument;
  readonly registry: ComponentRegistry;
  /** Send scene ops to the core only. */
  patch(ops: readonly SceneOp[]): Promise<unknown>;
}

/** Make the preview of a page. */
export function createViewPreview(parts: ViewPreviewParts): ViewPreview {
  const key = shallowRef<string | null>(null);
  const { registry } = parts;
  /** The document that the core draws while the preview shows, and the editor document at its start. */
  let shown: SceneDocument | null = null;
  let start = parts.doc();
  const hide = (): void => {
    if (shown !== null) {
      // The core has the changes of the page after the start on top of the shown document. The return ops give the
      // current editor document.
      const now = parts.doc();
      const change = docOps(start, now, registry) ?? [];
      const applied = applyOps(shown, change, registry);
      const core = applied.ok ? applied.doc : shown;
      void parts.patch(docOps(core, now, registry) ?? []);
    }
    shown = null;
    key.value = null;
  };
  return {
    key,
    hide,
    show(next, doc) {
      hide();
      start = parts.doc();
      const ops = docOps(start, doc, registry);
      if (ops === null) return;
      key.value = next;
      shown = doc;
      void parts.patch(ops);
    },
  };
}

const current = shallowRef<ViewPreview | null>(null);

/** The view preview of the page, or null before the edit mode starts it. */
export function pageViewPreview(): ViewPreview | null {
  return current.value;
}

export function setPageViewPreview(preview: ViewPreview | null): void {
  current.value = preview;
}
