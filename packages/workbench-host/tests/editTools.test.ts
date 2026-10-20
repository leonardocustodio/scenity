// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the editor tools of the host: `lab_commands` and `lab_edit` against a scripted lab. The scripted lab
 * answers the calls `commands`, `command`, `proposalMode` and `url` as the command runner of the lab page does
 * (apps/editor `core/editor/useCommands.ts`). The scripted check: Claude moves a prop through `lab_edit`, at once in
 * apply mode, and as a proposal that the owner accepts.
 */
import { describe, expect, test } from "bun:test";
import { handleToolRequest } from "../src/tools/index";
import type { ToolResult } from "../src/tools/kit";
import type { SurfacePort } from "../src/tools/context";
import { scaleTestTimeouts } from "./ciTiming";
import { fakeContext, LAB_URL, type FakeCall } from "./fakeLab";
import { useLabFixture } from "./labFixture";

// The built-in project of the host is the lab fixture (a lab surface, the `labs` runs, the stop gate).
useLabFixture();

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const AT0 = "room.props.lantern.at.0";

/** The commands of the lab API (`commands`): a short part of the registry, with an action of the owner. */
const COMMANDS = [
  {
    id: "prop.move",
    title: "Move the prop over the floor",
    key: "Drag (Shift: 10 cm grid)",
    kind: "edit",
    args: {
      prop: { type: "string", optional: true, description: "The prop slot." },
      x: { type: "number", optional: true, description: "The new x." },
      z: { type: "number", optional: true, description: "The new z." },
    },
    selection: "a prop selection (or the prop argument)",
    owner: false,
    available: false,
    reason: "prop.move needs a prop selection (or the prop argument).",
  },
  {
    id: "camera.open",
    title: "Open a named camera",
    key: "1–9",
    kind: "view",
    args: { name: { type: "string", values: ["overview", "chest"], description: "The named camera." } },
    selection: "no selection",
    owner: false,
    available: true,
    reason: null,
  },
  {
    id: "proposal.acceptAll",
    title: "Accept all proposals",
    key: null,
    kind: "view",
    args: {},
    selection: "no selection",
    owner: true,
    available: false,
    reason: "No proposals wait.",
  },
];

interface Edit {
  readonly id: string;
  readonly title: string;
  readonly ops: readonly { kind: "tune"; path: string; value: number }[];
}

/**
 * A scripted lab: the tune values, the proposals and the switch of the session, with the answers of the command
 * runner of the lab page for `prop.move`, `placement.save` and `camera.open`.
 */
function scriptedLab(options: { workbench?: boolean } = {}) {
  const tunes: Record<string, number> = {};
  let proposals: { id: string; edit: Edit; command: string }[] = [];
  let mode = "propose";
  let count = 0;
  const calls: FakeCall[] = [];
  const base = (command: string, kind: string, title: string) => ({
    command,
    kind,
    title,
    proposal: null,
    edit: null,
    ops: [] as unknown[],
    pending: [] as unknown[],
    sent: [] as unknown[],
    value: null as unknown,
  });
  const done = (run: Record<string, unknown>) => ({ ...run, tunes: { ...tunes }, mode });
  const apply = (edit: Edit, command: string) => {
    for (const op of edit.ops) tunes[op.path] = op.value;
    return done({ ...base(command, "edit", edit.title), outcome: "applied", edit: edit.id, step: true, ops: edit.ops });
  };
  const answers: Record<string, (args: readonly unknown[]) => unknown> = {
    commands: () => COMMANDS,
    proposalMode: () => mode,
    url: () => `${LAB_URL}&sel=prop:lantern`,
    setProposalMode: (args) => (mode = String(args[0])),
    accept: (args) => {
      const proposal = proposals.find((item) => item.id === args[0]);
      if (proposal === undefined) throw new Error(`No proposal "${String(args[0])}".`);
      proposals = proposals.filter((item) => item !== proposal);
      return { ...apply(proposal.edit, proposal.command), proposal: proposal.id };
    },
    command: (args) => {
      const [id, given, how] = args as [string, Record<string, unknown>, { mode?: string; by?: string }];
      if (id === "camera.open") {
        return done({ ...base(id, "view", `Open the camera ${String(given.name)}`), outcome: "ran" });
      }
      if (id === "placement.save") {
        const run = {
          edit: "placement.save#1",
          tool: "labs tune-apply",
          args: {
            values: `${AT0}:0.5`,
            dry: true,
            placement: true,
            command: `bun run labs tune-apply "${AT0}:0.5" --dry`,
          },
        };
        const where = options.workbench === true ? { sent: [run] } : { pending: [run] };
        const ops = [{ kind: "source", tool: run.tool, args: run.args }];
        return done({
          ...base(id, "edit", "Save placement (dry run)"),
          outcome: "applied",
          step: false,
          ops,
          ...where,
        });
      }
      if (id !== "prop.move") throw new Error(`No command "${id}". Commands: prop.move, camera.open.`);
      count += 1;
      const edit: Edit = {
        id: `prop.move#${String(count)}`,
        title: `Move lantern to x ${String(given.x)}, z -1.49`,
        ops: [{ kind: "tune", path: AT0, value: Number(given.x) }],
      };
      // As the lab (useCommands.ts): only the switch of the session lets Claude apply at once.
      const applies =
        how.by === "claude" ? mode === "apply" && how.mode !== "propose" : how.mode === "apply" || mode === "apply";
      if (applies) return apply(edit, id);
      const proposal = { id: `p${String(count)}`, edit, command: id };
      proposals.push(proposal);
      return done({
        ...base(id, "edit", edit.title),
        outcome: "proposed",
        proposal: proposal.id,
        edit: edit.id,
        ops: edit.ops,
      });
    },
  };
  const port: SurfacePort = {
    call(name, args = []) {
      calls.push({ call: name, args });
      const answer = answers[name];
      if (answer === undefined) return Promise.resolve(undefined);
      try {
        return Promise.resolve(answer(args));
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
  };
  return { port, calls, tunes, proposals: () => proposals };
}

function textOf(result: ToolResult): string {
  return result.content.map((block) => (block.type === "text" ? block.text : `[image ${block.mimeType}]`)).join("\n");
}

async function tool(lab: ReturnType<typeof scriptedLab>, name: string, input: unknown) {
  const result = await handleToolRequest(name, input, fakeContext(lab.port));
  return { result, text: textOf(result) };
}

describe("lab_commands", () => {
  test("lists the commands with the key, the kind, the args and the rule; the actions of the owner stay out", async () => {
    const lab = scriptedLab();
    const { result, text } = await tool(lab, "lab_commands", {});
    expect(result.isError).toBeUndefined();
    expect(text).toContain("Commands of the lab: 2 of 2.");
    expect(text).toContain("prop.move (edit): Move the prop over the floor");
    expect(text).toContain(
      "key Drag (Shift: 10 cm grid) · needs a prop selection (or the prop argument) · not now: prop.move needs a prop",
    );
    expect(text).toContain("args: prop?: string, x?: number, z?: number");
    expect(text).toContain("camera.open (view): Open a named camera");
    expect(text).toContain("args: name: string overview|chest");
    expect(text).not.toContain("proposal.acceptAll");
    expect(text).toContain("Proposal switch of the session: propose (Claude's edits are proposals).");
    expect((await tool(lab, "lab_commands", { filter: "camera" })).text).toContain('with "camera": 1 of 2.');
  });
});

describe("lab_edit: Claude moves a prop (the scripted check)", () => {
  test("apply mode without the switch of the owner stays a proposal", async () => {
    const lab = scriptedLab();
    const { text } = await tool(lab, "lab_edit", {
      command: "prop.move",
      args: { prop: "lantern", x: 0.5 },
      mode: "apply",
    });
    expect(text).toContain("Proposal p1 (prop.move: Move lantern to x 0.5, z -1.49): not applied.");
    expect(lab.tunes).toEqual({});
  });

  test("apply mode: the lab applies the move at once; the result gives the op, the tunes and tune-apply", async () => {
    const lab = scriptedLab();
    await lab.port.call("setProposalMode", ["apply"]);
    const { result, text } = await tool(lab, "lab_edit", {
      command: "prop.move",
      args: { prop: "lantern", x: 0.5 },
      mode: "apply",
    });
    expect(result.isError).toBeUndefined();
    expect(lab.calls.find((item) => item.call === "command")).toEqual({
      call: "command",
      args: ["prop.move", { prop: "lantern", x: 0.5 }, { mode: "apply", by: "claude" }],
    });
    expect(lab.tunes).toEqual({ [AT0]: 0.5 });
    expect(text).toContain("Applied prop.move (Move lantern to x 0.5, z -1.49) as one step of the undo history.");
    expect(text).toContain(`  tune ${AT0} = 0.5`);
    expect(text).toContain(`Write them into the code: bun run labs tune-apply "${AT0}:0.5"`);
    expect(text).toContain("URL: http://127.0.0.1:52140/?take=greet");
    expect(text).not.toContain("workbench=");
  });

  test("propose mode (the default): a proposal waits, and the move applies when the owner accepts it", async () => {
    const lab = scriptedLab();
    const { text } = await tool(lab, "lab_edit", { command: "prop.move", args: { prop: "lantern", x: 0.5 } });
    expect(lab.calls.find((item) => item.call === "command")?.args[2]).toEqual({ by: "claude" });
    expect(text).toContain("Proposal p1 (prop.move: Move lantern to x 0.5, z -1.49): not applied.");
    expect(text).toContain(`  tune ${AT0} = 0.5`);
    expect(lab.tunes).toEqual({});
    expect(lab.proposals().map((item) => item.id)).toEqual(["p1"]);
    // The owner accepts the proposal in the lab.
    await lab.port.call("accept", ["p1"]);
    expect(lab.tunes).toEqual({ [AT0]: 0.5 });
    expect(lab.proposals()).toEqual([]);
  });

  test("the switch of the session applies a move of Claude at once", async () => {
    const lab = scriptedLab();
    await lab.port.call("setProposalMode", ["apply"]);
    const { text } = await tool(lab, "lab_edit", { command: "prop.move", args: { prop: "lantern", x: 0.7 } });
    expect(text).toContain("Applied prop.move");
    expect(lab.tunes).toEqual({ [AT0]: 0.7 });
  });

  test("a view command runs at once; Save placement goes to the host, or waits in a page alone", async () => {
    const lab = scriptedLab({ workbench: true });
    expect((await tool(lab, "lab_edit", { command: "camera.open", args: { name: "chest" } })).text).toContain(
      "Ran camera.open (Open the camera chest): a view command, not an input of the scene; it runs at once.",
    );
    await lab.port.call("setProposalMode", ["apply"]);
    const sent = await tool(lab, "lab_edit", { command: "placement.save", mode: "apply" });
    expect(sent.text).toContain("Applied placement.save (Save placement (dry run)).");
    expect(sent.text).toContain(`  source labs tune-apply: bun run labs tune-apply "${AT0}:0.5" --dry`);
    expect(sent.text).toContain(`Sent to the host: bun run labs tune-apply "${AT0}:0.5" --dry. The host runs it`);
    const aloneLab = scriptedLab();
    await aloneLab.port.call("setProposalMode", ["apply"]);
    const alone = await tool(aloneLab, "lab_edit", { command: "placement.save", mode: "apply" });
    expect(alone.text).toContain(`Waits (no run yet; the lab is not in the workbench or no path runs this tool)`);
  });

  test("gives a tool error for a bad mode and for an unknown command of the lab", async () => {
    const lab = scriptedLab();
    const bad = await tool(lab, "lab_edit", { command: "prop.move", mode: "now" });
    expect(bad.result.isError).toBe(true);
    expect(bad.text).toContain("mode");
    const unknown = await tool(lab, "lab_edit", { command: "prop.fly" });
    expect(unknown.result.isError).toBe(true);
    expect(unknown.text).toBe('lab_edit: No command "prop.fly". Commands: prop.move, camera.open.');
  });
});
