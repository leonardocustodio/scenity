// SPDX-License-Identifier: Apache-2.0
/**
 * The built-in metrics of the library and a registry with them. A host adds the metrics of its plugins with
 * `use(plugin)`.
 */
import {
  assetRights,
  belowFloor,
  distance,
  ikError,
  jointAngle,
  overlap,
  reach,
  routeClear,
  triangleBudget,
  visible,
  walkway,
} from "./metrics";
import { MetricRegistry, type MetricPlugin } from "./registry";
import type { MetricDefinition } from "./types";

export const BUILTIN_METRICS: readonly MetricDefinition[] = [
  distance,
  overlap,
  belowFloor,
  ikError,
  jointAngle,
  reach,
  visible,
  walkway,
  routeClear,
  triangleBudget,
  assetRights,
];

/** A registry with the built-in metrics and the metrics of the dev faces of the plugins. */
export function createMetricRegistry(plugins: readonly MetricPlugin[] = []): MetricRegistry {
  const registry = new MetricRegistry(BUILTIN_METRICS);
  for (const plugin of plugins) registry.use(plugin);
  return registry;
}
