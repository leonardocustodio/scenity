// SPDX-License-Identifier: Apache-2.0
/**
 * A scene or sequence save whose gate measures by itself. The page sends the rule results with its save; a save with no
 * results for its text (Claude through the host, a tool) gets the results of `measureSavedRules`. Then the writer runs
 * its one gate, as for a save of the page.
 */
import {
  saveSceneFile,
  sceneTextHash,
  type SceneFileOptions,
  type SceneSaveParams,
  type SceneSaveResult,
} from "../sceneFile/files";
import { measureSavedRules } from "./measure";

/** True when a save carries the rule results of its text (the page measured them). */
export function hasRuleResults(params: SceneSaveParams): boolean {
  return params.checks?.hash === sceneTextHash(params.text);
}

/** Save a file of the project; the gate measures the rules when the request carries no results for its text. */
export async function saveMeasured(
  root: string,
  params: SceneSaveParams,
  options: SceneFileOptions = {},
): Promise<SceneSaveResult> {
  if (hasRuleResults(params)) return saveSceneFile(root, params, options);
  const verdicts = await measureSavedRules(root, params.path, params.text);
  return saveSceneFile(root, { ...params, checks: { hash: sceneTextHash(params.text), verdicts } }, options);
}
