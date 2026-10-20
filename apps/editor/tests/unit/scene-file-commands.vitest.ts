// SPDX-License-Identifier: Apache-2.0
// The file commands of the scene page: the file name of a name, and the prefab document of an entity with its subtree
// (the entity is the one root, at the origin of the prefab).
import { builtinRegistry, checkEntityDocument } from "@scenity/scene";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { describe, expect, it } from "vitest";
import { fileSlug, prefabOf } from "../../src/scene/projects/fileCommands";

const SCENE = {
  format: "scenity.scene/1",
  id: "room",
  entities: {
    table: { name: "Table", parent: null, index: 0, components: { transform: { position: [1, 0, 2] } } },
    cup: { name: "Cup", parent: "table", index: 0, components: { transform: { position: [0, 1, 0] } } },
    lamp: { name: "Lamp", parent: null, index: 1, components: { transform: { position: [3, 0, 0] } } },
  },
} as unknown as SceneDocument;

describe("the file commands", () => {
  it("makes a file name of a name", () => {
    expect(fileSlug("Lounge Chair (oak)")).toBe("lounge-chair-oak");
    expect(fileSlug("  ")).toBe("");
  });

  it("makes the prefab of an entity with its subtree", () => {
    const prefab = prefabOf(SCENE, "table", "Dining table") as unknown as {
      root: string;
      entities: Record<string, { parent: string | null; components: { transform: { position: number[] } } }>;
    };
    expect(prefab.root).toBe("table");
    expect(Object.keys(prefab.entities).sort()).toEqual(["cup", "table"]);
    expect(prefab.entities.table?.parent).toBeNull();
    expect(prefab.entities.table?.components.transform.position).toEqual([0, 0, 0]);
    expect(prefab.entities.cup?.components.transform.position).toEqual([0, 1, 0]);
    expect(checkEntityDocument(prefabOf(SCENE, "table", "Dining table"), builtinRegistry()).errors).toEqual([]);
  });
});
