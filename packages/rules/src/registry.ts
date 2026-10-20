// SPDX-License-Identifier: Apache-2.0
/**
 * The registry of the metrics: the built-in metrics and the metrics of the plugins. A plugin gives its metrics through
 * its dev face (`defineDevPlugin({ library })` of `@scenity/runtime-dev`). `use(plugin)` adds them (each ID starts with
 * the plugin ID and a dot). The rules, the CLI and the tools of Claude evaluate a metric by its ID with arguments as
 * data. The registry first checks the arguments with the schema of the metric.
 */
import { z } from "zod";
import type { MetricContext } from "./context";
import type { MetricDefinition, MetricLimit, MetricResult } from "./types";

// The pages of Scenity have a strict CSP with Trusted Types. Without this setting, zod calls `Function("")`
// when it makes an object schema, and the page reports a CSP violation. A plugin metric module can load before the
// schema modules of @scenity/scene (packages/scene/src/schema/common.ts), so the library sets it too.
z.config({ jitless: true });

/** A built-in metric ID is one word; a plugin metric ID is the plugin ID, a dot and words with dots (`doors.gap`). */
const BUILTIN_ID = /^[a-z][a-zA-Z0-9]*$/;
const PLUGIN_ID = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

/** Make a metric. The ID is a word (a built-in metric) or words with dots (a plugin metric). */
export function defineMetric<Schema extends z.ZodType>(spec: MetricDefinition<Schema>): MetricDefinition<Schema> {
  if (!BUILTIN_ID.test(spec.id) && !PLUGIN_ID.test(spec.id)) throw new Error(`"${spec.id}" is not a metric ID`);
  return spec;
}

/** The outcome of an evaluation: the result, or the reason that the metric did not run. */
export type MetricOutcome =
  { readonly ok: true; readonly result: MetricResult } | { readonly ok: false; readonly reason: string };

/** A metric as data: for a list of the metrics, the palette and the tools of Claude. */
export interface MetricDescription {
  readonly id: string;
  readonly label: string;
  readonly unit: string;
  readonly worst: "max" | "min";
  /** The plugin of the metric, or null for a built-in metric. */
  readonly plugin: string | null;
  /** The JSON Schema of the arguments. */
  readonly args: unknown;
}

/** The dev face of a plugin as the registry reads it. */
export interface MetricPlugin {
  readonly id: string;
  readonly library?: readonly MetricDefinition[];
}

export class MetricRegistry {
  readonly #metrics = new Map<string, { readonly metric: MetricDefinition; readonly plugin: string | null }>();

  constructor(builtins: readonly MetricDefinition[] = []) {
    for (const metric of builtins) this.register(metric, null);
  }

  /**
   * Add a metric. A plugin metric ID starts with the plugin ID and a dot (`doors.gap`), as each part ID of a runtime
   * plugin (`defineRuntimePlugin`). Each ID can occur one time only.
   */
  register(metric: MetricDefinition, plugin: string | null): void {
    if (plugin !== null && !(PLUGIN_ID.test(metric.id) && metric.id.startsWith(`${plugin}.`))) {
      throw new Error(
        `${plugin}: the metric ID "${metric.id}" does not start with "${plugin}." (a plugin metric is "<plugin>.<name>")`,
      );
    }
    const known = this.#metrics.get(metric.id);
    if (known !== undefined) {
      throw new Error(`the metric "${metric.id}" is in the registry already (${known.plugin ?? "built-in"})`);
    }
    this.#metrics.set(metric.id, { metric, plugin });
  }

  /** Add the metrics of the dev face of a plugin. */
  use(plugin: MetricPlugin): this {
    for (const metric of plugin.library ?? []) this.register(metric, plugin.id);
    return this;
  }

  has(id: string): boolean {
    return this.#metrics.has(id);
  }

  get(id: string): MetricDefinition | undefined {
    return this.#metrics.get(id)?.metric;
  }

  /** The IDs in the order of the registration. */
  ids(): string[] {
    return [...this.#metrics.keys()];
  }

  /** Each metric as data, with the JSON Schema of its arguments. */
  describe(): MetricDescription[] {
    return [...this.#metrics.values()].map(({ metric, plugin }) => ({
      id: metric.id,
      label: metric.label,
      unit: metric.unit,
      worst: metric.worst ?? "max",
      plugin,
      // The arguments as a rule document writes them: a field with a default is optional.
      args: z.toJSONSchema(metric.args, { io: "input", unrepresentable: "any" }),
    }));
  }

  /** Check the arguments, then evaluate the metric in a context. */
  evaluate(id: string, ctx: MetricContext, args: unknown = {}): MetricOutcome {
    const metric = this.get(id);
    if (metric === undefined) return { ok: false, reason: `no metric "${id}"` };
    const parsed = metric.args.safeParse(args);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "args"}: ${issue.message}`);
      return { ok: false, reason: `${id}: ${issues.join("; ")}` };
    }
    return { ok: true, result: metric.evaluate(ctx, parsed.data) };
  }
}

/**
 * True when a value is in a limit: at least `min` and at most `max`. A null value (the metric does not apply) is in
 * each limit. The gate of the rules adds the levels and the known gaps on top of this test.
 */
export function inLimit(value: number | null, limit: MetricLimit): boolean {
  if (value === null) return true;
  if (limit.min !== undefined && value < limit.min) return false;
  return limit.max === undefined || value <= limit.max;
}
