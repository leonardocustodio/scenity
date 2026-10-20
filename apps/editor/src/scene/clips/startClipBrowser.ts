// SPDX-License-Identifier: Apache-2.0
/**
 * The clip browser of the editor window. The panel `clips` uses the document of the editor, the selection, the inspect
 * report of the core (the clips of the models), the open sequence of the page and the preview clip of the viewport
 * port.
 */
import { shallowRef } from "vue";
import type { StudioShell } from "../../studio/shell/shell";
import type { ScenePageEditor } from "../sceneEditor";
import type { ViewportPort } from "../viewport/viewportTypes";
import ClipBrowserPanel from "./ClipBrowserPanel.vue";
import type { ClipDrag } from "./clipBrowser";

/** Start the clip browser. */
export function startClipBrowser(
  shell: Pick<StudioShell, "setPanel">,
  editor: ScenePageEditor,
  selection?: { readonly ids: readonly string[]; listen(listener: (ids: readonly string[]) => void): () => void },
  viewport?: Pick<ViewportPort, "previewClip">,
): void {
  const doc = shallowRef(editor.doc);
  editor.listen(() => (doc.value = editor.doc));
  const selected = shallowRef<readonly string[]>(selection?.ids ?? []);
  selection?.listen((ids) => (selected.value = ids));
  shell.setPanel("clips", {
    component: ClipBrowserPanel,
    props: {
      doc,
      selected,
      report: () => globalThis.__scenity?.inspect?.() ?? Promise.resolve(null),
      sequence: () => globalThis.__scenity?.sequence?.() ?? null,
      time: () => globalThis.__scenity?.time?.() ?? 0,
      run: async (command: string, args: Readonly<Record<string, unknown>>) => {
        try {
          await globalThis.__scenity?.sequenceCommand?.(command, args);
          return null;
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      },
      preview: (value: ClipDrag | null) => {
        viewport?.previewClip?.(value);
      },
    },
  });
}
