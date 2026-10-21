// SPDX-License-Identifier: Apache-2.0
/**
 * The runtime of the host: the source files or a compiled binary.
 *
 * A shell can start a compiled host (`bun build --compile` of main.ts). A compiled host has its modules in the binary
 * (`/$bunfs/…`), and `process.execPath` is the binary, not `bun`. The children of the host still run from the source
 * files with `bun`: the Vite servers, the MCP proxy (mcp.ts), the runs, the setups and a second host. This module gives
 * the paths for both cases:
 *
 * - from the source files (`bun main.ts`, the browser path): `bun` is `process.execPath`, a source file is next to this
 *   module;
 * - compiled: `bun` is `SCENITY_WORKBENCH_BUN` (the shell sets it) or the `bun` of the `PATH`; the source folder is
 *   `SCENITY_WORKBENCH_HOST_SRC`. The shell must set it.
 *
 * The supervisor starts a new worker from the source files when a source file is newer than the binary. Thus a
 * change of the host code by Claude takes effect at the restart.
 */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The source folder of the host for a compiled host (the shell sets it). */
export const HOST_SOURCE_ENV = "SCENITY_WORKBENCH_HOST_SRC";
/** The `bun` program for a compiled host (the shell sets it). */
export const BUN_ENV = "SCENITY_WORKBENCH_BUN";
/** The input list of the compiled host (one absolute path per line), next to the binary. */
export const INPUTS_SUFFIX = ".inputs";

/** True when the main module runs from a `bun build --compile` binary. */
export function isCompiled(main: string = Bun.main): boolean {
  return main.startsWith("/$bunfs/") || main.startsWith("B:/~BUN/");
}

/** The `bun` program for the children of the host. */
export function bunPath(env: Readonly<Record<string, string | undefined>> = process.env): string {
  if (!isCompiled()) return process.execPath;
  return env[BUN_ENV] ?? Bun.which("bun") ?? "bun";
}

/**
 * The source folder of the host (`packages/workbench-host/src`). A compiled host reads it from
 * `SCENITY_WORKBENCH_HOST_SRC` and stops with an error without it.
 */
export function hostSourceDir(env: Readonly<Record<string, string | undefined>> = process.env): string {
  if (!isCompiled()) return dirname(fileURLToPath(import.meta.url));
  const dir = env[HOST_SOURCE_ENV];
  if (dir !== undefined && dir !== "") return dir;
  throw new Error(`A compiled host needs ${HOST_SOURCE_ENV}: the folder of the source files of the host.`);
}

/** A source file of the host, for a child process (`mcp.ts`, `main.ts`). */
export function hostSourceFile(name: string): string {
  return join(hostSourceDir(), name);
}

/** The command of a host process (a worker of the supervisor, a second host): the binary, or `bun main.ts`. */
export function hostCommand(main: string = hostSourceFile("main.ts")): string[] {
  return isCompiled() ? [process.execPath] : [process.execPath, main];
}

/**
 * Why a compiled host is older than its sources, or null when it is fresh. The input list comes from the build
 * (`bun build --metafile`); a missing input or an input newer than the binary makes it stale.
 */
export function staleReason(binary: string): string | null {
  let built: number;
  let list: string;
  try {
    built = statSync(binary).mtimeMs;
    list = readFileSync(`${binary}${INPUTS_SUFFIX}`, "utf8");
  } catch {
    return "no input list";
  }
  for (const line of list.split("\n").map((item) => item.trim())) {
    if (line === "") continue;
    try {
      if (statSync(line).mtimeMs > built) return `${line} is newer than the binary`;
    } catch {
      return `${line} is missing`;
    }
  }
  return null;
}

/** The command of a new worker: the binary when it is fresh, else `bun main.ts` from the source files. */
export function workerCommand(log: (line: string) => void = () => undefined): string[] {
  if (!isCompiled()) return hostCommand();
  const stale = staleReason(process.execPath);
  if (stale === null) return [process.execPath];
  log(`workbench host: the compiled host is stale (${stale}); the worker runs from the source files`);
  return [bunPath(), hostSourceFile("main.ts")];
}

/**
 * The Claude Code binary of the Agent SDK for a compiled host. The SDK finds its native binary next to its own module,
 * and a compiled host has no such folder. The platform package of the SDK in `node_modules` has it. From the source
 * files, the SDK finds it itself (an empty result).
 */
export function claudeExecutableOption(): { pathToClaudeCodeExecutable?: string } {
  if (!isCompiled()) return {};
  const path = claudeExecutableIn(join(hostSourceDir(), ".."));
  return path === null ? {} : { pathToClaudeCodeExecutable: path };
}

/**
 * The Claude Code binary of the SDK in the `node_modules` of a package folder. A compiled binary does not resolve
 * packages on the disk, so this follows the layout of Bun: the platform package is next to the real folder of the SDK.
 */
export function claudeExecutableIn(packageDir: string): string | null {
  const suffix = process.platform === "win32" ? ".exe" : "";
  try {
    const sdk = realpathSync(join(packageDir, "node_modules", "@anthropic-ai", "claude-agent-sdk"));
    const binary = join(dirname(sdk), `claude-agent-sdk-${process.platform}-${process.arch}`, `claude${suffix}`);
    return existsSync(binary) ? binary : null;
  } catch {
    return null;
  }
}
