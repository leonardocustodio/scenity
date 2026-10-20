// SPDX-License-Identifier: Apache-2.0
/**
 * The build panels of the editor window, for the project folder of the page: the Build window, the Embed panel (the
 * player preview and the embed snippets), the Shots panel (the shots, the baselines, verify), the render queue, the
 * Frame index panel and the Project settings window.
 */
import { markRaw } from "vue";
import type { StudioShell } from "../../studio/shell/shell";
import BuildPanel from "./BuildPanel.vue";
import EmbedPanel from "./EmbedPanel.vue";
import RenderQueuePanel from "./RenderQueuePanel.vue";
import FrameIndexPanel from "../frameIndex/FrameIndexPanel.vue";
import ShotsPanel from "./ShotsPanel.vue";
import ProjectSettingsPanel from "../projectSettings/ProjectSettingsPanel.vue";
import type { ScenePageEditor } from "../sceneEditor";

/** Start the Build window for the project folder `base` (its URL, with a "/" at the end). */
export function startBuild(
  shell: Pick<StudioShell, "setPanel">,
  base: string,
  scenes: () => readonly string[],
  editor: ScenePageEditor,
  sequences: () => readonly string[] = () => [],
): void {
  shell.setPanel("build", { component: BuildPanel, props: { base } });
  shell.setPanel("embed", { component: EmbedPanel, props: { base, scenes } });
  // The shots, the baselines and the verify job. The editor has private fields: it goes in as it is.
  shell.setPanel("baselines", { component: ShotsPanel, props: { base, scenes, editor: markRaw(editor) } });
  // The render queue of sheets and clips.
  shell.setPanel("renderQueue", { component: RenderQueuePanel, props: { base, sequences } });
  // The frame index of the project.
  shell.setPanel("frameIndex", { component: FrameIndexPanel, props: { base } });
  shell.setPanel("projectSettings", { component: ProjectSettingsPanel, props: { base } });
}
