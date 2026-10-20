// SPDX-License-Identifier: Apache-2.0
/**
 * The state tools of the workbench. `lab_state` gives the context packet and the lab state as JSON. `lab_console`
 * gives the console errors and warnings of the lab page since the last call, and the state of the dev server.
 */
import { z } from "zod";
import { buildPacket, serverLine } from "../context";
import { pluginContext } from "../plugins";
import { call, cut, defineTool, portOf, textResult } from "./kit";
import { whereInput } from "./frame";

export const labState = defineTool({
  name: "lab_state",
  description:
    "What the owner looks at now: the context packet of the workbench (checkout, lab URL, take, clock, camera, open " +
    "item, the clip and family of each member, the failing checks, the tunes, the console) and the lab state as " +
    "JSON (members and the parts of the plugin).",
  input: z.object({ where: whereInput }),
  alwaysLoad: true,
  async handler(input, ctx) {
    const packet = await buildPacket(ctx);
    const state = await call(portOf(ctx, input.where), "state");
    // A host plugin gives the short state (without the long parts). Without a plugin, the state does not change.
    return textResult([packet.text, `Lab state: ${JSON.stringify(pluginContext().summary(state))}`]);
  },
});

/** The longest text of one console entry in a result. */
const ENTRY_CHARS = 400;

export const labConsole = defineTool({
  name: "lab_console",
  description:
    "The console errors and warnings of the lab page since the last lab_console call (the Vite error overlay " +
    "included), and the state of the dev server. With clear false, the entries stay for the next call.",
  input: z.object({
    clear: z.boolean().optional().describe("Forget the entries after this call (default true)."),
  }),
  alwaysLoad: false,
  async handler(input, ctx) {
    const port = ctx.surface("visible");
    let note = "";
    try {
      await ctx.consoleLog.pull(port);
    } catch (error) {
      note = ` (the frame did not answer: ${error instanceof Error ? error.message : String(error)})`;
    }
    const { errors, warnings } = ctx.consoleLog.peek();
    if (input.clear !== false) ctx.consoleLog.clear();
    const entry = (item: string): string => `  ${item.length > ENTRY_CHARS ? `${item.slice(0, ENTRY_CHARS)}…` : item}`;
    const lines = [`Console of the lab: ${String(errors.length)} errors, ${String(warnings.length)} warnings${note}.`];
    if (errors.length > 0) lines.push("Errors:", ...cut(errors, 10, entry));
    if (warnings.length > 0) lines.push("Warnings:", ...cut(warnings, 6, entry));
    lines.push(serverLine(ctx.server?.() ?? null, ctx.checkout, ctx.now?.() ?? new Date()));
    return textResult(lines);
  },
});
