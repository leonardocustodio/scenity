// SPDX-License-Identifier: Apache-2.0
/**
 * The identity of the editor window. The title of the window names the scene, the project and Scenity. While the
 * scene has changes that are not saved, the title starts with `*` and the icon of the tab also gets a dot. Several
 * windows of a project have the same title for the same scene and state.
 */
import { t } from "../texts";
import cleanIcon from "./icons/window.svg?url";
import dirtyIcon from "./icons/window-dirty.svg?url";
import type { ScenePageEditor } from "./sceneEditor";

/** The name of a scene file with no folder and no `.scene.json`. */
export function sceneName(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.scene\.json$/, "");
}

/** The title of the window. */
export function windowTitle(path: string, project: string, dirty: boolean): string {
  return t(dirty ? "window-title-dirty" : "window-title", { scene: sceneName(path), project });
}

/** The icon of the tab: the mark of Scenity, with a dot for changes that are not saved. */
function iconUrl(dirty: boolean): string {
  return dirty ? dirtyIcon : cleanIcon;
}

let refresh: (() => void) | null = null;

/** Show the title and the icon of the window again. False when no window identity runs (then the file bar sets it). */
export function refreshWindowIdentity(): boolean {
  refresh?.();
  return refresh !== null;
}

/** Keep the title and the icon of the window up to date. The result stops it. */
export function startWindowIdentity(editor: ScenePageEditor, project: string): () => void {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (link === null) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.append(link);
  }
  const icon = link;
  const show = (): void => {
    const dirty = editor.dirty;
    const title = windowTitle(editor.file.path, project, dirty);
    if (document.title === title) return;
    document.title = title;
    icon.href = iconUrl(dirty);
    document.documentElement.dataset.dirty = dirty ? "1" : "0";
  };
  const stops = [editor.listen(show), editor.listenSaved(show)];
  refresh = show;
  // The state of the file bar can also change without a change of the document (a save, a reload from the disk).
  const timer = setInterval(show, 1000);
  show();
  return () => {
    for (const stop of stops) stop();
    clearInterval(timer);
    refresh = null;
  };
}
