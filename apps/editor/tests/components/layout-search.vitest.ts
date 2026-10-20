// SPDX-License-Identifier: Apache-2.0
// The layout search of the page. A candidate moves the facts of the entity and its subtree. The search keeps the rules
// with no sequence time, and finds a place where a distance rule passes.
import type { Rule, SceneDocument } from "@scenity/scene";
import type { SceneInspectReport } from "@scenity/runtime-dev/document/report";
import { describe, expect, it } from "vitest";
import { placeRules, searchPlaces, shiftedReport, startResults } from "../../src/scene/layoutTools/layoutSearch";

const entity = (id: string, x: number, parent: string | null = null) => ({
  ...{ id, name: null, parent, tags: [], components: ["transform"], visible: true },
  transform: { position: [x, 0, 0] as const, rotation: [0, 0, 0, 1] as const, scale: [1, 1, 1] as const },
  bounds: { min: [x - 0.5, 0, -0.5] as const, max: [x + 0.5, 1, 0.5] as const },
  sockets: {},
  joints: null,
  stats: { meshes: 1, triangles: 10, drawCalls: 1, instanced: false, lod: null },
});
const report = {
  simMs: null,
  bounds: null,
  entities: [entity("chair", 0), entity("cushion", 0, "chair"), entity("table", 1)],
  totals: { entities: 3, triangles: 30, drawCalls: 3 },
  layers: { names: [], on: [] },
} as unknown as SceneInspectReport;
const transform = (x: number) => ({ transform: { position: [x, 0, 0] } });
const scene = {
  format: "scenity.scene/1",
  id: "s",
  name: "S",
  entities: {
    chair: { name: "Chair", parent: null, index: 0, components: transform(0) },
    cushion: { name: "Cushion", parent: "chair", index: 0, components: transform(0) },
    table: { name: "Table", parent: null, index: 1, components: transform(1) },
  },
} as unknown as SceneDocument;

describe("the layout search of the page", () => {
  it("moves the facts of the entity and its subtree", () => {
    const moved = {
      ...scene,
      entities: { ...scene.entities, chair: { ...scene.entities.chair, components: transform(-2) } },
    } as unknown as SceneDocument;
    const shifted = shiftedReport(report, scene, moved, "chair");
    expect(shifted.entities.map((item) => item.transform.position[0])).toEqual([-2, -2, 1]);
    expect(shifted.entities[1]?.bounds?.min[0]).toBe(-2.5);
  });

  it("finds a place where the rules pass", () => {
    const away: Rule = {
      id: "away",
      metric: "distance",
      args: { from: "entity:chair", to: "entity:table" },
      min: 1.5,
      level: "block",
    };
    const later: Rule = { ...away, id: "later", scope: { kind: "sequence" } };
    expect(placeRules([away, later]).map((rule) => rule.id)).toEqual(["away"]);
    const input = { report, scene, project: null, rules: [away], entity: "chair", radius: 2, steps: 60 };
    expect(startResults(input)[0]?.status).toBe("fail");
    const found = searchPlaces(input);
    expect(found.variants.length).toBeGreaterThan(0);
    expect(found.variants[0]?.results[0]?.status).toBe("pass");
  });
});
