// SPDX-License-Identifier: Apache-2.0 The entity tree of the hierarchy panel on the generic garden scene: the rows in
// tree order, the collapsed parents, the search by name, tag or component, the row range of a Shift-click and the drop
// places of a drag.
import { describe, expect, it } from "bun:test";
import {
  canParent,
  dropTarget,
  rowRange,
  searchEntities,
  searchTerms,
  topEntities,
  treeOrder,
  treeRows,
} from "../src/index";
import { garden } from "./helpers";

describe("the entity tree", () => {
  it("gives the rows in tree order with their depth, and hides the children of a collapsed parent", () => {
    const doc = garden();
    const rows = treeRows(doc);
    expect(rows.map((row) => [row.id, row.depth, row.children, row.expanded])).toEqual([
      ["table", 0, 1, true],
      ["lamp", 1, 0, false],
      ["bench", 0, 0, false],
      ["sun", 0, 0, false],
    ]);
    expect(rows[0]?.label).toBe("Table");
    expect(treeRows(doc, { collapsed: new Set(["table"]) }).map((row) => row.id)).toEqual(["table", "bench", "sun"]);
    expect(treeOrder(doc)).toEqual(["table", "lamp", "bench", "sun"]);
  });

  it("searches by name, ID, tag or component, and shows the ancestors of a match", () => {
    const doc = garden();
    expect(searchTerms("Tag:Furniture  c:light lamp")).toEqual([
      { field: "tag", text: "furniture" },
      { field: "component", text: "light" },
      { field: "any", text: "lamp" },
    ]);
    expect(searchEntities(doc, "tag:furniture")).toEqual(["table", "bench"]);
    expect(searchEntities(doc, "component:light")).toEqual(["lamp", "sun"]);
    expect(searchEntities(doc, "socket")).toEqual(["table", "bench"]);
    expect(searchEntities(doc, "name:sun")).toEqual(["sun"]);
    expect(searchEntities(doc, "c:light name:lamp")).toEqual(["lamp"]);
    expect(searchEntities(doc, "  ")).toEqual([]);
    // A search shows each parent of a match, also a collapsed one. The parent is not a match.
    const rows = treeRows(doc, { query: "lamp", collapsed: new Set(["table"]) });
    expect(rows.map((row) => [row.id, row.match])).toEqual([
      ["table", false],
      ["lamp", true],
    ]);
  });

  it("gives the rows of a Shift-click range in the order of the rows", () => {
    const rows = treeRows(garden());
    expect(rowRange(rows, "sun", "lamp")).toEqual(["lamp", "bench", "sun"]);
    expect(rowRange(rows, "gone", "bench")).toEqual(["bench"]);
    expect(rowRange(rows, "table", "gone")).toEqual([]);
  });

  it("gives the drop places of a drag and refuses a cycle", () => {
    const doc = garden();
    expect(dropTarget(doc, ["sun"], "table", "inside")).toEqual({ parent: "table", index: 1 });
    expect(dropTarget(doc, ["sun"], "lamp", "before")).toEqual({ parent: "table", index: 0 });
    expect(dropTarget(doc, ["sun"], "table", "after")).toEqual({ parent: null, index: 1 });
    expect(dropTarget(doc, ["table"], "sun", "after")).toEqual({ parent: null, index: 2 });
    expect(dropTarget(doc, ["lamp"], null, "inside")).toEqual({ parent: null, index: 3 });
    // A parent in the subtree of a moved entity makes a cycle. A row cannot go before itself.
    expect(dropTarget(doc, ["table"], "lamp", "inside")).toBeNull();
    expect(dropTarget(doc, ["table"], "table", "inside")).toBeNull();
    expect(dropTarget(doc, ["bench"], "bench", "before")).toBeNull();
    expect(dropTarget(doc, ["pond"], "table", "inside")).toBeNull();
    expect(canParent(doc, ["table"], "lamp")).toBe(false);
    expect(canParent(doc, ["bench"], "lamp")).toBe(true);
    expect(canParent(doc, ["bench"], "pond")).toBe(false);
  });

  it("keeps only the top entities of a selection, so a subtree moves as one", () => {
    expect(topEntities(garden(), ["lamp", "table", "sun", "pond"])).toEqual(["table", "sun"]);
  });
});
