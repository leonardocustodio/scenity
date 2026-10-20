// SPDX-License-Identifier: Apache-2.0
/**
 * The scene file calls: the editor reads a `*.scene.json` file of the project and writes it back through the host. The
 * workbench host has the typed requests `scene.read` and `scene.save`; the dev server of the scene page has the same
 * calls for a page with no workbench. `SCENE_READ` and `SCENE_SAVE` are the typed calls: each side checks the arguments
 * and the result with them. A save carries the results of the rules on its scene and the reason of an override (the
 * rule gate of the writer, `@scenity/cli/sceneFile`). `@scenity/cli/sceneFileContract` gives the same names to its
 * users.
 *
 * The same calls also read and write these files:
 * - a `*.sequence.json` file (the sequencer of the scene page);
 * - a `*.material.json` file (the material editor of the scene page);
 * - a `*.prefab.json` file (the prefab mode of the scene page, and an apply of overrides to a prefab);
 * - `scenity.editor.json` at the project root (the editor settings of a project).
 */
import { argError, defineBridgeCall } from "./define";
import { isObject } from "./envelope";

/** The request type of a read. */
export const SCENE_READ_CALL = "scene.read";
/** The request type of a save. */
export const SCENE_SAVE_CALL = "scene.save";
/** The end of the name of a scene file that a save can write. */
export const SCENE_FILE_SUFFIX = ".scene.json";
/** The end of the name of a sequence file that a save can write (the sequencer of the editor). */
export const SEQUENCE_FILE_SUFFIX = ".sequence.json";
/** The end of the name of a material file that a save can write (the material editor). */
export const MATERIAL_FILE_SUFFIX = ".material.json";
/** The end of the name of a prefab file that a save can write (the prefab mode of the editor). */
export const PREFAB_FILE_SUFFIX = ".prefab.json";
/** The end of the name of the note file of a scene (`scenity.notes/1`, the notes of the editor). */
export const NOTES_FILE_SUFFIX = ".notes.json";
/** The end of the name of an override layer file (`scenity.overrides/1`, the variants of the editor). */
export const OVERRIDES_FILE_SUFFIX = ".overrides.json";

/**
 * The path of the editor settings of a project (`scenity.editor/1`, the settings tab of the scene page). A
 * save writes it only at the root of the project folder.
 */
export const EDITOR_SETTINGS_PATH = "scenity.editor.json";

/** The document kind of a file that a save can write, from the end of its name, or null. */
export function savedFileKind(
  path: string,
): "scene" | "sequence" | "material" | "prefab" | "editor" | "notes" | "overrides" | null {
  if (path === EDITOR_SETTINGS_PATH) return "editor";
  if (path.endsWith(NOTES_FILE_SUFFIX)) return "notes";
  if (path.endsWith(OVERRIDES_FILE_SUFFIX)) return "overrides";
  if (path.endsWith(SCENE_FILE_SUFFIX)) return "scene";
  if (path.endsWith(MATERIAL_FILE_SUFFIX)) return "material";
  if (path.endsWith(PREFAB_FILE_SUFFIX)) return "prefab";
  return path.endsWith(SEQUENCE_FILE_SUFFIX) ? "sequence" : null;
}

/** The ends of the names of the files that a save can write. */
const SAVED_SUFFIXES = [
  SCENE_FILE_SUFFIX,
  SEQUENCE_FILE_SUFFIX,
  MATERIAL_FILE_SUFFIX,
  PREFAB_FILE_SUFFIX,
  NOTES_FILE_SUFFIX,
  OVERRIDES_FILE_SUFFIX,
] as const;

/** A scene file as the disk holds it: the path in the project, the text and the SHA-256 of the text (hex). */
export interface SceneFileText {
  readonly path: string;
  readonly text: string;
  readonly hash: string;
}

/** The status of a rule (`RuleStatus` of `@scenity/rules`). */
export type SceneRuleStatus = "pass" | "fail" | "known" | "n/a" | "error";

/** The verdict of a rule (`RuleVerdict` of `@scenity/rules`): the part of a result that the gate reads. */
export interface SceneRuleVerdict {
  readonly id: string;
  readonly level: "block" | "warn";
  readonly status: SceneRuleStatus;
  readonly detail?: string;
  readonly provisional?: boolean;
}

/**
 * The results of the rules that the page evaluated on the scene of a save. `hash` is the SHA-256 of the
 * `text` of the save: the writer reads the results only for that text.
 */
export interface SceneRuleChecks {
  readonly hash: string;
  readonly verdicts: readonly SceneRuleVerdict[];
}

/** The longest reason of an override (characters). */
export const SCENE_REASON_MAX = 500;

/** The parameters of a save. */
export interface SceneSaveParams {
  /** The path of the file in the project folder, with "/" (for example `scenes/main.scene.json`). */
  readonly path: string;
  /** The scene document as JSON. The writer checks it and writes its canonical form. */
  readonly text: string;
  /** The hash of the file at the load of the editor; null for a new file. */
  readonly baseHash: string | null;
  /** Write also when the file on the disk has another hash than `baseHash` (the owner chose "Overwrite"). */
  readonly force?: boolean;
  /** The results of the rules on the scene of `text`. */
  readonly checks?: SceneRuleChecks;
  /** The reason of the owner to save while a `block` rule fails (the override). */
  readonly reason?: string;
}

/** The result of a save. */
export type SceneSaveResult =
  /** The file holds the canonical text now. `changed` is false when the disk had the same text. */
  | {
      readonly ok: true;
      readonly path: string;
      readonly hash: string;
      readonly text: string;
      readonly changed: boolean;
      /** The reason of the owner that let a failed `block` rule go. */
      readonly override?: string;
      /** The `warn` rules that fail (the save goes). */
      readonly warned?: readonly SceneRuleVerdict[];
    }
  /** The file changed on the disk after the load: `hash` is the hash of the disk text (null: no file now). */
  | { readonly ok: false; readonly path: string; readonly conflict: true; readonly hash: string | null }
  /**
   * The writer refused the save (a bad path, a file of the denylist, a document that does not read). A failed
   * `block` rule with no reason of the owner gives the rules in `blocked`.
   */
  | {
      readonly ok: false;
      readonly path: string;
      readonly conflict: false;
      readonly reason: string;
      readonly blocked?: readonly SceneRuleVerdict[];
    };

/** Why a path cannot be the path of a scene file in a project, or null for a good path. */
export function sceneFilePathProblem(path: string): string | null {
  if (path === "" || path.length > 512) return "The path of a scene file has 1 to 512 characters.";
  if (path.includes("\\") || path.includes("\0")) return "The path of a scene file uses only / between its parts.";
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return "The path of a scene file is relative to the project.";
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    return "The path of a scene file has no empty, . or .. part.";
  }
  const name = parts.at(-1) ?? "";
  if (savedFileKind(path) === null || (SAVED_SUFFIXES as readonly string[]).includes(name)) {
    return `A save writes only ${EDITOR_SETTINGS_PATH} or a file with a name that ends with ${SAVED_SUFFIXES.join(", ")}.`;
  }
  return null;
}

const SHA256 = /^[0-9a-f]{64}$/;
const RULE_STATUSES: readonly unknown[] = ["pass", "fail", "known", "n/a", "error"];

/** True for the verdict of a rule. */
function isVerdict(value: unknown): value is SceneRuleVerdict {
  if (!isObject(value)) return false;
  return (
    typeof value.id === "string" &&
    (value.level === "block" || value.level === "warn") &&
    RULE_STATUSES.includes(value.status) &&
    (value.detail === undefined || typeof value.detail === "string") &&
    (value.provisional === undefined || typeof value.provisional === "boolean")
  );
}

/** True for the rule results of a save. */
export function isSceneRuleChecks(value: unknown): value is SceneRuleChecks {
  if (!isObject(value) || typeof value.hash !== "string" || !SHA256.test(value.hash)) return false;
  return Array.isArray(value.verdicts) && value.verdicts.every(isVerdict);
}

/** True for the parameters of a save. */
export function isSceneSaveParams(value: unknown): value is SceneSaveParams {
  if (typeof value !== "object" || value === null) return false;
  const params = value as Record<string, unknown>;
  const base = params.baseHash;
  const reason = params.reason;
  return (
    typeof params.path === "string" &&
    typeof params.text === "string" &&
    (base === null || (typeof base === "string" && SHA256.test(base))) &&
    (params.force === undefined || typeof params.force === "boolean") &&
    (params.checks === undefined || isSceneRuleChecks(params.checks)) &&
    (reason === undefined || (typeof reason === "string" && reason.length <= SCENE_REASON_MAX))
  );
}

/** Read the result of a read. */
function readSceneFileText(raw: unknown): SceneFileText {
  if (!isObject(raw) || typeof raw.path !== "string" || typeof raw.text !== "string" || typeof raw.hash !== "string") {
    throw new Error(`${SCENE_READ_CALL}: the answer is not a scene file.`);
  }
  return { path: raw.path, text: raw.text, hash: raw.hash };
}

/** Read the result of a save. */
function readSaveResult(raw: unknown): SceneSaveResult {
  if (!isObject(raw) || typeof raw.ok !== "boolean" || typeof raw.path !== "string") {
    throw new Error(`${SCENE_SAVE_CALL}: the answer is not a save result.`);
  }
  return raw as unknown as SceneSaveResult;
}

/** The typed call `scene.read` (args `[path]`). */
export const SCENE_READ = defineBridgeCall({
  name: SCENE_READ_CALL,
  args: (raw): [path: string] => {
    const [path] = raw;
    if (typeof path !== "string" || path === "") argError(SCENE_READ_CALL, "the path must be a text.");
    return [path];
  },
  result: readSceneFileText,
});

/** The typed call `scene.save` (args `[params]`). */
export const SCENE_SAVE = defineBridgeCall({
  name: SCENE_SAVE_CALL,
  args: (raw): [params: SceneSaveParams] => {
    const [params] = raw;
    if (!isSceneSaveParams(params)) argError(SCENE_SAVE_CALL, "the parameters are not save parameters.");
    return [params];
  },
  result: readSaveResult,
});

/** The request type of the create of a new scene file. */
export const SCENE_CREATE_CALL = "scene.create";

const SCENE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The parameters of a create. The writer makes the empty scene document itself (the ID, the name and no
 * entities), so a create cannot write content past the rule gate of a save.
 */
export interface SceneCreateParams {
  /** The path of the new `*.scene.json` file in the project folder, with "/". */
  readonly path: string;
  /** The ID of the scene document (not `id`: a host request keeps that key for the request ID). */
  readonly sceneId: string;
  /** The name of the scene (1 to 200 characters). */
  readonly name: string;
}

/** The result of a create. */
export type SceneCreateResult =
  /** The file holds the canonical text of the empty scene. `listed` is true when the project file lists it now. */
  | { readonly ok: true; readonly path: string; readonly hash: string; readonly text: string; readonly listed: boolean }
  /** The writer refused the create: a bad path, a file of the denylist, a file that is there already. */
  | { readonly ok: false; readonly path: string; readonly reason: string };

/** True for the parameters of a create. */
export function isSceneCreateParams(value: unknown): value is SceneCreateParams {
  if (!isObject(value)) return false;
  const { path, sceneId, name } = value;
  return (
    typeof path === "string" &&
    sceneFilePathProblem(path) === null &&
    savedFileKind(path) === "scene" &&
    typeof sceneId === "string" &&
    SCENE_ID.test(sceneId) &&
    typeof name === "string" &&
    name.trim().length > 0 &&
    name.length <= 200
  );
}

/** Read the result of a create. */
function readCreateResult(raw: unknown): SceneCreateResult {
  if (!isObject(raw) || typeof raw.ok !== "boolean" || typeof raw.path !== "string") {
    throw new Error(`${SCENE_CREATE_CALL}: the answer is not a create result.`);
  }
  return raw as unknown as SceneCreateResult;
}

/** The typed call `scene.create` (args `[params]`). */
export const SCENE_CREATE = defineBridgeCall({
  name: SCENE_CREATE_CALL,
  args: (raw): [params: SceneCreateParams] => {
    const [params] = raw;
    if (!isSceneCreateParams(params)) argError(SCENE_CREATE_CALL, "the parameters are not create parameters.");
    return [params];
  },
  result: readCreateResult,
});
