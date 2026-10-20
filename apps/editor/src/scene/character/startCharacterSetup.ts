// SPDX-License-Identifier: Apache-2.0
/**
 * The Character setup window of the editor window. The panel `character` uses the document of the editor, the
 * selection, the inspect report of the core (the bone names of the models), and the commands. It also uses the canvas
 * of the Scene view (the IK handles go over it) and the preview clip of the viewport port.
 */
import { shallowRef } from "vue";
import type { StudioShell } from "../../studio/shell/shell";
import type { ScenePageEditor } from "../sceneEditor";
import type { ViewportPort } from "../viewport/viewportTypes";
import { pageKeys } from "../settings/pageKeys";
import CharacterSetupPanel from "./CharacterSetupPanel.vue";

/** Start the Character setup window. */
export function startCharacterSetup(
  shell: Pick<StudioShell, "setPanel">,
  editor: ScenePageEditor,
  selection?: { readonly ids: readonly string[]; listen(listener: (ids: readonly string[]) => void): () => void },
  canvas?: HTMLCanvasElement,
  viewport?: Pick<ViewportPort, "previewClip">,
): void {
  const doc = shallowRef(editor.doc);
  editor.listen(() => (doc.value = editor.doc));
  const selected = shallowRef<readonly string[]>(selection?.ids ?? []);
  selection?.listen((ids) => (selected.value = ids));
  shell.setPanel("character", {
    component: CharacterSetupPanel,
    props: {
      doc,
      selected,
      canvas,
      preview: (value: { readonly entity: string; readonly clip: string; readonly name: string } | null) => {
        viewport?.previewClip?.(value);
      },
      report: () => globalThis.__scenity?.inspect?.() ?? Promise.resolve(null),
      run: async (command: string, args: Readonly<Record<string, unknown>>) => {
        try {
          await pageKeys().execute(command, args);
          return null;
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      },
    },
  });
}
