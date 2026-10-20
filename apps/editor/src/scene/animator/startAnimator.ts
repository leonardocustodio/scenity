// SPDX-License-Identifier: Apache-2.0
/**
 * The Animator window of the editor window: the panel `animator` over the document of the editor and the selection,
 * the inspect report of the core (the preview), and the commands of the window.
 */
import { shallowRef } from "vue";
import type { StudioShell } from "../../studio/shell/shell";
import type { ScenePageEditor } from "../sceneEditor";
import { pageKeys } from "../settings/pageKeys";
import AnimatorPanel from "./AnimatorPanel.vue";

/** Start the Animator window. */
export function startAnimator(
  shell: Pick<StudioShell, "setPanel">,
  editor: ScenePageEditor,
  selection?: { readonly ids: readonly string[]; listen(listener: (ids: readonly string[]) => void): () => void },
): void {
  const doc = shallowRef(editor.doc);
  editor.listen(() => (doc.value = editor.doc));
  const selected = shallowRef<readonly string[]>(selection?.ids ?? []);
  selection?.listen((ids) => (selected.value = ids));
  shell.setPanel("animator", {
    component: AnimatorPanel,
    props: {
      doc,
      selected,
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
