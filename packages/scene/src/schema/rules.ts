// SPDX-License-Identifier: Apache-2.0
/**
 * The zod schema of a rule: a limit on the value of a metric of the
 * metric library (`@scenity/rules`), with a scope, a level and notes. A rule is in a rules document
 * (`*.rules.json`), in the `rules` list of the project, of a scene or of a sequence.
 *
 * - `metric` and `args`: the metric ID and its arguments as data. The registry of the metrics checks the arguments.
 * - `scope`: the times and the entities of the rule (see `ruleScopeSchema`).
 * - `min`, `max`: the limit. A rule with no limit uses the limit of the metric (a budget of the project).
 * - `unit`: the unit of the limit. The gate refuses a metric that gives another unit.
 * - `level`: `block` stops a save (a reason from the owner lets the save continue). `warn` only shows the failure.
 * - `provisional`: the limit is not confirmed. `note`: words for a person. `known`: the reason of a known gap. A
 *   failure of the rule is then a known failure, not a failure of the gate.
 */
import { z } from "zod";
import { idSchema, relativePathSchema } from "./common";

/** The pattern of a rule ID: words with `.`, `_` or `-` between them (`layout.walkway`). */
export const RULE_ID_PATTERN = /^[a-z][A-Za-z0-9]*([._-][A-Za-z0-9]+)*$/;
/** The pattern of a metric ID: a word (a built-in metric) or words with dots (a plugin metric, `doors.gap`). */
export const METRIC_ID_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/;
/** The pattern of a marker name (the same as `NAME_PATTERN` of the sequence schema). */
const MARKER_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

export const ruleIdSchema = z
  .string()
  .max(128)
  .regex(RULE_ID_PATTERN, "a rule ID is words with '.', '_' or '-' between them");
export const metricIdSchema = z.string().max(128).regex(METRIC_ID_PATTERN, "not a metric ID");
const markerSchema = z
  .string()
  .regex(MARKER_PATTERN, "a marker name has 1 to 64 letters, digits, '_', '.', ':' or '-'");
/** A time of a sequence: a count of milliseconds, or the name of a marker of the sequence. */
export const ruleTimeSchema = z.union([z.number().int().min(0), markerSchema]);
/** Entities: an ID, `tag:<tag>`, `component:<id>`, `*`, or a list of them (as the selectors of the metrics). */
export const ruleSelectorSchema = z.union([z.string().min(1).max(128), z.array(z.string().min(1).max(128)).min(1)]);

/**
 * The scope of a rule: the times and the entities where the gate evaluates the metric.
 *
 * - `scene`: the scene one time, with no sequence time (a page with a sequence uses the time 0).
 * - `sequence`: each marker and each key time of a sequence.
 * - `range`: the times `from` to `to` (ms or marker names) of a sequence, at a step of `step` ms.
 * - `marker`: the times of one or more markers of a sequence.
 * - `entity`: the scene one time, and only the items of the metric for the entities of `entity`.
 *
 * `sequence` is the ID of a sequence of the project. In a sequence document it is the sequence of the document.
 */
export const ruleScopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("scene") }),
  z.strictObject({ kind: z.literal("sequence"), sequence: idSchema.optional() }),
  z.strictObject({
    kind: z.literal("range"),
    sequence: idSchema.optional(),
    from: ruleTimeSchema,
    to: ruleTimeSchema,
    step: z.number().int().min(1),
  }),
  z.strictObject({
    kind: z.literal("marker"),
    sequence: idSchema.optional(),
    marker: z.union([markerSchema, z.array(markerSchema).min(1)]),
  }),
  z.strictObject({ kind: z.literal("entity"), entity: ruleSelectorSchema }),
]);

export const RULE_LEVELS = ["block", "warn"] as const;

export const ruleSchema = z
  .strictObject({
    id: ruleIdSchema,
    metric: metricIdSchema,
    args: z.record(z.string(), z.json()).optional(),
    /** The scope (default: `scene` in a project or a scene, `sequence` in a sequence). */
    scope: ruleScopeSchema.optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    unit: z.string().min(1).max(32).optional(),
    level: z.enum(RULE_LEVELS),
    provisional: z.boolean().optional(),
    note: z.string().min(1).max(500).optional(),
    known: z.string().min(1).max(500).optional(),
  })
  .refine((rule) => rule.min === undefined || rule.max === undefined || rule.min <= rule.max, {
    message: "min is not more than max",
    path: ["max"],
  });

/** A list of rules: each rule ID is in the list one time. */
export const ruleListSchema = z
  .array(ruleSchema)
  .refine((rules) => new Set(rules.map((r) => r.id)).size === rules.length, {
    message: "each rule ID is in the list one time",
  });

/** The pattern of the path of a rules document: a relative path that ends with `.rules.json`. */
export const rulesPathSchema = relativePathSchema.regex(/\.rules\.json$/, "a rules file name ends with .rules.json");

/** The rules document `*.rules.json`: a list of rules that the project names in its `rules` list. */
export const rulesDocumentSchema = z.strictObject({
  format: z.literal("scenity.rules/1"),
  id: idSchema,
  name: z.string().min(1).max(200).optional(),
  rules: ruleListSchema,
});

export type Rule = z.infer<typeof ruleSchema>;
export type RuleScope = z.infer<typeof ruleScopeSchema>;
export type RuleLevel = (typeof RULE_LEVELS)[number];
export type RulesDocument = z.infer<typeof rulesDocumentSchema>;
