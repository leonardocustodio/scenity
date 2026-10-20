// SPDX-License-Identifier: Apache-2.0
// The templates as data: a template of a plugin of the checkout (a folder in its package), and a folder outside the
// package that the list does not include. Also a template of the person, with no outputs and no local state.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listTemplates, pluginTemplateList, saveTemplate, templateDir } from "../src/templates";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), "studio-templates-"));
  dirs.push(dir);
  return dir;
}

/** Write files under a folder: each path relative to it. */
function write(dir: string, files: Readonly<Record<string, string>>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
}

const PROJECT = JSON.stringify({ format: "scenity.project/1", id: "crossing", name: "Crossing", scenes: [] });

describe("the templates", () => {
  test("a plugin of the checkout gives the templates of its package; a folder outside it goes", () => {
    const checkout = folder();
    const templates = [
      { id: "crossing", title: "Road crossing", description: "A road.", folder: "templates/crossing" },
      { id: "outside", title: "Outside", folder: "../../../elsewhere" },
    ];
    write(checkout, {
      "plugins/traffic/runtime/package.json": JSON.stringify({ name: "@x/traffic", scenity: { templates } }),
      "plugins/traffic/runtime/templates/crossing/scenity.project.json": PROJECT,
      "plugins/traffic/runtime/templates/crossing/posters/a.webp": "",
      "elsewhere/scenity.project.json": PROJECT,
    });
    const listed = pluginTemplateList(checkout);
    expect(listed).toEqual([
      {
        id: "plugin:@x/traffic/crossing",
        source: "plugin",
        title: "Road crossing",
        description: "A road.",
        dir: join(checkout, "plugins/traffic/runtime/templates/crossing"),
        picture: "posters/a.webp",
      },
    ]);
    expect(pluginTemplateList(null)).toEqual([]);
  });

  test("a project saved as a template has no outputs and no local state; a second save gets a new ID", () => {
    const state = folder();
    const project = folder();
    write(project, {
      "scenity.project.json": PROJECT,
      "package.json": "{}",
      "scenes/main.scene.json": "{}",
      "dist/index.html": "",
      ".scenity/cache/a": "",
      ".scenity/recipes/r.json": "{}",
    });
    const first = saveTemplate(state, project, { title: "My Crossing!", description: "" });
    expect(first.id).toBe("user:my-crossing");
    for (const [path, kept] of [
      ["scenes/main.scene.json", true],
      ["package.json", true],
      [".scenity/recipes/r.json", true],
      ["template.json", true],
      ["dist/index.html", false],
      [".scenity/cache/a", false],
    ] as const) {
      expect([path, existsSync(join(first.dir, path))]).toEqual([path, kept]);
    }
    expect(saveTemplate(state, project, { title: "My Crossing!", description: "" }).id).toBe("user:my-crossing-2");
    expect(listTemplates(state, null).map((template) => template.title)).toEqual(["My Crossing!", "My Crossing!"]);
    expect(templateDir(state, null, "user:my-crossing")).toBe(first.dir);
    expect(templateDir(state, null, "user:none")).toBeNull();
    expect(() => saveTemplate(state, state, { title: "No project", description: "" })).toThrow();
  });
});
