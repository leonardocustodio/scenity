// SPDX-License-Identifier: Apache-2.0
/**
 * The Console panel of the editor window: the panel over the log of the page, and the failed
 * jobs of the studio host (its event socket) in a window that the studio serves.
 */
import type { StudioShell } from "../../studio/shell/shell";
import { pageKeys } from "../settings/pageKeys";
import type { ScenePageEditor } from "../sceneEditor";
import type { PageSelectionPort } from "../inspector/startInspector";
import { servedByStudio } from "../projects/noProject";
import ConsolePanel from "./ConsolePanel.vue";
import { pageConsole } from "./consoleStore";
import { tapJobs } from "./consoleTaps";

/** Start the Console panel and, in a window of the studio, the tap of the jobs. */
export function startConsole(
  shell: Pick<StudioShell, "setPanel">,
  editor: ScenePageEditor,
  selection: PageSelectionPort | undefined,
): void {
  shell.setPanel("console", {
    component: ConsolePanel,
    props: {
      store: pageConsole(),
      select: (entity: string) => {
        if (editor.doc.entities[entity] !== undefined) selection?.set([entity]);
      },
      openFile: (path: string) => void pageKeys().execute("scene.open", { path }),
    },
  });
  void servedByStudio().then((studio) => {
    if (!studio) return;
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    tapJobs(pageConsole(), () => new WebSocket(`${scheme}://${location.host}/events`));
  });
}
