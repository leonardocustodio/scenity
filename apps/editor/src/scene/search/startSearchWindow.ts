// SPDX-License-Identifier: Apache-2.0
/**
 * The Search window of the editor window: the panel, the command `search.window` (⌘⇧K), and ⌥↩ in the search box, which
 * opens the text of the box in the window. An edit of a cell is the command `component.set`, so it is one undo step.
 */
import { shallowRef } from "vue";
import type { StudioShell } from "../../studio/shell/shell";
import { t } from "../../texts";
import type { PageSelectionPort } from "../inspector/startInspector";
import type { ScenePageEditor } from "../sceneEditor";
import { pageKeys } from "../settings/pageKeys";
import SearchWindow from "./SearchWindow.vue";
import { SearchWindowState } from "./searchWindow";

/** Start the Search window. */
export function startSearchWindow(
  shell: Pick<StudioShell, "setPanel" | "showPanel" | "search">,
  editor: ScenePageEditor,
  selection: PageSelectionPort | undefined,
  project: string,
): void {
  const state = new SearchWindowState(project);
  const doc = shallowRef(editor.doc);
  editor.listen(() => (doc.value = editor.doc));
  const show = (text?: string): void => {
    if (text !== undefined) state.text.value = text;
    shell.search.load();
    shell.showPanel("search");
  };
  shell.setPanel("search", {
    component: SearchWindow,
    props: {
      state,
      search: shell.search,
      doc,
      select: (ids: readonly string[]) => selection?.set(ids.filter((id) => editor.doc.entities[id] !== undefined)),
      setValue: (entity: string, component: string, field: string, value: unknown) =>
        void pageKeys().execute("component.set", { entity, component, field, value: JSON.stringify(value) }),
    },
  });
  shell.search.openWindow = show;
  pageKeys().register([
    { id: "search.window", title: t("search-command-window"), keys: ["Mod+Shift+K"], inText: true, run: () => show() },
  ]);
}
