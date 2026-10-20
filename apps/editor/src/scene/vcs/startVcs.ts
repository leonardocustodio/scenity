// SPDX-License-Identifier: Apache-2.0
/**
 * The version control panel of the editor window, for the project folder of the page. In the studio, the panel also
 * shows the agent tasks of each branch (the tasks of the studio host).
 */
import { markRaw } from "vue";
import { studioHost } from "../../studio/shell/panels";
import type { StudioShell } from "../../studio/shell/shell";
import { agentClient } from "../agent/agentClient";
import type { ScenePageEditor } from "../sceneEditor";
import VcsPanel from "./VcsPanel.vue";

/** Start the panel for the project `project` (its name on the dev server). */
export function startVcs(shell: Pick<StudioShell, "setPanel">, project: string, editor: ScenePageEditor): void {
  const tasks = async () => (studioHost.value ? (await agentClient().tasks(project)).tasks : []);
  const onSaved = (listener: (path: string) => void) => editor.listenSaved(() => listener(editor.file.path));
  shell.setPanel("vcs", { component: markRaw(VcsPanel), props: { base: `/projects/${project}/`, tasks, onSaved } });
}
