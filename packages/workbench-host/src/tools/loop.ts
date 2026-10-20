// SPDX-License-Identifier: Apache-2.0
/**
 * The tools of the change loop. `workbench_after` waits until the dev server applied the last edit. Then it gives the
 * frame at the URL state of the start of the turn. `workbench_run` starts a run of the project in the checkout, with
 * its output in the Runs tab of the page.
 */
import { z } from "zod";
import type { ProjectRun, RunInfo } from "../protocol";
import type { ToolContext } from "./context";
import { defineTool, imageContent, textResult, type ToolDef, type ToolResult } from "./kit";
import { MAX_IMAGE_WIDTH } from "./frame";

export const workbenchAfter = defineTool({
  name: "workbench_after",
  description:
    "After an edit: wait until the dev server applied it (HMR or a page reload), put the lab frame back at the URL " +
    "state of the turn start, and capture it. Gives the files of the turn, 'reloaded' when the page loaded again, and " +
    "one picture (the owner sees the same before and after in the panel).",
  input: z.object({
    width: z.number().int().min(64).max(MAX_IMAGE_WIDTH).optional().describe("The width of the picture in px."),
  }),
  alwaysLoad: false,
  async handler(input, ctx): Promise<ToolResult> {
    if (ctx.after === undefined) throw new Error("workbench_after: the host has no turn capture.");
    const result = await ctx.after(input.width);
    if (result === null) throw new Error("workbench_after: no turn yet (the prompt hook starts a turn).");
    const lines = [
      `Turn ${String(result.turn)} · ${String(result.files.length)} files: ${result.files.join(", ") || "none"}`,
      `Update: ${result.applied ? (result.reloaded ? "applied with a page reload" : "applied by HMR") : "none seen (not a lab file, or no update in time)"}.`,
      `URL state of the turn start: ${result.url ?? "unknown"}`,
    ];
    if (result.after === null) {
      lines.push(`No picture: ${result.error ?? "the frame gave none"}.`);
      return textResult(lines);
    }
    lines.push(`Picture: ${String(result.after.width)}×${String(result.after.height)} ${result.after.mime}.`);
    return { content: [{ type: "text", text: lines.join("\n") }, imageContent(result.after)] };
  },
});

/** The lines of the result of a run for Claude. */
function runLines(result: Omit<RunInfo, "output">): string[] {
  const images = result.images.slice(0, 12);
  return [
    `${[result.line ?? result.command, ...result.args].join(" ")} · ${result.status} (exit ${String(result.code)}) · run ${result.run}`,
    result.summary === "" ? "No output." : result.summary,
    `Output folder: ${result.outDir ?? "none"}`,
    ...(images.length === 0
      ? []
      : [
          `Images (${String(result.images.length)}):`,
          ...images.map((path) => `  ${path}`),
          ...(result.images.length > images.length ? ["  …"] : []),
        ]),
  ];
}

/** Start a run of the project and wait for its result. */
async function runHandler(input: { command: string; args?: string[] }, ctx: ToolContext): Promise<ToolResult> {
  if (ctx.run === undefined) throw new Error("workbench_run: the host has no runs.");
  return textResult(runLines(await ctx.run(input.command, input.args ?? [])));
}

const RUN_TEXT =
  "Run a run of the project in the checkout: a command of `workbench.runs` of the project manifest or of a host " +
  "plugin. The host adds --dry to a run that the owner must confirm (for example a release). The owner sees the " +
  "output in the Runs tab. Gives the exit code, the last lines, the output folder and the paths of its images (read " +
  "an image with the Read tool).";
const ARGS = z.array(z.string().max(1000)).max(40).optional().describe("The arguments after the command line.");

/**
 * `workbench_run` for the runs of the open project that the agent can start (runCatalog.ts `agentRuns`). The
 * command is an enum of their IDs. A project with no such run gets no tool (null).
 */
export function workbenchRunFor(runs: readonly ProjectRun[]): ToolDef | null {
  const [first, ...rest] = runs.map((run) => run.id);
  if (first === undefined) return null;
  const names = runs.map((run) => (run.label === run.id ? run.id : `${run.id} (${run.label})`)).join(", ");
  return defineTool({
    name: "workbench_run",
    description: `${RUN_TEXT} Runs: ${names}.`,
    input: z.object({ command: z.enum([first, ...rest]).describe("The ID of the run."), args: ARGS }),
    alwaysLoad: false,
    handler: runHandler,
  });
}

/** The place of `workbench_run` in the core tools; `workbenchTools()` sets the runs of the open project. */
export const workbenchRun = defineTool({
  name: "workbench_run",
  description: RUN_TEXT,
  input: z.object({ command: z.string().min(1).describe("The ID of the run."), args: ARGS }),
  alwaysLoad: false,
  handler: runHandler,
});
