// SPDX-License-Identifier: Apache-2.0
// The selection tools. Each tool is a command with a key or a menu entry. The selection history moves back and forward.
// The tests also cover Select by tag, component and kind, Invert and Select children. One clipboard key serves every
// project of the origin.
import { describe, expect, it } from "vitest";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { clipboardKey } from "../../src/scene/pageClipboard";
import {
  descendants,
  entitiesBy,
  SELECTION_HISTORY_MAX,
  SelectionHistory,
  selectionCommands,
} from "../../src/scene/selectionCommands";
import { WindowNotices } from "../../src/studio/shell/dialogs";

const DOC = {
  format: "scenity.scene/1",
  id: "room",
  entities: {
    table: { name: "Table", parent: null, index: 0, tags: ["furniture"], components: { model: {} } },
    lamp: { name: "Lamp", parent: "table", index: 0, components: { light: {} } },
    bulb: { name: "Bulb", parent: "lamp", index: 0, components: {} },
    cam: { name: "Camera", parent: null, index: 1, components: { camera: {} } },
  },
} as unknown as SceneDocument;

function selectionOf(ids: string[] = []) {
  const state = { ids };
  return {
    state,
    port: {
      get ids() {
        return state.ids;
      },
      set: (next: readonly string[]) => {
        state.ids = [...next];
      },
      listen: () => () => undefined,
    },
  };
}

describe("the selection tools", () => {
  it("are commands with a key or a menu entry", () => {
    const { port } = selectionOf();
    const commands = selectionCommands(
      { doc: () => DOC, selection: port, notices: new WindowNotices() },
      new SelectionHistory(),
    );
    expect(commands.map((command) => command.id)).toEqual([
      "selection.all",
      "selection.none",
      "selection.invert",
      "selection.children",
      "selection.back",
      "selection.forward",
      "selection.byTag",
      "selection.byComponent",
      "selection.byKind",
    ]);
    for (const command of commands) expect((command.keys?.length ?? 0) > 0 || command.menu !== undefined).toBe(true);
    expect(commands.every((command) => command.agents === true)).toBe(true);
  });

  it("select all, none, the inverse, the children, and by tag, component and kind", async () => {
    const { state, port } = selectionOf(["table"]);
    const run = async (id: string, args: Record<string, string> = {}) => {
      const commands = selectionCommands(
        { doc: () => DOC, selection: port, notices: new WindowNotices() },
        new SelectionHistory(),
      );
      await commands.find((command) => command.id === id)?.run(args);
      return [...state.ids].sort();
    };
    expect(await run("selection.invert")).toEqual(["bulb", "cam", "lamp"]);
    state.ids = ["table"];
    expect(await run("selection.children")).toEqual(["bulb", "lamp"]);
    expect(await run("selection.all")).toEqual(["bulb", "cam", "lamp", "table"]);
    expect(await run("selection.none")).toEqual([]);
    expect(await run("selection.byTag", { tag: "furniture" })).toEqual(["table"]);
    expect(await run("selection.byComponent", { component: "light" })).toEqual(["lamp"]);
    expect(await run("selection.byKind", { kind: "camera" })).toEqual(["cam"]);
    expect(descendants(DOC, ["lamp"])).toEqual(["bulb"]);
    expect(entitiesBy(DOC, "kind", "unknown")).toEqual([]);
  });

  it("go back and forward in the selection history", () => {
    const history = new SelectionHistory();
    const seen: (readonly string[])[] = [];
    const set = (ids: readonly string[]): void => {
      seen.push(ids);
      history.push(ids);
    };
    history.push(["a"]);
    history.push(["b"]);
    history.push(["b"]);
    history.push(["c"]);
    expect(history.step(-1, set)).toBe(true);
    expect(history.step(-1, set)).toBe(true);
    expect(history.step(-1, set)).toBe(false);
    expect(seen).toEqual([["b"], ["a"]]);
    expect(history.canForward).toBe(true);
    history.step(1, set);
    expect(seen.at(-1)).toEqual(["b"]);
    // A new selection drops the forward steps.
    history.push(["d"]);
    expect(history.canForward).toBe(false);
    for (let at = 0; at < SELECTION_HISTORY_MAX + 10; at += 1) history.push([String(at)]);
    let back = 0;
    while (history.step(-1, () => undefined)) back += 1;
    expect(back).toBe(SELECTION_HISTORY_MAX - 1);
  });

  it("keep one clipboard for every project", () => {
    expect(clipboardKey()).toBe("scenity.scene.clipboard");
  });
});
