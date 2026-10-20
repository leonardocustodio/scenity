// SPDX-License-Identifier: Apache-2.0
/**
 * The rule gate of a scene save. The writer of the scene files runs the one gate of `@scenity/rules` (`gateRules`)
 * before it writes:
 *
 * - The rules that the writer knows: the rules of the scene document and the rules of the project (inline, or in the
 *   `*.rules.json` documents that the project names). Their levels come from these files, not from the request.
 * - The results come from the request (`checks`): the scene page evaluates the rules on its scene with the metrics
 *   and sends the results with the save. The writer reads them only when their hash is the hash of the saved text.
 *   A known rule with no result is an error. The results of other rules (the rules of a sequence) stay as they are.
 * - A failed `block` rule refuses the save, unless the request carries a reason of the owner (the override). The
 *   writer then keeps the reason in a log file next to the scene (`<name>.rules-log.jsonl`).
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { documentRules, gateRules, type RuleGate, type RuleVerdict } from "@scenity/rules";
import { readDocument, type Rule, type SceneDocument, type SequenceDocument } from "@scenity/scene";
import type { SceneSaveParams } from "./contract";

/** The project file at the root of a project folder. */
export const PROJECT_FILE = "scenity.project.json";

/** The rules that the writer knows, and an error verdict for each rules file that does not read. */
export interface WriterRules {
  readonly rules: readonly Rule[];
  readonly problems: readonly RuleVerdict[];
}

function problem(id: string, detail: string): RuleVerdict {
  return { id, level: "block", status: "error", detail };
}

/** The rules of a rules document of the project, or the reason that it does not read. */
function rulesFile(root: string, path: string): Rule[] | string {
  // A rules file can be outside the project folder, as its scenes and sequences (a sample can name the rules
  // of its plugin). The schema of the project gives a relative path; the writer only reads the file.
  const file = resolve(root, path);
  if (!existsSync(file)) return "no rules file";
  const read = readDocument(readFileSync(file, "utf8"), "rules");
  if (!read.ok) return `the rules file does not read: ${read.errors[0]?.path ?? ""} ${read.errors[0]?.message ?? ""}`;
  return documentRules(read.doc.rules);
}

/** The rules of the project of a folder: none with no project file. */
export function projectRules(root: string): WriterRules {
  const file = join(root, PROJECT_FILE);
  if (!existsSync(file)) return { rules: [], problems: [] };
  const read = readDocument(readFileSync(file, "utf8"), "project");
  if (!read.ok) return { rules: [], problems: [problem(PROJECT_FILE, "the project file does not read")] };
  const rules: Rule[] = [];
  const problems: RuleVerdict[] = [];
  for (const item of read.doc.rules ?? []) {
    if (typeof item !== "string") {
      rules.push(...documentRules([item]));
      continue;
    }
    const found = rulesFile(root, item);
    if (typeof found === "string") problems.push(problem(item, found));
    else rules.push(...found);
  }
  return { rules, problems };
}

/** The rules that the writer knows for a scene of the project folder `root`: the scene rules, then the project rules.
 * */
export function writerRules(root: string, doc: SceneDocument): WriterRules {
  const project = projectRules(root);
  return { rules: [...documentRules(doc.rules), ...project.rules], problems: project.problems };
}

/** The rules that the writer knows for a sequence of the project folder: the sequence rules, then the project rules. */
export function sequenceWriterRules(root: string, doc: SequenceDocument): WriterRules {
  const project = projectRules(root);
  return { rules: [...documentRules(doc.rules, doc.id), ...project.rules], problems: project.problems };
}

/** The words of a known rule with no result. */
function missing(params: SceneSaveParams, textHash: string): string {
  if (params.checks === undefined) return "the save carries no rule results";
  if (params.checks.hash !== textHash) return "the rule results are for another text";
  return "the save carries no result of this rule";
}

/**
 * The decision of the gate for a save. `textHash` is the hash of `params.text`. The levels of the known rules come
 * from the files; a result of the request for another rule keeps its level.
 */
export function sceneRuleGate(known: WriterRules, params: SceneSaveParams, textHash: string): RuleGate {
  const reported = params.checks?.hash === textHash ? params.checks.verdicts : [];
  const byId = new Map(reported.map((verdict) => [verdict.id, verdict]));
  const verdicts: RuleVerdict[] = known.rules.map((rule) => {
    const given = byId.get(rule.id);
    byId.delete(rule.id);
    const status = given?.status ?? "error";
    const detail = given === undefined ? missing(params, textHash) : given.detail;
    return {
      id: rule.id,
      level: rule.level,
      status,
      ...(detail === undefined ? {} : { detail }),
      ...(rule.provisional === true ? { provisional: true } : {}),
    };
  });
  return gateRules([...verdicts, ...byId.values(), ...known.problems], params.reason);
}

/** The log file of the overrides of a scene file: `<folder>/<name>.rules-log.jsonl`. */
export function overrideLogFile(sceneFile: string): string {
  const name = sceneFile.slice(dirname(sceneFile).length + 1).replace(/\.(scene|sequence)\.json$/, "");
  return join(dirname(sceneFile), `${name}.rules-log.jsonl`);
}

/** Add one line to the log of the overrides next to the scene file: the time, the reason and the failed rules. */
export function logOverride(sceneFile: string, path: string, hash: string, gate: RuleGate, time = new Date()): void {
  const rules = gate.blocks.map((verdict) => ({
    id: verdict.id,
    status: verdict.status,
    detail: verdict.detail ?? "",
  }));
  const line = { time: time.toISOString(), scene: path, hash, reason: gate.override, rules };
  appendFileSync(overrideLogFile(sceneFile), `${JSON.stringify(line)}\n`);
}
