// SPDX-License-Identifier: Apache-2.0
// The command kit and its registry. `defineCommand` checks a command. The registry keeps the order of the palette,
// refuses a second ID, checks the arguments and the selection rule, and lists what can run in the current state.
import { describe, expect, it } from "bun:test";
import {
  CommandError,
  createCommandRegistry,
  defineCommand,
  grid,
  parseArgs,
  rulePasses,
  ruleText,
  type EditOp,
} from "../src/index";
import { FIXTURE_COMMANDS, fixtureEditor, type FixtureHost, type FixtureState } from "./helpers";

describe("the command kit", () => {
  it("defines a command and refuses an ID that is not dot-separated words", () => {
    const command = FIXTURE_COMMANDS[0];
    expect(command?.id).toBe("entity.move");
    expect(() =>
      defineCommand({
        id: "Bad id",
        title: "t",
        key: null,
        kind: "view",
        args: {},
        selection: { kinds: [] },
        build: () => ({ kind: "view", title: "t", run: () => null }),
      }),
    ).toThrow("dot-separated words");
  });

  it("checks the arguments: the defaults, the types, the limits and the unknown names", () => {
    const specs = FIXTURE_COMMANDS[0]?.args ?? {};
    expect(parseArgs(specs, { x: 1, z: 2 })).toEqual({ args: { x: 1, y: 0, z: 2 }, problems: [] });
    expect(parseArgs(specs, { x: "a", z: 2, w: 3 }).problems).toEqual([
      'No argument "w" (x, y, z).',
      '"x" is a finite number.',
    ]);
    expect(parseArgs(specs, [1]).problems).toEqual(["The arguments are an object of names and values."]);
    expect(parseArgs({ value: { type: "number", description: "v", min: 0, max: 1 } }, { value: 2 }).problems).toEqual([
      '"value" is at most 1.',
    ]);
  });

  it("tells the selection rule in words and checks it against the selection or the argument", () => {
    expect(ruleText({ kinds: [] })).toBe("no selection");
    expect(ruleText({ kinds: ["entity"], orArg: "entity" })).toBe("a entity selection (or the entity argument)");
    expect(rulePasses({ kinds: ["entity"] }, null)).toBe(false);
    expect(rulePasses({ kinds: ["entity"] }, { kind: "entity", id: "table" })).toBe(true);
    expect(rulePasses({ kinds: ["entity"], orArg: "id" }, null, { id: "bench" })).toBe(true);
    expect(grid(0.123456)).toBe(0.1235);
  });
});

describe("the command registry", () => {
  it("keeps the order of the registration and refuses a second command with the same ID", () => {
    const registry = createCommandRegistry<FixtureState, FixtureHost, EditOp>();
    registry.register(FIXTURE_COMMANDS);
    expect(registry.list().map((command) => command.id)).toEqual([
      "entity.move",
      "entity.rename",
      "light.dim",
      "scene.save",
      "selection.clear",
      "proposal.acceptAll",
    ]);
    expect(() => registry.register(FIXTURE_COMMANDS.slice(0, 1))).toThrow('"entity.move" is registered already');
    registry.clear();
    expect(registry.list()).toEqual([]);
  });

  it("lists what can run now and prepares a command with the words of each problem", () => {
    const editor = fixtureEditor();
    const listings = editor.registry.listings(editor.state(0));
    const move = listings.find((item) => item.id === "entity.move");
    expect(move).toMatchObject({
      available: false,
      reason: "entity.move needs a entity selection.",
      selection: "a entity selection",
    });
    expect(listings.find((item) => item.id === "proposal.acceptAll")).toMatchObject({
      owner: true,
      reason: "No proposal waits.",
    });
    expect(() => editor.registry.prepare("entity.fly", {}, editor.state(0))).toThrow(CommandError);
    expect(() => editor.registry.prepare("entity.move", { x: 1, z: 1 }, editor.state(0))).toThrow(
      "needs a entity selection",
    );
    editor.select("bench");
    const outcome = editor.registry.prepare("entity.move", { x: 1, z: 2 }, editor.state(0));
    expect(outcome).toEqual({
      kind: "edit",
      title: "Move bench",
      ops: [
        { kind: "scene", op: { op: "set", path: "/entities/bench/components/transform/position", value: [1, 0, 2] } },
      ],
    });
  });
});
