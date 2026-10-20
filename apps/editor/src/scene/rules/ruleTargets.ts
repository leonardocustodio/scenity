// SPDX-License-Identifier: Apache-2.0
/**
 * The files of the rules editor: the scene of the page, its sequence, the project file and the rules files that the
 * project names, or a new rules file. The scene and the sequence change their rules with an edit of the page (one undo
 * step; the save writes them). The project file and the rules files change on the dev server (scripts/rulesApi.ts),
 * and then the page reads the rules of the project again.
 */
import type { Rule, SceneOp } from "@scenity/scene";

type JsonValue = Extract<SceneOp, { op: "set" }>["value"];
import { IMPORT_HEADER } from "../../assetBrowser/assetTypes";
import { t } from "../../texts";
import { PROJECT_FILE, reloadProjectRules, type PageRulesPort } from "../pageRules";
import type { ScenePageEditor } from "../sceneEditor";
import type { PageSequence } from "../sequencer/pageSequence";

/** One file of rules. */
export interface RuleTarget {
  readonly kind: "scene" | "sequence" | "project" | "file";
  /** The path of the file, relative to the project folder. */
  readonly file: string;
}

/** The parts of the page that the writer uses. */
export interface RuleWriterParts {
  readonly editor: ScenePageEditor;
  readonly sequence: PageSequence | null;
  readonly port: PageRulesPort;
  /** The URL of the project folder, with a "/" at the end. */
  readonly base: string;
}

/** The files of rules of the page: the scene, the sequence, the project file and each rules file of the project. */
export function ruleTargets(parts: RuleWriterParts): RuleTarget[] {
  const files = (parts.port.project.project?.rules ?? []).filter((item): item is string => typeof item === "string");
  return [
    { kind: "scene", file: parts.editor.file.path },
    ...(parts.sequence === null ? [] : [{ kind: "sequence" as const, file: parts.sequence.path }]),
    ...(parts.port.project.project === null ? [] : [{ kind: "project" as const, file: PROJECT_FILE }]),
    ...files.map((file) => ({ kind: "file" as const, file })),
  ];
}

/** The current rules of a file. */
export function rulesOf(parts: RuleWriterParts, target: RuleTarget): readonly Rule[] {
  if (target.kind === "scene") return parts.editor.doc.rules ?? [];
  if (target.kind === "sequence") return parts.sequence?.channel.doc.rules ?? [];
  return parts.port.project.sourced.filter((item) => item.source === target.file).map((item) => item.rule);
}

/** The list with the rule in place of the rule `old` (or at its end); a rule ID of another rule is a refusal. */
export function withRule(list: readonly Rule[], rule: Rule, old: string | null): Rule[] | string {
  if (rule.id !== old && list.some((item) => item.id === rule.id)) return t("rules-edit-same-id", { id: rule.id });
  const at = old === null ? -1 : list.findIndex((item) => item.id === old);
  return at < 0 ? [...list, rule] : list.map((item, index) => (index === at ? rule : item));
}

/** Write the rules of a file. The result is null, or the reason of a refusal. */
export async function writeRules(
  parts: RuleWriterParts,
  target: RuleTarget,
  rules: readonly Rule[],
): Promise<string | null> {
  if (target.kind === "scene") {
    // A rule is JSON: the copy of the list is the value of the op (no list removes the field).
    const value = JSON.parse(JSON.stringify(rules)) as JsonValue;
    const op =
      rules.length === 0 ? { op: "set" as const, path: "/rules" } : { op: "set" as const, path: "/rules", value };
    return parts.editor.apply([op], t("rules-edit-title"));
  }
  if (target.kind === "sequence") {
    if (parts.sequence === null) return t("rules-edit-no-sequence");
    try {
      await parts.sequence.run("sequence.rules", { rules: JSON.stringify(rules) });
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }
  const response = await fetch(`${parts.base}rules.write`, {
    method: "POST",
    headers: { [IMPORT_HEADER]: "1", "Content-Type": "application/json" },
    body: JSON.stringify({ file: target.file, rules }),
  }).catch((error: unknown) => error as Error);
  if (response instanceof Error) return response.message;
  const answer = (await response.json()) as { ok: boolean; reason?: string };
  if (!answer.ok) return answer.reason ?? t("rules-edit-failed");
  await reloadProjectRules(parts.port.project);
  return null;
}
