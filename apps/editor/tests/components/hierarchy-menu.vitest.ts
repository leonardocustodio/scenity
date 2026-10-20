// SPDX-License-Identifier: Apache-2.0
// The context menu of the hierarchy with the items of the plugins (the `menus` point of a studio face). A row item runs
// its command with the entity of the row.
import { afterEach, describe, expect, it } from "vitest";
import { menuItems, PLUGIN_MENU_ITEMS } from "../../src/scene/hierarchy/hierarchyState";

afterEach(() => {
  PLUGIN_MENU_ITEMS.splice(0);
});

describe("the context menu of the hierarchy", () => {
  it("has the items of the plugins after the core items", () => {
    PLUGIN_MENU_ITEMS.push({ menu: "hierarchy", command: "hello.wheel", label: "Make a wheel" });
    PLUGIN_MENU_ITEMS.push({ menu: "hierarchy.empty", command: "hello.road", label: "Add a road" });
    const row = menuItems("car");
    expect(row.at(-1)).toEqual({
      key: "plugin:hello.wheel",
      label: "Make a wheel",
      command: "hello.wheel",
      args: { entity: "car" },
    });
    expect(row.some((item) => item.command === "hello.road")).toBe(false);
    const empty = menuItems(null);
    expect(empty.at(-1)).toMatchObject({ command: "hello.road", args: {} });
  });
});
