// SPDX-License-Identifier: Apache-2.0
/**
 * The host face of the lab fixture of the host tests: a project with a lab surface, the `labs` runs and a stop gate,
 * as a plugin with a lab gives them. The tests make this project the built-in project of the host (`useLabFixture`).
 */
import {
  checkLines,
  commandListTool,
  commandRunTool,
  defineHostPlugin,
  type HostContextLines,
  type HostPaths,
  INDEX_CAPABILITY,
  labTuneLines,
  labUrlFacts,
  list,
  number,
  record,
  SCENE_CAPABILITY,
  text,
  type GateCheck,
  type RunPreset,
  type RunSpec,
  type SurfacePort,
} from "../../../../../src/plugin";

/** The output folders of the runs, under the ignored test results of the editor app. */
export const LAB_RUNS_OUT = "apps/editor/test-results/room3d/workbench";

/** The facts of one subcommand of the lab CLI. */
interface LabRun {
  readonly label: string;
  readonly kind: string;
  readonly out?: boolean;
  readonly gpu?: RunSpec["gpu"];
  readonly confirm?: boolean;
  readonly ref?: boolean;
  readonly take?: boolean;
  readonly agent?: boolean;
  readonly presets?: readonly RunPreset[];
}

/** The subcommands of the lab CLI (`bun run labs <id>`). */
const LAB_RUNS: Readonly<Record<string, LabRun>> = {
  motion: { label: "Motion", kind: "check", out: true, take: true, presets: [{ label: "Motion", sequence: "greet" }] },
  verify: {
    label: "Verify",
    kind: "check",
    presets: [{ label: "Verify" }, { label: "Verify visual", args: ["--visual"] }],
  },
  review: { label: "Review", kind: "review", out: true, ref: true, take: true },
  sheet: { label: "Sheet", kind: "render", out: true },
  shot: { label: "Shot", kind: "render", out: true },
  clip: { label: "Clip", kind: "render", out: true },
  stills: { label: "Stills", kind: "render" },
  scenes: { label: "Scenes", kind: "render" },
  asset: { label: "Asset", kind: "tool", out: true, gpu: "confirmed", confirm: true },
  perf: {
    label: "Perf",
    kind: "check",
    agent: false,
    presets: [{ label: "Perf (quick, dry)", args: ["--quick", "--dry"] }],
  },
  "tune-apply": { label: "Tune to code", kind: "write", gpu: false },
  "camera-save": { label: "Save camera", kind: "write", gpu: false },
  "layout-save": { label: "Save layout", kind: "write", gpu: false },
  promote: {
    label: "Promote",
    kind: "release",
    confirm: true,
    presets: [
      { label: "Promote (dry)", args: ["--dry"] },
      { label: "Promote…", confirm: "Run labs promote: every runtime gate, then the release record and the version." },
    ],
  },
};

/** The run spec of one subcommand. */
function labRun(id: string, run: LabRun): RunSpec {
  return {
    command: `bun run labs ${id}`,
    label: run.label,
    kind: run.kind,
    ...(run.out === true ? { out: LAB_RUNS_OUT } : {}),
    gpu: run.gpu ?? true,
    gpuOff: ["--check"],
    ...(run.confirm === true ? { confirm: true } : {}),
    ...(run.ref === true ? { ref: true } : {}),
    ...(run.take === true ? { sequence: { flag: "", required: true } } : {}),
    ...(run.agent === undefined ? {} : { agent: run.agent }),
    aliases: [`bun labs ${id}`, `bun apps/editor/scripts/labs.ts ${id}`],
    ...(run.presets === undefined ? {} : { presets: [...run.presets] }),
  };
}

/** The runs of the lab by ID. */
export const LAB_RUN_SPECS: Readonly<Record<string, RunSpec>> = Object.fromEntries(
  Object.entries(LAB_RUNS).map(([id, run]) => [id, labRun(id, run)]),
);

/** The stop gate of a loop with a take: the motion checks of the take. */
export const LAB_GATE = "bun run labs motion";

/** The fast check of the stop gate: the motion checks of the take at its moments, through a frame. */
async function checkTakeAtMoments(port: SurfacePort, url: string | null): Promise<GateCheck> {
  const take = labUrlFacts(url).take;
  const moments = record(await port.call("moments", [take], { timeoutMs: 10_000 }));
  const times = [...new Set(Object.values(moments).map(number))].filter((at): at is number => at !== null);
  const report = record(await port.call("check", times.length === 0 ? [] : [times], { timeoutMs: 180_000 }));
  const title = `the motion checks of take ${take ?? "?"} at its moments`;
  const hint = "Fix the cause (lab_frame shows it), or tell the owner why it cannot pass.";
  if (report.applies === false)
    return { sequence: take, pass: true, summary: text(report.summary) ?? "no checks", title };
  const failures = list(report.failures);
  const lines = checkLines(report, { failures: 8, worst: 0 });
  return { sequence: take, pass: failures.length === 0, summary: lines.join("\n"), title, hint };
}

/** The members on screen, two per line: the ID, the clip and the family of each member of the report. */
function memberRows(report: unknown): string[] {
  const members = list(record(report).members)
    .map(record)
    .filter((member) => member.visible !== false);
  const cells = members.map((member) => {
    const id = (text(member.id) ?? "?").padEnd(9);
    const clip = (text(member.clip) ?? "idle").padEnd(26);
    return `${id} ${clip} ${`(${text(member.family) ?? "?"})`.padEnd(18)}`;
  });
  const rows: string[] = [];
  for (let index = 0; index < cells.length; index += 2)
    rows.push(`  ${cells.slice(index, index + 2).join(" ")}`.trimEnd());
  return rows.slice(0, 4);
}

/** The short lab state of `lab_state`: the members with their places and their work. */
function shortState(state: unknown): unknown {
  const members = list(record(state).members).map((value) => {
    const { id, role, home, binding, phase } = record(value);
    return { id, role, home, binding, phase };
  });
  return { members };
}

const CONTEXT_LINES: HostContextLines = { members: memberRows, summary: shortState };

/** The tune paths that a placement may write: the prop places, the bends of the routes and the light. */
const PATHS: HostPaths = {
  placement: [
    /^room\.props\.[a-z_]+\.(at\.[012]|yaw)$/i,
    /^routes\.[a-z0-9_]+\.\d+\.[012]$/i,
    /^light\.(key|fill|sky)\.[a-z]+(\.[012])?$/,
  ],
  // The import job of a dropped file, from the root of the checkout (the tests start no job).
  importJob: "scripts/importJob.ts",
  layoutPair:
    /^(?:room\.props\.[a-z_]+\.(?:at\.[012]|yaw)|routes\.[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*):-?\d+(?:\.\d+)?(?:e-?\d+)?$/,
};

/** The old names of the editor tools of a lab: aliases of `scene_commands` and `scene_command`. */
const labCommands = commandListTool({
  name: "lab_commands",
  description:
    "List the editor commands of the lab (the command registry of the scene editor): the ID, the title, the key of " +
    "the owner, the kind (edit: an input as a proposal or an applied step; view: runs at once), the arguments, the " +
    "selection that the command needs and whether it can run now. lab_edit runs one.",
  place: "the lab",
  inputTexts: { filter: "Keep the commands whose ID or title contains this text, for example 'prop'." },
});

const labEdit = commandRunTool({
  name: "lab_edit",
  description:
    "Run an editor command of the lab (lab_commands lists them), for example command 'prop.move' with args " +
    "{ prop: 'lamp', x: 0.5 }. An edit is a proposal by default: the lab keeps it and the owner accepts or " +
    "rejects it. Only when the owner sets the switch of the session to 'apply' does mode 'apply' apply it at once, " +
    "as one undo step. A view command (select, camera, marks) runs at once. Gives the proposal ID or the applied " +
    "ops, the tune values and the `labs tune-apply` text.",
  place: "the lab",
  tunes: labTuneLines,
  inputTexts: {
    command: "The command ID, for example 'prop.move', 'prop.turn' or 'selection.set'.",
    args: "The arguments of the command (lab_commands gives them), for example { prop: 'lamp', degrees: 15 }.",
  },
});

export default defineHostPlugin({
  id: "lab",
  tools: [labCommands, labEdit],
  contextLines: CONTEXT_LINES,
  paths: PATHS,
  runs: { commands: LAB_RUN_SPECS, gate: LAB_GATE },
  surfaces: [{ id: "lab", kind: "scene", label: "Lab", capabilities: [SCENE_CAPABILITY, INDEX_CAPABILITY], order: 1 }],
  gateCheck: checkTakeAtMoments,
  defaultSequence: "greet",
});
