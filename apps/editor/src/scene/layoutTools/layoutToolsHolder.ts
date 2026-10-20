// SPDX-License-Identifier: Apache-2.0
/**
 * The layout tools of the edit mode as the page sees it: the lazy chunk of the
 * tools (startLayoutTools.ts) and its part of the script API. A page without `edit=1` never loads the chunk.
 */
import type { ProjectDocument, Rule, SceneOp } from "@scenity/scene";
import type { PatchResult, PickHit } from "@scenity/runtime/protocol";
import type { EditorPose } from "../dragMath";
import type { InspectPort } from "../gizmo/freeDrag";
import type { PageSelectionPort } from "../inspector/startInspector";
import type { ScenePageEditor } from "../sceneEditor";
import type { LayoutToolsApi } from "./startLayoutTools";

/** What the edit mode gives to the layout tools: the parts of the page that they read. */
export interface LayoutToolsOpen {
  readonly canvas: HTMLCanvasElement;
  readonly selection?: PageSelectionPort | undefined;
  readonly inspect?: InspectPort | undefined;
  /** The rules port gives the project document and the rules of the project (for the layout search). */
  readonly rules?:
    { readonly project: { readonly project: ProjectDocument | null; readonly rules: readonly Rule[] } } | undefined;
  patch(ops: readonly SceneOp[]): Promise<PatchResult>;
  pick(x: number, y: number): Promise<PickHit | null>;
  camera(): string | null;
  editorView?(): EditorPose | null;
}

/** The layout tools API of each editor in the edit mode, when its lazy chunk runs. */
const pageTools = new WeakMap<ScenePageEditor, { api: LayoutToolsApi | null }>();

/** Load and start the layout tools of an editor (none without a selection and an inspect report). */
export async function openLayoutTools(parts: LayoutToolsOpen, editor: ScenePageEditor): Promise<void> {
  const { selection, inspect } = parts;
  if (selection === undefined || inspect === undefined) return;
  const holder: { api: LayoutToolsApi | null } = { api: null };
  pageTools.set(editor, holder);
  const { startLayoutTools } = await import("./startLayoutTools");
  holder.api = startLayoutTools({
    canvas: parts.canvas,
    editor,
    selection,
    inspect,
    project: parts.rules?.project.project ?? null,
    // The rules of the layout search: the current rules of the scene, then the rules of the project.
    rules: () => [...(editor.doc.rules ?? []), ...(parts.rules?.project.rules ?? [])],
    pick: (x, y) => parts.pick(x, y),
    // An empty patch answers after the next frame of the core: the frame of the last edit.
    settle: async () => {
      await editor.settled();
      await parts.patch([]);
    },
    camera: () => parts.camera(),
    editorView: () => parts.editorView?.() ?? null,
  });
}

/** The layout tools part of the script API: it calls the tools of the lazy chunk (empty without `edit=1`). */
export function layoutToolsApi(editor: ScenePageEditor): Partial<LayoutToolsApi> {
  const holder = pageTools.get(editor);
  if (holder === undefined) return {};
  const api = (): LayoutToolsApi => {
    if (holder.api === null) throw new Error("the layout tools do not run yet (wait for data-layout-tools)");
    return holder.api;
  };
  return {
    layoutTool: (tool, input) => api().layoutTool(tool, input),
    layoutTools: () => api().layoutTools(),
    layoutSearch: (entity, radius) => api().layoutSearch(entity, radius),
    applyPlace: (variant) => api().applyPlace(variant),
  };
}
