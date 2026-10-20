// SPDX-License-Identifier: Apache-2.0
/**
 * The editor tools of the workbench: the twins of the command registry of the page of the scene surface. Thus Claude
 * edits through the same commands as the owner. The scene page (scene projects) and the lab page serve the same bridge
 * calls.
 *
 * - `scene_commands` lists the commands of the page: the ID, the title, the key, the kind (edit or view), the arguments
 *   and the selection rule, and what can run now. The actions of the owner (`proposal.*`) are not in the list.
 * - `scene_command` runs a command with its arguments through the bridge call `command` as Claude. An edit of Claude is
 *   a proposal by default: the page keeps it, and the owner accepts or rejects it. Only the switch of the session in
 *   the page (the choice of the owner) lets `mode: "apply"` apply the edit at once, as one undo step. A view command
 *   (select, camera, marks) runs at once.
 * - `scene_batch` runs many commands as one undo step, all or none.
 *
 * `commandListTool` and `commandRunTool` make these tools with other names and texts. For example, a host plugin can
 * keep older names of these tools as aliases. The tools call the visible frame only, so the owner sees the proposals
 * and the edits there.
 */
import { z } from "zod";
import { COMMAND_BATCH_CALL, COMMAND_CALL, COMMANDS_CALL, PROPOSAL_MODE_CALL } from "@scenity/bridge";
import { callTyped, cut, defineTool, frameUrl, list, record, shownUrl, text, textResult } from "./kit";
import { tuneLines } from "./tunes";

/** The words of one argument of a command: `name?: type (values) = default`. */
function argText(name: string, value: unknown): string {
  const spec = record(value);
  const values = Array.isArray(spec.values) ? ` ${spec.values.map(String).join("|")}` : "";
  const fallback = spec.default === undefined ? "" : ` = ${JSON.stringify(spec.default)}`;
  const optional = spec.optional === true || spec.default !== undefined ? "?" : "";
  return `${name}${optional}: ${text(spec.type) ?? "?"}${values}${fallback}`;
}

/**
 * The lines of the commands of a page (the bridge call `commands`), without the actions of the owner. `place` names
 * the page in the head line (default "the editor"; a host of another page gives its own name).
 */
export function commandLines(value: unknown, filter = "", place = "the editor"): string[] {
  const needle = filter.toLowerCase();
  const all = list(value)
    .map(record)
    .filter((item) => item.owner !== true);
  const words = (item: Record<string, unknown>): string =>
    [item.id, item.title, item.description, item.category].map((value) => text(value) ?? "").join(" ");
  const kept = all.filter((item) => words(item).toLowerCase().includes(needle));
  const line = (item: Record<string, unknown>): string => {
    const args = Object.entries(record(item.args)).map(([name, spec]) => argText(name, spec));
    const now = item.available === true ? "can run now" : `not now: ${text(item.reason) ?? "?"}`;
    const title = text(item.title) ?? "";
    // The description for the agents, when it says more than the title.
    const description = text(item.description);
    const category = text(item.category);
    return [
      `${text(item.id) ?? "?"} (${text(item.kind) ?? "?"}${category === null ? "" : `, ${category}`}): ${title}`,
      ...(description === null || description === title ? [] : [`    ${description}`]),
      `    key ${text(item.key) ?? "none"} · needs ${text(item.selection) ?? "?"} · ${now}`,
      `    args: ${args.length === 0 ? "none" : args.join(", ")}`,
      // The JSON Schema of the arguments (the page gives it with each command).
      ...(item.schema === undefined ? [] : [`    schema: ${JSON.stringify(item.schema)}`]),
    ].join("\n");
  };
  const head = `Commands of ${place}${needle === "" ? "" : ` with "${filter}"`}: ${String(kept.length)} of ${String(all.length)}.`;
  return [head, ...cut(kept, 40, line, "give a filter")];
}

/** The words of one edit op of a command result. */
export function opLine(value: unknown): string {
  const op = record(value);
  if (op.kind === "tune") {
    return `  tune ${text(op.path) ?? "?"} = ${typeof op.value === "number" ? String(op.value) : "default"}`;
  }
  if (op.kind === "event") return `  event ${JSON.stringify(op.event)}`;
  const args = record(op.args);
  const command = text(args.command);
  return `  source ${text(op.tool) ?? "?"}${command === null ? ` ${JSON.stringify(args)}` : `: ${command}`}`;
}

/** The words of a source run of a result: its command, else its tool and arguments. */
function runText(value: unknown): string {
  const run = record(value);
  const args = record(run.args);
  return text(args.command) ?? `${text(run.tool) ?? "?"} ${JSON.stringify(args)}`;
}

/** The lines of a result of `command` (`CommandRun` of `@scenity/editor-core`) for Claude; `place` names the page. */
export function editLines(
  value: unknown,
  url: string | null,
  place = "the editor",
  tunes: (values: Readonly<Record<string, unknown>>) => string[] = (values) => tuneLines(values),
): string[] {
  const run = record(value);
  const id = text(run.command) ?? "?";
  const title = text(run.title) ?? "";
  const ops = list(run.ops);
  const lines: string[] = [];
  switch (run.outcome) {
    case "proposed":
      lines.push(
        `Proposal ${text(run.proposal) ?? "?"} (${id}: ${title}): not applied. The owner accepts or rejects it in ` +
          `${place}. Only when the owner sets the switch of the session to 'apply' do Claude's edits apply at once.`,
        ...ops.map(opLine),
      );
      return lines;
    case "ran":
      lines.push(`Ran ${id} (${title}): a view command, not an input of the scene; it runs at once.`);
      if (run.value !== null && run.value !== undefined) lines.push(`Value: ${JSON.stringify(run.value)}`);
      return lines;
    case "unchanged":
      lines.push(`Applied ${id} (${title}): no input changed.`, ...ops.map(opLine));
      break;
    default:
      lines.push(
        `Applied ${id} (${title})${run.step === true ? " as one step of the undo history" : ""}.`,
        ...ops.map(opLine),
      );
  }
  for (const sent of list(run.sent)) {
    lines.push(
      `Sent to the host: ${runText(sent)}. The host runs it in the Runs tab; the selection card shows the output.`,
    );
  }
  for (const pending of list(run.pending)) {
    lines.push(`Waits (no run yet; ${place} is not in the workbench or no path runs this tool): ${runText(pending)}`);
  }
  if (run.tunes !== undefined) lines.push(...tunes(record(run.tunes)));
  if (url !== null) lines.push(`URL: ${shownUrl(url)}`);
  return lines;
}

/** One problem of a value for one argument spec of a command (the `ArgSpec` of `@scenity/editor-core`), or null. */
function argProblem(name: string, spec: Record<string, unknown>, value: unknown): string | null {
  const type = text(spec.type);
  if (type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return `"${name}" is a number.`;
    if (spec.integer === true && !Number.isInteger(value)) return `"${name}" is a whole number.`;
    if (typeof spec.min === "number" && value < spec.min) return `"${name}" is at least ${String(spec.min)}.`;
    if (typeof spec.max === "number" && value > spec.max) return `"${name}" is at most ${String(spec.max)}.`;
    return null;
  }
  if (type === "boolean") return typeof value === "boolean" ? null : `"${name}" is true or false.`;
  if (typeof value !== "string" || value.trim() === "") return `"${name}" is a text.`;
  const values = Array.isArray(spec.values) ? spec.values.map(String) : null;
  return values === null || values.includes(value) ? null : `"${name}" is one of ${values.join(", ")}.`;
}

/**
 * The problems of the arguments of a call for the arguments of a command: an unknown name, a missing argument with no
 * default, a value of the wrong type, a value out of its range or its list. No problem gives an empty list.
 */
export function argProblems(specs: unknown, args: Readonly<Record<string, unknown>>): string[] {
  const known = record(specs);
  const problems = Object.keys(args)
    .filter((name) => !Object.hasOwn(known, name))
    .map((name) => `No argument "${name}" (${Object.keys(known).join(", ") || "none"}).`);
  for (const [name, value] of Object.entries(known)) {
    const spec = record(value);
    const given = args[name];
    if (given === undefined) {
      if (spec.optional !== true && spec.default === undefined) problems.push(`The argument "${name}" is missing.`);
      continue;
    }
    const problem = argProblem(name, spec, given);
    if (problem !== null) problems.push(problem);
  }
  return problems;
}

/** The input texts of a command tool: the description of each field. */
export interface CommandInputTexts {
  readonly filter: string;
  readonly command: string;
  readonly args: string;
  readonly mode: string;
}

/** The names and texts of a command tool: its name, its description and the words that name the page. */
export interface CommandToolSpec {
  readonly name: string;
  readonly description: string;
  /** The page in the result texts, for example "the editor". */
  readonly place: string;
  /** The lines of the tune values of a page that has them (default: the generic lines). */
  readonly tunes?: (values: Readonly<Record<string, unknown>>) => string[];
  /** The descriptions of the input fields (default: the generic texts). */
  readonly inputTexts?: Partial<CommandInputTexts>;
}

/** The generic descriptions of the input fields. */
const INPUT_TEXTS: CommandInputTexts = {
  filter: "Keep the commands whose ID or title contains this text, for example 'entity'.",
  command: "The command ID, for example 'entity.move', 'entity.rename' or 'entity.delete'.",
  args: "The arguments of the command (scene_commands gives them), for example { entity: 'table', degrees: 15 }.",
  mode: "propose (default): a proposal for the owner; apply: apply at once, only when the owner's switch allows it.",
};

/** The input of a command list tool. */
function listInput(texts: CommandInputTexts) {
  return z.object({ filter: z.string().optional().describe(texts.filter) });
}

/** The input of a command run tool. */
function runInput(texts: CommandInputTexts) {
  return z.object({
    command: z.string().min(1).describe(texts.command),
    args: z
      .record(z.string(), z.union([z.number(), z.string(), z.boolean()]))
      .optional()
      .describe(texts.args),
    mode: z.enum(["propose", "apply"]).optional().describe(texts.mode),
  });
}

/** A tool that lists the commands of the page of the scene surface and the switch of the session. */
export function commandListTool(spec: CommandToolSpec) {
  return defineTool({
    name: spec.name,
    description: spec.description,
    input: listInput({ ...INPUT_TEXTS, ...spec.inputTexts }),
    alwaysLoad: false,
    async handler(input, ctx) {
      const port = ctx.surface("visible");
      const commands = await callTyped(port, COMMANDS_CALL, []);
      const mode = await callTyped(port, PROPOSAL_MODE_CALL, []);
      const how = mode === "apply" ? "Claude's edits apply at once" : "Claude's edits are proposals";
      return textResult([
        ...commandLines(commands, input.filter ?? "", spec.place),
        `Proposal switch of the session: ${mode} (${how}).`,
      ]);
    },
  });
}

/** A tool that runs one command of the page of the scene surface as Claude (proposals and the switch apply). */
export function commandRunTool(spec: CommandToolSpec) {
  return defineTool({
    name: spec.name,
    description: spec.description,
    input: runInput({ ...INPUT_TEXTS, ...spec.inputTexts }),
    alwaysLoad: false,
    async handler(input, ctx) {
      const port = ctx.surface("visible");
      // The host checks the arguments of a listed command before the run. The page answers an unknown ID.
      const listed = list(await callTyped(port, COMMANDS_CALL, [])).map(record);
      const command = listed.find((item) => item.id === input.command);
      const problems = command === undefined ? [] : argProblems(command.args, input.args ?? {});
      if (problems.length > 0) throw new Error(`${input.command}: ${problems.join(" ")}`);
      // Without a mode, the switch of the session decides. Mode "propose" asks for a proposal in both cases.
      // The session of the call goes to the page, so the history names it.
      const session = ctx.session === undefined ? {} : { session: ctx.session };
      const how =
        input.mode === undefined ? { by: "claude", ...session } : { mode: input.mode, by: "claude", ...session };
      const result = await callTyped(port, COMMAND_CALL, [input.command, input.args ?? {}, how]);
      const url = await frameUrl(port);
      return textResult(editLines(result, url, spec.place, spec.tunes));
    },
  });
}

/** The generic tool `scene_commands`. */
export const sceneCommands = commandListTool({
  name: "scene_commands",
  description:
    "List the editor commands of the open scene (the command registry of the editor window): the ID, the title, the key of the owner, the kind (edit: an input as a proposal or an applied step; " +
    "view: runs at once), the arguments with their types, the selection that the command needs and whether it can " +
    "run now. scene_command runs one.",
  place: "the editor",
});

/** The generic tool `scene_command`. */
export const sceneCommand = commandRunTool({
  name: "scene_command",
  description:
    "Run an editor command of the open scene as Claude (scene_commands lists them), for example command " +
    "'entity.move' with args { entity: 'table', x: 0.5 }. An edit is a proposal by default: the page keeps it and " +
    "the owner accepts or rejects it. Only when the owner sets the switch of the session to 'apply' does mode " +
    "'apply' apply it at once, as one undo step. A view command (select, camera) runs at once. Gives the proposal " +
    "ID or the applied ops.",
  place: "the editor",
});

/** The input of `scene_batch`. */
const batchInput = z.object({
  steps: z
    .array(
      z.object({
        command: z.string().min(1).describe("The command ID."),
        args: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional(),
      }),
    )
    .min(1)
    .max(200)
    .describe("The commands in their order; each one works on the document after the one before it."),
  title: z.string().min(1).max(200).optional().describe("The name of the undo step, for example 'Lay out the room'."),
  mode: z.enum(["propose", "apply"]).optional().describe(INPUT_TEXTS.mode),
});

/** The generic tool `scene_batch`: many commands as one undo step, all or none. */
export const sceneBatch = defineTool({
  name: "scene_batch",
  description:
    "Run many editor commands of the open scene as one change: they apply all or none, as one named undo step (or " +
    "one proposal for the owner). A step that fails changes nothing and names the step. Each step works on the " +
    "document after the step before it, so 'entity.create.box' then 'entity.move' of the new entity works.",
  input: batchInput,
  alwaysLoad: false,
  async handler(input, ctx) {
    const port = ctx.surface("visible");
    // The host checks the arguments of each listed command before the batch.
    const listed = list(await callTyped(port, COMMANDS_CALL, [])).map(record);
    for (const [index, step] of input.steps.entries()) {
      const command = listed.find((item) => item.id === step.command);
      const problems = command === undefined ? [] : argProblems(command.args, step.args ?? {});
      if (problems.length > 0) throw new Error(`step ${String(index + 1)} (${step.command}): ${problems.join(" ")}`);
    }
    const session = ctx.session === undefined ? {} : { session: ctx.session };
    const how = { by: "claude", ...(input.mode === undefined ? {} : { mode: input.mode }), ...session };
    const steps = input.steps.map((step) => ({
      command: step.command,
      ...(step.args === undefined ? {} : { args: step.args }),
    }));
    const result = await callTyped(port, COMMAND_BATCH_CALL, [
      steps,
      input.title ?? `${String(steps.length)} commands`,
      how,
    ]);
    return textResult(editLines(result, await frameUrl(port), "the editor"));
  },
});
