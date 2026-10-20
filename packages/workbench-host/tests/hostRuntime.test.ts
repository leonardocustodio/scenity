// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the runtime paths of the host (hostRuntime.ts): the source files and `bun` from the sources, and the
 * staleness of a compiled host against its input list. The CLI tests run against a compiled binary with
 * `SCENITY_WORKBENCH_HOST_BIN` (tests/hostProgram.ts).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  bunPath,
  claudeExecutableIn,
  claudeExecutableOption,
  hostCommand,
  hostSourceDir,
  hostSourceFile,
  isCompiled,
  staleReason,
  workerCommand,
} from "../src/hostRuntime";
import { MCP_SCRIPT } from "../src/settings";
import { cleanup, tempDir } from "./helpers";

const folders: string[] = [];
afterAll(() => cleanup(...folders));

describe("the host from the source files", () => {
  test("bun is this process and the source files are next to the module", () => {
    expect(isCompiled()).toBe(false);
    expect(bunPath()).toBe(process.execPath);
    expect(hostSourceDir()).toBe(join(import.meta.dir, "..", "src"));
    expect(existsSync(hostSourceFile("main.ts"))).toBe(true);
    expect(MCP_SCRIPT).toBe(join(import.meta.dir, "..", "src", "mcp.ts"));
    expect(hostCommand("/x/main.ts")).toEqual([process.execPath, "/x/main.ts"]);
    expect(workerCommand()).toEqual([process.execPath, hostSourceFile("main.ts")]);
    expect(claudeExecutableOption()).toEqual({});
  });

  test("the Claude Code binary of the SDK is next to the real folder of the SDK (the layout of Bun)", () => {
    const binary = claudeExecutableIn(join(import.meta.dir, ".."));
    // A machine without the platform package of the SDK (an install without optional packages) gives null.
    if (binary !== null) expect(binary).toEndWith(`claude-agent-sdk-${process.platform}-${process.arch}/claude`);
    expect(claudeExecutableIn(tempDir("no-sdk"))).toBeNull();
  });

  test("a compiled main module has a path of the binary file system", () => {
    expect(isCompiled("/$bunfs/root/workbench-host")).toBe(true);
    expect(isCompiled("/Users/x/main.ts")).toBe(false);
  });
});

describe("the staleness of a compiled host", () => {
  test("fresh while no input is newer; stale after an edit, a missing input or without a list", () => {
    const dir = tempDir("host-runtime");
    folders.push(dir);
    const binary = join(dir, "workbench-host");
    const input = join(dir, "main.ts");
    writeFileSync(binary, "binary");
    writeFileSync(input, "source");
    expect(staleReason(binary)).toBe("no input list");
    writeFileSync(`${binary}.inputs`, `${input}\n`);
    const now = Date.now() / 1000;
    utimesSync(input, now - 60, now - 60);
    utimesSync(binary, now, now);
    expect(staleReason(binary)).toBeNull();
    utimesSync(input, now + 5, now + 5);
    expect(staleReason(binary)).toContain("is newer than the binary");
    writeFileSync(`${binary}.inputs`, `${join(dir, "gone.ts")}\n`);
    expect(staleReason(binary)).toContain("is missing");
  });
});
