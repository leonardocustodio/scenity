// SPDX-License-Identifier: Apache-2.0
/**
 * The values of the Performance panel. Pure functions, no DOM.
 *
 * - `statRows`: each value of the frame statistics of the core (`SceneStats` of `@scenity/runtime`, `stats()` of the
 *   page) as a row: the key of the value, the Fluent ID of its label, and its text (numbers as data).
 * - `entityCosts`: the cost of each entity of the inspect report (triangles, draw calls, meshes), the most first.
 */
import type { SceneStats } from "@scenity/runtime/protocol";
import type { SceneInspectReport } from "@scenity/runtime-dev/document/report";

/** One row of the statistics. */
export interface StatRow {
  /** The key of the value in `stats()` (a dotted path for a part of a value). */
  readonly key: string;
  readonly label: string;
  readonly text: string;
}

const ms = (value: number): string => `${value.toFixed(2)} ms`;
const count = (value: number): string => value.toLocaleString("en-US");
/** A number of the statistics as text, or null when the core gives none (a number can be absent at the start). */
const num = (value: unknown, format: (item: number) => string): string | null =>
  typeof value === "number" && Number.isFinite(value) ? format(value) : null;
/** The keys that `statRows` knows; another key of the statistics shows as JSON. */
const KNOWN = new Set([
  "mode",
  "tier",
  "frames",
  "intervalP50",
  "intervalP95",
  "workP50",
  "workP95",
  "updateP95",
  "renderP95",
  "poseP95",
  "memory",
  "heapMb",
  "drawCalls",
  "triangles",
  "entities",
  "instances",
  "visibleEntities",
  "effects",
  "assets",
  "loads",
  "failures",
  "gpu",
  "backend",
  "backendReason",
  "backendChosen",
]);

/** The rows of the statistics of a frame window, in the order of `SceneStats`. */
export function statRows(stats: SceneStats): StatRow[] {
  const rows: StatRow[] = [];
  const add = (key: string, text: string | null): void => {
    if (text !== null) rows.push({ key, label: `perf-stat-${key.replace(".", "-")}`, text });
  };
  const optional = <T>(value: T | undefined | null, format: (item: T) => string): string | null =>
    value === undefined || value === null ? null : format(value);
  add("mode", stats.mode);
  add("tier", stats.tier);
  add("frames", num(stats.frames, count));
  add(
    "intervalP50",
    num(stats.intervalP50, (value) => `${ms(value)} (${value > 0 ? String(Math.round(1000 / value)) : "0"} fps)`),
  );
  add("intervalP95", num(stats.intervalP95, ms));
  add("workP50", num(stats.workP50, ms));
  add("workP95", num(stats.workP95, ms));
  add("updateP95", num(stats.updateP95, ms));
  add("renderP95", num(stats.renderP95, ms));
  add("poseP95", num(stats.poseP95, ms));
  add(
    "memory",
    optional(stats.memory, (memory) =>
      [
        num(memory.geometries, count) ?? "—",
        num(memory.textures, count) ?? "—",
        num(memory.programs, count) ?? "—",
        ...(memory.bytes === undefined ? [] : [`${(memory.bytes / (1024 * 1024)).toFixed(1)} MB`]),
      ].join(" · "),
    ),
  );
  add(
    "heapMb",
    num(stats.heapMb, (value) => `${value.toFixed(1)} MB`),
  );
  add("drawCalls", num(stats.drawCalls, count));
  add("triangles", num(stats.triangles, count));
  add("entities", num(stats.entities, count));
  add("instances", num(stats.instances, count));
  add("visibleEntities", num(stats.visibleEntities, count));
  add(
    "effects",
    optional(stats.effects, (effects) => (effects.length === 0 ? "—" : effects.join(", "))),
  );
  add("assets", stats.assets);
  const loads = Object.values((stats.loads as Readonly<Record<string, string>> | undefined) ?? {});
  add("loads", `${String(loads.filter((load) => load === "ready").length)} / ${String(loads.length)}`);
  add(
    "failures",
    optional(stats.failures, (failures) => (failures.length === 0 ? "0" : failures.join("; "))),
  );
  add(
    "gpu",
    stats.gpu === undefined
      ? null
      : stats.gpu === null
        ? "—"
        : `${num(stats.gpu.p50, ms) ?? "—"} · p95 ${num(stats.gpu.p95, ms) ?? "—"} (${String(stats.gpu.samples)})`,
  );
  add("backend", optional(stats.backend, String));
  add("backendReason", optional(stats.backendReason, String));
  add("backendChosen", optional(stats.backendChosen, String));
  for (const [key, value] of Object.entries(stats)) {
    if (!KNOWN.has(key) && value !== undefined)
      rows.push({ key, label: "perf-stat-other", text: JSON.stringify(value) });
  }
  return rows;
}

/** The cost of one entity. */
export interface EntityCost {
  readonly id: string;
  readonly name: string;
  readonly triangles: number;
  readonly drawCalls: number;
  readonly meshes: number;
  readonly instanced: boolean;
}

/** The entities of an inspect report with a cost, the most triangles first (then the most draw calls). */
export function entityCosts(report: SceneInspectReport, most = 20): EntityCost[] {
  return report.entities
    .filter((entity) => entity.stats.triangles > 0 || entity.stats.drawCalls > 0)
    .map((entity) => ({
      id: entity.id,
      name: entity.name ?? entity.id,
      triangles: entity.stats.triangles,
      drawCalls: entity.stats.drawCalls,
      meshes: entity.stats.meshes,
      instanced: entity.stats.instanced,
    }))
    .sort((a, b) => b.triangles - a.triangles || b.drawCalls - a.drawCalls || a.id.localeCompare(b.id))
    .slice(0, most);
}
