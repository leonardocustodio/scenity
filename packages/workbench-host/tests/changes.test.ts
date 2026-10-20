// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the requests of the change loop: the tune text from the lab, and
 * the turns, the undo, the diff and the commit through a host and a fake page.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatTunes, readTunes } from "../src/changes";
import { git } from "../src/exec";
import { startHost } from "../src/host";
import type { Surface } from "../src/surfaces";
import type { TurnSummary } from "../src/protocol";
import { cleanup, fakeCommand, FakePage, makeRepo, tempDir } from "./helpers";
import { scaleTestTimeouts } from "./ciTiming";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const made: string[] = [];
afterAll(() => cleanup(...made));

function fakeSurface(call: () => Promise<unknown>, url: string | null): Surface {
  return { call, state: { url } } as unknown as Surface;
}

describe("the tune values", () => {
  test("the tune text has each finite value with a safe path", () => {
    expect(formatTunes({ "wave.hand.y": -0.004, "wave.depth": 0.05, "bad;path": 1, nan: Number.NaN })).toBe(
      "wave.hand.y:-0.004,wave.depth:0.05",
    );
    expect(formatTunes(null)).toBe("");
  });

  test("the lab gives the values; without an answer the URL of the surface gives them", async () => {
    expect(await readTunes(fakeSurface(() => Promise.resolve({ "a.b": 1 }), null))).toBe("a.b:1");
    const url = "http://127.0.0.1:5400/?take=greet&tune=wave.hand.y:-0.004,x.y:2";
    expect(await readTunes(fakeSurface(() => Promise.reject(new Error("no page")), url))).toBe(
      "wave.hand.y:-0.004,x.y:2",
    );
    expect(await readTunes(fakeSurface(() => Promise.reject(new Error("no page")), null))).toBe("");
  });
});

describe("the change requests through a host", () => {
  test("git.turns, git.diff, git.undoTurn, git.keepTurn and git.commit", async () => {
    const { parent, repo } = await makeRepo();
    const state = tempDir("changes-state");
    made.push(parent, state);
    const host = await startHost({ checkout: repo, stateDir: state, serverCommand: fakeCommand, watch: false });
    const page = await FakePage.open(host.endpoint);
    try {
      await host.turns.beginTurn(repo, "s1", { prompt: "change the readme" });
      writeFileSync(join(repo, "README.md"), "turn one\n");
      writeFileSync(join(repo, "new.txt"), "new\n");
      await host.turns.recordEdits(repo, "s1", [join(repo, "README.md"), join(repo, "new.txt")]);
      const turns = (await page.call("git.turns")) as { turns: TurnSummary[]; files: string[]; proposal: string };
      expect(turns.files).toEqual(["README.md", "new.txt"]);
      expect(turns.proposal).toBe("Change the readme");
      const { patch } = (await page.call("git.diff", { paths: ["README.md"] })) as { patch: string };
      expect(patch).toContain("+turn one");
      const undone = await page.call("git.undoTurn", { session: "s1", turn: 1 });
      expect(undone).toEqual({ restored: ["README.md"], deleted: ["new.txt"], skipped: [] });
      expect(readFileSync(join(repo, "README.md"), "utf8")).toBe("test\n");

      await host.turns.beginTurn(repo, "s1", { prompt: "second" });
      writeFileSync(join(repo, "README.md"), "turn two\n");
      await host.turns.recordEdits(repo, "s1", ["README.md"]);
      await page.call("git.keepTurn", { session: "s1", turn: 2 });
      // The reason of a layout override goes into the proposal until the commit.
      host.turns.notes.add(repo, "the sofa moves next");
      const noted = (await page.call("git.turns")) as { proposal: string };
      expect(noted.proposal).toBe("Second (layout checks overridden: the sofa moves next)");
      const bad = await page.request("git.commit", { message: "Two\nlines", paths: ["README.md"] });
      expect(bad).toMatchObject({ ok: false });
      expect(host.turns.notes.reasons(repo)).toEqual(["the sofa moves next"]);
      const { commit } = (await page.call("git.commit", { message: "Keep turn two", paths: ["README.md"] })) as {
        commit: string;
      };
      expect(await git(repo, ["log", "-1", "--format=%H %s"])).toBe(`${commit} Keep turn two\n`);
      expect(host.turns.notes.reasons(repo)).toEqual([]);
    } finally {
      page.close();
      await host.stop();
    }
  });
});
