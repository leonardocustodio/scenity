// SPDX-License-Identifier: Apache-2.0
/**
 * The sources of the Problems panel:
 *
 * - the rules of the scene, the project and the sequence (the check of the core): a failed rule is a problem of the
 *   kind "rule"; a rule of a budget metric is a "budget" problem and a rule of the metric `assetRights` a "rights"
 *   problem;
 * - the references `asset:<id>` of the components that the asset manifest does not have ("asset");
 * - the components that the registry does not know ("component", with the fix Remove the component);
 * - the findings of the check of the document against the schemas of the components ("schema");
 * - the errors of the code of the plugins in the Console ("plugin");
 * - the health of the assets (`assets.health.json` of the dev server): an asset that the release gate stops for its
 *   rights is a "rights" problem of the entities that use it; the assets with no build output are a "build" problem.
 *
 * The rows of the check job (checkJob.ts) and the problems of the asset database (databaseProblems.ts) are other
 * sources.
 */
import type { SceneRuleVerdict } from "@scenity/bridge";
import { checkEntityDocument, parsePointer, type ComponentRegistry } from "@scenity/scene";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { failedRow } from "../../core/rules/ruleRows";
import { t } from "../../texts";
import type { ConsoleStore } from "../console/consoleStore";
import type { PageRuleSet } from "../pageRules";
import { ruleOfRow, sceneRuleRows } from "../rules/sceneRuleRows";
import type { AssetHealth } from "../../assetBrowser/assetTypes";
import type { Problem, ProblemFix, ProblemKind } from "./problemList";

/** The metrics of a budget. */
const BUDGET_METRICS = new Set(["triangleBudget"]);

/** The kind of the problem of a failed rule. */
function ruleKind(metric: string | undefined, id: string): ProblemKind {
  if (metric === "assetRights") return "rights";
  if ((metric !== undefined && BUDGET_METRICS.has(metric)) || id.toLowerCase().includes("budget")) return "budget";
  return "rule";
}

/** What the rule source reads: the rule check of the page and its project problems. */
export interface RuleCheck {
  check(): Promise<{ readonly set: PageRuleSet; readonly results: Parameters<typeof sceneRuleRows>[1] }>;
  readonly problems: readonly SceneRuleVerdict[];
}

/** The problems of the failed rules. */
export async function ruleProblems(rules: RuleCheck, doc: SceneDocument): Promise<Problem[]> {
  const { set, results } = await rules.check();
  return sceneRuleRows(set, results, doc, rules.problems)
    .filter(failedRow)
    .map((row) => ({
      key: `rule:${row.id}:${row.source}`,
      kind: ruleKind(ruleOfRow(set, row.id)?.metric, row.id),
      level: row.level === "block" ? ("error" as const) : ("warn" as const),
      title: `${row.id}: ${row.detail}`,
      detail: [row.scope, row.limit, row.note ?? ""].filter((part) => part !== "").join(" · ") || null,
      entities: row.entities,
      time: row.worst,
      file: row.source,
      fixes: [],
    }));
}

/** Each `asset:<id>` text in a value. */
function assetRefs(value: unknown, out: Set<string>): void {
  if (typeof value === "string") {
    if (value.startsWith("asset:")) out.add(value.slice("asset:".length).split("#")[0] ?? "");
  } else if (Array.isArray(value)) for (const item of value) assetRefs(item, out);
  else if (typeof value === "object" && value !== null) for (const item of Object.values(value)) assetRefs(item, out);
}

/** The references of the entities to assets that the manifest does not have. */
export function assetProblems(doc: SceneDocument, assets: readonly { readonly id: string }[]): Problem[] {
  const known = new Set(assets.map((asset) => asset.id));
  return Object.entries(doc.entities).flatMap(([id, entity]) => {
    const refs = new Set<string>();
    assetRefs(entity.components, refs);
    return [...refs]
      .filter((ref) => !known.has(ref))
      .map((ref) => ({
        key: `asset:${id}:${ref}`,
        kind: "asset" as const,
        level: "error" as const,
        title: t("problem-asset-missing", { name: entity.name ?? id, asset: ref }),
        detail: t("problem-asset-missing-detail"),
        entities: [id],
        time: null,
        file: null,
        fixes: [],
      }));
  });
}

/** The components that the registry does not know, with the fix that removes one. */
export function componentProblems(
  doc: SceneDocument,
  registry: Pick<ComponentRegistry, "has">,
  remove: (entity: string, component: string) => unknown,
): Problem[] {
  return Object.entries(doc.entities).flatMap(([id, entity]) =>
    Object.keys(entity.components)
      .filter((component) => !registry.has(component))
      .map((component) => {
        const fix: ProblemFix = {
          id: "remove",
          label: t("problem-component-remove"),
          run: () => remove(id, component),
        };
        return {
          key: `component:${id}:${component}`,
          kind: "component" as const,
          level: "warn" as const,
          title: t("problem-component-unknown", { name: entity.name ?? id, component }),
          detail: t("problem-component-unknown-detail"),
          entities: [id],
          time: null,
          file: null,
          fixes: [fix],
        };
      }),
  );
}

/** The findings of the check of the document against the schemas of its components (without the unknown components). */
export function schemaProblems(doc: SceneDocument, registry: ComponentRegistry): Problem[] {
  const { errors, warnings } = checkEntityDocument(doc, registry);
  const findings = [
    ...errors.map((finding) => ({ ...finding, level: "error" as const })),
    ...warnings.map((finding) => ({ ...finding, level: "warn" as const })),
  ];
  return findings.flatMap((finding, index) => {
    const tokens = parsePointer(finding.path) ?? [];
    const entity = tokens[0] === "entities" ? (tokens[1] ?? null) : null;
    const component = tokens[2] === "components" ? tokens[3] : undefined;
    if (component !== undefined && !registry.has(component)) return [];
    const name = entity === null ? null : (doc.entities[entity]?.name ?? entity);
    return [
      {
        key: `schema:${finding.path}:${String(index)}`,
        kind: "schema" as const,
        level: finding.level,
        title: name === null ? finding.message : `${name}: ${finding.message}`,
        detail: finding.path,
        entities: entity === null ? [] : [entity],
        time: null,
        file: null,
        fixes: [],
      },
    ];
  });
}

/** The errors of the code of the plugins in the log of the Console. */
export function pluginProblems(log: Pick<ConsoleStore, "entries">): Problem[] {
  return log.entries.value
    .filter((entry) => entry.source === "plugin" && entry.level === "error")
    .map((entry) => ({
      key: `plugin:${String(entry.id)}`,
      kind: "plugin" as const,
      level: "error" as const,
      title: entry.text,
      detail: entry.detail,
      entities: entry.entity === null ? [] : [entry.entity],
      time: null,
      file: entry.file?.path ?? null,
      fixes: [],
    }));
}

/** The problems of the health of the assets: the rights that stop a release, and the assets that are not built. */
export function healthProblems(health: AssetHealth, doc: SceneDocument): Problem[] {
  const users = new Map<string, string[]>();
  for (const [id, entity] of Object.entries(doc.entities)) {
    const refs = new Set<string>();
    assetRefs(entity.components, refs);
    for (const ref of refs) users.set(ref, [...(users.get(ref) ?? []), id]);
  }
  const rights = health.rights.map((asset) => ({
    key: `rights:${asset.id}`,
    kind: "rights" as const,
    level: "error" as const,
    title: t("problem-rights", { asset: asset.id, count: users.get(asset.id)?.length ?? 0 }),
    detail: asset.problems.join("; ") || null,
    entities: users.get(asset.id) ?? [],
    time: null,
    file: null,
    fixes: [],
  }));
  const build =
    health.unbuilt.length === 0
      ? []
      : [
          {
            key: "build:unbuilt",
            kind: "build" as const,
            level: "warn" as const,
            title: t("problem-unbuilt", { count: health.unbuilt.length }),
            detail: t("problem-unbuilt-detail", { assets: health.unbuilt.slice(0, 8).join(", ") }),
            entities: health.unbuilt.flatMap((id) => users.get(id) ?? []),
            time: null,
            file: null,
            fixes: [],
          },
        ];
  return [...rights, ...build];
}
