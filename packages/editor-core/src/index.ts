// SPDX-License-Identifier: Apache-2.0
/**
 * The entry point of @scenity/editor-core. It exports:
 * - the command kit and its registry;
 * - the runner (owner, Claude, script; the proposals and the switch) and the change sets of the review;
 * - the edit ops (scene ops and the op kinds of plugins) and one history for all edits;
 * - the selection over entity IDs with sub-targets, and the clipboard;
 * - the scene channel and the file state of a scene document;
 * - the hierarchy model, the entity edits, the inspector model and the transform edits of the gizmos;
 * - the sequencer model, the play mode and the math of the editor camera;
 * - the query of a scene document, and the document sessions of the open scenes;
 * - the prefab set, the expansion of the instances, and the apply and revert of overrides;
 * - the material edits, the key map and the editor settings.
 *
 * No Vue import.
 */
export * from "./command";
export * from "./argsSchema";
export * from "./registry";
export * from "./ops";
export * from "./tunes";
export * from "./events";
export * from "./history";
export * from "./docDiff";
export * from "./runner";
export * from "./changeSets";
export * from "./selection";
export * from "./clipboard";
export * from "./sceneChannel";
export * from "./sceneFile";
export * from "./hierarchy/index";
export * from "./entities/index";
export * from "./inspector/index";
export * from "./transform/index";
export * from "./sequence/index";
export * from "./play/index";
export * from "./viewport/index";
export * from "./query/index";
export * from "./prefabs/index";
export * from "./sessions/index";
export * from "./material/index";
export * from "./keymap/index";
export * from "./settings/index";
