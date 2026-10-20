// SPDX-License-Identifier: Apache-2.0
/**
 * The viewport of the edit mode as the page sees it: the lazy chunk of the
 * viewport (startViewport.ts) and its part of the script API. A page without `edit=1` never loads the chunk.
 */
import type { ScenePageEditor } from "../sceneEditor";
import type { ViewportApi, ViewportParts } from "./viewportTypes";

/** The viewport API of each editor in the edit mode, when its lazy chunk runs. */
const pageViewports = new WeakMap<ScenePageEditor, { api: ViewportApi | null }>();

/** Load and start the viewport of an editor. */
export async function openViewport(parts: ViewportParts): Promise<void> {
  const holder: { api: ViewportApi | null } = { api: null };
  pageViewports.set(parts.editor, holder);
  const { startViewport } = await import("./startViewport");
  holder.api = startViewport(parts);
}

/** The viewport part of the script API. It calls the viewport of the lazy chunk (empty without `edit=1`). */
export function viewportApi(editor: ScenePageEditor): Partial<ViewportApi> {
  const holder = pageViewports.get(editor);
  if (holder === undefined) return {};
  const api = (): ViewportApi => {
    if (holder.api === null) throw new Error("the viewport does not run yet (wait for data-viewport)");
    return holder.api;
  };
  return {
    viewport: () => api().viewport(),
    setViewport: (change) => api().setViewport(change),
    frameSelection: () => api().frameSelection(),
  };
}
