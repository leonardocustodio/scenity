// SPDX-License-Identifier: Apache-2.0
/**
 * The calls of the editor core: `inspect`, `command`, `tools`, `tools.call` and `contextLines`. The checks
 * of the arguments and the reads of the results are the same on the frame side and on the caller side.
 */
import { describe, expect, test } from "bun:test";
import {
  COMMAND_CALL,
  COMMANDS_CALL,
  PROPOSAL_MODE_CALL,
  SCENE_PICK_CALL,
  SCENE_QUERY_CALL,
  CONTEXT_LINES_CALL,
  INSPECT_CALL,
  PAGE_TOOL_CALL,
  PAGE_TOOLS_CALL,
  sendBridgeCall,
  serveBridgeCall,
} from "../src/index";

const LAMPS = { name: "scene_lamps", description: "The lamps.", inputSchema: { type: "object" as const } };

describe("the editor calls", () => {
  test("command needs an ID and keeps the other arguments", async () => {
    expect(COMMAND_CALL.args(["prop.turn", { degrees: 15 }, { by: "claude" }])).toEqual([
      "prop.turn",
      { degrees: 15 },
      { by: "claude" },
    ]);
    expect(() => COMMAND_CALL.args([])).toThrow("command: the command ID must be a text.");
    expect(() => COMMAND_CALL.args([" "])).toThrow("command: the command ID must be a text.");
    const sent: unknown[] = [];
    await sendBridgeCall(COMMAND_CALL, (name, args) => Promise.resolve(sent.push([name, args])), "history.undo");
    expect(sent).toEqual([["command", ["history.undo"]]]);
  });

  test("inspect gives an object or null", () => {
    expect(INSPECT_CALL.result({ simMs: 0, entities: [] })).toEqual({ simMs: 0, entities: [] });
    expect(INSPECT_CALL.result(null)).toBeNull();
    expect(() => INSPECT_CALL.result("report")).toThrow("inspect: the frame gave no report.");
  });

  test("tools keeps the valid tools once and drops the bad entries", () => {
    const raw = [LAMPS, { ...LAMPS }, { ...LAMPS, name: "Bad" }, { ...LAMPS, name: "x", inputSchema: {} }, 3];
    expect(PAGE_TOOLS_CALL.result(raw)).toEqual([LAMPS]);
    expect(PAGE_TOOLS_CALL.result(undefined)).toEqual([]);
  });

  test("tools.call checks the name and the input; a text is a result without an error", async () => {
    expect(PAGE_TOOL_CALL.args(["scene_lamps"])).toEqual(["scene_lamps", {}]);
    expect(() => PAGE_TOOL_CALL.args(["Scene Lamps", {}])).toThrow("tools.call: the tool name is not valid.");
    expect(() => PAGE_TOOL_CALL.args(["scene_lamps", [1]])).toThrow("tools.call: the input must be an object.");
    expect(PAGE_TOOL_CALL.result("2 lamps")).toEqual({ text: "2 lamps", isError: false });
    expect(PAGE_TOOL_CALL.result({ text: "no lamp", isError: true })).toEqual({ text: "no lamp", isError: true });
    expect(() => PAGE_TOOL_CALL.result(7)).toThrow("tools.call: the page gave no tool result.");
    const serve = serveBridgeCall(PAGE_TOOL_CALL, (name, input) => ({
      text: `${name} ${JSON.stringify(input)}`,
      isError: false,
    }));
    expect(await serve(["scene_lamps", { on: true }])).toEqual({ text: 'scene_lamps {"on":true}', isError: false });
  });

  test("contextLines keeps the texts of a list", () => {
    expect(CONTEXT_LINES_CALL.result(["a", 1, "b"])).toEqual(["a", "b"]);
    expect(CONTEXT_LINES_CALL.result(null)).toEqual([]);
  });
});

describe("the scene calls", () => {
  test("scene.query checks the query fields and reads the answer", () => {
    expect(SCENE_QUERY_CALL.args([])).toEqual([{}]);
    const query = { where: "tag:furniture", ids: ["bench"], values: ["light"], limit: 5 };
    expect(SCENE_QUERY_CALL.args([query])).toEqual([query]);
    expect(() => SCENE_QUERY_CALL.args([[1]])).toThrow("scene.query: the query must be an object.");
    expect(() => SCENE_QUERY_CALL.args([{ colour: "red" }])).toThrow('scene.query: no field "colour".');
    expect(() => SCENE_QUERY_CALL.args([{ name: 3 }])).toThrow("scene.query: name is a text.");
    expect(() => SCENE_QUERY_CALL.args([{ ids: [1] }])).toThrow("scene.query: ids is a list of texts.");
    expect(() => SCENE_QUERY_CALL.args([{ limit: 0 }])).toThrow("scene.query: limit is a whole number from 1 to 500.");
    expect(SCENE_QUERY_CALL.result({ matches: 0, total: 3, entities: [] })).toEqual({
      matches: 0,
      total: 3,
      entities: [],
    });
    expect(() => SCENE_QUERY_CALL.result(null)).toThrow("scene.query: the page gave no query result.");
  });

  test("commands keeps the entries with an ID; proposalMode is propose unless the page says apply", () => {
    const move = { id: "entity.move", title: "Move", key: null, kind: "edit", args: {}, selection: "x" };
    expect(COMMANDS_CALL.result([move, { title: "no ID" }, 4])).toEqual([move] as never);
    expect(() => COMMANDS_CALL.result({})).toThrow("commands: the page gave no command list.");
    expect(PROPOSAL_MODE_CALL.result("apply")).toBe("apply");
    expect(PROPOSAL_MODE_CALL.result(undefined)).toBe("propose");
  });
});

describe("scene.pick", () => {
  test("checks the point and the options and reads a hit or null", () => {
    expect(SCENE_PICK_CALL.args([10, 20])).toEqual([10, 20, {}]);
    expect(SCENE_PICK_CALL.args([1, 2, { sub: ["socket"] }])).toEqual([1, 2, { sub: ["socket"] }]);
    expect(() => SCENE_PICK_CALL.args(["1", 2])).toThrow("scene.pick: the point must be two numbers");
    expect(() => SCENE_PICK_CALL.args([1, 2, { sub: 3 }])).toThrow("scene.pick: sub is true, false or a list");
    const hit = { entity: "table", component: null, sub: "top", point: [0, 0.75, 0], distance: 3 };
    expect(SCENE_PICK_CALL.result(hit)).toEqual(hit);
    expect(SCENE_PICK_CALL.result(null)).toBeNull();
    expect(() => SCENE_PICK_CALL.result({ id: "x" })).toThrow("scene.pick: the page gave no hit.");
  });
});
