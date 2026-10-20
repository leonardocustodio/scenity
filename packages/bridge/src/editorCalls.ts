// SPDX-License-Identifier: Apache-2.0
/**
 * The calls of the editor core: a scene page of the editor serves them with or without a
 * plugin. The workbench host sends them with `callTyped`.
 *
 * - `inspect`: the inspect report of the last frame (an object of the page), or null before the first frame.
 * - `command` (args `[id, args?, how?]`): run a command of the command registry of the editor.
 * - `commandBatch` (args `[steps, title?, how?]`): run a list of commands as one step of the history.
 * - `tools`: the tools of the page (the editor plugins give them): a name, a description and a JSON Schema of the
 *   input. The host adds them to the MCP tool list.
 * - `tools.call` (args `[name, input]`): run one tool of the page. The page checks the input.
 * - `contextLines`: the lines of the context packet that the page gives (the editor plugins give them).
 */
import { argError, defineBridgeCall, noArgs } from "./define";
import { isObject } from "./envelope";

/** The form of the name of a page tool: a lowercase letter, then lowercase letters, digits and `_`. */
export const PAGE_TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;

/** The JSON Schema of the input of a page tool: an object schema. */
export interface PageToolSchema {
  readonly type: "object";
  readonly [key: string]: unknown;
}

/** One tool of the page, as the host lists it. */
export interface PageToolInfo {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: PageToolSchema;
}

/** The result of one tool of the page: a text, and true when the tool failed. */
export interface PageToolResult {
  readonly text: string;
  readonly isError: boolean;
}

/** The checked arguments of `command`: the command ID, then the arguments and the options as the page reads them. */
export type CommandArgs = [id: string, ...rest: unknown[]];

/** Check the arguments of `command`: the ID is a text that is not empty. The other arguments pass as they are. */
export function commandArgsOf(raw: readonly unknown[]): CommandArgs {
  const [id, ...rest] = raw;
  if (typeof id !== "string" || id.trim() === "") argError("command", "the command ID must be a text.");
  return [id, ...rest];
}

/** Read the result of `inspect`: an object, or null. */
export function readInspect(raw: unknown): Record<string, unknown> | null {
  if (raw === null || raw === undefined) return null;
  if (!isObject(raw)) throw new Error("inspect: the frame gave no report.");
  return raw;
}

/** Read one tool of the page, or null for a bad entry. */
function pageToolOf(raw: unknown): PageToolInfo | null {
  if (!isObject(raw)) return null;
  const { name, description, inputSchema } = raw;
  if (typeof name !== "string" || !PAGE_TOOL_NAME.test(name) || typeof description !== "string") return null;
  if (!isObject(inputSchema) || inputSchema.type !== "object") return null;
  return { name, description, inputSchema: inputSchema as PageToolSchema };
}

/** Read the result of `tools`: the valid tools in their order. A bad list gives an empty list. */
export function readPageTools(raw: unknown): PageToolInfo[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.flatMap((item) => {
    const tool = pageToolOf(item);
    if (tool === null || seen.has(tool.name)) return [];
    seen.add(tool.name);
    return [tool];
  });
}

/** Check the arguments of `tools.call`: the name of a tool and its input object (absent: an empty object). */
export function pageToolArgsOf(raw: readonly unknown[]): [name: string, input: Record<string, unknown>] {
  const [name, input] = raw;
  if (typeof name !== "string" || !PAGE_TOOL_NAME.test(name)) argError("tools.call", "the tool name is not valid.");
  if (input !== undefined && input !== null && !isObject(input)) argError("tools.call", "the input must be an object.");
  return [name, isObject(input) ? input : {}];
}

/** Read the result of `tools.call`: a text gives a result without an error. */
export function readPageToolResult(raw: unknown): PageToolResult {
  if (typeof raw === "string") return { text: raw, isError: false };
  if (!isObject(raw) || typeof raw.text !== "string") throw new Error("tools.call: the page gave no tool result.");
  return { text: raw.text, isError: raw.isError === true };
}

/** Read the result of `contextLines`: the texts of a list. A bad list gives an empty list. */
export function readContextLines(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((line): line is string => typeof line === "string") : [];
}

/** The editor call `inspect`. */
export const INSPECT_CALL = defineBridgeCall({ name: "inspect", args: noArgs, result: readInspect });
/** The editor call `command`. */
export const COMMAND_CALL = defineBridgeCall({ name: "command", args: commandArgsOf });
/** The arguments of `commandBatch`: the steps (each a command ID and its arguments), the title, the `how`. */
export type CommandBatchArgs = [
  steps: readonly { readonly command: string; readonly args?: Readonly<Record<string, unknown>> }[],
  title?: string,
  how?: unknown,
];

function commandBatchArgsOf(raw: readonly unknown[]): CommandBatchArgs {
  const [steps, title, how] = raw;
  if (!Array.isArray(steps) || steps.length === 0) argError("commandBatch", "the steps are a list that is not empty.");
  for (const step of steps) {
    if (!isObject(step) || typeof step.command !== "string" || step.command === "")
      argError("commandBatch", "each step has a command ID.");
    if (step.args !== undefined && !isObject(step.args))
      argError("commandBatch", "the arguments of a step are an object.");
  }
  if (title !== undefined && typeof title !== "string") argError("commandBatch", "the title is a text.");
  return [
    steps as CommandBatchArgs[0],
    ...(title === undefined ? [] : [title]),
    ...(how === undefined ? [] : [how]),
  ] as CommandBatchArgs;
}

/** The editor call `commandBatch`: the steps apply all or none, as one named step of the history. */
export const COMMAND_BATCH_CALL = defineBridgeCall({ name: "commandBatch", args: commandBatchArgsOf });
/** The editor call `tools`. */
export const PAGE_TOOLS_CALL = defineBridgeCall({ name: "tools", args: noArgs, result: readPageTools });
/** The editor call `tools.call`. */
export const PAGE_TOOL_CALL = defineBridgeCall({
  name: "tools.call",
  args: pageToolArgsOf,
  result: readPageToolResult,
});
/** The editor call `contextLines`. */
export const CONTEXT_LINES_CALL = defineBridgeCall({ name: "contextLines", args: noArgs, result: readContextLines });

/** The editor calls whose arguments the page checks before the method of the script API runs. */
export const EDITOR_CALLS = [INSPECT_CALL, COMMAND_CALL] as const;
