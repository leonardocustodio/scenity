// SPDX-License-Identifier: Apache-2.0
/**
 * The form of the rules editor. Pure functions, no DOM.
 *
 * - The metric picker: each metric of the library (`describe` of `@scenity/rules`) with the fields of its arguments,
 *   from the JSON Schema of the arguments (`settingFields` of the import dialog). An argument that takes a text or a
 *   list (an entity selector) is a "selector": a plain text is the text, and a text that starts with `[`, `{`, a digit
 *   or `-` is JSON. An argument with the pattern `^entity:` takes `entity:<id>` (the picker offers the entities of the
 *   scene).
 * - The draft: the texts of the form. `ruleOf` makes the rule of a draft and checks it with the rule schema.
 */
import { createMetricRegistry, type MetricDescription } from "@scenity/rules";
import { ruleSchema, type Rule } from "@scenity/scene";
import { settingFields, type SettingField } from "../../assetBrowser/settingsForm";

/** The kind of an argument field: the kinds of the settings form, and a selector (a text, or JSON for a list). */
export type ArgKind = SettingField["kind"] | "selector";

/** One argument of a metric. */
export interface ArgField extends Omit<SettingField, "kind"> {
  readonly kind: ArgKind;
  readonly required: boolean;
  /** True when the text of the argument starts with `entity:` (a point or an entity of the scene). */
  readonly entityRef: boolean;
}

/** One metric of the picker. */
export interface MetricChoice {
  readonly id: string;
  readonly label: string;
  readonly unit: string;
  /** The plugin of the metric, or null for a built-in metric. */
  readonly plugin: string | null;
  /** "max": a larger value is worse (the limit is a max); "min": a smaller value is worse. */
  readonly worst: "max" | "min";
  readonly fields: readonly ArgField[];
}

type Schema = Readonly<Record<string, unknown>>;
const isSchema = (value: unknown): value is Schema =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The options of a property schema (`anyOf` or `oneOf`). */
function optionsOf(schema: Schema): Schema[] {
  const list = Array.isArray(schema.anyOf) ? schema.anyOf : Array.isArray(schema.oneOf) ? schema.oneOf : [];
  return list.filter(isSchema);
}

/** The argument fields of a JSON Schema of arguments. */
export function argFields(schema: unknown): ArgField[] {
  const properties = isSchema(schema) && isSchema(schema.properties) ? schema.properties : {};
  const required = new Set(isSchema(schema) && Array.isArray(schema.required) ? schema.required.map(String) : []);
  return settingFields(schema).map((field) => {
    const property = properties[field.name];
    const options = isSchema(property) ? optionsOf(property) : [];
    const text = options.some((option) => option.type === "string");
    const entityRef =
      (isSchema(property) && property.pattern === "^entity:") ||
      options.some((option) => option.pattern === "^entity:");
    const kind: ArgKind = field.kind === "json" && text ? "selector" : field.kind;
    return { ...field, kind, advanced: kind === "json", required: required.has(field.name), entityRef };
  });
}

/** The metrics of the library (the built-in metrics, and the metrics of `descriptions` when the caller gives them). */
export function metricChoices(
  descriptions: readonly MetricDescription[] = createMetricRegistry().describe(),
): MetricChoice[] {
  return descriptions.map((metric) => ({
    id: metric.id,
    label: metric.label,
    unit: metric.unit,
    plugin: metric.plugin ?? null,
    worst: metric.worst === "min" ? "min" : "max",
    fields: argFields(metric.args),
  }));
}

/** The scope kinds of a rule. */
export const SCOPE_KINDS = ["scene", "sequence", "range", "marker", "entity"] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];

/** The texts of the form of a rule. */
export interface RuleDraft {
  readonly id: string;
  readonly metric: string;
  readonly args: Readonly<Record<string, string>>;
  readonly min: string;
  readonly max: string;
  readonly unit: string;
  readonly level: "block" | "warn";
  readonly provisional: boolean;
  readonly note: string;
  /** "" keeps the default scope of the file. */
  readonly scope: ScopeKind | "";
  readonly scopeSequence: string;
  readonly from: string;
  readonly to: string;
  readonly step: string;
  readonly marker: string;
  readonly entity: string;
}

/** A new draft for a metric. */
export function emptyDraft(metric: string): RuleDraft {
  return {
    ...{ id: "", metric, args: {}, min: "", max: "", unit: "", level: "warn", provisional: false, note: "" },
    ...{ scope: "", scopeSequence: "", from: "", to: "", step: "", marker: "", entity: "" },
  };
}

/** A value of a rule as the text of a field. */
const textOf = (value: unknown): string =>
  value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);

/**
 * The draft of a rule from a current value (a readout of a layout tool): the metric, its arguments, and the value as
 * the limit on the side of the worst values of the metric.
 */
export function draftFromValue(choice: MetricChoice, args: unknown, value: number): RuleDraft {
  const texts =
    typeof args === "object" && args !== null && !Array.isArray(args)
      ? Object.fromEntries(Object.entries(args).map(([key, item]) => [key, textOf(item)]))
      : {};
  const limit = String(Math.round(value * 1000) / 1000);
  return { ...emptyDraft(choice.id), args: texts, ...(choice.worst === "max" ? { max: limit } : { min: limit }) };
}

/** The draft of a rule. */
export function draftOf(rule: Rule): RuleDraft {
  const scope = rule.scope;
  const args = Object.fromEntries(Object.entries(rule.args ?? {}).map(([key, value]) => [key, textOf(value)]));
  return {
    ...emptyDraft(rule.metric),
    ...{ id: rule.id, args, min: textOf(rule.min), max: textOf(rule.max), unit: rule.unit ?? "" },
    ...{ level: rule.level, provisional: rule.provisional === true, note: rule.note ?? "", scope: scope?.kind ?? "" },
    scopeSequence: scope !== undefined && "sequence" in scope ? (scope.sequence ?? "") : "",
    from: scope?.kind === "range" ? String(scope.from) : "",
    to: scope?.kind === "range" ? String(scope.to) : "",
    step: scope?.kind === "range" ? String(scope.step) : "",
    marker: scope?.kind === "marker" ? textOf(scope.marker) : "",
    entity: scope?.kind === "entity" ? textOf(scope.entity) : "",
  };
}

/** The value of an argument text (an empty text gives no value). Throws an Error with the name of the argument. */
function argValue(field: ArgField, text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  if (field.kind === "selector") {
    if (!/^[[{\d-]/.test(trimmed)) return trimmed;
  } else if (field.kind === "text" || field.kind === "choice") return trimmed;
  else if (field.kind === "boolean") return trimmed === "true";
  else if (field.kind === "word-or-number" && field.choices.includes(trimmed)) return trimmed;
  else if (field.kind !== "json") {
    const value = Number(trimmed);
    if (!Number.isFinite(value)) throw new Error(field.name);
    return value;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error(field.name);
  }
}

/** A time of a range: a count of ms, or a marker name. */
const timeOf = (text: string): number | string => (/^\d+$/.test(text.trim()) ? Number(text) : text.trim());

/** The scope of a draft, or undefined (the default scope). */
function scopeOf(draft: RuleDraft): unknown {
  const sequence = draft.scopeSequence.trim() === "" ? {} : { sequence: draft.scopeSequence.trim() };
  switch (draft.scope) {
    case "":
      return undefined;
    case "scene":
      return { kind: "scene" };
    case "sequence":
      return { kind: "sequence", ...sequence };
    case "range":
      return { kind: "range", ...sequence, from: timeOf(draft.from), to: timeOf(draft.to), step: Number(draft.step) };
    case "marker":
      return {
        kind: "marker",
        ...sequence,
        marker: draft.marker.includes(",") ? draft.marker.split(",").map((m) => m.trim()) : draft.marker.trim(),
      };
    case "entity":
      return {
        kind: "entity",
        entity: draft.entity.includes(",") ? draft.entity.split(",").map((e) => e.trim()) : draft.entity.trim(),
      };
  }
}

/** The result of `ruleOf`: the rule, or the reason (a JSON Pointer of the rule and a message, or a bad argument). */
export type RuleOfResult = { readonly ok: true; readonly rule: Rule } | { readonly ok: false; readonly reason: string };

/** The rule of a draft, checked by the rule schema. */
export function ruleOf(draft: RuleDraft, choice: MetricChoice): RuleOfResult {
  const args: Record<string, unknown> = {};
  try {
    for (const field of choice.fields) {
      const value = argValue(field, draft.args[field.name] ?? "");
      if (value !== undefined && textOf(value) !== field.fallback) args[field.name] = value;
    }
  } catch (error) {
    return { ok: false, reason: `args/${error instanceof Error ? error.message : String(error)}` };
  }
  const number = (text: string): number | undefined => (text.trim() === "" ? undefined : Number(text));
  const raw = {
    id: draft.id.trim(),
    metric: choice.id,
    ...(Object.keys(args).length === 0 ? {} : { args }),
    ...(scopeOf(draft) === undefined ? {} : { scope: scopeOf(draft) }),
    ...(number(draft.min) === undefined ? {} : { min: number(draft.min) }),
    ...(number(draft.max) === undefined ? {} : { max: number(draft.max) }),
    ...(draft.unit.trim() === "" ? {} : { unit: draft.unit.trim() }),
    level: draft.level,
    ...(draft.provisional ? { provisional: true } : {}),
    ...(draft.note.trim() === "" ? {} : { note: draft.note.trim() }),
  };
  const parsed = ruleSchema.safeParse(raw);
  if (parsed.success) return { ok: true, rule: parsed.data };
  const issue = parsed.error.issues[0];
  return { ok: false, reason: `${issue?.path.join("/") ?? ""}: ${issue?.message ?? ""}` };
}
