// SPDX-License-Identifier: Apache-2.0
/**
 * The tools of the workbench for Scenity Studio: a small server that runs the tools of the
 * host against the editor windows of a studio host, with no workbench page. `POST /tools/<name>` with the tool input
 * runs a tool (the header `x-workbench-token` carries the token of this server) and gives its result. The surface of
 * each tool is the page bridge of the studio (studioPort.ts).
 *
 *   bun packages/workbench-host/src/studioTools.ts --studio <origin> --token <studio secret> [--port <port>]
 *
 * It prints `SCENITY_STUDIO_TOOLS_READY {"origin":…,"token":…}` when it listens.
 */
import { randomBytes } from "node:crypto";
import { studioSurfacePort } from "./studioPort";
import { makeToolContext } from "./tools/context";
import { handleToolRequest } from "./tools/index";

/** The header of the token of this server. */
export const TOOLS_TOKEN_HEADER = "x-workbench-token";

/** The options of the server. */
export interface StudioToolsOptions {
  readonly studio: string;
  readonly studioToken: string;
  readonly port: number;
  readonly checkout: string;
}

/** Start the server; its origin, its token and the stop. */
export function startStudioTools(options: StudioToolsOptions): { origin: string; token: string; stop(): void } {
  const token = randomBytes(24).toString("hex");
  const surface = studioSurfacePort(options.studio, options.studioToken);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: options.port,
    async fetch(request) {
      const url = new URL(request.url);
      const name = /^\/tools\/([a-z_]+)$/.exec(url.pathname)?.[1];
      if (request.method !== "POST" || name === undefined)
        return Response.json({ error: "POST /tools/<name>" }, { status: 404 });
      if (request.headers.get(TOOLS_TOKEN_HEADER) !== token)
        return Response.json({ error: "the token is not valid" }, { status: 401 });
      const input: unknown = await request.json().catch(() => ({}));
      const ctx = makeToolContext({ surface: () => surface, checkout: options.checkout });
      return Response.json(await handleToolRequest(name, input, ctx));
    },
  });
  return { origin: `http://127.0.0.1:${String(server.port)}`, token, stop: () => void server.stop(true) };
}

/** The value of a flag of the command line, or undefined. */
function flag(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const studio = flag(args, "--studio");
  const studioToken = flag(args, "--token");
  if (studio === undefined || studioToken === undefined) {
    console.error("usage: studioTools.ts --studio <origin> --token <studio secret> [--port <port>]");
    process.exit(2);
  }
  const started = startStudioTools({
    studio,
    studioToken,
    port: Number(flag(args, "--port") ?? "0"),
    checkout: process.cwd(),
  });
  console.log(`SCENITY_STUDIO_TOOLS_READY ${JSON.stringify({ origin: started.origin, token: started.token })}`);
}
