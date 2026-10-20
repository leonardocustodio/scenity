// SPDX-License-Identifier: Apache-2.0
/**
 * The command `scenity mcp`: the MCP server of Scenity Studio over stdio, for an external agent (Claude Code, Codex,
 * Cursor, Claude Desktop):
 *
 *   scenity mcp [--name <client>] [--project <key>] [--studio <origin>] [--state <dir>]
 *
 * It runs `src/mcp.ts` of the studio host (the source of a checkout, else the installed `@scenity/studio-host`) with
 * the stdio of this command. The studio must run; the owner allows the connection in the studio.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { CommandResult } from "../args";
import { checkoutRoot } from "../workspace";
import { STUDIO_HOST } from "./command";

export const MCP_USAGE = "scenity mcp [--name <client>] [--project <key>] [--studio <origin>] [--state <dir>]";
export const MCP_HELP = [
  `usage: ${MCP_USAGE}`,
  "Serve the tools of Scenity Studio over MCP (stdio) for an external agent. The studio must run (scenity studio);",
  "the owner allows the connection in the agent panel or in Hub → Agents. --name: the name of the agent in the",
  "studio (default: An external agent). --project: the project key of its session (default: the owner chooses).",
  "Setup: claude mcp add scenity -- scenity mcp --name 'Claude Code'",
];

/** The entry of the MCP server: the source of a checkout, else the installed studio host, or null. */
export function mcpEntry(checkout: string | null = checkoutRoot()): string | null {
  if (checkout !== null) {
    const entry = join(checkout, "packages", "studio-host", "src", "mcp.ts");
    if (existsSync(entry)) return entry;
  }
  for (const from of [process.cwd(), import.meta.dir]) {
    try {
      return Bun.resolveSync(`${STUDIO_HOST}/mcp`, from);
    } catch {
      // Not installed there.
    }
  }
  return null;
}

export async function runMcpCommand(argv: readonly string[]): Promise<CommandResult> {
  const entry = mcpEntry();
  if (entry === null) return { out: [`scenity mcp: install ${STUDIO_HOST} (bun add -d ${STUDIO_HOST})`], code: 1 };
  const child = spawn(process.execPath, [entry, ...argv], { stdio: "inherit" });
  const code = await new Promise<number>((done) => child.on("exit", (exit) => done(exit ?? 1)));
  return { out: [], code };
}
