// SPDX-License-Identifier: Apache-2.0
/**
 * The scene call of the lab page: `scene.query` of `@scenity/bridge` for the tool `scene_query`. The editor plugin
 * gives the scene document of the page with the tune values of the page in it (`EditorPlugin.sceneDocument`).
 * `queryScene` of `@scenity/editor-core` gives the answer. The lab page has no bounds of the entities. The scene page
 * has them from its inspect report.
 */
import { SCENE_QUERY_CALL, serveBridgeCall, type SceneQueryArgs, type SceneQueryAnswer } from "@scenity/bridge";
import { queryScene } from "@scenity/editor-core";
import { registeredPlugin } from "../plugin";

/** Answer a query over the scene document of the plugin. A page with no scene document gives an error. */
export function labSceneQuery(query: SceneQueryArgs): SceneQueryAnswer {
  const tunes = globalThis.__room3dLab?.tunes() ?? {};
  const doc = registeredPlugin()?.sceneDocument?.(tunes) ?? null;
  if (doc === null) throw new Error("scene.query: this page has no scene document.");
  return queryScene(doc, query);
}

/** The scene calls of the lab page. */
export const SCENE_BRIDGE_CALLS = {
  [SCENE_QUERY_CALL.name]: serveBridgeCall(SCENE_QUERY_CALL, labSceneQuery),
} as const;
