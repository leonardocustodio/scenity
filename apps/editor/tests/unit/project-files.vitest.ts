// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
// The files of a project for the Project window: the kinds of the entries, and a move of a model folder (its records
// move, the IDs stay, the rights paths follow). Also a rename of a scene (the project file follows), a new folder, and
// the refusals (a path out of the project, a target that is there, a folder into itself).
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { listProjectFiles, makeProjectFolder, moveProjectFile, projectPath } from "../../scripts/projectFiles";
import { revealCommand } from "../../scripts/projectFilesServer";

const SHOWROOM = join(import.meta.dirname, "../../../../samples/showroom");
const LANTERN = "01M4ZPXYG26FPR940EDPJM9FCD";
const temp = mkdtempSync(join(tmpdir(), "scenity-project-files-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

let copies = 0;
function copy(): string {
  copies += 1;
  const dir = join(temp, `showroom-${String(copies)}`);
  cpSync(SHOWROOM, dir, { recursive: true, filter: (source) => !source.includes(".scenity") });
  return dir;
}

describe("the files of a project", () => {
  it("list the folders and the files with their kinds", () => {
    const files = listProjectFiles(copy());
    const kind = (path: string) => files.find((file) => file.path === path)?.kind;
    expect(kind("scenes")).toBe("folder");
    expect(kind("scenes/main.scene.json")).toBe("scene");
    expect(files.find((file) => file.asset === LANTERN)?.path).toBe("assets/sources/Lantern_01/Lantern_01_1k.gltf");
    expect(files.some((file) => file.path.endsWith(".meta.json"))).toBe(false);
    expect(files.some((file) => file.path.startsWith("build/"))).toBe(false);
  });

  it("move a model folder: the records move, the IDs stay, the rights paths follow", () => {
    const dir = copy();
    expect(moveProjectFile(dir, "assets/sources/Lantern_01", "assets/sources/lights/Lantern_01")).toBeNull();
    const record = join(dir, "assets/sources/lights/Lantern_01/Lantern_01_1k.gltf.meta.json");
    const value = JSON.parse(readFileSync(record, "utf8")) as { id: string; rights: string };
    expect(value.id).toBe(LANTERN);
    expect(existsSync(join(dir, "assets/sources/lights/Lantern_01", value.rights))).toBe(true);
    expect(listProjectFiles(dir).find((file) => file.asset === LANTERN)?.path).toBe(
      "assets/sources/lights/Lantern_01/Lantern_01_1k.gltf",
    );
  });

  it("rename a scene: the project file follows; refuse a path out of the project and a target that is there", () => {
    const dir = copy();
    expect(moveProjectFile(dir, "scenes/main.scene.json", "scenes/room.scene.json")).toBeNull();
    const project = JSON.parse(readFileSync(join(dir, "scenity.project.json"), "utf8")) as { scenes: string[] };
    expect(project.scenes).toContain("scenes/room.scene.json");
    expect(project.scenes).not.toContain("scenes/main.scene.json");
    expect(moveProjectFile(dir, "scenes/room.scene.json", "../out.scene.json")).toContain("leaves the project");
    expect(moveProjectFile(dir, "scenes", "scenes/inner")).toContain("into itself");
    expect(makeProjectFolder(dir, "levels")).toBeNull();
    expect(makeProjectFolder(dir, "levels")).toContain("there already");
    expect(moveProjectFile(dir, "scenes/room.scene.json", "levels")).toContain("there already");
    expect(projectPath(dir, "/etc/passwd")).toBeNull();
  });

  it("reveal a file with the file manager of each system", () => {
    expect(revealCommand("/p/a.glb", "darwin")).toEqual(["open", ["-R", "/p/a.glb"]]);
    expect(revealCommand("/p/a.glb", "linux")[0]).toBe("xdg-open");
  });
});
