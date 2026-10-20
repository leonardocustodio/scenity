// SPDX-License-Identifier: Apache-2.0
/**
 * The run of `scenity check`: each rule of a project through the one gate of `@scenity/rules` (`evaluateRules` in the
 * rule check of the dev document core), with no browser.
 *
 * - A unit of work is a scene: the scene rules and the project rules at the scene time, and the rules of each
 *   sequence of the project that animates the scene at the times of their scopes. The core loads the scene once for
 *   each sequence that the rules name (no sequence first).
 * - `assetRights` reads the release check of the assets (`@scenity/assets/release`).
 * - A failed `block` rule passes only when the override log of its scene accepts it (overrides.ts).
 * - A project with no rule needs no asset: the check passes with "no rules".
 */
import { AssetDatabase } from "@scenity/assets";
import { releaseCheckOf } from "@scenity/assets/release";
import type { Rule } from "@scenity/scene";
import { assetStatuses, documentRules, type AssetStatus, type RuleResult } from "@scenity/rules";
import { checkAssets, CheckSetupError, type CheckAssets } from "./assets";
import { HeadlessScene, type HeadlessRegistries } from "./headless";
import { acceptedOverride, readOverrideLog } from "./overrides";
import { pluginRegistries, projectPath, readCheckProject, type CheckProject, type CheckScene } from "./project";
import { blocks, failedRow, resultRow, type CheckReport, type CheckRow } from "./rows";

export interface CheckOptions {
  /** The project folder. */
  readonly dir: string;
  /** Check this scene only: a path relative to the project folder or to the work folder. */
  readonly scene?: string;
  /** Check the rules of this sequence only (on its scene). */
  readonly sequence?: string;
  /** The LOD tier of the built models (default "high"). */
  readonly tier?: string;
}

/** A scene and the rules that the check measures on it. */
export interface CheckUnit {
  readonly scene: CheckScene;
  readonly rules: readonly Rule[];
}

/** The parts of a run that each unit shares. */
export interface RunParts {
  readonly project: CheckProject;
  readonly assets: CheckAssets;
  readonly registries: HeadlessRegistries;
  readonly statuses: readonly AssetStatus[];
}

/** The rules of the sequences of a scene (each with its sequence ID). */
function sequenceRules(project: CheckProject, scene: CheckScene): Rule[] {
  return project.sequences
    .filter((sequence) => sequence.doc.scene === scene.doc.id)
    .flatMap((sequence) => documentRules(sequence.doc.rules, sequence.doc.id));
}

/** The scenes and rules of the check, from the options. */
function checkUnits(project: CheckProject, options: CheckOptions): CheckUnit[] {
  if (options.sequence !== undefined) {
    const path = projectPath(project, options.sequence);
    const sequence = project.sequences.find((item) => item.path === path);
    if (sequence === undefined) throw new CheckSetupError(`${path} is not a sequence of the project.`);
    const scene = project.scenes.find((item) => item.doc.id === sequence.doc.scene);
    if (scene === undefined) throw new CheckSetupError(`The project has no scene "${sequence.doc.scene}".`);
    return [{ scene, rules: documentRules(sequence.doc.rules, sequence.doc.id) }];
  }
  let scenes = project.scenes;
  if (options.scene !== undefined) {
    const path = projectPath(project, options.scene);
    scenes = scenes.filter((item) => item.path === path);
    if (scenes.length === 0) throw new CheckSetupError(`${path} is not a scene of the project.`);
  }
  return scenes.map((scene) => ({
    scene,
    rules: [...documentRules(scene.doc.rules), ...project.rules, ...sequenceRules(project, scene)],
  }));
}

/** The sequence that a rule needs: the sequence of its scope, or null for a scene or entity scope. */
function ruleSequence(rule: Rule): string | null {
  const scope = rule.scope;
  if (scope === undefined || scope.kind === "scene" || scope.kind === "entity") return null;
  return scope.sequence ?? null;
}

/** The release state of each asset of the project. */
async function releaseStatuses(dir: string): Promise<AssetStatus[]> {
  const db = await AssetDatabase.open(dir);
  const report = await releaseCheckOf(db);
  return assetStatuses(
    db.entries().map((entry) => entry.id),
    report.findings,
  );
}

/** Measure the rules of one sequence (or of no sequence) on the scene of a unit. */
async function measureGroup(parts: RunParts, unit: CheckUnit, id: string | null, rules: Rule[]): Promise<RuleResult[]> {
  const { project, assets } = parts;
  const sequence = id === null ? null : (project.sequences.find((item) => item.doc.id === id)?.doc ?? null);
  const core = new HeadlessScene(assets, parts.registries);
  try {
    await core.load(unit.scene.doc, sequence);
    const failures = assets.takeFailures();
    if (failures.length > 0) throw new Error(`the assets did not load: ${failures.join("; ")}`);
    return core.check({
      rules,
      sequences: Object.fromEntries(project.sequences.map((item) => [item.doc.id, item.doc])),
      playing: sequence?.id ?? null,
      project: project.project,
      assets: parts.statuses,
    });
  } finally {
    core.dispose();
  }
}

/** The rows of the rules of one unit, with no override. */
export async function measureUnit(parts: RunParts, unit: CheckUnit): Promise<CheckRow[]> {
  const groups = new Map<string | null, Rule[]>([[null, []]]);
  for (const rule of unit.rules) {
    const id = ruleSequence(rule);
    groups.set(id, [...(groups.get(id) ?? []), rule]);
  }
  const rows: CheckRow[] = [];
  for (const [id, rules] of groups) {
    if (rules.length === 0) continue;
    try {
      const results = await measureGroup(parts, unit, id, rules);
      rows.push(...results.map((result, index) => resultRow(unit.scene.path, id, result, rules[index] ?? {})));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      rows.push(...rules.map((rule) => failedRow(unit.scene.path, id, rule, detail)));
    } finally {
      parts.assets.takeFailures();
    }
  }
  return rows;
}

/** The rows of a unit with the overrides of its log (overrides.ts). */
function withOverrides(dir: string, unit: CheckUnit, rows: readonly CheckRow[]): CheckRow[] {
  const log = readOverrideLog(dir, unit.scene.path);
  return rows.map((row) => {
    const failed = row.level === "block" && (row.status === "fail" || row.status === "error");
    const reason = failed ? acceptedOverride(log, unit.scene.hash, row.rule) : null;
    return reason === null ? row : { ...row, override: reason };
  });
}

/** The shared parts of a run: the assets, the plugin registries and the release state of the assets. */
export async function runParts(project: CheckProject, tier?: string): Promise<RunParts> {
  return {
    project,
    assets: await checkAssets(project.dir, project.project, tier),
    registries: await pluginRegistries(project),
    statuses: await releaseStatuses(project.dir),
  };
}

/** Run the check of a project. A setup problem (no project, no build) throws a `CheckSetupError`. */
export async function runCheck(options: CheckOptions): Promise<CheckReport> {
  const project = readCheckProject(options.dir);
  const units = checkUnits(project, options).filter((unit) => unit.rules.length > 0);
  const problems: CheckRow[] = project.problems.map((verdict) =>
    failedRow("project", null, { id: verdict.id, metric: "rules", level: verdict.level }, verdict.detail ?? ""),
  );
  const base = { project: project.project.id, dir: project.dir };
  if (units.length === 0) {
    return { ...base, assets: null, rows: problems, passed: !problems.some(blocks), rules: problems.length };
  }
  const parts = await runParts(project, options.tier);
  const rows = [...problems];
  for (const unit of units) rows.push(...withOverrides(project.dir, unit, await measureUnit(parts, unit)));
  const { origin, tier, where } = parts.assets;
  const used = { origin, tier, where };
  return { ...base, assets: used, rows, passed: !rows.some(blocks), rules: rows.length };
}
