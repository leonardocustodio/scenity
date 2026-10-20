// SPDX-License-Identifier: Apache-2.0
/**
 * The editor faces of the project plugins: the resolver finds the editor face and the editor config face, the
 * config faces merge in the order of the project, the generated plugin list and style list name the faces with
 * relative paths, a write changes only a changed file, and the default project comes from the root package.json.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  editorPluginsCode,
  editorStylesCode,
  loadEditorProject,
  mergeEditorConfig,
  writeEditorFiles,
} from "../src/vite/editor";
import { defaultProjectDir } from "../src/vite/resolve";

const temp = realpathSync(mkdtempSync(join(tmpdir(), "scenity-cli-editor-")));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

function put(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** A workspace with a project `shop` and two plugins: `doors` (editor faces) and `lamps` (runtime face only). */
function workspace(): { root: string; project: string } {
  const root = join(temp, "work");
  put(join(root, "package.json"), JSON.stringify({ name: "work", scenity: { project: "projects/shop" } }));
  const project = join(root, "projects", "shop");
  const doc = { format: "scenity.project/1", id: "shop", name: "Shop", scenes: [], plugins: ["./doors", "./lamps"] };
  put(join(project, "scenity.project.json"), JSON.stringify(doc));
  put(join(project, "doors", "package.json"), JSON.stringify({ name: "doors", scenity: { editor: "./src/page.ts" } }));
  put(join(project, "doors", "src", "page.ts"), 'export default { id: "doors" };\n');
  put(join(project, "doors", "doors.css"), ".doors {}\n");
  put(
    join(project, "doors", "editorConfig.ts"),
    [
      'import { join } from "node:path";',
      "export default {",
      '  alias: [{ find: "doors-alias", replacement: "/doors" }],',
      '  proxy: ({ env }) => ({ "/doors": env.DOORS_URL ?? "http://127.0.0.1:1" }),',
      '  fsAllow: ["/doors/data"],',
      '  styles: [join(import.meta.dir, "doors.css")],',
      '  stills: "/doors/stills",',
      "};",
      "",
    ].join("\n"),
  );
  put(join(project, "lamps", "runtime.ts"), 'export default { id: "lamps" };\n');
  return { root, project };
}

describe("the editor faces", () => {
  const { root, project } = workspace();

  test("the default project is the scenity.project field of the root package.json", () => {
    expect(defaultProjectDir(join(root, "apps", "editor"))).toBe(project);
    expect(defaultProjectDir(tmpdir())).toBeNull();
  });

  test("the loader finds the faces and merges the config faces", async () => {
    const editor = await loadEditorProject(project, { env: { DOORS_URL: "http://127.0.0.1:2" }, root });
    expect(editor.plugins.map((plugin) => plugin.editor)).toEqual([join(project, "doors/src/page.ts"), undefined]);
    expect(editor.plugins[0]?.editorConfig).toBe(join(project, "doors/editorConfig.ts"));
    expect(editor.config.alias).toEqual([{ find: "doors-alias", replacement: "/doors" }]);
    expect(editor.config.proxy).toEqual({ "/doors": "http://127.0.0.1:2" });
    expect(editor.config.fsAllow).toEqual(["/doors/data"]);
    expect(editor.config.styles).toEqual([join(project, "doors/doors.css")]);
    expect(editor.config.stills).toBe("/doors/stills");
    expect(editor.config.content).toEqual({ roots: [], manifest: null, excluded: [] });
    expect(editor.config.plugins).toEqual([]);
  });

  test("with no config face the defaults apply", () => {
    const config = mergeEditorConfig([], { env: {}, root }, project);
    expect(config.stills).toBe(join(project, "stills"));
    expect(config.workerPlugins()).toEqual([]);
    expect(config.proxy).toEqual({});
    expect(config.defaultTake).toBeNull();
  });

  test("the default take comes from a config face, else from the first sequence of the project", () => {
    const context = { env: {}, root };
    expect(mergeEditorConfig([], context, project, ["sequences/tour.sequence.json"]).defaultTake).toBe("tour");
    const faces = [{}, { defaultTake: "greet" }, { defaultTake: "parade" }];
    expect(mergeEditorConfig(faces, context, project, ["tour.sequence.json"]).defaultTake).toBe("greet");
  });

  test("the generated files import the faces with relative paths", async () => {
    const editor = await loadEditorProject(project, { env: {}, root });
    const out = join(root, "apps", "editor", "src", "generated");
    const code = editorPluginsCode(editor.plugins, out, project);
    expect(code).toStartWith("// SPDX-License-Identifier: Apache-2.0\n");
    expect(code).toContain('import editor0 from "../../../../projects/shop/doors/src/page.ts";');
    expect(code).toContain("export const editorPlugins = [editor0] as const;");
    expect(code).toContain('export type * from "../../../../projects/shop/doors/src/page.ts";');
    const styles = editorStylesCode(editor.config.styles, out, project);
    expect(styles).toContain('@import "../../../../projects/shop/doors/doors.css";');
    expect(editorPluginsCode([], out, project)).toContain("export const editorPlugins = [] as const;");
    expect(editorPluginsCode([], out, project)).not.toContain("export type *");
  });

  test("a write changes only a changed file", async () => {
    const editor = await loadEditorProject(project, { env: {}, root });
    const out = join(root, "apps", "editor", "src", "generated");
    expect(writeEditorFiles(editor, out).sort()).toEqual(["editorPlugins.ts", "editorStyles.css"]);
    const before = statSync(join(out, "editorPlugins.ts")).mtimeMs;
    expect(writeEditorFiles(editor, out)).toEqual([]);
    expect(statSync(join(out, "editorPlugins.ts")).mtimeMs).toBe(before);
    expect(readFileSync(join(out, "editorStyles.css"), "utf8")).toContain("doors.css");
  });
});
