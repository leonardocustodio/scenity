// SPDX-License-Identifier: Apache-2.0
/**
 * The events of the dropped files and the scratch props on the bridge (frame to workbench page).
 *
 * - `import`: a file that the owner dropped on the scene, with its drop point and the source and the licence
 *   that the owner gave. It stays in the workbench page: the page uploads the file to the host; the host never gets the
 *   event. A drop of the desktop shell has no file (`file: null`): the page keeps the path of the drop under its `drop`
 *   ID and sends that path to the host, so a frame cannot name a file of its own choice.
 * - `scratch`: the frame needs the models of these imports; the workbench page gives them with the bridge call
 *   `scratchModel`. The host never gets the event.
 * - `promote`: "Promote to the room" of a scratch prop at its place (degrees), dry or real. The host makes a
 *   project asset of the model and an entity at that place in the scene document; it writes no prompt.
 */

/** The form of an import ID: base 36 time, a dash, 8 hex characters. */
export const IMPORT_ID_PATTERN = /^[0-9a-z]{1,12}-[0-9a-f]{8}$/;
/** The most import IDs of one `scratch` event. */
export const SCRATCH_NEED_MAX = 16;

/** A point of the scene (metres, Y up). */
export type ImportPoint = readonly [number, number, number];

export type ImportEventBody = {
  readonly event: "import";
  readonly drop: string;
  /** The dropped file (the browser path), or null for a drop of the desktop shell (the page has its path). */
  readonly file: Blob | null;
  readonly name: string;
  readonly point: ImportPoint | null;
  readonly source: string;
  readonly licence: string;
};

/** The import IDs whose models the frame needs. */
export type ScratchEventBody = {
  readonly event: "scratch";
  readonly need: readonly string[];
};

/** A scratch prop at its place, dry (a preview only) or real (the asset and the entity). */
export type PromoteEventBody = {
  readonly event: "promote";
  /** The import ID of the model. */
  readonly import: string;
  /** The ID of the scratch prop in the frame (`scratch-<n>`). */
  readonly scratch: string;
  /** The base centre in the scene (metres). */
  readonly at: readonly [number, number, number];
  /** The turn about the vertical axis (degrees). */
  readonly turnDeg: number;
  readonly dry: boolean;
};

/** True for the fields of an `import` event. */
export function isImportEvent(value: Readonly<Record<string, unknown>>): boolean {
  return (
    (value.file === null || (typeof Blob !== "undefined" && value.file instanceof Blob)) &&
    typeof value.name === "string" &&
    typeof value.drop === "string" &&
    typeof value.source === "string" &&
    typeof value.licence === "string" &&
    (value.point === null || Array.isArray(value.point))
  );
}

/** True for the fields of a `scratch` event. */
export function isScratchEvent(value: Readonly<Record<string, unknown>>): boolean {
  const need = value.need;
  return (
    Array.isArray(need) &&
    need.length <= SCRATCH_NEED_MAX &&
    need.every((id) => typeof id === "string" && IMPORT_ID_PATTERN.test(id))
  );
}

/** True for the fields of a `promote` event. */
export function isPromoteEvent(value: Readonly<Record<string, unknown>>): boolean {
  const at = value.at;
  return (
    typeof value.import === "string" &&
    IMPORT_ID_PATTERN.test(value.import) &&
    typeof value.scratch === "string" &&
    /^scratch-\d{1,3}$/.test(value.scratch) &&
    Array.isArray(at) &&
    at.length === 3 &&
    at.every((item) => typeof item === "number" && Number.isFinite(item) && Math.abs(item) < 50) &&
    typeof value.turnDeg === "number" &&
    Number.isFinite(value.turnDeg) &&
    typeof value.dry === "boolean"
  );
}
