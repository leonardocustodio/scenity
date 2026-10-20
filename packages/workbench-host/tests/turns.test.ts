// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the turns and their undo in a temporary repository: a clean file, a dirty file, an untracked file and a
 * created file of one turn; other changes stay; the order of two turns; keep; a new store on the same state folder (a
 * host restart); an ignored file; the proposed commit message.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "../src/exec";
import { headCommit } from "../src/git";
import { proposeMessage, TurnStore } from "../src/turns";
import { cleanup, makeRepo, rejectsWith, tempDir } from "./helpers";
import { scaleTestTimeouts } from "./ciTiming";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const made: string[] = [];
afterAll(() => cleanup(...made));

async function setup(): Promise<{ repo: string; state: string; store: TurnStore }> {
  const { parent, repo } = await makeRepo();
  const state = tempDir("turns-state");
  made.push(parent, state);
  for (const name of ["clean.txt", "dirty.txt", "other.txt"]) writeFileSync(join(repo, name), `${name} at HEAD\n`);
  writeFileSync(join(repo, ".gitignore"), "ignored.txt\n");
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "--quiet", "-m", "files"]);
  return { repo, state, store: new TurnStore({ stateDir: state }) };
}

const read = (repo: string, name: string): string => readFileSync(join(repo, name), "utf8");
const write = (repo: string, name: string, text: string): void => writeFileSync(join(repo, name), text);

describe("a turn and its undo", () => {
  test("the undo restores exactly the files of the turn and deletes the files that it created", async () => {
    const { repo, store } = await setup();
    write(repo, "dirty.txt", "dirty before the turn\n");
    write(repo, "untracked.txt", "untracked before the turn\n");
    const begun = await store.beginTurn(repo, "s1", { prompt: "make the hat stay on the head.\nMore words" });
    expect(begun.turn).toBe(1);
    expect(begun.head).toBe((await headCommit(repo)) ?? "");

    // Claude edits four files. The owner edits another file at the same time.
    write(repo, "clean.txt", "edited by Claude\n");
    write(repo, "dirty.txt", "edited by Claude\n");
    write(repo, "untracked.txt", "edited by Claude\n");
    write(repo, "created.txt", "created by Claude\n");
    write(repo, "other.txt", "edited by the owner\n");
    const files = ["clean.txt", "dirty.txt", "untracked.txt", "created.txt"].map((name) => join(repo, name));
    const recorded = await store.recordEdits(repo, "s1", [...files, "/etc/hosts"]);
    expect(recorded?.files).toEqual(["clean.txt", "dirty.txt", "untracked.txt", "created.txt"]);
    // A second edit of a file keeps the base of the first edit.
    write(repo, "clean.txt", "edited twice\n");
    await store.recordEdits(repo, "s1", [join(repo, "clean.txt")]);
    expect(store.turnFiles(repo, "s1")).toEqual(["clean.txt", "dirty.txt", "untracked.txt", "created.txt"]);
    expect(store.proposal(repo)).toBe("Make the hat stay on the head");

    const result = await store.undoTurn(repo, "s1", 1);
    expect(result).toEqual({
      restored: ["clean.txt", "dirty.txt", "untracked.txt"],
      deleted: ["created.txt"],
      skipped: [],
    });
    expect(read(repo, "clean.txt")).toBe("clean.txt at HEAD\n");
    expect(read(repo, "dirty.txt")).toBe("dirty before the turn\n");
    expect(read(repo, "untracked.txt")).toBe("untracked before the turn\n");
    expect(existsSync(join(repo, "created.txt"))).toBe(false);
    expect(read(repo, "other.txt")).toBe("edited by the owner\n");
    expect(store.list(repo)[0]?.state).toBe("undone");
    expect(store.sessionFiles(repo)).toEqual([]);
    await rejectsWith(store.undoTurn(repo, "s1", 1), "only an open turn");
  });

  test("a later turn on the same file must be undone first; each undo goes back one turn", async () => {
    const { repo, store } = await setup();
    await store.beginTurn(repo, "s1", { prompt: "first" });
    write(repo, "clean.txt", "turn 1\n");
    await store.recordEdits(repo, "s1", ["clean.txt"]);
    await store.beginTurn(repo, "s1", { prompt: "second" });
    write(repo, "clean.txt", "turn 2\n");
    await store.recordEdits(repo, "s1", ["clean.txt"]);
    expect(store.list(repo).map((turn) => turn.turn)).toEqual([2, 1]);
    await rejectsWith(store.undoTurn(repo, "s1", 1), "Turn 2 changed the same files");
    await store.undoTurn(repo, "s1", 2);
    expect(read(repo, "clean.txt")).toBe("turn 1\n");
    await store.undoTurn(repo, "s1", 1);
    expect(read(repo, "clean.txt")).toBe("clean.txt at HEAD\n");
  });

  test("keep removes the undo and the saved contents", async () => {
    const { repo, state, store } = await setup();
    await store.beginTurn(repo, "s1");
    write(repo, "clean.txt", "kept\n");
    await store.recordEdits(repo, "s1", ["clean.txt"]);
    await store.keepTurn(repo, "s1", 1);
    await rejectsWith(store.undoTurn(repo, "s1", 1), "is kept");
    expect(store.sessionFiles(repo)).toEqual(["clean.txt"]);
    const blobs = readdirSync(join(state, "turns"))
      .map((folder) => join(state, "turns", folder, "blobs"))
      .flatMap((folder) => (existsSync(folder) ? readdirSync(folder) : []));
    // Only the snapshot of the last turn stays (it has no dirty file here).
    expect(blobs).toEqual([]);
    expect(read(repo, "clean.txt")).toBe("kept\n");
  });

  test("a new store on the same state folder (a host restart) undoes a turn of the old store", async () => {
    const { repo, state, store } = await setup();
    await store.beginTurn(repo, "s1", { turn: 1 });
    write(repo, "dirty.txt", "edited\n");
    await store.recordEdits(repo, "s1", ["dirty.txt"]);
    const again = new TurnStore({ stateDir: state });
    // The hooks count from 1 again after a restart; the store gives the next free number.
    expect((await again.beginTurn(repo, "s1", { turn: 1 })).turn).toBe(2);
    await again.undoTurn(repo, "s1", 1);
    expect(read(repo, "dirty.txt")).toBe("dirty.txt at HEAD\n");
  });

  test("an ignored file and an edit without a turn start are skipped, not deleted", async () => {
    const { repo, store } = await setup();
    write(repo, "ignored.txt", "the owner's file\n");
    await store.recordEdits(repo, "s9", ["clean.txt"]);
    await store.recordEdits(repo, "s9", ["ignored.txt"]);
    write(repo, "ignored.txt", "edited\n");
    const result = await store.undoTurn(repo, "s9", 1);
    expect(result.restored).toEqual([]);
    expect(result.skipped).toEqual([
      "clean.txt (the edit came before the turn start)",
      "ignored.txt (Git ignores the file; no copy exists)",
    ]);
    expect(read(repo, "ignored.txt")).toBe("edited\n");
  });

  test("the session start is the HEAD commit at the open", async () => {
    const { repo, store } = await setup();
    expect(store.start(repo)).toBeNull();
    expect(await store.recordStart(repo)).toBe((await headCommit(repo)) ?? "");
    expect(store.start(repo)).toBe((await headCommit(repo)) ?? "");
  });
});

describe("the proposed message", () => {
  test("it is the first line, at most 72 characters, with a capital letter", () => {
    expect(proposeMessage("\n  fix the hand of Jo.  \nmore")).toBe("Fix the hand of Jo");
    const long = proposeMessage(`make ${"word ".repeat(30)}`);
    expect(long.length).toBeLessThanOrEqual(72);
    expect(long.endsWith(" ")).toBe(false);
  });
});
