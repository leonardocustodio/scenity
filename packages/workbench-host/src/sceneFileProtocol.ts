// SPDX-License-Identifier: Apache-2.0
/**
 * The scene file requests of the host: the editor reads a `*.scene.json` file of the project and saves it again.
 * The host writes the canonical form of the document atomically, only in the project
 * folder, never a file of the denylist, and only for a page with the role editor or admin (roleProtocol.ts). After a
 * save that changed the file, the host sends `scene.saved`: the Changes tab loads again and shows the JSON diff.
 *
 * The parameter and result types come from the contract of `@scenity/cli/sceneFileContract`. This module is pure
 * (no `node:` or `bun:` import), so the page gets it through
 * `@scenity/workbench-host/protocol`.
 */
import type {
  SceneCreateParams,
  SceneCreateResult,
  SceneFileText,
  SceneSaveParams,
  SceneSaveResult,
} from "@scenity/cli/sceneFileContract";

export type { SceneCreateParams, SceneCreateResult, SceneFileText, SceneSaveParams, SceneSaveResult };

/** The scene file requests (page to host). `RequestMap` of protocol.ts extends this map. */
export interface SceneFileRequests {
  /** The text of a scene file of the project and its SHA-256: the base of a later save. */
  "scene.read": { params: { path: string }; result: SceneFileText };
  /** Save a scene file: a conflict or a refusal is a result (`ok: false`), not an error. */
  "scene.save": { params: SceneSaveParams; result: SceneSaveResult };
  /** Create a new empty scene file: a refusal is a result (`ok: false`), not an error. */
  "scene.create": { params: SceneCreateParams; result: SceneCreateResult };
}

export const SCENE_FILE_REQUEST_NAMES: Readonly<Record<keyof SceneFileRequests, true>> = {
  "scene.read": true,
  "scene.save": true,
  "scene.create": true,
};

/** The scene file events (host to page). `EventMap` of protocol.ts extends this map. */
export interface SceneFileEvents {
  /** A save changed a scene file: its path in the checkout (with "/") and the hash of the new text. */
  "scene.saved": { path: string; hash: string };
}

export const SCENE_FILE_EVENT_NAMES: Readonly<Record<keyof SceneFileEvents, true>> = {
  "scene.saved": true,
};
