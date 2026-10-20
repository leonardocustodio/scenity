// SPDX-License-Identifier: Apache-2.0
/**
 * The import by drop: the route of the host, its limits and the
 * check of its fields. The module is pure (no `node:` or `bun:` import): the page imports it through
 * `@scenity/workbench-host/protocol`.
 *
 * **An HTTP route, not a binary WebSocket frame.** The pictures go as binary frames, but a dropped model can have
 * 200 MB. One WebSocket message of that size is more than the payload limit of the socket (16 MB in Bun). It also
 * stops every other message of the page until it arrives. `POST /imports` streams the body to a file with a byte
 * limit and needs the token header as every route. It gives the answer of the start immediately. Two forms:
 *
 * - **Upload (the browser):** the body is the bytes of the file (`application/octet-stream`); the query has the fields
 *   (`name`, `point=x,y,z`, `source`, `licence`, `drop`).
 * - **Path (the desktop shell):** a JSON body `{ path, point, source, licence, drop }`. The host reads the file where
 *   it is, after a check: an absolute path in the home folder of the owner, not a link, a file of an import format of
 *   at most 200 MB, and not on the denylist (denylist.ts). The workbench page gets the path from the drag and drop
 *   event of Scenity (apps/workbench `desktop/shellDrop.ts`).
 *
 * The answer is `ImportStarted`: the import ID and the run of the Runs tab. The files of the import folder are at
 * `GET /imports/<id>/<file>` (IMPORT_FILES only).
 *
 * The bridge event `import`, the import ID form and the point type are in @scenity/bridge (assetEvents.ts).
 */
import { IMPORT_ID_PATTERN, type ImportPoint } from "@scenity/bridge";

/** The path of the import route. */
export const IMPORT_PATH = "/imports";
/** The largest file of an import (bytes). */
export const IMPORT_MAX_BYTES = 200 * 1024 * 1024;
/**
 * The largest request body of the host server and of the Scenity gateway (bytes): the largest import and 1 MB for
 * the fields. The gateway (gateway/main.ts) uses this value too, so it refuses no body that the host takes.
 */
export const HOST_BODY_MAX_BYTES = IMPORT_MAX_BYTES + 1024 * 1024;
/** The file types of an import. */
export const IMPORT_FORMATS = [".glb", ".gltf", ".fbx", ".obj", ".blend"] as const;
/** The longest text of the `source` and `licence` fields. */
export const IMPORT_TEXT_MAX = 500;
/** The files of an import folder that `GET /imports/<id>/<file>` gives. */
export const IMPORT_FILES = [
  "record.json",
  "request.json",
  "preview.glb",
  "model.high.glb",
  "model.low.glb",
  "normalized.glb",
  "sheet.png",
] as const;
export type ImportFile = (typeof IMPORT_FILES)[number];

/** The fields of an import request. */
export interface ImportFields {
  /** The file name of the drop (a base name with an import extension). */
  readonly name: string;
  /** The drop point, or null. */
  readonly point: ImportPoint | null;
  /** Where the file comes from, and its licence (the answers of the owner). */
  readonly source: string;
  readonly licence: string;
  /** The ID of the drop in the lab page, so the page can replace its quick preview; "" for none. */
  readonly drop: string;
}

/** The answer of `POST /imports`. */
export interface ImportStarted {
  readonly id: string;
  readonly run: string;
  readonly name: string;
  readonly point: ImportPoint | null;
  readonly drop: string;
}

/** The lowercase extension of a name, with its dot, or "". */
function extension(name: string): string {
  const at = name.lastIndexOf(".");
  return at <= 0 ? "" : name.slice(at).toLowerCase();
}

/** True for a file name of an import format. */
export function isImportName(name: string): boolean {
  return (IMPORT_FORMATS as readonly string[]).includes(extension(name));
}

/** A safe base name: the last part of the name, with other characters than letters, digits, `.`, `-`, `_` as `_`. */
export function safeImportName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  return base
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^\.+/, "_")
    .slice(-120);
}

/** The text of a point (`x,y,z`), or "" for none. */
export function pointText(point: ImportPoint | null): string {
  return point === null ? "" : point.map((value) => String(Math.round(value * 1000) / 1000)).join(",");
}

/** A point from its text or a list of three finite numbers, or null. */
export function readPoint(value: unknown): ImportPoint | null {
  const parts = typeof value === "string" ? (value === "" ? [] : value.split(",").map(Number)) : value;
  if (!Array.isArray(parts) || parts.length !== 3) return null;
  const [x, y, z] = parts as unknown[];
  if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") return null;
  if (![x, y, z].every((item) => Number.isFinite(item) && Math.abs(item) < 1000)) return null;
  return [x, y, z];
}

/** The query of an upload (the page). */
export function importQuery(fields: ImportFields): string {
  return new URLSearchParams({
    name: fields.name,
    point: pointText(fields.point),
    source: fields.source,
    licence: fields.licence,
    drop: fields.drop,
  }).toString();
}

function text(value: unknown, field: string, max = IMPORT_TEXT_MAX): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new Error(`The field ${field} must be a text.`);
  // eslint-disable-next-line no-control-regex -- the check refuses control characters.
  if (value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`The field ${field} is longer than ${String(max)} characters or has a control character.`);
  }
  return value.trim();
}

/** The fields of a request (the query of an upload, or the JSON of a path). Throws with the reason. */
export function readImportFields(values: Readonly<Record<string, unknown>>, name: string): ImportFields {
  const safe = safeImportName(name);
  if (!isImportName(safe)) throw new Error(`${safe || "The file"}: the import reads ${IMPORT_FORMATS.join(", ")}.`);
  const point = values.point === undefined || values.point === "" ? null : readPoint(values.point);
  if (point === null && values.point !== undefined && values.point !== "" && values.point !== null) {
    throw new Error("The drop point must be three numbers (metres).");
  }
  const drop = text(values.drop, "drop", 64);
  if (!/^[A-Za-z0-9_-]*$/.test(drop)) throw new Error("The field drop has a character that is not allowed.");
  return { name: safe, point, source: text(values.source, "source"), licence: text(values.licence, "licence"), drop };
}

/** The import and the file of a path `/imports/<id>/<file>`, or null. */
export function importFileOf(pathname: string): { readonly id: string; readonly file: ImportFile } | null {
  const match = /^\/imports\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (match === null) return null;
  const [, id = "", file = ""] = match;
  if (!IMPORT_ID_PATTERN.test(id) || !(IMPORT_FILES as readonly string[]).includes(file)) return null;
  return { id, file: file as ImportFile };
}
