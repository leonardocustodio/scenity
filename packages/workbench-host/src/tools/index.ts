// SPDX-License-Identifier: Apache-2.0
/**
 * The MCP tools of the workbench. `workbenchTools()` is the one registry: the core tools and the tools of the host
 * plugins of the open project. The host route `GET /tools` lists it with the tools of the page (`allToolListings`).
 * The stdio MCP server (src/mcp.ts) reads that list and sends each call to the host route `POST /tools/<name>`
 * (`handleToolRequest`). The in-process SDK server of the chat mode reads the same registry.
 */
import { z } from "zod";
import { pluginToolNotes, pluginTools } from "../plugins";
import { labBrowse, labOpen } from "./browser";
import { sceneCheck } from "./check";
import { sceneBatch, sceneCommand, sceneCommands } from "./edit";
import type { ToolContext } from "./context";
import { labFrame } from "./frame";
import { errorResult, errorText, type ToolDef, type ToolResult } from "./kit";
import { activeRunCatalog, agentRuns } from "../runCatalog";
import { workbenchAfter, workbenchRun, workbenchRunFor } from "./loop";
import { jobOutput, jobRun, jobRunFor, jobStatus } from "./jobs";
import { studioStateTool, uiHighlight, uiNotify, uiReveal, uiState } from "./ui";
import { labMeasure } from "./measure";
import { pageTools, runPageTool } from "./pageTools";
import { labMarks, labPick } from "./pick";
import { sceneQuery } from "./query";
import { sceneFrame, sceneMeasure } from "./sceneView";
import { scenePick, sceneSheet } from "./scenePick";
import { assetImport, assetSearch } from "./assets";
import { labSheet } from "./sheet";
import { labConsole, labState } from "./state";
import { labTune, labTunes } from "./tune";

export type { ToolContent, ToolDef, ToolResult } from "./kit";
export * from "./context";

/**
 * The core tools of the host: they hold no domain names. The tools of the plugins (plugins.ts) come after them, for
 * example the check, the file and the inspect tools of the host plugin of a project.
 */
export const CORE_TOOLS: readonly ToolDef[] = [
  // The one state call: the agent calls it first.
  studioStateTool,
  labState,
  labFrame,
  labTune,
  labTunes,
  labOpen,
  labBrowse,
  // Point and ask.
  labPick,
  labMarks,
  // The query of the open scene and the commands of the editor. A host plugin can keep old names of these tools as
  // aliases.
  sceneQuery,
  sceneCommands,
  sceneCommand,
  // Many commands as one undo step.
  sceneBatch,
  // A picture and a distance of the open scene (the scene page and the lab).
  sceneFrame,
  sceneMeasure,
  // The pick and the contact sheet of the scene page, and the asset database of the project.
  scenePick,
  sceneSheet,
  assetSearch,
  assetImport,
  // The measure tool (the distance; a plugin can add inputs).
  labMeasure,
  labConsole,
  labSheet,
  workbenchAfter,
  workbenchRun,
  // The CLI commands of the project as jobs.
  jobRun,
  jobStatus,
  jobOutput,
  // The UI tools of the editor window.
  uiState,
  uiReveal,
  uiHighlight,
  uiNotify,
  // The rules of the open project with no browser (`scenity check`).
  sceneCheck,
];

/**
 * The core tools and the tools of the plugins. A plugin tool with the name of a core tool takes its place in the
 * list; the other plugin tools come after the core tools. `notes` adds the examples of the plugins (a tool name → a
 * sentence) to the descriptions of the core tools.
 */
export function composeTools(
  core: readonly ToolDef[],
  plugins: readonly ToolDef[],
  notes: Readonly<Record<string, string>> = {},
): ToolDef[] {
  const byName = new Map(plugins.map((tool) => [tool.name, tool]));
  // A plugin adds the examples of its project to the description of a core tool that it keeps.
  const noted = (tool: ToolDef): ToolDef => {
    const note = notes[tool.name];
    return note === undefined ? tool : { ...tool, description: `${tool.description} ${note}` };
  };
  const tools = core.map((tool) => byName.get(tool.name) ?? noted(tool));
  return [...tools, ...plugins.filter((tool) => !core.some((item) => item.name === tool.name))];
}

/**
 * Every host tool of the workbench MCP server `workbench`, in the order of the list: the core tools and the tools of
 * the host plugins of the open project. The tools of the page come after them (`allToolListings`).
 */
export function workbenchTools(): ToolDef[] {
  // `workbench_run` takes the runs of the open project. A project with no run for the agent has no such tool.
  const runs = agentRuns(activeRunCatalog());
  const run = workbenchRunFor(runs);
  const job = jobRunFor(runs);
  const core = CORE_TOOLS.flatMap((tool) => {
    if (tool === workbenchRun) return run === null ? [] : [run];
    // `job_run` takes the same runs. With no run, there is no job tool.
    if (tool === jobRun) return job === null ? [] : [job];
    if ((tool === jobStatus || tool === jobOutput) && job === null) return [];
    return [tool];
  });
  return composeTools(core, pluginTools(), pluginToolNotes());
}

/** The host tool of a name, or undefined. */
export function toolNamed(name: string): ToolDef | undefined {
  return workbenchTools().find((tool) => tool.name === name);
}

/** The MCP description of a tool: its name, its description, its JSON schema and the load hint of Claude Code. */
export interface ToolListing {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: { readonly type: "object"; readonly [key: string]: unknown };
  readonly _meta?: { readonly "anthropic/alwaysLoad": true };
}

/** The MCP listing of each host tool (tools/list). */
export function toolListings(tools: readonly ToolDef[] = workbenchTools()): ToolListing[] {
  return tools.map((tool) => {
    const schema: Record<string, unknown> = { ...z.toJSONSchema(tool.input, { io: "input" }) };
    delete schema.$schema;
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: { ...schema, type: "object" },
      ...(tool.alwaysLoad ? { _meta: { "anthropic/alwaysLoad": true } as const } : {}),
    };
  });
}

/**
 * The MCP listing of each host tool and of each tool of the page of the visible scene frame. A page that does not
 * answer adds no tools.
 */
export async function allToolListings(ctx: ToolContext): Promise<ToolListing[]> {
  const own = toolListings();
  const page = await pageTools(ctx, new Set(own.map((listing) => listing.name)));
  return [...own, ...page.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))];
}

/** The text of the zod issues of a bad input. */
function issuesText(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length === 0 ? "input" : issue.path.join(".")}: ${issue.message}`)
    .join("; ");
}

/**
 * Run a tool for the host route `POST /tools/<name>`: check the input with the schema of the tool and call its
 * handler. A name that no host tool has goes to the tools of the page (the page checks the input). A bad
 * name, a bad input and a failure of the surface give a tool error with the words of the lab API.
 */
export async function handleToolRequest(name: string, input: unknown, ctx: ToolContext): Promise<ToolResult> {
  const tools = workbenchTools();
  const tool = tools.find((item) => item.name === name);
  if (tool === undefined) return await pageToolRequest(name, input, ctx, tools);
  const parsed = tool.input.safeParse(input ?? {});
  if (!parsed.success) return errorResult(`${name}: bad input: ${issuesText(parsed.error)}.`);
  try {
    return await tool.handler(parsed.data, ctx);
  } catch (error) {
    return errorResult(`${name}: ${errorText(error)}`);
  }
}

/** Run a tool of the page, or give the error of a name that no tool has. */
async function pageToolRequest(
  name: string,
  input: unknown,
  ctx: ToolContext,
  tools: readonly ToolDef[],
): Promise<ToolResult> {
  const page = await pageTools(ctx, new Set(tools.map((item) => item.name)));
  if (!page.some((item) => item.name === name)) {
    const names = [...tools, ...page].map((item) => item.name).join(", ");
    return errorResult(`No workbench tool "${name}". Tools: ${names}.`);
  }
  try {
    return await runPageTool(ctx, name, input);
  } catch (error) {
    return errorResult(`${name}: ${errorText(error)}`);
  }
}
