// SPDX-License-Identifier: Apache-2.0
/**
 * The rules of the scene page: before a save, the page evaluates the rules on the scene of its core and sends the
 * verdicts with the save request. The writer of the scene files runs the one gate over them (`@scenity/cli/sceneFile`
 * ruleGate.ts).
 *
 * The rules: the rules of the scene document, the rules of the project (inline, and the `*.rules.json` documents
 * that it names) and the rules of the sequence of the page when that sequence animates the scene. The core moves to
 * the times of the scopes with no render (`checkRules` of the dev document client), then returns to its time.
 *
 * Each rule keeps its source file (`pageRuleSet`), so the rules panel of the edit mode groups the rules by file.
 */
import { readDocument, type ProjectDocument, type Rule, type SceneDocument } from "@scenity/scene";
import type { SequenceDocument } from "@scenity/scene/sequence";
import { documentRules, type AssetStatus, type RuleResult } from "@scenity/rules";
import type { SceneRuleVerdict } from "@scenity/cli/sceneFileContract";
import type { RuleCheckRequest } from "@scenity/runtime-dev/document/ruleCheck";
import { t } from "../texts";

/** A rule with its source file (the rules panel groups the rules by source). */
export interface SourcedRule {
  readonly rule: Rule;
  readonly source: string;
}

/** The file name of the project document. */
export const PROJECT_FILE = "scenity.project.json";

/** The rules of the project: inline, and the rules documents; a rules file that does not read gives an error. */
export interface ProjectRules {
  readonly project: ProjectDocument | null;
  readonly rules: readonly Rule[];
  /** The same rules, each with its file (the project file, or the rules document). */
  readonly sourced: readonly SourcedRule[];
  /** An error verdict for each rules file that does not read (the writer gives the same). */
  readonly problems: readonly SceneRuleVerdict[];
  /**
   * The rights state of each asset of the project (the release gate of the dev server), for `assetRights`,
   * as `scenity check` gives it. Undefined: a page with no dev server.
   */
  readonly assets?: readonly AssetStatus[] | undefined;
}

/** The rights state of each asset: the asset list and the assets that the release gate stops. */
async function readAssetStatuses(base: string): Promise<AssetStatus[] | undefined> {
  const json = async <T>(path: string): Promise<T | null> => {
    const response = await fetch(`${base}${path}`, { cache: "no-store" }).catch(() => null);
    const type = response?.headers.get("content-type") ?? "";
    return response?.ok === true && type.includes("json") ? ((await response.json()) as T) : null;
  };
  const [list, health] = await Promise.all([
    json<{ assets: readonly { id: string }[] }>("assets.list.json"),
    json<{ rights: readonly { id: string; problems: readonly string[] }[] }>("assets.health.json"),
  ]);
  if (list === null || health === null) return undefined;
  const stopped = new Map(health.rights.map((item) => [item.id, item.problems]));
  return list.assets.map(({ id }) => ({ id, allowed: !stopped.has(id), problems: stopped.get(id) ?? [] }));
}

/** Read the project of the page at `base` and the rules documents that it names. */
export async function readProjectRules(base: string): Promise<ProjectRules> {
  const response = await fetch(`${base}scenity.project.json`, { cache: "no-store" });
  const none: ProjectRules = { project: null, rules: [], sourced: [], problems: [] };
  if (!response.ok) return none;
  const read = readDocument(await response.text(), "project");
  if (!read.ok) return none;
  const sourced: SourcedRule[] = [];
  const problems: SceneRuleVerdict[] = [];
  for (const item of read.doc.rules ?? []) {
    if (typeof item !== "string") {
      sourced.push(...documentRules([item]).map((rule) => ({ rule, source: PROJECT_FILE })));
      continue;
    }
    const file = await fetch(`${base}${item}`, { cache: "no-store" });
    const doc = file.ok ? readDocument(await file.text(), "rules") : null;
    if (doc?.ok === true) sourced.push(...documentRules(doc.doc.rules).map((rule) => ({ rule, source: item })));
    else problems.push({ id: item, level: "block", status: "error", detail: t("scene-rules-file-unread") });
  }
  const assets = await readAssetStatuses(base);
  return {
    ...{ project: read.doc, rules: sourced.map((item) => item.rule), sourced, problems },
    ...(assets === undefined ? {} : { assets }),
  };
}

/** Project rules that read the files again after the rules editor writes one. */
export interface LiveProjectRules extends ProjectRules {
  reload(): Promise<void>;
}

/** The rules of the project of the page at `base`, with a reload (the getters give the last read). */
export async function liveProjectRules(base: string): Promise<LiveProjectRules> {
  let now = await readProjectRules(base);
  return {
    get project() {
      return now.project;
    },
    get rules() {
      return now.rules;
    },
    get sourced() {
      return now.sourced;
    },
    get problems() {
      return now.problems;
    },
    get assets() {
      return now.assets;
    },
    async reload() {
      now = await readProjectRules(base);
    },
  };
}

/** Read the project rules again when they have a reload (`liveProjectRules`). */
export async function reloadProjectRules(project: ProjectRules): Promise<void> {
  if ("reload" in project && typeof project.reload === "function") await (project as LiveProjectRules).reload();
}

/** The check of the rules on the core of the page. */
export type RuleChecker = (doc: SceneDocument) => Promise<readonly SceneRuleVerdict[]>;

/** The verdict of a rule result: the part that the save request carries. */
export function verdictOf(result: RuleResult): SceneRuleVerdict {
  return {
    id: result.id,
    level: result.level,
    status: result.status,
    detail: result.detail,
    ...(result.provisional === true ? { provisional: true } : {}),
  };
}

/** The parts of the page that the rule check uses. */
export interface PageRuleParts {
  readonly project: ProjectRules;
  /** The sequence of the page, or null. */
  readonly sequence: SequenceDocument | null;
  checkRules(request: RuleCheckRequest): Promise<readonly RuleResult[] | null>;
}

/** The file names of the scene and of the sequence of the page (the sources of their rules). */
export interface RuleFiles {
  readonly scene: string;
  readonly sequence: string;
}

/** The rules of a check with their sources, and the request of the check without the rules. */
export interface PageRuleSet {
  readonly rules: readonly SourcedRule[];
  readonly request: Omit<RuleCheckRequest, "rules">;
}

/** The current rules of the scene, of the project and of the sequence of the scene, in that order. */
export function pageRuleSet(
  project: ProjectRules,
  doc: SceneDocument,
  sequence: SequenceDocument | null,
  files: RuleFiles = { scene: "scene", sequence: "sequence" },
): PageRuleSet {
  const own = sequence !== null && sequence.scene === doc.id ? sequence : null;
  const rules: SourcedRule[] = [
    ...documentRules(doc.rules).map((rule) => ({ rule, source: files.scene })),
    ...project.sourced,
    ...(own === null ? [] : documentRules(own.rules, own.id).map((rule) => ({ rule, source: files.sequence }))),
  ];
  return {
    rules,
    request: {
      sequences: sequence === null ? {} : { [sequence.id]: sequence },
      playing: sequence?.id ?? null,
      ...(project.project === null ? {} : { project: project.project }),
      ...(project.assets === undefined ? {} : { assets: project.assets }),
    },
  };
}

/** The rule check of the page: the current rules of the scene, of the project and of the sequence of the scene. */
export function pageRuleChecker(parts: PageRuleParts): RuleChecker {
  const { project, sequence } = parts;
  return async (doc) => {
    const set = pageRuleSet(project, doc, sequence);
    if (set.rules.length === 0) return project.problems;
    const results = await parts.checkRules({ ...set.request, rules: set.rules.map((item) => item.rule) });
    if (results === null) throw new Error("the scene core stopped before the rule check");
    return [...results.map(verdictOf), ...project.problems];
  };
}

/** What the rules panel of the edit mode reads: the project rules and the rule check of the core. */
export interface PageRulesPort {
  readonly project: ProjectRules;
  checkRules(request: RuleCheckRequest): Promise<readonly RuleResult[] | null>;
}
