// SPDX-License-Identifier: Apache-2.0
/**
 * The loader of a project. It reads `scenity.project.json` from a folder, then each listed scene, through an injected
 * file reader. Thus this package stays free of `node:` and `bun:`. It reports each missing file.
 */
import type { DocError } from "./errors";
import { joinPath } from "./paths";
import { readDocument, type ReadOptions } from "./read";
import type { SceneDocument } from "./schema/documents";
import type { Budget, ProjectDocument } from "./schema/project";

/** The name of the project file in the project folder. */
export const PROJECT_FILE = "scenity.project.json";

/** A file reader: the text of a file, or undefined when the file does not exist. */
export interface ProjectFs {
  readText(path: string): Promise<string | undefined> | string | undefined;
}

export interface LoadedScene {
  /** The path of the scene file (the project folder and the listed path). */
  readonly path: string;
  readonly doc: SceneDocument;
}

export type LoadProjectResult =
  | {
      readonly ok: true;
      readonly project: ProjectDocument;
      readonly scenes: readonly LoadedScene[];
      /** The paths of the listed files that do not exist. */
      readonly missing: readonly string[];
      /** The errors of the scene files that exist but do not read, with the path of the file. */
      readonly errors: readonly (DocError & { readonly file: string })[];
    }
  | { readonly ok: false; readonly file: string; readonly errors: readonly DocError[] };

/** Load the project of a folder and its scenes. A missing or bad scene file does not stop the load. */
export async function loadProject(dir: string, fs: ProjectFs, options: ReadOptions = {}): Promise<LoadProjectResult> {
  const file = joinPath(dir, PROJECT_FILE);
  const text = await fs.readText(file);
  if (text === undefined) return { ok: false, file, errors: [{ path: "", message: `${file} does not exist` }] };
  const read = readDocument(text, "project", options);
  if (!read.ok) return { ok: false, file, errors: read.errors };
  const project = read.doc;
  const scenes: LoadedScene[] = [];
  const missing: string[] = [];
  const errors: (DocError & { file: string })[] = [];
  for (const listed of project.scenes) {
    const path = joinPath(dir, listed);
    const sceneText = await fs.readText(path);
    if (sceneText === undefined) {
      missing.push(path);
      continue;
    }
    const scene = readDocument(sceneText, "scene", options);
    if (scene.ok) scenes.push({ path, doc: scene.doc });
    else errors.push(...scene.errors.map((error) => ({ ...error, file: path })));
  }
  return { ok: true, project, scenes, missing, errors };
}

/** The numbers of a frame or a scene that a budget can limit. */
export type BudgetMeasure = Partial<Readonly<Record<keyof Budget, number>>>;

/** The budget of a group (`scene`, an asset kind) and a tier in `quality.budgets` of a project, or undefined. */
export function projectBudget(project: ProjectDocument, group: string, tier: string): Budget | undefined {
  const budgets = project.quality?.budgets;
  const byTier = budgets !== undefined && Object.hasOwn(budgets, group) ? budgets[group] : undefined;
  return byTier !== undefined && Object.hasOwn(byTier, tier) ? byTier[tier] : undefined;
}

/**
 * The measured values over their maximum in a budget, one text for each, in the key order of the budget. A
 * value that the budget does not limit, or that the measure does not give, passes.
 */
export function overBudget(budget: Budget, measured: BudgetMeasure): string[] {
  const out: string[] = [];
  for (const key of Object.keys(budget).sort() as (keyof Budget)[]) {
    const limit = budget[key];
    const value = measured[key];
    if (limit !== undefined && value !== undefined && value > limit)
      out.push(`${key} ${String(value)} > ${String(limit)}`);
  }
  return out;
}
