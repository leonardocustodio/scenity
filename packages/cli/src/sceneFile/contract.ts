// SPDX-License-Identifier: Apache-2.0
/**
 * The contract of the scene file calls: the editor reads a `*.scene.json` file of the project and saves it through the
 * host. The contract is in `@scenity/bridge` (sceneFiles.ts: the types, the checks and the typed calls `SCENE_READ`
 * and `SCENE_SAVE`). This entry point gives the same names to its users. The same calls also take a
 * `*.material.json` file and a `*.prefab.json` file.
 */
export {
  isSceneCreateParams,
  isSceneRuleChecks,
  isSceneSaveParams,
  MATERIAL_FILE_SUFFIX,
  PREFAB_FILE_SUFFIX,
  SCENE_CREATE,
  SCENE_CREATE_CALL,
  SCENE_FILE_SUFFIX,
  SCENE_REASON_MAX,
  SCENE_READ,
  SCENE_READ_CALL,
  SCENE_SAVE,
  SCENE_SAVE_CALL,
  sceneFilePathProblem,
  savedFileKind,
  SEQUENCE_FILE_SUFFIX,
  type SceneCreateParams,
  type SceneCreateResult,
  type SceneFileText,
  type SceneRuleChecks,
  type SceneRuleStatus,
  type SceneRuleVerdict,
  type SceneSaveParams,
  type SceneSaveResult,
} from "@scenity/bridge";
