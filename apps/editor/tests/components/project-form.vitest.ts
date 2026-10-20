// SPDX-License-Identifier: Apache-2.0
// The form of the Project settings window from the JSON Schema of the project file: the nodes, the checks, the search,
// the edits and the sections.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { documentJsonSchemas } from "@scenity/scene";
import { describe, expect, it } from "vitest";
import {
  checkValue,
  emptyOf,
  optionOf,
  projectNode,
  renameKey,
  searchHit,
  setIn,
  type FormNode,
} from "../../src/scene/projectSettings/projectForm";
import { sectionsOf } from "../../src/scene/projectSettings/projectSections";

const root = projectNode(documentJsonSchemas().project);
const fieldOf = (node: FormNode, name: string): FormNode => {
  if (node.kind !== "object") throw new Error("not an object");
  const field = node.fields.find((item) => item.name === name);
  if (field === undefined) throw new Error(`no field ${name}`);
  return field.node;
};
const showroom = JSON.parse(
  readFileSync(join(__dirname, "../../../../samples/showroom/scenity.project.json"), "utf8"),
) as unknown;

describe("the project form", () => {
  it("has a node for each field of the project file, with no JSON node but the free values", () => {
    expect(fieldOf(root, "scenes")).toMatchObject({ kind: "list", item: { kind: "text" } });
    expect(fieldOf(root, "format")).toEqual({ kind: "const", value: "scenity.project/1" });
    expect(fieldOf(fieldOf(root, "build"), "budgets")).toMatchObject({ kind: "map", value: { kind: "object" } });
    const rule = fieldOf(root, "rules");
    expect(
      rule.kind === "list" && rule.item.kind === "union" ? rule.item.options.map((item) => item.label) : [],
    ).toEqual(["text", "object"]);
    const runs = fieldOf(fieldOf(root, "workbench"), "runs");
    expect(runs.kind === "map" ? runs.value.kind : "").toBe("union");
    // Only the arguments of a rule are free JSON values.
    const json: string[] = [];
    const walk = (node: FormNode, path: string): void => {
      if (node.kind === "json") json.push(path);
      if (node.kind === "object") for (const field of node.fields) walk(field.node, `${path}.${field.name}`);
      if (node.kind === "list") walk(node.item, `${path}[]`);
      if (node.kind === "map") walk(node.value, `${path}{}`);
      if (node.kind === "union") node.options.forEach((option) => walk(option.node, `${path}|${option.label}`));
    };
    walk(root, "");
    expect(json).toEqual([".rules[]|object.args{}"]);
  });

  it("finds no problem in the showroom project and names the problems of a bad value", () => {
    expect(checkValue(root, showroom)).toEqual([]);
    const bad = setIn(setIn(setIn(showroom, ["id"], "Not An Id"), ["units", "assetScale"], 0), ["name"], undefined);
    expect(checkValue(root, bad).map((problem) => `${problem.path} ${problem.id}`)).toEqual([
      "id project-check-pattern",
      "name project-check-required",
      "units.assetScale project-check-above",
    ]);
  });

  it("finds a field by a word of its name, also below another field", () => {
    const build = { name: "build", description: "", node: fieldOf(root, "build") };
    expect(searchHit(build, "build")).toBe("self");
    expect(searchHit(build, "gzip")).toBe("inside");
    expect(searchHit(build, "surfaces")).toBeNull();
  });

  it("edits a copy and keeps the place of each field", () => {
    const value = { a: 1, b: { c: [1, 2, 3] }, d: true };
    expect(setIn(value, ["b", "c", 1], undefined)).toEqual({ a: 1, b: { c: [1, 3] }, d: true });
    expect(Object.keys(setIn(value, ["a"], 5) as object)).toEqual(["a", "b", "d"]);
    expect(Object.keys(setIn(value, ["a"], undefined) as object)).toEqual(["b", "d"]);
    expect(value.b.c).toEqual([1, 2, 3]);
    expect(Object.keys(renameKey({ x: 1, y: 2 }, "x", "z") as object)).toEqual(["z", "y"]);
    expect(renameKey({ x: 1, y: 2 }, "x", "y")).toEqual({ x: 1, y: 2 });
  });

  it("makes new values with the required fields and picks the option of a value", () => {
    const surfaces = fieldOf(fieldOf(root, "workbench"), "surfaces");
    expect(surfaces.kind === "list" ? emptyOf(surfaces.item) : null).toEqual({ id: "", kind: "", label: "" });
    const rule = fieldOf(root, "rules");
    if (rule.kind !== "list" || rule.item.kind !== "union") throw new Error("no rule union");
    expect(optionOf(rule.item, "rules/main.rules.json")).toBe(0);
    expect(optionOf(rule.item, { id: "a", metric: "b", level: "warn" })).toBe(1);
  });

  it("puts each root field into a section", () => {
    const sections = sectionsOf(root);
    expect(sections.map((item) => item.section.id)).toEqual([
      ...["general", "assets", "plugins", "rules", "quality", "build", "release", "workbench", "editor"],
    ]);
    expect(sections.flatMap((item) => item.fields.map((field) => field.name)).sort()).toEqual(
      root.kind === "object" ? root.fields.map((field) => field.name).sort() : [],
    );
  });
});

describe("the project settings of the dev server", () => {
  it("names a missing file of a list and the issues of the reader", async () => {
    const { fileChecks, schemaChecks } = await import("../../scripts/projectSettingsApi");
    const dir = join(__dirname, "../../../../samples/showroom");
    expect(fileChecks(dir, showroom)).toEqual([]);
    const next = (showroom as { scenes: string[] }).scenes.length;
    expect(fileChecks(dir, setIn(showroom, ["scenes", next], "../outside.scene.json"))).toEqual([
      { path: `scenes[${String(next)}]`, kind: "missing", detail: "../outside.scene.json" },
    ]);
    expect(schemaChecks(showroom)).toEqual([]);
    expect(schemaChecks(setIn(showroom, ["id"], "Bad Id")).map((check) => check.path)).toEqual(["id"]);
  });
});
