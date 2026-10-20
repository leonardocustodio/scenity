// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadProject, overBudget, projectBudget, readDocument, type ProjectFs } from "../src/index";
import { FIXTURES, fixtureText } from "./helpers";

/** A file reader over the fixture folder, as a test double of the file system. */
const fixtureFs: ProjectFs = {
  readText(path) {
    try {
      return Promise.resolve(readFileSync(join(FIXTURES, path), "utf8"));
    } catch {
      return Promise.resolve(undefined);
    }
  },
};

describe("the project document", () => {
  test("an empty project reads", () => {
    const result = readDocument(fixtureText("empty.project.json"), "project");
    expect(result.ok && result.doc).toEqual({ format: "scenity.project/1", id: "empty", name: "Empty", scenes: [] });
  });

  test("the shop-like project reads with its workbench settings", () => {
    const result = readDocument(fixtureText("plugin-project/scenity.project.json"), "project");
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.doc.workbench?.surfaces.map((surface) => surface.kind)).toEqual([
      "scene",
      "web",
      "console",
      "gallery",
    ]);
    expect(result.doc.quality?.budgets?.scene?.high?.triangles).toBe(400000);
    expect(result.doc.workbench?.gate).toBe("gate");
  });

  test("a bad project names the path", () => {
    const text = fixtureText("plugin-project/scenity.project.json").replace('"kind": "web"', '"kind": "w e b"');
    const result = readDocument(text, "project");
    expect(result.ok ? "" : result.errors[0]?.path).toBe("/workbench/surfaces/1/kind");
  });

  test("a surface reads with its capabilities, page, hidden flag and order", () => {
    const surface = { id: "view", kind: "scene", label: "View", capabilities: ["scene", "index"], page: "/a.html?x=1" };
    const text = (extra: object): string =>
      JSON.stringify({
        format: "scenity.project/1",
        id: "p",
        name: "P",
        scenes: [],
        workbench: { surfaces: [{ ...surface, hidden: true, order: 2, ...extra }] },
      });
    const result = readDocument(text({}), "project");
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.doc.workbench?.surfaces[0]).toEqual({ ...surface, hidden: true, order: 2 });
    const twice = readDocument(text({ capabilities: ["scene", "scene"] }), "project");
    expect(twice.ok ? "" : twice.errors[0]?.path).toBe("/workbench/surfaces/0/capabilities");
    const relative = readDocument(text({ page: "a.html" }), "project");
    expect(relative.ok ? "" : relative.errors[0]?.path).toBe("/workbench/surfaces/0/page");
  });

  test("an absolute scene path is refused", () => {
    const result = readDocument('{"format":"scenity.project/1","id":"p","name":"P","scenes":["/etc/main.scene.json"]}');
    expect(result.ok ? "" : result.errors[0]?.path).toBe("/scenes/0");
  });

  test("loadProject reads the scenes relative to the project and reports the missing files", async () => {
    const result = await loadProject("plugin-project", fixtureFs);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.project.id).toBe("shop");
    expect(result.scenes.map((scene) => [scene.path, scene.doc.id])).toEqual([
      ["plugin-project/scenes/main.scene.json", "main"],
    ]);
    expect(result.missing).toEqual(["plugin-project/scenes/workshop_b.scene.json"]);
    expect(result.errors).toEqual([]);
  });

  test("loadProject loads the empty project fixture", async () => {
    const files: Record<string, string> = { "empty/scenity.project.json": fixtureText("empty.project.json") };
    const result = await loadProject("empty", { readText: (path) => files[path] });
    expect(result).toEqual({
      ok: true,
      project: { format: "scenity.project/1", id: "empty", name: "Empty", scenes: [] },
      scenes: [],
      missing: [],
      errors: [],
    });
  });

  test("loadProject of a folder with no project file fails", async () => {
    const result = await loadProject("nowhere", fixtureFs);
    expect(result).toMatchObject({ ok: false, file: "nowhere/scenity.project.json" });
  });

  test("loadProject reports a bad scene file with its path", async () => {
    const files: Record<string, string> = {
      "p/scenity.project.json": '{"format":"scenity.project/1","id":"p","name":"P","scenes":["a.scene.json"]}',
      "p/a.scene.json":
        '{"format":"scenity.scene/1","id":"a","entities":{"x":{"parent":null,"index":3,"components":{}}}}',
    };
    const result = await loadProject("p", { readText: (path) => files[path] });
    expect(result.ok && result.errors).toEqual([
      {
        file: "p/a.scene.json",
        path: "/entities/x/index",
        message: "the index 3 is not 0: the indexes of the roots must be 0..0",
      },
    ]);
  });
});

describe("the budgets of a project", () => {
  const read = readDocument(
    JSON.stringify({
      format: "scenity.project/1",
      id: "budgets",
      name: "Budgets",
      scenes: [],
      quality: { budgets: { scene: { medium: { triangles: 1000, drawCalls: 10 } } } },
    }),
    "project",
  );
  if (!read.ok) throw new Error(JSON.stringify(read.errors));
  const project = read.doc;

  test("projectBudget finds the budget of a group and a tier", () => {
    expect(projectBudget(project, "scene", "medium")).toEqual({ triangles: 1000, drawCalls: 10 });
    expect(projectBudget(project, "scene", "high")).toBeUndefined();
    expect(projectBudget(project, "model", "medium")).toBeUndefined();
  });

  test("overBudget gives each value over its maximum", () => {
    const budget = projectBudget(project, "scene", "medium")!;
    expect(overBudget(budget, { triangles: 900, drawCalls: 10 })).toEqual([]);
    expect(overBudget(budget, { triangles: 1200, drawCalls: 12, bytes: 5 })).toEqual([
      "drawCalls 12 > 10",
      "triangles 1200 > 1000",
    ]);
  });
});
