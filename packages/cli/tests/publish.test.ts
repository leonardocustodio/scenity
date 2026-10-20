// SPDX-License-Identifier: Apache-2.0
// `scenity publish`: the ZIP archive of a folder and the release gate. The system unzip reads the archive, and the
// same folder gives the same bytes. A failed release gate stops the publish and gives its reasons.
import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPublishCommand } from "../src/publish/command";
import { folderEntries, zipBytes } from "../src/publish/zip";

const SHOWROOM = join(import.meta.dir, "../../../samples/showroom");
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "scenity-publish-"));
  dirs.push(dir);
  return dir;
}

describe("scenity publish", () => {
  test("a folder as a ZIP archive that unzip reads, with the same bytes each time", () => {
    const dir = temp();
    mkdirSync(join(dir, "site/player"), { recursive: true });
    writeFileSync(join(dir, "site/index.html"), "<scenity-player></scenity-player>\n");
    writeFileSync(join(dir, "site/player/element.js"), "export {};\n".repeat(50));
    const bytes = zipBytes(folderEntries(join(dir, "site")));
    expect(zipBytes(folderEntries(join(dir, "site")))).toEqual(bytes);
    writeFileSync(join(dir, "site.zip"), bytes);
    const listed = Bun.spawnSync(["unzip", "-l", join(dir, "site.zip")]).stdout.toString();
    expect(listed).toContain("index.html");
    expect(listed).toContain("player/element.js");
    const tested = Bun.spawnSync(["unzip", "-t", join(dir, "site.zip")]);
    expect(tested.exitCode).toBe(0);
  });

  test("a failed release gate stops the publish and gives its reasons", async () => {
    const dir = temp();
    for (const part of ["assets", "build", "rights", "scenes", "scenity.project.json"]) {
      cpSync(join(SHOWROOM, part), join(dir, part), { recursive: true });
    }
    mkdirSync(join(dir, "dist"));
    writeFileSync(join(dir, "dist/index.html"), "<scenity-player></scenity-player>\n");
    const passed = await runPublishCommand([dir, "--json"]);
    expect(passed.code).toBe(0);
    const report = JSON.parse(passed.out[0] ?? "{}") as { archive: string; files: number };
    expect(existsSync(report.archive)).toBe(true);
    expect(report.files).toBe(1);
    // The project accepts no licence, so the gate stops each asset.
    const projectFile = join(dir, "scenity.project.json");
    const project = JSON.parse(readFileSync(projectFile, "utf8")) as { release: { licences: { allow: string[] } } };
    project.release.licences.allow = [];
    writeFileSync(projectFile, JSON.stringify(project));
    const stopped = await runPublishCommand([dir, "--json", "--out", join(dir, "stopped.zip")]);
    expect(stopped.code).toBe(1);
    const reasons = (JSON.parse(stopped.out[0] ?? "{}") as { reasons: string[] }).reasons;
    expect(reasons.length).toBeGreaterThan(0);
    expect(existsSync(join(dir, "stopped.zip"))).toBe(false);
  });
});
