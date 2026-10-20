// SPDX-License-Identifier: Apache-2.0
// The doctor of the studio: each check finds its tool, and a missing or old tool gets its fix (a command of the studio
// or a page of the docs). Fakes replace the tools.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blenderCheck, bunCheck, chromiumCheck, claudeCheck, compareVersions, runDoctor } from "../src/doctor";

describe("the doctor", () => {
  test("compares versions", () => {
    expect(compareVersions("1.4.2", "1.4.2")).toBe(0);
    expect(compareVersions("1.10.0", "1.4.2")).toBe(1);
    expect(compareVersions("5.1", "5.2")).toBe(-1);
  });

  test("an old Bun gets the install page", () => {
    expect(bunCheck("1.4.2")).toMatchObject({ state: "ok", fix: null });
    expect(bunCheck("1.3.0")).toMatchObject({ state: "warn", fix: { kind: "docs", url: "https://bun.sh" } });
  });

  test("Blender: missing, old or right", () => {
    expect(blenderCheck(null)).toMatchObject({ state: "missing", fix: { kind: "docs" } });
    expect(blenderCheck("/fake/blender", () => "Blender 4.5.1")).toMatchObject({
      state: "warn",
      fix: { kind: "docs" },
    });
    expect(blenderCheck("/fake/blender", () => "Blender 5.2.0\nbuild")).toMatchObject({ state: "ok", fix: null });
  });

  test("a missing Chromium gets the install command", () => {
    const app = mkdtempSync(join(tmpdir(), "doctor-app-"));
    writeFileSync(join(app, "package.json"), "{}");
    try {
      expect(chromiumCheck(null)).toMatchObject({
        state: "missing",
        fix: { kind: "command", job: "fix.chromium", cmd: ["bunx", "playwright", "install", "chromium"] },
      });
      expect(chromiumCheck(app)).toMatchObject({ state: "missing", fix: { kind: "command" } });
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  });

  test("Claude: the command or an API key", () => {
    expect(claudeCheck({}, null)).toMatchObject({ state: "warn", fix: { kind: "docs" } });
    expect(claudeCheck({ ANTHROPIC_API_KEY: "k" }, null)).toMatchObject({ state: "ok" });
    expect(claudeCheck({}, "2.1.302 (Claude Code)")).toMatchObject({ state: "ok", detail: "2.1.302 (Claude Code)" });
  });

  test("runs every check on this machine", () => {
    expect(runDoctor(null).map((check) => check.id)).toEqual(["bun", "git", "blender", "chromium", "claude"]);
  });
});
