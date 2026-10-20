// SPDX-License-Identifier: Apache-2.0
/**
 * The command `scenity studio`:
 *
 *   scenity studio [--project <dir>] [--port <n>] [--state <dir>] [--root <dir>]... [--no-open] [--safe]
 *                  [--public-origin <url>]
 *
 * It starts Scenity Studio: the studio host on 127.0.0.1 (default port 5170) with the Hub, every open project and the
 * jobs, and it opens the browser on the Hub (or on the project of `--project`). With a studio on the port already, it
 * opens the browser on that studio. The host is `packages/studio-host` of a checkout, else the installed package
 * `@scenity/studio-host`, else that package at the version of this command through `bun x` (the studio host depends on
 * this package, so this package does not depend on it). The first stdout line is
 * `SCENITY_STUDIO_READY {"origin":…,"url":…}`. The command runs until SIGINT or SIGTERM.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CommandResult } from "../args";
import { checkoutRoot } from "../workspace";

export const STUDIO_USAGE =
  "scenity studio [--project <dir>] [--port <n>] [--state <dir>] [--root <dir>]... [--no-open] [--safe] [--public-origin <url>]";
export const STUDIO_HELP = [
  `usage: ${STUDIO_USAGE}`,
  "Start Scenity Studio and open the browser on the Hub: the projects, a new project, the samples and the setup. With",
  "--project, open that project in the editor. --port: the port of the studio (default 5170); a second run opens the",
  "studio that runs there. --no-open: print the launch link only. --safe: open each project with no plugin code.",
  "--state: the studio state folder. --root: a folder that the folder dialogs show (default: the home folder); the",
  "first one is the default place of a new project. --public-origin: the remote mode behind the gateway of the studio",
  "(the launch links have that origin; no shell; a file write of an agent asks). Ctrl+C stops the studio.",
];

/** The package of the studio host. */
export const STUDIO_HOST = "@scenity/studio-host";

/** The entry of the installed studio host, from the work folder or from this package, or null. */
export function installedStudioEntry(cwd: string = process.cwd()): string | null {
  for (const from of [cwd, import.meta.dir]) {
    try {
      return Bun.resolveSync(STUDIO_HOST, from);
    } catch {
      // Not installed there.
    }
  }
  return null;
}

/** The entry of the studio host: the source of a checkout, else the installed package, or null. */
export function studioEntry(
  checkout: string | null = checkoutRoot(),
  installed: () => string | null = installedStudioEntry,
): string | null {
  if (checkout !== null) {
    const entry = join(checkout, "packages", "studio-host", "src", "main.ts");
    if (existsSync(entry)) return entry;
  }
  return installed();
}

/** The command line of the studio host: its entry, or the package at the version of this command through `bun x`. */
export function studioCommand(entry: string | null, version: string = commandVersion()): string[] {
  return entry === null ? [process.execPath, "x", `${STUDIO_HOST}@${version}`] : [process.execPath, entry];
}

/** The version of this command (its package.json). */
function commandVersion(): string {
  const file = join(import.meta.dir, "..", "..", "package.json");
  return (JSON.parse(readFileSync(file, "utf8")) as { version: string }).version;
}

/** The arguments with the project and root folders made absolute (the host may run in another folder). */
export function studioArgs(argv: readonly string[], cwd: string = process.cwd()): string[] {
  const out = [...argv];
  for (let i = 0; i < out.length; i += 1) {
    const arg = out[i] ?? "";
    for (const flag of ["--project", "--root"]) {
      if (arg === flag && out[i + 1] !== undefined) out[i + 1] = resolve(cwd, out[i + 1] ?? "");
      else if (arg.startsWith(`${flag}=`)) out[i] = `${flag}=${resolve(cwd, arg.slice(flag.length + 1))}`;
    }
  }
  return out;
}

export async function runStudioCommand(argv: readonly string[]): Promise<CommandResult> {
  const [program = process.execPath, ...head] = studioCommand(studioEntry());
  const child = spawn(program, [...head, ...studioArgs(argv)], { stdio: "inherit" });
  const forward = (signal: NodeJS.Signals): void => {
    child.kill(signal);
  };
  process.on("SIGINT", forward);
  process.on("SIGTERM", forward);
  const code = await new Promise<number>((done) => child.on("exit", (exit) => done(exit ?? 1)));
  return { out: [], code };
}
