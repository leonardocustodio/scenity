// SPDX-License-Identifier: Apache-2.0
/**
 * The studio host: one server on 127.0.0.1 and a fixed port that needs no project. It keeps these paths and forwards
 * every other path (and the Vite HMR WebSocket) to its one scene server:
 *
 * - `/health`: the state of the host, with no access check;
 * - `/launch?code=…&next=…`: a launch code becomes the session cookies, then a redirect;
 * - `/p/<key>`: a redirect to the editor page of a project. A project of the registry that closed because it was idle
 *   opens again first, and the redirect waits until the scene server has it;
 * - `/api/…`: the API (api.ts); `/events`: a WebSocket of the changes of the projects and the jobs;
 * - `/bridge`: the WebSocket of the page bridge of the editor windows; `/api/bridge/<call>`: a call of a tool to the
 *   newest editor window (bridgeHub.ts); `/api/documents/run`: a scene command on a scene file with no window
 *   (documents.ts), and the ops of a change go to the windows of the scene; `/api/documents/log`: the version and the
 *   last steps of a scene in the order of the host (documentLog.ts);
 * - `/api/agent/…`: the agent sessions of the projects (agents/routes.ts). Their events go on `/events`.
 *   `POST /api/agent/choose-template`: the agent chooses the template of a new project (agents/chooseTemplate.ts);
 * - `/mcp`: the MCP server over HTTP (agents/mcpHttp.ts): the token of a connection, no session cookie;
 * - `/`: the Hub page (`hub.html` of the scene server).
 *
 * In the remote mode (`publicOrigin`), the host stays on 127.0.0.1 behind the gateway of the studio (gateway.ts). It
 * opens no shell terminal, and a file write of an agent asks in each mode (no Auto mode for file writes).
 */
import { agentApi } from "./agents/routes";
import { AgentSessions } from "./agents/sessions";
import { PluginTools, pluginToolApi } from "./agents/pluginTools";
import { MCP_PATH, mcpHttp } from "./agents/mcpHttp";
import { HOST_TOOLS } from "./agents/hostTools";
import { STUDIO_TOOLS } from "@scenity/agent-tools";
import { readKindValues, stricter, type AgentRole } from "./agents/permissions";
import { UsageLedger } from "./agents/limits";
import { claudeWithStudio, terminalApi, Terminals, type TerminalKind } from "./terminals";
import type { AgentDriver } from "./agents/driver";
import { BridgeHub } from "./bridgeHub";
import { PoolFrames } from "./poolFrames";
import { cliCommand } from "./runtime";
import { SHADOW_FRAME_CALL } from "@scenity/bridge";
import { runDocumentCommand } from "./documents";
import { chooseTemplateApi } from "./agents/chooseTemplate";
import type { Server, ServerWebSocket } from "bun";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ServerChild } from "./process";
import { StudioAccess } from "./access";
import { editorUrl, handleApi, json, openProject, type ApiContext } from "./api";
import { Folders } from "./folders";
import { JobService, type JobInfo } from "./jobs";
import { OpenProjects } from "./openProjects";
import {
  closeProxySocket,
  forwardHttp,
  openProxySocket,
  proxyMessage,
  proxySocketData,
  type ProxySocket,
} from "./proxy";
import { ProjectRegistry } from "./registry";
import { UserState } from "./userState";

export interface StudioOptions {
  readonly port: number;
  /** The studio state folder (store.ts `studioStateDir`). */
  readonly stateDir: string;
  /** The command line of the `scenity` CLI for the pictures of the scene pool (default: `cliCommand()`). */
  readonly cli?: readonly string[];
  /** The scene server; null in a test with no pages. */
  readonly sceneServer: (projectsFile: string) => SceneServer | null;
  /** The editor app folder (for the doctor), or null. */
  readonly editorApp?: string | null;
  /** The folders that the folder dialog may list (default: the home folder). */
  readonly roots?: readonly string[];
  /** A project with no request for this time closes (default 30 minutes). */
  readonly idleMs?: number;
  readonly safe?: boolean;
  readonly log?: (line: string) => void;
  /** The driver of the agent sessions (the Claude driver, or a script in a test); none: no sessions. */
  readonly agents?: AgentDriver | null;
  /** The program of a terminal (a test gives another). Default: claude with the studio MCP, or the shell. */
  readonly terminalProgram?: (kind: TerminalKind, cwd: string, project: string) => readonly string[];
  /** The public origin of the studio behind the gateway (the remote mode), or null. */
  readonly publicOrigin?: string | null;
}

export interface Studio {
  readonly origin: string;
  readonly access: StudioAccess;
  readonly context: ApiContext;
  /** The page bridge of the editor windows. */
  readonly bridge: BridgeHub;
  /** The terminals of the projects. */
  readonly terminals: Terminals;
  /** The agent sessions, or null with no driver. */
  readonly agents: AgentSessions | null;
  /** A launch link of the studio that opens `next` (default the Hub). */
  launchUrl(next?: string): string;
  stop(): Promise<void>;
}

interface EventSocket {
  readonly kind: "events";
  /** The role of the page. Only the owner gets the output of the terminals. */
  readonly role: AgentRole;
}
/** A socket of the page bridge of an editor window. */
interface BridgePageSocket {
  readonly kind: "bridge";
}
type SocketData = EventSocket | BridgePageSocket | ProxySocket;

const HOST_PATHS = ["/api/", "/events", "/launch", "/health", "/p/"];
const LOCKED = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Scenity Studio</title></head>
<body style="font:15px system-ui;margin:3rem;background:#161616;color:#f2f0ec"><h1>Scenity Studio</h1>
<p>This browser has no session of the studio. Run <code>scenity studio</code> in a terminal: it opens the studio here.</p>
</body></html>`;

/** The project key of a page request (`?project=` or `/projects/<key>/`), or null. */
export function projectOfRequest(url: URL): string | null {
  return url.searchParams.get("project") ?? /^\/projects\/([a-z0-9-]+)\//.exec(url.pathname)?.[1] ?? null;
}

/** Wait (at most 5 s) until the scene server at `origin` serves the project file of a project. */
async function waitForProject(origin: string | null, key: string): Promise<void> {
  if (origin === null) return;
  for (let tries = 0; tries < 50; tries += 1) {
    const answer = await fetch(`${origin}/projects/${key}/scenity.project.json`).catch(() => null);
    if (answer?.ok === true) return;
    await Bun.sleep(100);
  }
}

/**
 * `POST /api/launch-code` with `{ role?, next?, review? }` (the owner only): a launch link of a role (`viewer`,
 * `editor` or `admin`, the default) that opens `next` (a path of the host). With the role `viewer`, `review` gives a
 * code that works for 7 days.
 */
async function launchCodeApi(access: StudioAccess, request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { role?: unknown; next?: unknown; review?: unknown };
  const role = body.role === "viewer" || body.role === "editor" ? body.role : "admin";
  const next = typeof body.next === "string" ? `&next=${encodeURIComponent(safeNext(body.next))}` : "";
  // The code of a review link of a viewer lasts 7 days.
  const code = access.launchCode(role, role === "viewer" && body.review === true);
  return json({ url: `${access.linkOrigin}/launch?code=${code}${next}`, role });
}

/** A safe `next` path of a launch link: a path on this host, else `/`. */
export function safeNext(next: string | null): string {
  return next !== null && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

/** What the host needs of its scene server (a `DevServer`, or a fake in a test). */
export type SceneServer = Pick<ServerChild, "info" | "start" | "stop">;

interface Parts {
  readonly context: ApiContext;
  readonly access: StudioAccess;
  readonly bridge: BridgeHub;
  readonly agents: AgentSessions | null;
  /** The driver of the agents (the choice of a template), or null. */
  readonly driver: AgentDriver | null;
  /** The tools of the host faces of the plugins of each project. */
  readonly pluginTools: PluginTools;
  readonly pool: PoolFrames;
  readonly terminals: Terminals;
  readonly scene: SceneServer | null;
  readonly sockets: Set<ServerWebSocket<SocketData>>;
}

/** The parts of a studio host: the state, the projects, the jobs, the access and the scene server. */
function studioParts(options: StudioOptions, origin: string): Parts {
  const state = new UserState(options.stateDir);
  const open = new OpenProjects(join(options.stateDir, "projects.json"));
  const sockets = new Set<ServerWebSocket<SocketData>>();
  const broadcast = (event: unknown): void => {
    const text = JSON.stringify(event);
    // Only the owner gets the output of the terminals.
    const type = (event as { readonly type?: unknown }).type;
    const owner = typeof type === "string" && type.startsWith("terminal.");
    for (const ws of sockets) if (ws.data.kind === "events" && (!owner || ws.data.role === "admin")) ws.send(text);
  };
  const remote = (options.publicOrigin ?? null) !== null;
  const jobs = new JobService({
    onState: (job: JobInfo) => broadcast({ type: "jobs.state", job }),
    onOutput: (job: JobInfo, text: string) => broadcast({ type: "jobs.output", id: job.id, text }),
  });
  const context: ApiContext = {
    state,
    registry: new ProjectRegistry(state),
    open,
    // The roots of the folder dialog and of the jobs (main.ts gives the `--root` folders and the checkout).
    folders: new Folders(options.roots ?? [homedir()]),
    jobs,
    editorApp: options.editorApp ?? null,
    safe: options.safe ?? false,
    origin,
    changed: () => broadcast({ type: "projects.changed" }),
  };
  const bridge = new BridgeHub();
  // A picture of an agent for a project with no window comes from a warm page of the scene pool.
  const pool = new PoolFrames({
    cli: options.cli ?? cliCommand(),
    dirOf: (project) => dirOfProject(context, project),
    tmp: join(options.stateDir, "frames"),
  });
  bridge.noWindow = (project, call, args) =>
    call === SHADOW_FRAME_CALL.name ? pool.frame(project, SHADOW_FRAME_CALL.args(args)[0]) : null;
  // A restricted project (not trusted, or safe mode) gives no tool of its plugins.
  const pluginTools = new PluginTools({
    dirOf: (project) => {
      const entry = context.registry.byKey(project);
      const info = entry === undefined ? null : context.registry.info(entry);
      if (info === null || context.safe || (info.runsCode && !info.trusted)) return null;
      return dirOfProject(context, project);
    },
    core: new Set([...STUDIO_TOOLS, ...HOST_TOOLS].map((tool) => tool.name)),
  });
  const driver = options.agents ?? null;
  const agents =
    driver === null
      ? null
      : new AgentSessions({
          driver,
          hub: bridge,
          dirOf: (project) => open.get(project)?.dir ?? context.registry.byKey(project)?.dir ?? null,
          pluginTools: (project) => pluginTools.get(project),
          emit: broadcast,
          jobs,
          ledger: new UsageLedger(join(options.stateDir, "agent-usage.json")),
          tasksFile: join(options.stateDir, "agent-tasks.json"),
          preferences: () => {
            const { kinds, budgetUsd } = state.preferences.read().agent;
            const values = readKindValues(kinds);
            // In remote mode a file write of an agent asks in each mode.
            return {
              kinds: remote ? { ...values, files: stricter(values.files ?? "allow", "ask") } : values,
              budgetUsd,
            };
          },
        });
  // The terminals. The kind `claude` gets the MCP server of the studio.
  const terminals = new Terminals({
    emit: broadcast,
    program: options.terminalProgram ?? claudeWithStudio(options.stateDir, join(import.meta.dir, "mcp.ts")),
    refuseShell: remote,
  });
  return {
    context,
    access: new StudioAccess(options.stateDir, origin, Date.now, options.publicOrigin ?? null),
    bridge,
    agents,
    driver,
    pluginTools,
    pool,
    terminals,
    scene: options.sceneServer(open.file),
    sockets,
  };
}

function refuse(status: number, reason: string, page = false): Response {
  return page && status === 401
    ? new Response(LOCKED, { status, headers: { "content-type": "text/html" } })
    : json({ error: reason }, status);
}

/** The answer of `/launch`: the session cookies of a launch code, then a redirect to `next`. */
function launch(parts: Parts, request: Request, url: URL): Response {
  const cookies = parts.access.hostAllowed(request) ? parts.access.useCode(url.searchParams.get("code") ?? "") : null;
  if (cookies === null) return refuse(401, "the launch code is not valid", true);
  const headers = new Headers({ location: safeNext(url.searchParams.get("next")) });
  for (const cookie of parts.access.cookies(cookies.session, cookies.csrf)) headers.append("set-cookie", cookie);
  return new Response(null, { status: 303, headers });
}

/**
 * The bridge API of the tools: `GET /api/bridge` lists the editor windows. `POST /api/bridge/<call>` with
 * `{ args?, project?, timeoutMs? }` sends the call to the newest window (of the project) and gives `{ result }`.
 */
async function bridgeApi(hub: BridgeHub, request: Request, url: URL): Promise<Response> {
  if (url.pathname === "/api/bridge" && request.method === "GET") return json({ pages: hub.pages() });
  const call = decodeURIComponent(url.pathname.slice("/api/bridge/".length));
  if (request.method !== "POST" || call === "") return json({ error: "POST /api/bridge/<call>" }, 405);
  const body = (await request.json().catch(() => ({}))) as { args?: unknown; project?: unknown; timeoutMs?: unknown };
  const args = Array.isArray(body.args) ? body.args : [];
  const options = {
    ...(typeof body.project === "string" ? { project: body.project } : {}),
    ...(typeof body.timeoutMs === "number" ? { timeoutMs: Math.min(body.timeoutMs, 300_000) } : {}),
  };
  try {
    return json({ result: await hub.call(call, args, options) });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 502);
  }
}

/**
 * `GET /api/documents/log?project=…&path=…&since=…`: the version of a scene and its steps after `since` (the
 * changes of the windows and of the agents, in the order of the host).
 */
function documentLogApi(parts: Parts, url: URL): Response {
  const project = url.searchParams.get("project");
  const path = url.searchParams.get("path");
  if (project === null || path === null) return json({ error: "a project and a path" }, 400);
  const since = Number(url.searchParams.get("since") ?? "0");
  return json({
    version: parts.bridge.log.version(project, path),
    steps: parts.bridge.log.steps(project, path, Number.isFinite(since) ? since : 0),
  });
}

/**
 * `POST /api/documents/run` with `{ project, path, command, args?, actor? }`: an agent edits a scene of a project
 * with no open window. The host writes the file and sends the ops to the open windows of the scene.
 */
async function documentApi(parts: Parts, request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { project, path, command } = body;
  if (typeof project !== "string" || typeof path !== "string" || typeof command !== "string")
    return json({ error: "give the project, the path of the scene and the command" }, 400);
  const dir = parts.context.open.get(project)?.dir ?? parts.context.registry.byKey(project)?.dir;
  if (dir === undefined) return json({ error: `no project ${project}` }, 404);
  const args = typeof body.args === "object" && body.args !== null ? (body.args as Record<string, unknown>) : {};
  const result = await runDocumentCommand(dir, { path, command, args });
  if (!result.ok) return json({ error: result.reason }, 422);
  const { ops, title, saved } = result;
  parts.bridge.relay(null, { type: "doc.ops", project, path, ops, title, saved, actor: body.actor ?? null });
  return json(result);
}

/** The folder of an open or a known project, or null. */
function dirOfProject(context: ApiContext, project: string): string | null {
  return context.open.get(project)?.dir ?? context.registry.byKey(project)?.dir ?? null;
}

/**
 * A request of the MCP server over HTTP. The client sends the token of its connection, not a session cookie. The Host
 * header must name this host, and a request of a page must come from the studio (no other site).
 */
function mcpRoute(parts: Parts, request: Request): Promise<Response> | Response {
  if (!parts.access.hostAllowed(request)) return refuse(421, "the Host header is not this host");
  const origin = request.headers.get("origin");
  if (origin !== null && !parts.access.ownOrigin(origin)) return refuse(403, "the Origin header is not this host");
  if (parts.agents === null) return json({ error: "the studio runs with no agent" }, 404);
  return mcpHttp(parts.agents, request);
}

/** The request handler of the host. */
function requestHandler(parts: Parts) {
  const { context, access, scene } = parts;
  return async (request: Request, server: Server<SocketData>): Promise<Response | undefined> => {
    const url = new URL(request.url);
    const upgrade = request.headers.get("upgrade")?.toLowerCase() === "websocket";
    if (url.pathname === "/health")
      return json({ ok: true, studio: true, origin: context.origin, scene: scene?.info.status ?? null });
    if (url.pathname === "/launch") return launch(parts, request, url);
    if (url.pathname === MCP_PATH) return mcpRoute(parts, request);
    const host = HOST_PATHS.some((path) => url.pathname.startsWith(path));
    const refusal = access.check(request, upgrade, host);
    if (refusal !== null) return refuse(refusal.status, refusal.reason, request.method === "GET" && !host);
    if (url.pathname === "/events") {
      const role = access.roleOf(request) ?? "viewer";
      return server.upgrade(request, { data: { kind: "events", role } })
        ? undefined
        : json({ error: "no upgrade" }, 400);
    }
    // The page bridge of the editor windows, and the calls of the tools to them.
    if (url.pathname === "/bridge") {
      return server.upgrade(request, { data: { kind: "bridge" } }) ? undefined : json({ error: "no upgrade" }, 400);
    }
    if (url.pathname.startsWith("/api/bridge")) return bridgeApi(parts.bridge, request, url);
    if (url.pathname === "/api/documents/run" && request.method === "POST") return documentApi(parts, request);
    if (url.pathname === "/api/documents/log") return documentLogApi(parts, url);
    // The tools of the plugins run with no agent too.
    if (url.pathname === "/api/agent/tools" || url.pathname === "/api/agent/tools/run")
      return pluginToolApi(parts.pluginTools, parts.bridge, request, url);
    if (url.pathname.startsWith("/api/agent/")) {
      // With no agent, the status tells it. Each other agent path refuses the request.
      if (parts.agents === null && url.pathname === "/api/agent/status")
        return json({ available: false, driver: null });
      // Start from a prompt: the agent chooses the template of a new project.
      if (parts.driver !== null && url.pathname === "/api/agent/choose-template" && request.method === "POST")
        return chooseTemplateApi(parts.driver, request);
      return parts.agents === null
        ? json({ error: "the studio runs with no agent" }, 404)
        : agentApi(parts.agents, request, url, (project) => dirOfProject(context, project), context.state.dir, {
            role: access.roleOf(request) ?? "viewer",
          });
    }
    if (url.pathname.startsWith("/api/terminals")) {
      return terminalApi(parts.terminals, request, url, (project) => dirOfProject(context, project));
    }
    if (url.pathname === "/api/launch-code" && request.method === "POST") return launchCodeApi(access, request);
    // The role of the request and the remote mode go with the state of the host.
    if (url.pathname === "/api/state")
      return handleApi(
        { ...context, role: access.roleOf(request) ?? "admin", remote: access.publicOrigin !== null },
        request,
        url,
      );
    if (url.pathname.startsWith("/api/")) return handleApi(context, request, url);
    const short = /^\/p\/([a-z0-9-]+)$/.exec(url.pathname)?.[1];
    if (short !== undefined) {
      const open = context.open.get(short);
      const entry = open ?? context.registry.byKey(short);
      if (entry === undefined) return json({ error: "no such project" }, 404);
      if (open !== undefined) return Response.redirect(editorUrl(short, entry.dir), 302);
      // The project opens again, and the scene server reads the projects file a moment later.
      const again = openProject(context, entry.dir);
      await waitForProject(scene?.info.origin ?? null, again.key);
      return Response.redirect(again.url, 302);
    }
    const key = projectOfRequest(url);
    if (key !== null) context.open.touch(key);
    const upstream = scene?.info.origin;
    if (upstream == null || scene?.info.status !== "ready")
      return json({ error: "the scene server is not ready" }, 503);
    if (upgrade)
      return server.upgrade(request, { data: proxySocketData(request, url) })
        ? undefined
        : json({ error: "no upgrade" }, 400);
    const target = url.pathname === "/" ? new URL(`${upstream}/hub.html${url.search}`) : url;
    return forwardHttp(request, target, upstream);
  };
}

/** Start the studio host. */
export async function startStudio(options: StudioOptions): Promise<Studio> {
  const origin = `http://127.0.0.1:${String(options.port)}`;
  const parts = studioParts(options, origin);
  const { context, access, scene, sockets } = parts;
  const server = Bun.serve<SocketData>({
    hostname: "127.0.0.1",
    port: options.port,
    idleTimeout: 120,
    fetch: requestHandler(parts),
    websocket: {
      open(ws) {
        sockets.add(ws);
        if (ws.data.kind === "bridge") parts.bridge.attach(ws);
        if (ws.data.kind === "proxy") openProxySocket(ws as ServerWebSocket<ProxySocket>, scene?.info.origin ?? "");
      },
      message(ws, message) {
        if (ws.data.kind === "bridge" && typeof message === "string") parts.bridge.message(ws, message);
        if (ws.data.kind !== "proxy") return;
        proxyMessage(
          ws as ServerWebSocket<ProxySocket>,
          typeof message === "string" ? message : Uint8Array.from(message),
        );
      },
      close(ws) {
        sockets.delete(ws);
        if (ws.data.kind === "bridge") parts.bridge.detach(ws);
        if (ws.data.kind === "proxy") closeProxySocket(ws as ServerWebSocket<ProxySocket>);
      },
    },
  });
  options.log?.(`studio host on ${origin}`);
  if (scene !== null) await scene.start();
  // A project with an open window is never idle. The check runs at a quarter of the idle time (at most 1 min).
  const idleMs = options.idleMs ?? 30 * 60_000;
  const idle = setInterval(
    () => {
      for (const page of parts.bridge.pages()) if (page.project !== null) context.open.touch(page.project);
      if (context.open.closeIdle(idleMs).length > 0) context.changed();
    },
    Math.min(60_000, Math.max(250, idleMs / 4)),
  );
  return {
    origin,
    access,
    context,
    bridge: parts.bridge,
    agents: parts.agents,
    terminals: parts.terminals,
    launchUrl: (next = "/") =>
      `${access.linkOrigin}/launch?code=${access.launchCode()}&next=${encodeURIComponent(next)}`,
    stop: async () => {
      clearInterval(idle);
      context.jobs.stopAll();
      parts.agents?.stopAll();
      parts.pool.stop();
      await parts.terminals.closeAll();
      await scene?.stop();
      await server.stop(true);
    },
  };
}
