// SPDX-License-Identifier: Apache-2.0
// The change sets. The proposals of one turn of a session form one change set. Its ops come by entity with their old
// and new values. A person accepts 3 of 5 ops as one step of the history and rejects the other ops. A problem of the
// chosen ops changes nothing.
import { describe, expect, it } from "bun:test";
import type { SceneOp } from "@scenity/scene/schema/entity";
import {
  changeSetsOf,
  createRunner,
  opsByEntity,
  sceneOpEntity,
  sceneOpView,
  type Actor,
  type EditOp,
  type Proposal,
} from "../src/index";
import { cell, fixtureEditor, type FixtureHost, type FixtureState } from "./helpers";

const SESSION: Actor = { kind: "agent", session: "s1", name: "Chairs", colour: "agent-2", turn: 1 };

function scene(op: SceneOp): EditOp {
  return { kind: "scene", op };
}

const entityOf = (op: EditOp): string | null => (op.kind === "scene" ? sceneOpEntity(op.op) : null);

function setup() {
  const editor = fixtureEditor();
  const proposals = cell<readonly Proposal<EditOp>[]>([]);
  const runner = createRunner<FixtureState, FixtureHost, EditOp>({
    registry: editor.registry,
    state: editor.state,
    host: editor.host,
    apply: editor.apply,
    problems: () => [],
    proposals,
    mode: cell("propose"),
    keepMode: () => undefined,
  });
  // One turn: two proposals with five ops on four entities.
  runner.propose(
    {
      title: "Rename the furniture",
      ops: [
        scene({ op: "set", path: "/entities/bench/name", value: "Long bench" }),
        scene({ op: "set", path: "/entities/table/name", value: "Round table" }),
        scene({ op: "set", path: "/entities/bench/components/transform/position", value: [0, 0, 2] }),
      ],
      actor: SESSION,
    },
    "batch",
    {},
    "claude",
  );
  runner.propose(
    {
      title: "Rename the lights",
      ops: [
        scene({ op: "set", path: "/entities/lamp/name", value: "Desk lamp" }),
        scene({ op: "set", path: "/entities/sun/name", value: "Key light" }),
      ],
      actor: SESSION,
    },
    "batch",
    {},
    "claude",
  );
  runner.propose({ title: "Other", ops: [scene({ op: "remove", id: "lamp" })] }, "entity.delete", {}, "script");
  return { editor, runner, proposals };
}

describe("the change sets", () => {
  it("groups the proposals of one turn and lists the ops by entity with their values", () => {
    const { editor, proposals } = setup();
    const sets = changeSetsOf(proposals.value, entityOf);
    expect(sets.map((set) => [set.key, set.title, set.ops.length])).toEqual([
      ["s1#1", "Rename the furniture (+1)", 5],
      ["proposal:p3", "Other", 1],
    ]);
    const first = sets[0];
    if (first === undefined) throw new Error("no change set");
    expect([...opsByEntity(first).keys()]).toEqual(["bench", "table", "lamp", "sun"]);
    expect(first.ops.map((op) => op.key)).toEqual(["p1:0", "p1:1", "p1:2", "p2:0", "p2:1"]);
    const doc = editor.scene.value;
    const views = first.ops.map((item) => (item.op.kind === "scene" ? sceneOpView(doc, item.op.op) : null));
    expect(views[0]).toEqual({ change: "changed", field: "name", before: "Bench", after: "Long bench" });
    expect(views[2]).toMatchObject({ field: "components.transform.position", after: [0, 0, 2] });
    expect(sceneOpView(doc, { op: "remove", id: "lamp" })).toMatchObject({ change: "removed", before: "Lamp" });
    expect(sceneOpEntity({ op: "set", path: "/environment", value: null })).toBeNull();
  });

  it("accepts 3 of 5 ops as one step with the actor of the session, and rejects the rest", () => {
    const { editor, runner, proposals } = setup();
    const steps = editor.history.steps().steps.length;
    const run = runner.acceptOps(["p1:0", "p1:1", "p2:1"], "Chairs: rename");
    expect(run).toMatchObject({ outcome: "applied", step: true, command: "review.accept" });
    expect(editor.history.steps().steps.length).toBe(steps + 1);
    expect(editor.history.steps().steps.at(-1)?.label?.actor).toMatchObject({ session: "s1", turn: 1 });
    const entities = editor.scene.value.entities;
    expect([entities.bench?.name, entities.table?.name, entities.sun?.name, entities.lamp?.name]).toEqual([
      "Long bench",
      "Round table",
      "Key light",
      "Lamp",
    ]);
    // The proposals keep the other ops.
    expect(changeSetsOf(proposals.value, entityOf)[0]?.ops.map((op) => op.key)).toEqual(["p1:0", "p2:0"]);
    expect(runner.rejectOps(["p1:0", "p2:0"])).toBe(2);
    expect(proposals.value.map((item) => item.id)).toEqual(["p3"]);
    editor.history.undo();
    expect(editor.scene.value.entities.bench?.name).toBe("Bench");
  });

  it("changes nothing when the chosen ops do not apply", () => {
    const { editor, runner, proposals } = setup();
    runner.propose(
      { title: "Bad", ops: [scene({ op: "set", path: "/entities/ghost/name", value: "x" })], actor: SESSION },
      "batch",
      {},
      "claude",
    );
    const before = editor.scene.value;
    expect(() => runner.acceptOps(["p4:0"], "Bad")).toThrow();
    expect(editor.scene.value).toBe(before);
    expect(proposals.value.map((item) => item.id)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(() => runner.acceptOps([], "None")).toThrow("No op of a proposal is chosen.");
  });
});
