// SPDX-License-Identifier: Apache-2.0
// The routes of the walks of an actor. Each walk moves around the obstacles to its stand point. It starts at the stand
// point of the walk before. A move of an obstacle gives another route.
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { describe, expect, it } from "vitest";
import { walkRoutes, walksOf } from "../../src/scene/walks/walkRoutes";

function scene(boxAt: [number, number, number]): SceneDocument {
  return {
    format: "scenity.scene/1",
    id: "plaza",
    entities: {
      ada: {
        parent: null,
        index: 0,
        components: {
          transform: { position: [0, 0, 0] },
          locomotion: {
            walks: [
              { t: 500, to: "entity:spot" },
              { t: 4000, to: "entity:home" },
            ],
          },
        },
      },
      box: {
        parent: null,
        index: 1,
        components: { transform: { position: boxAt }, shape: { kind: "box", size: [1, 1, 1] }, obstacle: {} },
      },
      spot: { parent: null, index: 2, components: { transform: { position: [4, 0, 0] }, standPoint: {} } },
      home: { parent: null, index: 3, components: { transform: { position: [4, 0, 4] }, standPoint: {} } },
    },
  } as unknown as SceneDocument;
}

describe("the routes of the walks", () => {
  it("goes round an obstacle in the way, and goes straight when the obstacle moves away", () => {
    expect(walksOf(scene([2, 0, 0]), "ada")).toEqual([
      { t: 500, to: "spot" },
      { t: 4000, to: "home" },
    ]);
    const blocked = walkRoutes(scene([2, 0, 0]), "ada");
    expect(blocked.map((route) => [route.index, route.to])).toEqual([
      [0, "spot"],
      [1, "home"],
    ]);
    expect(blocked[0]?.points.length).toBeGreaterThan(2);
    expect(blocked[0]?.points[0]).toEqual([0, 0]);
    expect(blocked[0]?.points.at(-1)).toEqual([4, 0]);
    // The second walk starts at the stand point of the first.
    expect(blocked[1]?.points[0]).toEqual([4, 0]);
    const open = walkRoutes(scene([2, 0, 8]), "ada");
    expect(open[0]?.points).toEqual([
      [0, 0],
      [4, 0],
    ]);
    expect(walkRoutes(scene([2, 0, 0]), "box")).toEqual([]);
  });
});
