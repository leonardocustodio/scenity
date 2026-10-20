// SPDX-License-Identifier: Apache-2.0
// The metadata of a command and the zod schema of its arguments. The listings give the description, the category, the
// icon, the menu path, the undo kind, the keys and the JSON schema of the arguments. The zod schema accepts and
// refuses the same arguments as `parseArgs`.
import { describe, expect, it } from "bun:test";
import {
  argsJsonSchema,
  argsSchema,
  commandMeta,
  createCommandRegistry,
  parseArgs,
  type ArgSpec,
  type Command,
  type RuleState,
} from "../src/index";

const SPECS: Readonly<Record<string, ArgSpec>> = {
  entity: { type: "string", description: "The entity ID." },
  degrees: { type: "number", description: "The angle.", min: -360, max: 360, default: 0 },
  axis: { type: "string", description: "The axis.", values: ["x", "y", "z"], optional: true },
  local: { type: "boolean", description: "Turn about the local axes.", optional: true },
};

function view(id: string, extra: Partial<Command<RuleState, null, never>> = {}): Command<RuleState, null, never> {
  return {
    id,
    title: `Title of ${id}`,
    key: null,
    kind: "view",
    args: {},
    selection: { kinds: [] },
    build: () => ({ kind: "view", title: id, run: () => null }),
    ...extra,
  };
}

describe("the metadata of a command", () => {
  it("gives the defaults: the title, the first word of the ID, no icon, no menu, the undo kind of the kind", () => {
    expect(commandMeta(view("panel.open.rules"))).toEqual({
      description: "Title of panel.open.rules",
      category: "panel",
      icon: null,
      menu: null,
      undo: "none",
    });
    expect(commandMeta({ ...view("entity.move"), kind: "edit" }).undo).toBe("scene");
  });

  it("lists the metadata, the keys and the JSON schema of the arguments", () => {
    const registry = createCommandRegistry<RuleState, null, never>();
    registry.register([
      view("theme.light", {
        description: "Show the light theme.",
        icon: "sun",
        category: "view",
        menu: "View/Theme/Light",
        keys: ["Mod+K Mod+L"],
        args: SPECS,
      }),
    ]);
    const [listing] = registry.listings({ selection: null });
    expect(listing).toMatchObject({
      description: "Show the light theme.",
      icon: "sun",
      category: "view",
      menu: "View/Theme/Light",
      undo: "none",
      keys: ["Mod+K Mod+L"],
    });
    expect(listing?.schema).toMatchObject({ type: "object", required: ["entity"], additionalProperties: false });
  });
});

describe("the zod schema of the arguments", () => {
  const schema = argsSchema(SPECS);

  it("accepts the arguments that parseArgs accepts, with the same defaults", () => {
    const given = { entity: "table", axis: "y" };
    expect(schema.parse(given)).toEqual(parseArgs(SPECS, given).args);
  });

  it("refuses the arguments that parseArgs refuses", () => {
    for (const given of [
      {},
      { entity: "" },
      { entity: "table", degrees: 400 },
      { entity: "table", axis: "w" },
      { entity: "table", local: "yes" },
      { entity: "table", other: 1 },
    ]) {
      expect(schema.safeParse(given).success).toBe(false);
      expect(parseArgs(SPECS, given).problems.length).toBeGreaterThan(0);
    }
  });

  it("gives the JSON schema with the descriptions and the values", () => {
    const json = argsJsonSchema(SPECS) as { properties: Record<string, Record<string, unknown>> };
    expect(json.properties.degrees).toMatchObject({ type: "number", minimum: -360, maximum: 360, default: 0 });
    expect(json.properties.axis).toMatchObject({ enum: ["x", "y", "z"], description: "The axis." });
    expect(argsJsonSchema(SPECS)).toBe(json);
  });
});
