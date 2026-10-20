// SPDX-License-Identifier: Apache-2.0
/**
 * The preparation of a promote: the model of an import (a scratch prop of the lab, a dropped file) becomes a project
 * asset and an entity of a scene.
 * This module is the pure part: the target of the promote (the project folder of the assets, the import folder, the
 * rights record and the scene document), the facts of the import record, the refusals and the lines of the changes.
 * promoteRun.ts writes the files.
 *
 * The host writes no Claude prompt. The asset and the entity need no code change. A scene that shows each
 * `model` entity (the scene page) shows the model after a save and a reload. A host plugin can name the changes that
 * its project still needs (`followUp`, for example a code change of a scene kit that reads only its own slots).
 *
 * The rights check stays in the release gate: the record of the new asset points to the rights record of the
 * imports (`rights/imports.yaml`: the licence is not known, the web delivery is pending). Thus the release gate stops
 * the asset until the owner records its rights. The answers of the owner at the drop go into the result.
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { IMPORT_FOLDER, IMPORT_RIGHTS, safeFileName } from "../../assets/src/projectImport";
import { promotedName } from "../../editor-core/src/entities/promote";
import { defaultProjectDir, pluginPaths } from "./plugins";
import { list, number, record, text } from "./tools/kit";

/**
 * The folders and the scene of a promote that a host plugin gives (`paths.promote` of plugin.ts), each from the root
 * of the checkout. A project with no such plugin gets the defaults of the project folder.
 */
export interface PromoteFiles {
  /** The folder that gets the model file (default: `assets/sources` of the project). It is under an asset root. */
  readonly drop?: string;
  /** The folder of the rights records (default: `rights` of the project); the promote uses `imports.yaml` there. */
  readonly rights?: string;
  /** The scene document that gets the entity (default: the first scene of the project document). */
  readonly scene?: string;
  /** The changes that the project still needs after a promote, one line each (a code change). */
  readonly followUp?: readonly string[];
}

/** The promote files of the host plugins (none: the defaults of the project folder). */
export function promoteFiles(): PromoteFiles {
  return pluginPaths().promote ?? {};
}

/** The project of the host that a promote reads (projectProtocol.ts `ProjectInfo`). */
export interface PromoteProject {
  readonly dir: string;
  /** The project document, or null for a checkout with the built-in manifest. */
  readonly manifest: string | null;
}

/** Where a promote writes: absolute folders, and the project paths of the import folder and the rights record. */
export interface PromoteTarget {
  readonly checkout: string;
  /** The project folder of the asset database (it holds `scenity.project.json`). */
  readonly projectDir: string;
  /** The import folder and the rights record, relative to the project folder. */
  readonly folder: string;
  readonly rights: string;
  /** The scene document (absolute), or null when the project names none. */
  readonly scene: string | null;
  readonly followUp: readonly string[];
}

/** A path with "/" between its parts. */
function slashes(path: string): string {
  return path.split(sep).join("/");
}

/** True when `path` (absolute) is in the folder `dir`. */
export function inFolder(dir: string, path: string): boolean {
  const near = relative(dir, path);
  return near === "" || (!near.startsWith("..") && !isAbsolute(near));
}

/** The first scene of the project document of a folder, absolute, or null. */
function firstScene(projectDir: string): string | null {
  const file = join(projectDir, "scenity.project.json");
  if (!existsSync(file)) return null;
  try {
    const scenes = (JSON.parse(readFileSync(file, "utf8")) as { scenes?: unknown }).scenes;
    const first: unknown = Array.isArray(scenes) ? (scenes as unknown[])[0] : undefined;
    return typeof first === "string" ? resolve(projectDir, first) : null;
  } catch {
    return null;
  }
}

/**
 * The target of a promote. A project with a project document holds the assets itself; a checkout with the built-in
 * manifest uses the default project of its workspace (the `scenity.project` field of its package.json). `scene` is a
 * path relative to the project folder that replaces the scene of the plugin.
 */
export function promoteTarget(checkout: string, project: PromoteProject, scene?: string): PromoteTarget {
  const projectDir = project.manifest !== null ? project.dir : (defaultProjectDir(checkout) ?? project.dir);
  const files = promoteFiles();
  const fromCheckout = (path: string): string => slashes(relative(projectDir, join(checkout, path)));
  const pluginScene = files.scene === undefined ? null : join(checkout, files.scene);
  return {
    checkout,
    projectDir,
    folder: files.drop === undefined ? IMPORT_FOLDER : fromCheckout(files.drop),
    rights: files.rights === undefined ? IMPORT_RIGHTS : fromCheckout(`${files.rights}/imports.yaml`),
    scene: scene !== undefined ? resolve(projectDir, scene) : (pluginScene ?? firstScene(projectDir)),
    followUp: files.followUp ?? [],
  };
}

/** A project path of the target as a path of the checkout. */
export function checkoutPathOf(target: PromoteTarget, projectPath: string): string {
  return slashes(relative(target.checkout, join(target.projectDir, projectPath)));
}

/** The facts of an import record that the promote uses. */
export interface RecordFacts {
  readonly name: string;
  readonly source: string;
  readonly licence: string;
  readonly error: string | null;
  readonly pass: boolean | null;
}

export function factsOf(value: unknown): RecordFacts {
  const item = record(value);
  const result = item.result === null || item.result === undefined ? null : record(item.result);
  return {
    name: text(item.name) ?? "model",
    source: (text(item.source) ?? "").trim(),
    licence: (text(item.licence) ?? "").trim(),
    error: text(item.error),
    pass: result === null ? null : result.pass === true,
  };
}

/**
 * The numbers of the budget of a record: for each tier the triangles, the KB and the
 * largest texture against the budget, a tier over its budget marked "OVER", and the errors of the validator.
 */
export function budgetLines(value: unknown): string[] {
  const result = record(record(value).result);
  const lines = (["high", "low"] as const).flatMap((tier) => {
    const report = record(record(result.tiers)[tier]);
    const budget = record(report.budget);
    const triangles = number(report.triangles);
    if (triangles === null) return [];
    const kb = (bytes: unknown): string => String(Math.round((number(bytes) ?? 0) / 1024));
    const over = report.pass === false ? " OVER" : "";
    return [
      `${tier}: ${String(triangles)} of ${String(number(budget.triangles) ?? "?")} triangles, ` +
        `${kb(report.bytes)} of ${kb(budget.bytes)} KB, ` +
        `texture ${String(number(report.maxTextureSize) ?? "?")} of ${String(number(budget.maxTextureSize) ?? "?")} px${over}`,
    ];
  });
  const errors = list(record(result.validator).errors).filter((item): item is string => typeof item === "string");
  return [...lines, ...errors.slice(0, 3).map((error) => `validator: ${error}`)];
}

/** The reason that the model of a record cannot be promoted, or null. Rights do not refuse: the release gate stops. */
export function promoteRefusal(value: unknown): string | null {
  if (value === null || value === undefined) return "The import has no record: the import job did not end.";
  const facts = factsOf(value);
  if (facts.pass === null) return `The import failed: ${facts.error ?? "no result"}.`;
  if (!facts.pass) {
    const numbers = budgetLines(value);
    const detail = numbers.length === 0 ? "" : ` (${numbers.join("; ")})`;
    return `The model is over the budget or has validator errors${detail}: fix the file and import it again.`;
  }
  return null;
}

/** The file name of the promoted model: the name of the drop with the extension `.glb` (the import gives a GLB). */
export function modelFileName(name: string): string {
  return `${safeFileName(promotedName(name)) ?? "model"}.glb`;
}

/** A number for a line: at most 4 decimals. */
function shortNumber(value: number): string {
  return String(Math.round(value * 1e4) / 1e4 || 0);
}

/** The place of a model as text: the base centre and the turn about Y. */
export function placeText(at: readonly number[], turnDeg: number): string {
  return `[${at.map(shortNumber).join(", ")}] turned ${shortNumber(turnDeg)}°`;
}

/** The lines of the changes of a promote (before the run: the asset ID is not known yet). */
export function promoteChanges(
  facts: RecordFacts,
  target: PromoteTarget,
  place: { readonly at: readonly number[]; readonly turnDeg: number },
): string[] {
  const file = `${target.folder}/${modelFileName(facts.name)}`;
  const scene = target.scene === null ? null : slashes(relative(target.checkout, target.scene));
  const answers = facts.source === "" && facts.licence === "" ? "no answers" : `"${facts.source}", "${facts.licence}"`;
  return [
    `${checkoutPathOf(target, file)}: the model (a free name when the file exists)`,
    `${checkoutPathOf(target, `${file}.meta.json`)}: the asset record (the importer of the file, a new asset ID)`,
    `${checkoutPathOf(target, target.rights)}: the rights record of the imports (licence not known, webDelivery ` +
      `pending; the release gate stops the asset; the answers of the drop: ${answers})`,
    scene === null
      ? "no scene document: the project names no scene"
      : `${scene}: an entity "${promotedName(facts.name)}" with a model of the new asset at ${placeText(place.at, place.turnDeg)}`,
  ];
}

/** The import record of an import folder, or null. */
export function readRecord(folder: string): unknown {
  const file = join(folder, "record.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch {
    return null;
  }
}
