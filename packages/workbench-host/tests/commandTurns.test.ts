// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the files that a shell command of Claude changes. Claude can edit files with a script in `Bash`. The
 * `PostToolUse` hook of `Bash` names no file. Thus the hooks keep the start time of each command, and the turn store
 * adds the files that changed after it. "Undo the turn" then restores them.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "../src/exec";
import { createTurnLog, handleHook, type HookDeps } from "../src/hooks";
import { TurnStore } from "../src/turns";
import { cleanup, makeRepo, tempDir } from "./helpers";
import { scaleTestTimeouts } from "./ciTiming";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const made: string[] = [];
afterAll(() => cleanup(...made));

describe("the hooks of a shell command", () => {
  const base = { session_id: "s1", cwd: "/repo" };

  test("PostToolUse on Bash gives the host the turn, the command and its start time", async () => {
    const seen: string[] = [];
    let clock = 5_000;
    const deps: HookDeps = {
      packet: () => null,
      turns: createTurnLog(),
      now: () => clock,
      onCommand: (info) => seen.push(`${String(info.turn)} ${info.command} ${String(info.startedMs)}`),
    };
    await handleHook("UserPromptSubmit", base, deps);
    const call = { ...base, tool_name: "Bash", tool_use_id: "t1", tool_input: { command: "python3 edit.py" } };
    expect(await handleHook("PreToolUse", call, deps)).toEqual({});
    clock = 9_000;
    expect(await handleHook("PostToolUse", call, deps)).toEqual({});
    // A second end of the same call has no start time any more.
    await handleHook("PostToolUse", call, deps);
    // A refused command never starts.
    const push = { ...base, tool_name: "Bash", tool_use_id: "t2", tool_input: { command: "git push" } };
    await handleHook("PreToolUse", push, deps);
    await handleHook("PostToolUse", push, deps);
    expect(seen).toEqual(["1 python3 edit.py 5000", "1 python3 edit.py null", "1 git push null"]);
  });
});

async function setup(): Promise<{ repo: string; store: TurnStore }> {
  const { parent, repo } = await makeRepo();
  const state = tempDir("command-turns-state");
  made.push(parent, state);
  for (const name of ["clean.txt", "dirty.txt", "old.txt", "gone.txt"]) writeFileSync(join(repo, name), `${name}\n`);
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "--quiet", "-m", "files"]);
  return { repo, store: new TurnStore({ stateDir: state }) };
}

const write = (repo: string, name: string, text: string): void => writeFileSync(join(repo, name), text);
const read = (repo: string, name: string): string => readFileSync(join(repo, name), "utf8");
/** Give a file a modification time in the past (seconds since 1970). */
const age = (repo: string, name: string, seconds: number): void => utimesSync(join(repo, name), seconds, seconds);

describe("recordCommandChanges", () => {
  test("adds the files that a command changed after its start, and the undo restores them", async () => {
    const { repo, store } = await setup();
    write(repo, "dirty.txt", "dirty before the turn\n");
    write(repo, "old.txt", "changed long ago\n");
    await store.beginTurn(repo, "s1", { prompt: "fix the reach" });
    // An older change of another process: dirty before the command start, so not a file of the command.
    write(repo, "untracked-old.txt", "old\n");
    age(repo, "untracked-old.txt", 1_000);
    age(repo, "old.txt", 1_000);
    const since = Date.now() - 1_000;
    write(repo, "clean.txt", "by the command\n");
    write(repo, "dirty.txt", "by the command\n");
    write(repo, "created.txt", "by the command\n");
    rmSync(join(repo, "gone.txt"));

    const found = await store.recordCommandChanges(repo, "s1", since);
    expect([...(found?.added ?? [])].sort()).toEqual(["clean.txt", "created.txt", "dirty.txt", "gone.txt"]);
    // A second call adds nothing new.
    expect((await store.recordCommandChanges(repo, "s1", since))?.added).toEqual([]);

    const result = await store.undoTurn(repo, "s1", 1);
    expect(result).toEqual({ restored: ["clean.txt", "dirty.txt", "gone.txt"], deleted: ["created.txt"], skipped: [] });
    expect(read(repo, "clean.txt")).toBe("clean.txt\n");
    expect(read(repo, "dirty.txt")).toBe("dirty before the turn\n");
    expect(read(repo, "gone.txt")).toBe("gone.txt\n");
    expect(existsSync(join(repo, "created.txt"))).toBe(false);
    expect(read(repo, "old.txt")).toBe("changed long ago\n");
    expect(read(repo, "untracked-old.txt")).toBe("old\n");
  });

  test("a file with the same content as at the turn start, or no open turn, adds nothing", async () => {
    const { repo, store } = await setup();
    expect(await store.recordCommandChanges(repo, "s1", 0)).toBeNull();
    write(repo, "dirty.txt", "dirty before the turn\n");
    await store.beginTurn(repo, "s1");
    // The command writes the same bytes again: a new time, no change.
    write(repo, "dirty.txt", "dirty before the turn\n");
    expect((await store.recordCommandChanges(repo, "s1", 0))?.added).toEqual([]);
    write(repo, "clean.txt", "edited\n");
    await store.recordEdits(repo, "s1", ["clean.txt"]);
    await store.keepTurn(repo, "s1", 1);
    write(repo, "old.txt", "after the keep\n");
    expect(await store.recordCommandChanges(repo, "s1", 0)).toBeNull();
  });
});
