// SPDX-License-Identifier: Apache-2.0
/**
 * The entry point of @scenity/bridge: the one contract of the bridge between the workbench page and a surface page in a
 * frame. The editor (the frame side), the workbench page and the workbench host (the caller side) import it; none of
 * them keeps a copy.
 *
 * - envelope.ts: the call, answer and error messages, the version, the URL parameter and the origin check.
 * - define.ts: `defineBridgeCall` for typed calls, `serveBridgeCall` (the frame) and `sendBridgeCall` (the caller).
 * - base.ts: the base calls `url`, `capture` and `console`.
 * - editorCalls.ts: the calls of the editor core `inspect`, `command`, `tools`, `tools.call` and `contextLines`.
 * - events.ts: the events (`ready`, `url`, `hmr`, `reload`, `console`, `key` and the editor events).
 * - indexRead.ts: the index reads of a frame through the workbench page.
 * - sceneFiles.ts: the scene file calls `scene.read` and `scene.save`.
 * - sceneCalls.ts: the scene calls `scene.query`, `commands` and `proposalMode` of the generic Claude tools.
 *
 * The package is pure: no Vue, no DOM API but `structuredClone` and `URLSearchParams`, no Node API.
 */
export * from "./envelope";
export * from "./define";
export * from "./base";
export * from "./editorCalls";
export * from "./keys";
export * from "./events";
export * from "./editEvents";
export * from "./assetEvents";
export * from "./windowEvents";
export * from "./indexRead";
export * from "./sceneFiles";
export * from "./sceneCalls";
export * from "./uiCalls";
export * from "./turnCalls";
export * from "./taskCalls";
