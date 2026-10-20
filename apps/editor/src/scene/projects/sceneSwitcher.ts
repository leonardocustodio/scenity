// SPDX-License-Identifier: Apache-2.0
/**
 * The open scenes of the edit mode and their actions: New scene, Open a path, Save as, Close and the project start
 * screen. The actions that need a text (a name or a path) ask for it in the notice of the bar. The scene tabs of the
 * file bar (sceneTabs.ts) run the actions. The texts are Fluent messages of `src/i18n/en-US/projects.ftl`, and a file
 * name is a data value. DOM nodes only (no HTML text), as the file bar.
 */
import type { ScenePageEditor } from "../sceneEditor";
import { savedFileKind } from "@scenity/cli/sceneFileContract";
import { PageScenes, scenesOf, type PageScenesParts } from "./pageScenes";
import "./projects.css";
import { currentShell } from "../../studio/shell/shell";
import { startSceneTabs } from "./sceneTabs";

/** The script API of the open scenes. */
export interface ScenesApi {
  /** The open scenes and the active one. */
  scenes(): { readonly active: string | null; readonly open: ReturnType<PageScenes["list"]> };
  /** Open a scene of the project (or switch to it); the reason of a refusal, or null. */
  openScene(path: string): Promise<string | null>;
  /** Write a new empty scene and open it. */
  newScene(name: string): ReturnType<PageScenes["create"]>;
  /** Save the active scene to a new path; with a `reason`, the save continues while a block rule fails. */
  saveSceneAs(path: string, reason?: string): ReturnType<PageScenes["saveAs"]>;
  /** Close a scene (default: the active one); `choice` answers the question about unsaved changes. */
  closeScene(path?: string, choice?: "save" | "discard" | "cancel"): ReturnType<PageScenes["close"]>;
}

/** The script API over the open scenes; `frame` waits for the next frame of the core. */
export function scenesApi(scenes: PageScenes, editor: ScenePageEditor, frame: () => Promise<void>): ScenesApi {
  const settle = async <T>(value: T): Promise<T> => {
    await editor.settled();
    await frame();
    return value;
  };
  return {
    scenes: () => ({ active: scenes.sessions.active?.path ?? null, open: scenes.list() }),
    openScene: async (path) => settle(await scenes.open(path)),
    newScene: async (name) => settle(await scenes.create(name)),
    saveSceneAs: async (path, reason) => settle(await scenes.saveAs(path, reason)),
    closeScene: async (path, choice) => settle(await scenes.close(path, choice)),
  };
}

/** Wait for the next paint. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

/**
 * Start the open scenes of the edit mode and the switcher of the file bar. A page that edits no scene file (the
 * prefab mode) gets none.
 */
export function startPageScenes(parts: PageScenesParts): PageScenes | null {
  if (savedFileKind(parts.editor.file.path) !== "scene") return null;
  const scenes = new PageScenes(parts);
  // The open scenes are tabs of the file bar; ⋯ opens the Scenes panel.
  startSceneTabs(scenes, parts.editor, parts.bar, () => currentShell()?.showPanel("scenes"));
  return scenes;
}

/** The script API of the open scenes of an editor (empty without `edit=1` or in the prefab mode). */
export function pageScenesApi(editor: ScenePageEditor): Partial<ScenesApi> {
  const scenes = scenesOf(editor);
  return scenes === undefined ? {} : scenesApi(scenes, editor, nextPaint);
}
