// SPDX-License-Identifier: Apache-2.0
/**
 * The tools of the host faces of the plugins of a project: the `tools` of the module of `scenity.host` of each plugin
 * (else `host.ts` or `src/host.ts`). The workbench host reads the same face. The agent sessions of the project get
 * them beside the core tools. The person runs them from the search box of the editor window (`/api/agent/tools`). A
 * restricted project (not trusted, or a studio in safe mode) gives none. The host does not include a tool with the
 * name of a core tool, or a tool with no name, description, input schema or handler. It shows a warning for each.
 * The tools of a project load at the first request. A change of its plugins needs `forget`.
 */
import { pathToFileURL } from "node:url";
import { listingsOf, runToolOf, type ToolDef } from "@scenity/agent-tools";
import type { BridgeHub } from "../bridgeHub";
import { sessionPort } from "./session";
import { resolveProjectPlugins } from "@scenity/cli/plugins";

const NAME = /^[a-z][a-z0-9_]{0,63}$/;

/** True when a value is a tool that the studio can run. */
function isTool(value: unknown): value is ToolDef {
  if (typeof value !== "object" || value === null) return false;
  const tool = value as Partial<ToolDef>;
  return (
    typeof tool.name === "string" &&
    NAME.test(tool.name) &&
    typeof tool.description === "string" &&
    typeof (tool.input as { safeParse?: unknown } | undefined)?.safeParse === "function" &&
    typeof tool.handler === "function"
  );
}

/** The tools of the host faces of a project folder. `core` names the tools that a plugin cannot replace. */
export async function loadPluginTools(dir: string, core: ReadonlySet<string>): Promise<ToolDef[]> {
  const found = await resolveProjectPlugins(dir).catch(() => null);
  if (found === null) return [];
  const all = await Promise.all(
    found.plugins.map(async (plugin) => {
      if (plugin.host === undefined) return [];
      try {
        const module = (await import(pathToFileURL(plugin.host).href)) as { default?: { tools?: unknown } };
        const tools = Array.isArray(module.default?.tools) ? (module.default.tools as unknown[]) : [];
        return tools.filter((tool): tool is ToolDef => {
          if (isTool(tool) && !core.has(tool.name)) return true;
          console.warn(
            `[studio] a tool of ${plugin.host} is not a tool of the studio (or has the name of a core tool)`,
          );
          return false;
        });
      } catch (error) {
        console.warn(
          `[studio] the host face ${plugin.host} does not load:`,
          error instanceof Error ? error.message : error,
        );
        return [];
      }
    }),
  );
  return all.flat();
}

/** The tools of the plugins of each project: a cache that loads at the first request. */
export class PluginTools {
  readonly #byDir = new Map<string, readonly ToolDef[]>();
  readonly #loading = new Map<string, Promise<readonly ToolDef[]>>();
  readonly #options: {
    /** The folder of a project, or null. Null for a restricted project too. */
    dirOf(project: string): string | null;
    readonly core: ReadonlySet<string>;
  };

  constructor(options: { dirOf(project: string): string | null; readonly core: ReadonlySet<string> }) {
    this.#options = options;
  }

  /** The current tools of the project (the first request starts the load and gives none). */
  get(project: string): readonly ToolDef[] {
    const dir = this.#options.dirOf(project);
    if (dir === null) return [];
    void this.load(project);
    return this.#byDir.get(dir) ?? [];
  }

  /** Load the tools of a project (once). */
  load(project: string): Promise<readonly ToolDef[]> {
    const dir = this.#options.dirOf(project);
    if (dir === null) return Promise.resolve([]);
    let loading = this.#loading.get(dir);
    if (loading === undefined) {
      loading = loadPluginTools(dir, this.#options.core).then((tools) => {
        this.#byDir.set(dir, tools);
        return tools;
      });
      this.#loading.set(dir, loading);
    }
    return loading;
  }

  /** Forget the tools of a project folder (its plugins changed, or a trust came). */
  forget(dir: string): void {
    this.#byDir.delete(dir);
    this.#loading.delete(dir);
  }
}

/**
 * The routes of the editor window. `GET /api/agent/tools?project=<key>` gives the listings of the tools of the
 * plugins (their JSON Schemas make the forms of the search box). `POST /api/agent/tools/run` with
 * `{ project, name, input }` runs one for the person. Its context has the editor windows of the project and no session.
 */
export async function pluginToolApi(tools: PluginTools, hub: BridgeHub, request: Request, url: URL): Promise<Response> {
  const json = (value: unknown, status = 200): Response => Response.json(value, { status });
  if (url.pathname === "/api/agent/tools" && request.method === "GET") {
    return json({ tools: listingsOf(await tools.load(url.searchParams.get("project") ?? "")) });
  }
  if (url.pathname === "/api/agent/tools/run" && request.method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { project?: unknown; name?: unknown; input?: unknown };
    const project = typeof body.project === "string" ? body.project : "";
    const context = { surface: () => sessionPort(hub, project), session: { id: "person", name: "You" } };
    const result = await runToolOf(await tools.load(project), String(body.name), body.input ?? {}, context);
    return json(result);
  }
  return json({ error: "no such tool path" }, 404);
}
