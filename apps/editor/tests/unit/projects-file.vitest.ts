// SPDX-License-Identifier: Apache-2.0
// The open projects of the studio host on the scene server: the projects file, the merge into
// the project record, and the module of the plugins of a project that came after the start.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mergeProjects, PROJECTS_FILE_FORMAT, readProjectsFile } from "../../scripts/projectsFile";
import { lateProjectPluginsCode, projectPluginsCode, PROJECT_PLUGINS_OF } from "../../scripts/sceneProjectPlugins";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function file(data: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "projects-file-"));
  dirs.push(dir);
  const path = join(dir, "projects.json");
  writeFileSync(path, typeof data === "string" ? data : JSON.stringify(data));
  return path;
}

describe("the projects file of the studio host", () => {
  it("reads the projects with a page name and an absolute folder, and the restricted ones", () => {
    const path = file({
      format: PROJECTS_FILE_FORMAT,
      projects: { lobby: "/work/lobby", spin: { dir: "/work/spin", restricted: true }, "Bad Name": "/x", rel: "x" },
    });
    const data = readProjectsFile(path);
    expect(data.projects).toEqual({ lobby: "/work/lobby", spin: "/work/spin" });
    expect([...data.restricted]).toEqual(["spin"]);
  });

  it("gives no project for a missing file, another format or bad JSON", () => {
    expect(readProjectsFile("/no/such/file.json").projects).toEqual({});
    expect(readProjectsFile(file({ format: "other/1", projects: { a: "/a" } })).projects).toEqual({});
    expect(readProjectsFile(file("{")).projects).toEqual({});
  });

  it("merges into the record and keeps the names that the file does not own", () => {
    const record: Record<string, string> = { showroom: "/samples/showroom" };
    let owned = mergeProjects(record, new Set(), { lobby: "/work/lobby", crossing: "/work/crossing" });
    expect(record).toEqual({ showroom: "/samples/showroom", lobby: "/work/lobby", crossing: "/work/crossing" });
    owned = mergeProjects(record, owned, { lobby: "/work/lobby-2" });
    expect(record).toEqual({ showroom: "/samples/showroom", lobby: "/work/lobby-2" });
    expect([...owned]).toEqual(["lobby"]);
  });
});

describe("the plugins of a project that came after the start", () => {
  it("loads them from a module of its own in dev only", () => {
    const dev = projectPluginsCode({ spin: ["/p/spin/runtime.ts"] }, true);
    expect(dev).toContain(`/@id/__x00__${PROJECT_PLUGINS_OF}`);
    expect(projectPluginsCode({ spin: ["/p/spin/runtime.ts"] })).not.toContain(PROJECT_PLUGINS_OF);
  });

  it("gives the default export of each runtime face", () => {
    const code = lateProjectPluginsCode(["/p/a/runtime.ts", "C:\\p\\b\\runtime.ts"]);
    expect(code).toContain('import("/p/a/runtime.ts")');
    expect(code).toContain('import("C:/p/b/runtime.ts")');
    expect(code).toContain("export default modules.map((module) => module.default);");
  });
});
