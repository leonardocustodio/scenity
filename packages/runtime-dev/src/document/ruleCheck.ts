// SPDX-License-Identifier: Apache-2.0
/**
 * The rule check of a document core: the one gate of `@scenity/rules` on the scene of the core. The core moves to each
 * time of the scopes with an update and no render (the update-only sweep). The metrics read the scene of that time
 * (`builderMetricContext`). Then the core returns to its time.
 *
 * The scene page sends the rules of the scene, of the project and of its sequence before a save, and sends the
 * results with the save request. A time of another sequence than the sequence of the core has no context (`n/a`).
 */
import type { ProjectDocument, Rule } from "@scenity/scene";
import type { SceneBuilder } from "@scenity/runtime";
import {
  createMetricRegistry,
  evaluateRules,
  type AssetStatus,
  type MetricPlugin,
  type RuleResult,
  type RuleSequence,
} from "@scenity/rules";
import { builderMetricContext } from "./metricContext";

/** A rule check: the rules with their scopes, the sequences of the scopes and the data of the metrics. */
export interface RuleCheckRequest {
  readonly rules: readonly Rule[];
  /** The sequence documents by ID (the times of the scopes). */
  readonly sequences?: Readonly<Record<string, RuleSequence>>;
  /** The ID of the sequence that the core plays, or null. */
  readonly playing?: string | null;
  readonly project?: ProjectDocument;
  readonly assets?: readonly AssetStatus[];
}

/** The parts of the core that the check uses. */
export interface RuleCheckCore {
  readonly builder: SceneBuilder;
  /** Show the scene of a time with no render (null: no sequence time). */
  update(simOrNull: number | null): void;
  /** The simulation time of the last frame, or null. */
  readonly time: number | null;
}

/** Evaluate the rules on the scene of the core. After the check, the core returns to its time. */
export function checkRules(
  core: RuleCheckCore,
  request: RuleCheckRequest,
  plugins: readonly MetricPlugin[] = [],
): RuleResult[] {
  const registry = createMetricRegistry(plugins);
  const playing = request.playing ?? null;
  const options = {
    ...(request.project === undefined ? {} : { project: request.project }),
    ...(request.assets === undefined ? {} : { assets: request.assets }),
  };
  try {
    return evaluateRules(
      request.rules,
      registry,
      (at) => {
        if (at.sequence !== null && at.sequence !== playing) return null;
        core.update(at.t);
        return builderMetricContext(core.builder, { ...options, time: at.t });
      },
      { sequences: request.sequences ?? {} },
    );
  } finally {
    core.update(core.time);
  }
}
