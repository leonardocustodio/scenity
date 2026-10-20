// SPDX-License-Identifier: Apache-2.0
/**
 * The agent parts of the plugins on the scene page: the page tools (`pageTools`: tools of
 * the agents that run in the editor window) and the lines of the context packet (`contextLines`). The bridge calls
 * `tools`, `tools.call` and `contextLines` of the scene page read them (sceneBridgeCalls.ts).
 */
import type { PageToolInfo, PageToolResult } from "@scenity/bridge";

/** A page tool of a plugin: its info and its run function. */
export interface PluginPageTool extends PageToolInfo {
  run(input: Record<string, unknown>): Promise<PageToolResult>;
}

const tools = new Map<string, PluginPageTool>();
const lines = new Map<string, () => readonly string[]>();

/** Add a page tool; the result removes it. */
export function addPageTool(tool: PluginPageTool): () => void {
  tools.set(tool.name, tool);
  return () => {
    if (tools.get(tool.name) === tool) tools.delete(tool.name);
  };
}

/** The page tools of the plugins without their run functions. */
export function pluginPageTools(): PageToolInfo[] {
  return [...tools.values()].map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

/** Run a page tool of a plugin. Throws for a name that no tool has. */
export function runPluginPageTool(name: string, input: Record<string, unknown>): Promise<PageToolResult> {
  const tool = tools.get(name);
  if (tool === undefined) {
    const names = [...tools.keys()];
    throw new Error(`No page tool "${name}". Tools: ${names.length === 0 ? "none" : names.join(", ")}.`);
  }
  return tool.run(input);
}

/** Add a source of lines of the context packet; the result removes it. */
export function addContextLines(id: string, source: () => readonly string[]): () => void {
  lines.set(id, source);
  return () => {
    if (lines.get(id) === source) lines.delete(id);
  };
}

/** The lines of the plugins; a source that throws gives no lines. */
export function pluginContextLines(): string[] {
  return [...lines.values()].flatMap((source) => {
    try {
      return [...source()];
    } catch {
      return [];
    }
  });
}
