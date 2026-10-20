// SPDX-License-Identifier: Apache-2.0
/**
 * The handoff of the play window ("play in a window"). The scene page writes the current documents (the scene, the
 * sequence, the camera) under a new key of the local storage. Then it opens the play page (player/play.html) with the
 * key. The play page removes the handoff from the local storage and keeps it in its own session storage. Thus a reload
 * of the window plays the same documents. The module holds no editor code: the player pages import it. The handoff
 * also holds the input recording of the play mode when one exists. The window then replays its events in place of the
 * live input.
 */
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { InputRecording, SequenceDocument } from "@scenity/scene/sequence";

/** The format of a handoff. */
export const HANDOFF_FORMAT = "scenity.playHandoff/1";

/** The prefix of the storage keys of the handoffs. */
export const HANDOFF_PREFIX = "scenity.playHandoff.";

/** The documents that the play window plays. */
export interface PlayHandoff {
  readonly format: typeof HANDOFF_FORMAT;
  /** The name of the project on the dev server (`/projects/<name>/`). */
  readonly project: string;
  readonly scene: SceneDocument;
  /** The sequence over the scene, or null with no sequence. */
  readonly sequence: SequenceDocument | null;
  /** The document camera, or null for the first camera. */
  readonly camera: string | null;
  /** The input recording of the play mode (`scenity.input/1`) to replay. When it is absent, the live input plays. */
  readonly recording?: InputRecording;
}

/** The parts of a browser storage that the handoff uses. */
export interface HandoffStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** A key that the play page accepts: letters, digits and dashes only. */
function validKey(key: string): boolean {
  return /^[A-Za-z0-9-]{1,64}$/.test(key);
}

function isHandoff(value: unknown): value is PlayHandoff {
  if (typeof value !== "object" || value === null) return false;
  const handoff = value as Record<string, unknown>;
  return (
    handoff.format === HANDOFF_FORMAT &&
    typeof handoff.project === "string" &&
    typeof handoff.scene === "object" &&
    handoff.scene !== null &&
    (handoff.sequence === null || typeof handoff.sequence === "object") &&
    (handoff.camera === null || typeof handoff.camera === "string") &&
    (handoff.recording === undefined || (typeof handoff.recording === "object" && handoff.recording !== null))
  );
}

/** Write a handoff under `key`; false when the storage refuses it (a full or a blocked storage). */
export function writeHandoff(storage: HandoffStorage, key: string, handoff: PlayHandoff): boolean {
  if (!validKey(key)) return false;
  try {
    storage.setItem(HANDOFF_PREFIX + key, JSON.stringify(handoff));
    return true;
  } catch {
    return false;
  }
}

/** Read the handoff of `key` from `storage`, or null; `take` also removes it. */
export function readHandoff(storage: HandoffStorage, key: string, take = false): PlayHandoff | null {
  if (!validKey(key)) return null;
  try {
    const text = storage.getItem(HANDOFF_PREFIX + key);
    if (take) storage.removeItem(HANDOFF_PREFIX + key);
    const value: unknown = text === null ? null : JSON.parse(text);
    return isHandoff(value) ? value : null;
  } catch {
    return null;
  }
}
