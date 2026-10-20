// SPDX-License-Identifier: Apache-2.0
// The source paths of the module check of the marker gate: a worker bundle names its sources from the output folder of
// the player package, and a virtual module of Vite is not a file of a package.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { engineMarkers, scanModules } from "../src/build/markers";
import { packageDir } from "../src/vite/resolve";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function build(sources: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "scenity-markers-"));
  dirs.push(dir);
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "assets/sceneWorker-x.js.map"), JSON.stringify({ version: 3, sources, mappings: "" }));
  return dir;
}

describe("the module check of the marker gate", () => {
  const { modules } = engineMarkers();
  const base = join(packageDir("@scenity/player", import.meta.dir), "dist", "assets");

  test("reads the sources of a worker bundle from the output folder of the player package", () => {
    const dir = build(["../../../runtime/src/plugins/define.ts", "../../__vite-browser-external"]);
    expect(scanModules(dir, modules, [], [base])).toEqual([]);
    // With no base the relative path does not resolve, and the gate takes it for a folder `plugins`.
    expect(scanModules(dir, modules).map((item) => item.module.id)).toContain("plugins");
  });

  test("still finds a dev module of the editor", () => {
    const dir = build(["../../../../apps/editor/src/scene/main.ts"]);
    expect(scanModules(dir, modules, [], [base]).map((item) => item.module.id)).toContain("apps");
  });
});
