// SPDX-License-Identifier: Apache-2.0
// The command runner. The owner applies an edit at once. Claude and a script make proposals, and the owner accepts or
// rejects them. Only the switch of the session lets Claude apply at once. A view command runs at once. An action of
// the owner refuses Claude. The commands edit the generic fixture scene.
import { describe, expect, it } from "bun:test";
import { appliesAtOnce, CommandError, createRunner, type EditOp, type Proposal, type ProposalMode } from "../src/index";
import { cell, fixtureEditor, type FixtureHost, type FixtureState } from "./helpers";

function fixtureRunner(mode: ProposalMode = "propose") {
  const editor = fixtureEditor();
  const proposals = cell<readonly Proposal<EditOp>[]>([]);
  const kept: ProposalMode[] = [];
  const runner = createRunner<FixtureState, FixtureHost, EditOp>({
    registry: editor.registry,
    state: editor.state,
    host: editor.host,
    apply: editor.apply,
    problems: () => [],
    proposals,
    mode: cell(mode),
    keepMode: (next) => kept.push(next),
  });
  return { editor, runner, proposals, kept };
}

const MOVE = { x: 2, z: -1 };

/** The words of the error of a run that fails. */
async function failure(run: Promise<unknown>): Promise<string> {
  return run.then(
    () => "no error",
    (error: unknown) => String(error),
  );
}

describe("the command runner", () => {
  it("applies an edit of the owner at once as one step of the history", async () => {
    const { editor, runner } = fixtureRunner();
    editor.select("bench");
    const run = await runner.run("entity.move", MOVE, { by: "owner" });
    expect(run).toMatchObject({
      outcome: "applied",
      step: true,
      edit: "entity.move#1",
      proposal: null,
      mode: "propose",
    });
    expect(editor.scene.value.entities.bench?.components.transform).toEqual({ position: [2, 0, -1] });
    await runner.run("selection.clear", {}, { by: "owner" });
    expect(editor.host.calls).toEqual(["select none"]);
    editor.history.undo();
    expect(editor.scene.value.entities.bench?.components.transform).toEqual({ position: [1.5, 0, -1] });
  });

  it("keeps an edit of Claude or a script as a proposal; the owner accepts or rejects it", async () => {
    const { editor, runner, proposals } = fixtureRunner();
    editor.select("bench");
    const claude = await runner.run("entity.move", MOVE, { by: "claude", mode: "apply" });
    expect(claude).toMatchObject({ outcome: "proposed", proposal: "p1", step: false });
    const script = await runner.run("light.dim", { value: 0.5 });
    expect(script.outcome).toBe("proposed");
    expect(proposals.value.map((item) => [item.id, item.by, item.command])).toEqual([
      ["p1", "claude", "entity.move"],
      ["p2", "script", "light.dim"],
    ]);
    expect(editor.scene.value.entities.bench?.components.transform).toEqual({ position: [1.5, 0, -1] });
    expect(runner.accept("p1")).toMatchObject({ outcome: "applied", proposal: "p1" });
    expect((editor.scene.value.entities.bench?.components.transform as { position: number[] }).position).toEqual([
      2, 0, -1,
    ]);
    expect(runner.reject("p2")).toBe(true);
    expect(runner.reject("p2")).toBe(false);
    expect(() => runner.accept("p9")).toThrow('No proposal "p9".');
    expect(editor.tunes.value).toEqual({});
  });

  it("lets Claude apply at once only with the switch of the session", async () => {
    const { editor, runner, kept } = fixtureRunner();
    editor.select("table");
    expect(runner.setMode("apply")).toBe("apply");
    expect(kept).toEqual(["apply"]);
    expect((await runner.run("entity.move", MOVE, { by: "claude" })).outcome).toBe("applied");
    expect((await runner.run("entity.move", { x: 0, z: 0 }, { by: "claude", mode: "propose" })).outcome).toBe(
      "proposed",
    );
    expect(() => runner.setMode("all" as ProposalMode)).toThrow(CommandError);
  });

  it("decides the apply of each runner as the rules say", () => {
    expect(appliesAtOnce("owner", undefined, "propose", false)).toBe(true);
    expect(appliesAtOnce("owner", undefined, "propose", true)).toBe(false);
    expect(appliesAtOnce("owner", "apply", "propose", true)).toBe(true);
    expect(appliesAtOnce("claude", "apply", "propose", false)).toBe(false);
    expect(appliesAtOnce("claude", undefined, "apply", false)).toBe(true);
    expect(appliesAtOnce("script", "apply", "propose", false)).toBe(true);
    expect(appliesAtOnce("script", undefined, "propose", false)).toBe(false);
  });

  it("makes a command that proposes a proposal also for the owner, and refuses an owner action to Claude", async () => {
    const { editor, runner } = fixtureRunner();
    editor.select("sun");
    expect((await runner.run("entity.rename", { name: "Moon" }, { by: "owner" })).outcome).toBe("proposed");
    expect(runner.listings().find((item) => item.id === "proposal.acceptAll")?.available).toBe(true);
    expect(await failure(runner.run("proposal.acceptAll", {}, { by: "claude" }))).toContain("an action of the owner");
    const all = await runner.run("proposal.acceptAll", {}, { by: "owner" });
    expect(all.outcome).toBe("ran");
    expect(editor.scene.value.entities.sun?.name).toBe("Moon");
  });

  it("gives back a source op as a pending run and no history step", async () => {
    const { editor, runner } = fixtureRunner();
    const run = await runner.run("scene.save", {}, { by: "owner" });
    expect(run).toMatchObject({
      outcome: "applied",
      step: false,
      pending: [{ tool: "scene save", args: { scene: "garden" } }],
    });
    expect(editor.history.canUndo).toBe(false);
    expect(await failure(runner.run("light.dim", { value: 2 }, { by: "owner" }))).toContain('"value" is at most 1.');
  });
});
