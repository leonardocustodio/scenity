// SPDX-License-Identifier: Apache-2.0
// The selection: entity IDs with sub-targets (`entity:<id>#<sub>`) on the generic fixture scene.
import { describe, expect, it } from "bun:test";
import {
  addItem,
  entityTarget,
  makePrimary,
  parseSelectionText,
  parseTarget,
  primary,
  pruneSelection,
  selectedEntities,
  selectionText,
  selectOnly,
  targetRef,
  toggleItem,
} from "../src/index";
import { garden } from "./helpers";

describe("the selection", () => {
  it("names an entity and a sub-target with the reference text", () => {
    expect(targetRef(entityTarget("table"))).toBe("entity:table");
    expect(targetRef(entityTarget("table", "top"))).toBe("entity:table#top");
    expect(parseTarget("entity:bench#left")).toEqual({ kind: "entity", id: "bench", sub: "left" });
    expect(parseTarget("asset:bench")).toBeNull();
    expect(parseTarget("entity:bad id")).toBeNull();
  });

  it("selects, adds, toggles and makes primary; a sub-target is its own item", () => {
    let selection = selectOnly(entityTarget("table"));
    selection = addItem(selection, entityTarget("bench", "left"));
    selection = addItem(selection, entityTarget("bench", "left"));
    selection = addItem(selection, entityTarget("bench", "right"));
    expect(selectionText(selection)).toBe("entity:table,entity:bench#left,entity:bench#right");
    expect(selectedEntities(selection)).toEqual(["table", "bench"]);
    selection = toggleItem(selection, entityTarget("table"));
    expect(primary(selection)).toEqual({ kind: "entity", id: "bench", sub: "left" });
    selection = makePrimary(selection, entityTarget("sun"));
    expect(selectionText(selection)).toBe("entity:sun,entity:bench#left,entity:bench#right");
    expect(primary(selectOnly(null))).toBeNull();
  });

  it("reads a selection text and drops the items of entities that are not in the scene", () => {
    const selection = parseSelectionText("entity:lamp, entity:pond#x, nothing, entity:table#top");
    expect(selectionText(selection)).toBe("entity:lamp,entity:pond#x,entity:table#top");
    expect(selectionText(pruneSelection(selection, garden()))).toBe("entity:lamp,entity:table#top");
  });
});
