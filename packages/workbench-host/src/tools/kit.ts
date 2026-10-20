// SPDX-License-Identifier: Apache-2.0
/**
 * The tool kit of the workbench host: the kit of `@scenity/agent-tools`, with the tool definition over the context of
 * this host (`ToolContext`: the index, the console log, the runs and the other parts).
 */
import type { z } from "zod";
import { defineTool as defineSharedTool, type ToolDef as SharedToolDef } from "@scenity/agent-tools/kit";
import type { ToolContext } from "./context";

export * from "@scenity/agent-tools/kit";

/** A tool of this host: its handler reads the context of the host. */
export type ToolDef<S extends z.ZodObject = z.ZodObject> = SharedToolDef<S, ToolContext>;

/** Define a tool of this host. The function only gives the types. */
export function defineTool<S extends z.ZodObject>(tool: ToolDef<S>): ToolDef<S> {
  return defineSharedTool(tool);
}
