// SPDX-License-Identifier: Apache-2.0
/**
 * The HTTP routes of the agent parts of the host. The stdio MCP server calls `GET /tools/` (the tool list) and
 * `POST /tools/<name>`. The `http` hooks of the CLI call `POST /hooks/<event>`. A client reads the packet at
 * `GET /context?surface=<id>`. The server of the host checks the token before it calls this handler (server.ts
 * `HttpHandler`), so the handler does not check it again. A path that it does not know gives null (404).
 */
import { handleHook, isHookEvent, type HookDeps } from "./hooks";
import { HOST_PATHS } from "./protocol";
import { TERMINAL_HEADER } from "./settings";
import { allToolListings, handleToolRequest } from "./tools/index";
import type { FrontPackets } from "./frontPacket";
import type { ToolContext } from "./tools/context";
import type { Role } from "./roleProtocol";

export interface AgentHttpDeps {
  /** The tool context of the current open checkout. */
  context(): ToolContext;
  readonly hooks: HookDeps;
  /** The packets by surface. Without a surface, the packet of the surface in front. */
  readonly front: FrontPackets;
}

async function jsonBody(request: Request): Promise<unknown> {
  const body = await request.text();
  if (body.trim() === "") return {};
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

/** The workbench terminal of a hook (the header that the generated settings add), or null. */
export function hookTerminal(request: Request): string | null {
  const value = request.headers.get(TERMINAL_HEADER) ?? "";
  return /^(claude|shell)-[\w-]{1,64}$/.test(value) ? value : null;
}

function badJson(): Response {
  return Response.json({ ok: false, error: "The body is not JSON." }, { status: 400 });
}

/** Make the handler of `/tools/`, `/hooks/` and `/context`. */
export function createAgentHttp(
  deps: AgentHttpDeps,
): (request: Request, url: URL, role?: Role) => Promise<Response | null> {
  return async (request, url, role) => {
    const path = url.pathname;
    // The tools of the host, of the plugins of the project and of the page.
    if (path === HOST_PATHS.tools && request.method === "GET") {
      return Response.json({ tools: await allToolListings(deps.context()) });
    }
    if (path.startsWith(HOST_PATHS.tools) && request.method === "POST") {
      const input = await jsonBody(request);
      if (input === undefined) return badJson();
      const name = decodeURIComponent(path.slice(HOST_PATHS.tools.length));
      // The role of the caller goes to the tools (a viewer cannot import an asset).
      const context = role === undefined ? deps.context() : { ...deps.context(), role };
      return Response.json(await handleToolRequest(name, input, context));
    }
    if (path.startsWith(HOST_PATHS.hooks) && request.method === "POST") {
      const event = path.slice(HOST_PATHS.hooks.length);
      if (!isHookEvent(event)) return null;
      const payload = await jsonBody(request);
      if (payload === undefined) return badJson();
      return Response.json(await handleHook(event, payload, deps.hooks, hookTerminal(request)));
    }
    if (path === HOST_PATHS.context && request.method === "GET") {
      // A request without a surface gets the packet of the surface in front.
      const packet = await deps.front.packet(url.searchParams.get("surface"));
      return new Response(packet?.text ?? "", { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    return null;
  };
}
