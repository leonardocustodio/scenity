// SPDX-License-Identifier: Apache-2.0
/**
 * The actions of the open scenes: open a scene, New scene, Open a path, Save as, Close and the project start screen. An
 * action that needs a text (a name or a path) asks for it in the notice of the bar. After a refusal, the action asks
 * again with the reason. The scene tabs run them.
 */
import { t } from "../../texts";
import type { SceneBar } from "../sceneBar";
import type { ScenePageEditor } from "../sceneEditor";
import { projectPageUrl, type PageScenes } from "./pageScenes";

/**
 * Ask for a text in the notice of the bar, then run the action with it. A refusal asks again: `text` gives the
 * sentence of the notice with the reason of the refusal (null for the first ask).
 */
function askText(
  bar: SceneBar,
  text: (error: string | null) => string,
  input: { readonly placeholder: string; readonly value?: string },
  action: { readonly label: string; readonly run: (value: string) => Promise<string | null> },
  error: string | null = null,
): void {
  bar.notice({
    kind: "scene",
    spec: "prompt.scene",
    title: action.label,
    text: text(error),
    input: { ...input, testId: "scene-input" },
    first: {
      label: action.label,
      testId: "scene-input-go",
      run: (value) => {
        bar.notice(null);
        void action.run(value).then((reason) => {
          if (reason !== null) askText(bar, text, { ...input, value }, action, reason);
        });
      },
    },
    second: { label: t("projects-cancel"), testId: "scene-input-cancel", run: () => bar.notice(null) },
  });
}

/** A path for a save as: the path of the active scene with "-copy" before its suffix. */
function copyPath(path: string): string {
  return path.replace(/\.scene\.json$/, "-copy.scene.json");
}

/** Run a choice of the scene actions (from the scene tabs). */
export async function runChoice(
  scenes: PageScenes,
  editor: ScenePageEditor,
  bar: SceneBar,
  value: string,
): Promise<void> {
  const open = { label: t("projects-open"), run: (text: string) => scenes.open(text) };
  if (value.startsWith("open:")) {
    const path = value.slice("open:".length);
    const reason = await scenes.open(path);
    const failed = (error: string | null): string => t("projects-open-failed", { reason: error ?? "" });
    if (reason !== null) askText(bar, failed, { placeholder: t("projects-path"), value: path }, open, reason);
  } else if (value === "new") {
    const create = async (name: string): Promise<string | null> => {
      const result = await scenes.create(name);
      return result.ok ? null : result.reason;
    };
    const text = (error: string | null): string =>
      error === null ? t("projects-new") : t("projects-new-failed", { reason: error });
    askText(bar, text, { placeholder: t("projects-new-name") }, { label: t("projects-create"), run: create });
  } else if (value === "path") {
    const text = (error: string | null): string =>
      error === null ? t("projects-open-path") : t("projects-open-path-failed", { reason: error });
    askText(bar, text, { placeholder: t("projects-path-example") }, open);
  } else if (value === "saveAs") {
    // The save as shows its own notice for a refusal (a file that is there, a rule that fails).
    const saveAs = async (path: string): Promise<null> => {
      await scenes.saveAs(path);
      return null;
    };
    const input = { placeholder: t("projects-copy-example"), value: copyPath(editor.file.path) };
    askText(bar, () => t("projects-save-as"), input, { label: t("projects-save-as-go"), run: saveAs });
  } else if (value === "close") await scenes.close();
  else if (value === "start") location.assign(projectPageUrl(location.href, null));
}
