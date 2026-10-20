// SPDX-License-Identifier: Apache-2.0
/**
 * The doctor of the studio: the tools of the machine that parts of Scenity need, each with its state and a fix.
 * WebGPU is a check of the browser: the Hub page runs it, not the host.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

export type CheckState = "ok" | "warn" | "missing";

/** How to fix a check: a job of the studio (`job` names the job command of jobs.ts), or a page of the docs. */
export type Fix =
  | {
      readonly kind: "command";
      readonly label: string;
      readonly job: string;
      readonly cmd: readonly string[];
      readonly cwd?: string;
    }
  | { readonly kind: "docs"; readonly label: string; readonly url: string };

export interface DoctorCheck {
  readonly id: "bun" | "git" | "blender" | "chromium" | "claude";
  readonly state: CheckState;
  /** What the check found (a version, a path) or what is missing. */
  readonly detail: string;
  /** What needs it. */
  readonly needed: string;
  readonly fix: Fix | null;
}

/** The lowest Bun version of the workspace (`engines.bun` of the root package.json). */
export const BUN_MIN = "1.4.2";
/** The lowest Blender version of the FBX, OBJ and .blend imports. */
export const BLENDER_MIN = "5.2";

/** -1, 0 or 1 for two dotted versions. */
export function compareVersions(a: string, b: string): number {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

function run(cmd: string, args: readonly string[]): string | null {
  const answer = spawnSync(cmd, args, { encoding: "utf8", timeout: 8000 });
  return answer.status === 0 ? answer.stdout.trim() : null;
}

export function bunCheck(version: string = process.versions.bun): DoctorCheck {
  const ok = compareVersions(version, BUN_MIN) >= 0;
  return {
    id: "bun",
    state: ok ? "ok" : "warn",
    detail: `Bun ${version}`,
    needed: "the studio, the CLI and the tests",
    fix: ok ? null : { kind: "docs", label: "Install Bun", url: "https://bun.sh" },
  };
}

export function gitCheck(): DoctorCheck {
  const version = run("git", ["--version"]);
  return {
    id: "git",
    state: version === null ? "missing" : "ok",
    detail: version ?? "no git command",
    needed: "the Git state of a project, the version control panel and agent worktrees",
    fix: version === null ? { kind: "docs", label: "Install Git", url: "https://git-scm.com/downloads" } : null,
  };
}

/** The Blender program: on the PATH, or the app of macOS. */
export function blenderPath(): string | null {
  const which = run("which", ["blender"]);
  if (which !== null && which !== "") return which;
  const app = "/Applications/Blender.app/Contents/MacOS/Blender";
  return existsSync(app) ? app : null;
}

export function blenderCheck(
  path: string | null = blenderPath(),
  versionText: (path: string) => string = (p) => run(p, ["--version"]) ?? "",
): DoctorCheck {
  const docs: Fix = { kind: "docs", label: "Install Blender", url: "https://www.blender.org/download/" };
  if (path === null) {
    return { id: "blender", state: "missing", detail: "no Blender", needed: "FBX, OBJ and .blend imports", fix: docs };
  }
  const version = /Blender (\d+\.\d+)/.exec(versionText(path))?.[1] ?? "0";
  const ok = compareVersions(version, BLENDER_MIN) >= 0;
  return {
    id: "blender",
    state: ok ? "ok" : "warn",
    detail: `Blender ${version} at ${path}`,
    needed: `FBX, OBJ and .blend imports (Blender ${BLENDER_MIN} or later)`,
    fix: ok ? null : docs,
  };
}

/** The Chromium of Playwright, from the editor app (it has @playwright/test). */
export function chromiumCheck(editorApp: string | null): DoctorCheck {
  const needed = "scenity shot, sheet, clip, bench and verify";
  const install: Fix = {
    kind: "command",
    label: "Install Chromium",
    job: "fix.chromium",
    cmd: ["bunx", "playwright", "install", "chromium"],
  };
  if (editorApp === null) return { id: "chromium", state: "missing", detail: "no editor app", needed, fix: install };
  try {
    const require = createRequire(join(editorApp, "package.json"));
    const { chromium } = require("@playwright/test") as { chromium: { executablePath(): string } };
    const path = chromium.executablePath();
    return existsSync(path)
      ? { id: "chromium", state: "ok", detail: path, needed, fix: null }
      : {
          id: "chromium",
          state: "missing",
          detail: "the Playwright Chromium is not installed",
          needed,
          fix: { ...install, cwd: editorApp },
        };
  } catch {
    return { id: "chromium", state: "missing", detail: "no @playwright/test", needed, fix: install };
  }
}

export function claudeCheck(
  env: Readonly<Record<string, string | undefined>> = process.env,
  version: string | null = run("claude", ["--version"]),
): DoctorCheck {
  const key = (env.ANTHROPIC_API_KEY ?? "") !== "";
  const needed = "the Claude Code terminal and external agents (the chat works with a login or an API key)";
  if (version === null && !key) {
    return {
      id: "claude",
      state: "warn",
      detail: "no claude command and no ANTHROPIC_API_KEY",
      needed,
      fix: { kind: "docs", label: "Install Claude Code", url: "https://docs.claude.com/en/docs/claude-code/setup" },
    };
  }
  return { id: "claude", state: "ok", detail: version ?? "ANTHROPIC_API_KEY is set", needed, fix: null };
}

/** All the checks. `editorApp` is the editor app folder (for the Playwright Chromium), or null. */
export function runDoctor(editorApp: string | null): DoctorCheck[] {
  return [bunCheck(), gitCheck(), blenderCheck(), chromiumCheck(editorApp), claudeCheck()];
}
