// SPDX-License-Identifier: Apache-2.0
/**
 * The material editor in the edit mode of the scene page: the two calls of editMode.ts. `materialEditorParts` gives the
 * material channel to the page editor (with the channels of the open sequence). `startMaterials` connects the material
 * editor to the page editor and gives the material tab of the bottom dock (a lazy chunk with Vue). A page with no
 * `materials` port of its core has no material editor.
 */
import type { DockTab } from "../assetDock/dockTab";
import type { PageSelectionPort } from "../inspector/startInspector";
import type { PageEditorParts, ScenePageEditor } from "../sceneEditor";
import type { SceneFilePort } from "../sceneFiles";
import { holdMaterials } from "./materialApi";
import { PageMaterials, type MaterialPageParts } from "./pageMaterials";

/** The parts of the page that the material editor reads (a part of `EditParts` of editMode.ts). */
export interface MaterialEditParts {
  readonly project: string;
  readonly files: SceneFilePort;
  readonly materials?: MaterialPageParts["send"];
  readonly inspect?: MaterialPageParts["inspect"];
  readonly selection?: PageSelectionPort;
}

/** The material editor of each parts object of the page: one editor for one page. */
const editors = new WeakMap<MaterialEditParts, PageMaterials>();

/** The material editor of the page, or null when the page cannot send materials to its core. */
export function materialsOf(parts: MaterialEditParts): PageMaterials | null {
  if (parts.materials === undefined) return null;
  let materials = editors.get(parts);
  if (materials === undefined) {
    const inspect = parts.inspect === undefined ? {} : { inspect: parts.inspect };
    materials = new PageMaterials({
      base: `/projects/${parts.project}/`,
      files: parts.files,
      send: parts.materials,
      ...inspect,
    });
    editors.set(parts, materials);
  }
  return materials;
}

/** The channels and the op kinds of the page editor: `more` (the sequence) and the material channel. */
export function materialEditorParts(
  parts: MaterialEditParts,
  more?: Pick<PageEditorParts, "channels" | "kinds">,
): Pick<PageEditorParts, "channels" | "kinds"> {
  return materialsOf(parts)?.editorParts(more) ?? more ?? {};
}

/**
 * Connect the material editor to the page editor (the history, the save, the open event, the script API) and give
 * the material tab of the dock.
 */
export function startMaterials(parts: MaterialEditParts, editor: ScenePageEditor): Promise<DockTab | null>[] {
  const materials = materialsOf(parts);
  if (materials === null) return [];
  materials.connect(editor);
  holdMaterials(editor, materials);
  const tab = import("./startMaterials").then((chunk) => chunk.materialTab(materials, editor, parts.selection));
  return [tab];
}
