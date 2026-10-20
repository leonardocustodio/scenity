// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the notes of the commit message proposal. The reason of a layout override of "Save placement" goes into
 * the proposal of the Changes tab, as one subject line of at most 200 characters. A real apply that passed keeps the
 * reason, and a dry run does not. A commit clears it.
 */
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { CommitNotes, PLACEMENT_SUBJECT, SUBJECT_MAX, withOverrides } from "../src/commitNotes";
import { checkSubject } from "../src/git";
import { useHostPlugins } from "../src/plugins";
import type { RunResult } from "../src/runs";
import { RUNTIME_GATES_LINE, runPlacement, type SceneEditDeps } from "../src/sceneEdit";
import { TurnStore } from "../src/turns";
import { cleanup, tempDir } from "./helpers";

const made: string[] = [];
afterAll(() => cleanup(...made));
afterEach(() => useHostPlugins(null));

/** A fake plugin that lets the prop places pass a placement. */
const PROPS_PLUGIN = {
  id: "demo",
  tools: [],
  contextLines: {},
  runs: { commands: {} },
  paths: { placement: [/^room\.props\.[a-z_]+\.(at\.[012]|yaw)$/] },
};

function stateDir(): string {
  const dir = tempDir("commit-notes");
  made.push(dir);
  return dir;
}

/** The parts of the host for a placement: one run that passes (or fails) with a line of the dry run. */
function deps(status: string, notes: string[]): SceneEditDeps {
  return {
    terminals: { claudeTerminals: () => [], input: () => undefined },
    chat: { live: () => [], get: () => ({ prompt: () => undefined }) },
    runs: {
      start: (_checkout, _command, _args, options) => {
        options?.onOutput?.("stdout", "model/room.ts:278  room.props.lamp.at.0  1.31 → 1.2\n");
        return { run: "r1", done: Promise.resolve({ status, summary: "" } as RunResult) };
      },
    },
    current: () => "/checkout",
    lab: () => ({ call: () => Promise.resolve(null) }),
    noteOverride: (reason) => notes.push(reason),
  };
}

describe("the commit message proposal with the override reasons", () => {
  test("ends with the reasons, one line, at most 200 characters, and a valid commit message", () => {
    expect(withOverrides("Move the lamp stand", [])).toBe("Move the lamp stand");
    const one = withOverrides("Move the lamp stand", ["the sofa moves\nnext"]);
    expect(one).toBe("Move the lamp stand (layout checks overridden: the sofa moves next)");
    expect(() => checkSubject(one)).not.toThrow();
    expect(withOverrides("", ["a reason"])).toBe(`${PLACEMENT_SUBJECT} (layout checks overridden: a reason)`);
    const long = withOverrides("Move the lamp stand", ["x".repeat(300)]);
    expect(long.length).toBe(SUBJECT_MAX);
    expect(long.endsWith("…)")).toBe(true);
    expect(() => checkSubject(long)).not.toThrow();
  });

  test("the store keeps each reason once per checkout, and a commit clears them", () => {
    const notes = new CommitNotes(stateDir());
    notes.add("/a", " the sofa moves next ");
    notes.add("/a", "the sofa moves next");
    notes.add("/a", "a second reason");
    notes.add("/b", "other checkout");
    notes.add("/a", "  ");
    expect(notes.reasons("/a")).toEqual(["the sofa moves next", "a second reason"]);
    notes.clear("/a");
    expect(notes.reasons("/a")).toEqual([]);
    expect(notes.reasons("/b")).toEqual(["other checkout"]);
  });

  test("the proposal of the turns has the reasons; a new store on the same folder keeps them", () => {
    const dir = stateDir();
    const store = new TurnStore({ stateDir: dir });
    store.notes.add("/repo", "the walkway is narrow for one change");
    expect(store.proposal("/repo")).toBe(
      `${PLACEMENT_SUBJECT} (layout checks overridden: the walkway is narrow for one change)`,
    );
    expect(new TurnStore({ stateDir: dir }).proposal("/repo")).toContain("the walkway is narrow");
  });

  test("a real apply that passed keeps the reason and lists the runtime gates; a dry run or a failure does not", async () => {
    useHostPlugins([PROPS_PLUGIN]);
    const notes: string[] = [];
    const dry = await runPlacement(deps("passed", notes), "room.props.lamp.at.0:1.2", true, "why");
    expect(notes).toEqual([]);
    expect(dry.output).not.toContain(RUNTIME_GATES_LINE);
    const failed = await runPlacement(deps("failed", notes), "room.props.lamp.at.0:1.2", false, "why");
    expect(notes).toEqual([]);
    expect(failed.output).not.toContain(RUNTIME_GATES_LINE);
    const real = await runPlacement(deps("passed", notes), "room.props.lamp.at.0:1.2", false, "the sofa moves next");
    expect(notes).toEqual(["the sofa moves next"]);
    expect(real.output.split("\n")).toEqual([
      "Layout checks overridden: the sofa moves next (the commit message proposal has this reason).",
      "model/room.ts:278  room.props.lamp.at.0  1.31 → 1.2",
      RUNTIME_GATES_LINE,
    ]);
    // Without a reason: the gates, no note.
    await runPlacement(deps("passed", notes), "room.props.lamp.at.0:1.2", false);
    expect(notes).toHaveLength(1);
  });
});
