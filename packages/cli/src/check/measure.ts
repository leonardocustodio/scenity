// SPDX-License-Identifier: Apache-2.0
/**
 * The writer gate measures by itself. A save that carries no rule results for its text (a save of Claude through the
 * host, or of a tool) gets the results of `scenity check` on the saved text: the rules that the writer knows
 * (ruleGate.ts) on the scene of the text, with the assets of the project.
 *
 * - A scene text: the scene rules, the project rules, at the scene time.
 * - A sequence text: the sequence rules and the project rules, on the scene that the sequence animates.
 * - A material, prefab or editor text has no rules, so it gives no verdicts.
 *
 * A setup problem (no project file, no build, no scene of the sequence) gives an error verdict for each rule, so the
 * gate refuses the save unless the owner gives a reason.
 */
import { builtinRegistry, readDocument, type Rule } from "@scenity/scene";
import type { RuleVerdict } from "@scenity/rules";
import { savedFileKind, sceneTextHash } from "../sceneFile/files";
import { sequenceWriterRules, writerRules } from "../sceneFile/ruleGate";
import { measureUnit, runParts, type CheckUnit } from "./run";
import { readCheckProject, type CheckProject } from "./project";
import type { CheckRow } from "./rows";

/** The verdict of a row: the part that the gate reads. */
function verdictOf(row: CheckRow): RuleVerdict {
  return {
    id: row.rule,
    level: row.level,
    status: row.status,
    detail: row.detail,
    ...(row.provisional === true ? { provisional: true } : {}),
  };
}

/** The unit of a saved text, and the project with the saved document in place of the file on the disk. */
function savedUnit(root: string, path: string, text: string): { project: CheckProject; unit: CheckUnit } | null {
  const disk = readCheckProject(root, { optional: true });
  const registry = builtinRegistry();
  if (savedFileKind(path) === "sequence") {
    const read = readDocument(text, "sequence", { registry });
    if (!read.ok) return null;
    const doc = read.doc;
    const sequences = [...disk.sequences.filter((item) => item.doc.id !== doc.id), { path, doc }];
    const scene = disk.scenes.find((item) => item.doc.id === doc.scene);
    if (scene === undefined) throw new Error(`the project has no scene "${doc.scene}" for the sequence`);
    const rules = sequenceWriterRules(root, doc).rules;
    return { project: { ...disk, sequences }, unit: { scene, rules } };
  }
  const read = readDocument(text, "scene", { registry });
  if (!read.ok) return null;
  const scene = { path, doc: read.doc, hash: sceneTextHash(text) };
  const scenes = [...disk.scenes.filter((item) => item.path !== path), scene];
  return { project: { ...disk, scenes }, unit: { scene, rules: writerRules(root, read.doc).rules } };
}

/** The error verdicts of the known rules when the measure cannot run. */
function errorVerdicts(rules: readonly Rule[], detail: string): RuleVerdict[] {
  return rules.map((rule) => ({ id: rule.id, level: rule.level, status: "error", detail }));
}

/** The known rules of a saved text without the project parts (for the error verdicts of a setup problem). */
function knownRules(root: string, path: string, text: string): readonly Rule[] {
  const registry = builtinRegistry();
  if (savedFileKind(path) === "sequence") {
    const read = readDocument(text, "sequence", { registry });
    return read.ok ? sequenceWriterRules(root, read.doc).rules : [];
  }
  const read = readDocument(text, "scene", { registry });
  return read.ok ? writerRules(root, read.doc).rules : [];
}

/**
 * Measure the rules that the writer knows for a saved text of the project folder `root` (`path` is relative to the
 * folder). A text that does not read gives no verdicts: the writer refuses it before the gate.
 */
export async function measureSavedRules(root: string, path: string, text: string): Promise<RuleVerdict[]> {
  const kind = savedFileKind(path);
  if (kind === "material" || kind === "prefab" || kind === "editor") return [];
  let saved;
  try {
    saved = savedUnit(root, path, text);
  } catch (error) {
    return errorVerdicts(knownRules(root, path, text), error instanceof Error ? error.message : String(error));
  }
  if (saved === null || saved.unit.rules.length === 0) return [];
  try {
    const parts = await runParts(saved.project);
    return (await measureUnit(parts, saved.unit)).map(verdictOf);
  } catch (error) {
    return errorVerdicts(saved.unit.rules, error instanceof Error ? error.message : String(error));
  }
}
