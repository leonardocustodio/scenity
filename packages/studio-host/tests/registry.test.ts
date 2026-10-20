// SPDX-License-Identifier: Apache-2.0
// The projects of the studio: the registry, the facts of the Hub, "make this folder a project", trust, and the open
// projects with their file for the scene server.
import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenProjects, PROJECTS_FILE_FORMAT } from "../src/openProjects";
import { isNewerFormat, keyOf, makeProject, ProjectRegistry, readProjectDoc } from "../src/registry";
import { UserState } from "../src/userState";

const REPO = join(import.meta.dir, "..", "..", "..");
const dirs: string[] = [];
const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "studio-registry-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(root: string, name: string, doc: Record<string, unknown>): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "scenity.project.json"), JSON.stringify({ format: "scenity.project/1", scenes: [], ...doc }));
  return dir;
}

describe("the project registry", () => {
  test("adds projects with unique keys and lists the pinned first", () => {
    const root = temp();
    const registry = new ProjectRegistry(new UserState(join(root, "state")));
    const a = registry.add(project(root, "a", { id: "Lobby", name: "Lobby" }), new Date("2026-10-01"));
    const b = registry.add(project(root, "b", { id: "lobby", name: "Lobby 2" }), new Date("2026-10-02"));
    expect([a.key, b.key]).toEqual(["lobby", "lobby-2"]);
    expect(registry.list().map((p) => p.key)).toEqual(["lobby-2", "lobby"]);
    registry.pin("lobby", true);
    expect(registry.list().map((p) => p.key)).toEqual(["lobby", "lobby-2"]);
    // A second add keeps the key and the pin.
    expect(registry.add(join(root, "a")).key).toBe("lobby");
    expect(registry.byKey("lobby")?.pinned).toBe(true);
    registry.remove("lobby-2");
    expect(registry.entries().map((e) => e.key)).toEqual(["lobby"]);
  });

  test("refuses a folder with no project file", () => {
    const registry = new ProjectRegistry(new UserState(join(temp(), "state")));
    expect(() => registry.add(temp())).toThrow("has no scenity.project.json");
  });

  test("gives the facts of a sample and the state of a missing folder", () => {
    const root = temp();
    const dir = join(root, "showroom");
    cpSync(join(REPO, "samples", "showroom", "scenity.project.json"), join(dir, "scenity.project.json"));
    cpSync(join(REPO, "samples", "showroom", "posters"), join(dir, "posters"), { recursive: true });
    const registry = new ProjectRegistry(new UserState(join(root, "state")));
    const info = registry.info(registry.add(dir));
    // The showroom lists runs (command lines), so it runs code and needs trust.
    expect(info).toMatchObject({
      exists: true,
      id: "showroom",
      newer: false,
      scenes: 1,
      runsCode: true,
      trusted: false,
    });
    expect(info.picture).toMatch(/^posters\//);
    rmSync(dir, { recursive: true });
    expect(registry.list()[0]).toMatchObject({ exists: false, picture: null, git: null });
  });

  test("marks a project with plugins as code that needs trust, and trusts it", () => {
    const root = temp();
    const dir = project(root, "spin", { id: "spin", name: "Spin", plugins: ["./plugins/demo"] });
    const registry = new ProjectRegistry(new UserState(join(root, "state")));
    const entry = registry.add(dir);
    expect(registry.info(entry)).toMatchObject({ runsCode: true, trusted: false });
    registry.trust(dir);
    expect(registry.info(entry).trusted).toBe(true);
  });

  test("renames a project in its file", () => {
    const root = temp();
    const dir = project(root, "r", { id: "r", name: "Old" });
    const registry = new ProjectRegistry(new UserState(join(root, "state")));
    registry.add(dir);
    registry.rename("r", "New name");
    expect(readProjectDoc(dir)?.name).toBe("New name");
    expect(registry.byKey("r")?.name).toBe("New name");
  });

  test("makes a folder a project with the empty template, once", () => {
    const dir = join(temp(), "My Folder");
    mkdirSync(dir);
    writeFileSync(join(dir, "notes.txt"), "kept");
    makeProject(dir);
    expect(readProjectDoc(dir)).toMatchObject({
      id: "my-folder",
      name: "My Folder",
      scenes: ["scenes/main.scene.json"],
    });
    expect(readFileSync(join(dir, "notes.txt"), "utf8")).toBe("kept");
    expect(() => makeProject(dir)).toThrow("has a scenity.project.json");
  });

  test("knows a newer format and makes keys", () => {
    expect(isNewerFormat("scenity.project/1")).toBe(false);
    expect(isNewerFormat("scenity.project/2")).toBe(true);
    expect(keyOf("My Project_1")).toBe("my-project-1");
    expect(keyOf("---")).toBe("project");
  });
});

describe("the open projects", () => {
  test("write the projects file of the scene server, with the restricted ones as objects", () => {
    const file = join(temp(), "projects.json");
    const open = new OpenProjects(file);
    open.open("lobby", "/work/lobby", false);
    open.open("spin", "/work/spin", true);
    const data = JSON.parse(readFileSync(file, "utf8")) as unknown;
    expect(data).toEqual({
      format: PROJECTS_FILE_FORMAT,
      projects: { lobby: "/work/lobby", spin: { dir: "/work/spin", restricted: true } },
    });
    open.close("spin");
    const after = JSON.parse(readFileSync(file, "utf8")) as { projects: Record<string, unknown> };
    expect(Object.keys(after.projects)).toEqual(["lobby"]);
  });

  test("close after a time with no request", () => {
    let now = 0;
    const open = new OpenProjects(join(temp(), "projects.json"), () => now);
    open.open("a", "/a", false);
    open.open("b", "/b", false);
    now = 50;
    open.touch("a");
    now = 120;
    expect(open.closeIdle(100)).toEqual(["b"]);
    expect(open.list().map((p) => p.key)).toEqual(["a"]);
  });
});
