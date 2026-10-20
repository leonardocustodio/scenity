// SPDX-License-Identifier: Apache-2.0
/**
 * The host of the workbench: the server, the router, the state folder, the checkouts, the dev servers, the file
 * watchers and the surfaces in one object. `main.ts` starts it from the command line. A test starts it with a fake
 * dev server command. hostParts.ts builds the parts. hostRestart.ts keeps the restart state.
 */
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { addAgentHandlers, type AgentManager, type AgentManagerDeps } from "./agent/index";
import type { AgentLoop } from "./agentLoop";
import type { AuthProvider, AuthSetup } from "./authProvider";
import { watchBusy } from "./busy";
import { addChangeHandlers } from "./changes";
import { addSceneFileHandlers } from "./sceneFiles";
import { createCheckout, findCheckout, gitRoot, listCheckouts } from "./checkouts";
import { denyPatterns } from "./denylist";
import type { CheckoutSetups } from "./checkoutSetup";
import { childGroups, reapStale } from "./children";
import { buildParts, type HostParts } from "./hostParts";
import { editorSurfaces, loadHostProject, projectInfo, sceneSurface, type HostProject } from "./project";
import { useHostPlugins } from "./plugins";
import { useRunCatalog } from "./runCatalog";
import { addRestartHandler, loadRestart, saveRestart } from "./hostRestart";
import type { Infra, InfraOptions } from "./infra";
import { PROTOCOL_VERSION, type Checkout, type HostEndpoint, type SurfaceState } from "./protocol";
import { needString, optString, type Router } from "./router";
import type { RunManager, RunSpawner } from "./runs";
import type { HostServer, HttpHandler } from "./server";
import type { CommandFactory, DevServerOptions, DevServers } from "./servers";
import { HostState, defaultStateDir } from "./state";
import { EDITOR_SERVER, LAB_APP, labRoot, type DevServer } from "./servers";
import { runsScenePage, SCENE_SERVER, scenePagePath } from "./scenePage";
import type { Surface, SurfaceRegistry } from "./surfaces";
import { addTerminalHandlers, type TerminalManager, type TerminalManagerOptions } from "./terminal";
import { addSessionHandlers } from "./terminalSessions";
import { makeToken } from "./token";
import type { TurnStore } from "./turns";
import type { RemoteSetup } from "./remote";
import { findWorkspace, gitTopOf, isInside, slashPath } from "./workspace";

export interface HostOptions {
  /**
   * A folder of a Git worktree, or a folder with no Git. Without `project`, it is the workspace
   * folder: the Git top folder or a sub-folder of it (workspace.ts). The host opens it at the start.
   */
  readonly checkout: string;
  /**
   * The project folder with `scenity.project.json`: the checkout itself (the default), or a folder of it (a
   * sample of this repository). A folder without the file gets the built-in manifest of this repository. The
   * workspace folder is then the nearest folder above it with a package.json workspace, up to the Git top folder.
   */
  readonly project?: string;
  /** The port of the server; 0 (the default) gives a free port. */
  readonly port?: number;
  /** The state folder. The default comes from `defaultStateDir`. */
  readonly stateDir?: string | undefined;
  /** The launch token. The default comes from `makeToken`. */
  readonly token?: string;
  /** The command of the lab dev server. The default is the Vite server of apps/editor (`labCommand`). */
  readonly serverCommand?: CommandFactory;
  /**
   * The render pool of the open checkout with its built lab (labPool.ts). It starts with the host. main.ts gives
   * it. Without it (the tests), the host has no pool and the shadow uses the dev server.
   */
  readonly pool?: { readonly pages?: number; readonly command?: (token: string) => CommandFactory } | null;
  readonly readyTimeoutMs?: number;
  /** Watch the source files of each open checkout. The default is true. */
  readonly watch?: boolean;
  /** The HTTP handler of the paths with the token (`/hooks/`, `/context`). */
  readonly http?: HttpHandler;
  /** The programs, the environment and the CLI flags of the terminals. A test gives others. */
  readonly terminal?: Pick<TerminalManagerOptions, "program" | "env" | "claudeLaunch">;
  /** The start of the processes of the runs. A test gives a fake. */
  readonly runSpawn?: RunSpawner;
  /** The Agent SDK and the environment of the chat sessions. A test gives a fake SDK. */
  readonly chat?: Pick<AgentManagerDeps, "sdk" | "env">;
  /** The processes of the background runs, the start of a second host and the home folder. A test gives fakes. */
  readonly infra?: Pick<InfraOptions, "loops" | "startHost" | "home">;
  /** The automatic restart of a crashed dev server and its wait. A test gives short waits. */
  readonly devServer?: Pick<DevServerOptions, "autoRestarts" | "backoffMs" | "pollMs">;
  /** The remote mode behind the Scenity gateway (remote.ts), or null. */
  readonly remote?: RemoteSetup | null;
  /**
   * Stop the host and end the process with RESTART_EXIT_CODE (the supervisor of main.ts starts a new host).
   * Without it `host.restart` fails with a reason.
   */
  readonly restart?: () => void;
  /** End the process groups of an old host of the state folder at the start (default true). */
  readonly reap?: boolean;
  /**
   * The turntable picture of an import job (default true). The test-mode host of the e2e suite holds the GPU
   * lock, so its jobs skip the picture and end.
   */
  readonly importPicture?: boolean;
  /**
   * The auth provider (authProvider.ts). main.ts gives the settings of the environment (`token` with
   * role tokens, else `none`); without them the launch token is the one token (`none`).
   */
  readonly auth?: AuthSetup;
  /**
   * The busy state of the host (a run, a background run, a chat session or the Claude terminal works). main.ts
   * gives it when the desktop shell asks for the signals (busy.ts).
   */
  readonly onBusy?: (busy: boolean) => void;
  /** Each new JPEG of the picture store; main.ts gives it when the desktop shell re-encodes them (shellWebp.ts). */
  readonly onJpeg?: (file: string) => void;
}

/** The answer of `checkouts.open`. */
export interface OpenResult {
  readonly checkout: Checkout;
  readonly surfaces: SurfaceState[];
}

export interface Host {
  readonly endpoint: HostEndpoint;
  /** The workspace folder that the host started with. Git commands of the repository run in it. */
  readonly repo: string;
  readonly state: HostState;
  readonly server: HostServer;
  readonly servers: DevServers;
  readonly surfaces: SurfaceRegistry;
  readonly router: Router;
  /** The PTYs of the Claude panel. */
  readonly terminals: TerminalManager;
  /** The runs of `labs` subcommands: `runs.startRun` for the `workbench_run` tool. */
  readonly runs: RunManager;
  /** The turns of Claude: `beginTurn` and `recordEdits` for the hooks, `undoTurn` for the page. */
  readonly turns: TurnStore;
  /** The agent loop: the tool context, the packet, the hooks, the shadow, the Stop gate. */
  readonly agent: AgentLoop;
  /** The chat sessions of the Agent SDK: the same tools and hooks as the terminal mode. */
  readonly chat: AgentManager;
  /** The background runs, the picker, the experiment log, the checkout settings and the window hosts. */
  readonly infra: Infra;
  /** The auth provider: the role of each token. */
  readonly provider: AuthProvider;
  /** False for a project folder with no Git (no Changes tab, no turns). */
  readonly git: boolean;
  /** The project of the open checkout. */
  project(): HostProject;
  /** The open checkout. */
  current(): string;
  /** Open a checkout of the repository: start its lab server and its file watcher, and show it as the surfaces. */
  open(path: string): Promise<OpenResult>;
  /** The client of a surface (for the tools). */
  surface(id: string): Surface;
  /** Stop every child process and the server. */
  stop(): Promise<void>;
  /** Send SIGTERM to every child immediately, without a wait (the exit of the process). */
  killNow(): void;
}

const PAGE_ORIGIN = /^(https?|tauri):\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/;

/** True for the origin of a workbench page: `http(s)://<host>[:port]` or `tauri://<host>`. */
export function isPageOrigin(value: unknown): value is string {
  return typeof value === "string" && PAGE_ORIGIN.test(value);
}

/** Open a checkout of the repository: its lab server, its file watcher and its surfaces. */
async function openCheckout(parts: HostParts, path: string): Promise<OpenResult> {
  const { repo, state, surfaces, opened, turns } = parts;
  // The dev servers of a new worktree need its packages and its generated files first.
  parts.setups.assertReady(path);
  // The checkout is the workspace folder of a worktree.
  const checkout = await findCheckout(repo, path, opened, parts.git, parts.workspaceRel);
  // The project of the checkout (its manifest, else the built-in one).
  const project = await loadHostProject(join(checkout.path, parts.projectRel), checkout.path);
  denyPatterns(project.denylist);
  // The tools, the context lines and the paths come from the host faces of the plugins of the project.
  useHostPlugins(project.plugins);
  // The runs, the stop gate and the review pack come from the runs of the project.
  useRunCatalog(project.runCatalog);
  parts.project = project;
  // The commit at the first open of a checkout is the start of the session (`labs review --ref`).
  if (!opened.has(checkout.path)) void turns.recordStart(checkout.path).catch(() => null);
  opened.add(checkout.path);
  state.openCheckout(checkout.path);
  parts.current = checkout.path;
  openSurfaces(parts, checkout.path, project);
  return { checkout: { ...checkout, open: true }, surfaces: surfaces.states() };
}

/**
 * Each surface of the kind `scene` of the manifest runs on the editor server of the checkout (the Vite of
 * apps/editor, labRoot of servers.ts) under its manifest ID. A surface of the manifest with no page, or with
 * the scene page, runs the scene page on the scene server of the project (scenePage.ts). The scene surface (the first
 * surface with the capability `scene`) of the lab page also gets the built lab of the render pool. The registry
 * forgets the surfaces of the project before.
 */
function openSurfaces(parts: HostParts, checkout: string, project: HostProject): void {
  const { state, servers, surfaces } = parts;
  const served = editorSurfaces(project);
  for (const id of surfaces.ids()) if (!served.some((surface) => surface.id === id)) surfaces.remove(id);
  if (served.length === 0) return;
  const saved = state.surfaceUrls(checkout);
  const scene = sceneSurface(project);
  const started = new Set<DevServer>();
  let pooled = false;
  for (const surface of served) {
    const { id, kind, label, capabilities } = surface;
    const scenePage = runsScenePage(project, surface);
    const server = scenePage ? servers.ensure(project.dir, SCENE_SERVER) : servers.ensure(checkout, EDITOR_SERVER);
    started.add(server);
    // The built lab of the render pool for the shadow of the lab page (and the visible frame by `builtLab`).
    const pool = surface === scene && !scenePage;
    pooled ||= pool;
    surfaces.define({
      ...{ id, kind, label, capabilities, checkout, server },
      page: scenePage ? scenePagePath(project, surface) : surface.page,
      // The HMR tracker reads the paths of the labs app (a project folder uses the labs app of the engine).
      appRoot: join(labRoot(scenePage ? project.dir : checkout), LAB_APP),
      watcher: parts.watchers.of(checkout),
      savedUrl: saved[id] ?? null,
      built: pool ? parts.pools.ensure(checkout) : null,
    });
  }
  const editor = pooled ? servers.ensure(checkout, EDITOR_SERVER) : null;
  for (const server of started) if (server !== editor) void server.start();
  if (editor === null) return;
  // The render pool starts after the lab server, so it does not slow the first frame of the owner.
  parts.pools.resume();
  void editor.start().then(() => {
    if (parts.current === checkout) void parts.pools.only(checkout);
  });
}

/** Stop the host: write the restart state, then end every child process and the server. */
async function stopHost(parts: HostParts): Promise<void> {
  saveRestart(parts);
  parts.agent.stop();
  parts.surfaces.close();
  parts.watchers.stop();
  await Promise.all([
    parts.terminals.closeAll(),
    parts.servers.stopAll(),
    parts.pools.stopAll(),
    parts.runs.cancelAll(),
    parts.chat.closeAll(),
    parts.infra.stop(),
    // The changed manifests of the frame index.
    parts.index.close(),
  ]);
  await parts.server.stop();
  // A stopped host restores the built-in plugins (a test starts many hosts in one process).
  useHostPlugins(null);
  useRunCatalog(null);
}

/** The host object of the parts. */
function makeHost(parts: HostParts): Host {
  const { server, token, surfaces } = parts;
  return {
    endpoint: { origin: server.origin, token },
    repo: parts.repo,
    state: parts.state,
    server,
    servers: parts.servers,
    surfaces,
    router: parts.router,
    terminals: parts.terminals,
    runs: parts.runs,
    turns: parts.turns,
    agent: parts.agent,
    chat: parts.chat,
    infra: parts.infra,
    provider: parts.provider,
    git: parts.git,
    project: () => parts.project,
    current: () => parts.current,
    open: (path) => openCheckout(parts, path),
    surface: (id) => surfaces.surface(id),
    stop: () => stopHost(parts),
    killNow: () => {
      parts.infra.killNow();
      parts.runs.killNow();
      parts.terminals.killNow();
      parts.servers.killAllNow();
      parts.pools.killAllNow();
    },
  };
}

/** Add the request handlers of every part. */
function addAllHandlers(host: Host, parts: HostParts, options: HostOptions): void {
  const { router, surfaces, runs, turns } = parts;
  addHandlers(host, parts, parts.setups);
  addTerminalHandlers(router, parts.terminals);
  // The sessions of the Claude terminals (Resume, Export transcript).
  addSessionHandlers(router, {
    sessions: parts.sessions,
    claudeTerminals: () => parts.terminals.claudeTerminals(),
    current: () => parts.current,
    origin: parts.server.origin,
  });
  parts.agent.addHandlers(router);
  addAgentHandlers(router, parts.chat);
  addChangeHandlers(router, {
    runs,
    turns,
    current: () => parts.current,
    top: () => gitTopOf(parts.current, parts.workspaceRel),
    scene: () => surfaces.surface(surfaces.scene()),
  });
  // The read and the save of the scene files of the project.
  addSceneFileHandlers(router, {
    projectDir: () => parts.project.dir,
    current: () => parts.current,
    broadcast: (event) => parts.server.broadcast(event),
    // The reason of a rule override goes into the commit message proposal.
    noteOverride: (reason) => {
      turns.notes.add(parts.current, reason);
    },
  });
  parts.infra.addHandlers(router);
  addRestartHandler(router, parts, options.restart);
}

/**
 * Start the host. The promise resolves when the server listens; the lab server of the checkout starts after. The
 * process groups of an old host of the same state folder that still run end first; the restart state of an
 * old host restores its checkout, its surfaces and its chat sessions.
 */
export async function startHost(options: HostOptions): Promise<Host> {
  // The project folder, the Git top folder (none for a folder with no Git), the workspace.
  const { folder, root, repo, workspaceRel, projectRel } = await hostFolders(options);
  const project = await loadHostProject(folder, repo);
  denyPatterns(project.denylist);
  useHostPlugins(project.plugins);
  useRunCatalog(project.runCatalog);
  const state = new HostState(options.stateDir ?? defaultStateDir(root ?? repo));
  if (options.reap !== false) await reapStale(state.dir);
  childGroups.useFolder(state.dir);
  const start = { git: root !== null, project, projectRel, workspaceRel };
  const parts = buildParts(options, repo, state, options.token ?? makeToken(), start);
  const host = makeHost(parts);
  addAllHandlers(host, parts, options);
  if (options.onBusy !== undefined) {
    const sources = {
      runsRunning: () => parts.runs.runningAll().length,
      isClaudeTerminal: (id: string) => parts.terminals.claudeTerminals().some((item) => item.id === id),
    };
    watchBusy(parts.server, sources, { emit: options.onBusy });
  }
  const restart = loadRestart(parts);
  const opened = restart.checkout === null ? null : await host.open(restart.checkout).catch(() => null);
  if (opened === null) await host.open(repo);
  restart.apply();
  return host;
}

/** The folders of a host (workspace.ts): the project, the Git top, the workspace and the paths between them. */
interface HostFolders {
  readonly folder: string;
  readonly root: string | null;
  /** The workspace folder of the start (the checkout of the other host modules). */
  readonly repo: string;
  /** The workspace folder from the Git top folder. */
  readonly workspaceRel: string;
  /** The project folder from the workspace folder. */
  readonly projectRel: string;
}

/**
 * The folders of the options. Without `project`, the checkout is the workspace. With `project`, the workspace
 * is the nearest folder above the project with a package.json workspace, up to the Git top folder (else the top).
 */
async function hostFolders(options: HostOptions): Promise<HostFolders> {
  const base = realpathSync(options.checkout);
  const folder = realpathSync(options.project ?? options.checkout);
  const root = await gitRoot(base);
  const repo = options.project === undefined ? base : findWorkspace(folder, root ?? base);
  if (root !== null && !isInside(repo, root)) throw new Error(`The checkout is not in its Git worktree: ${repo}`);
  const projectRel = slashPath(repo, folder);
  if (!isInside(folder, repo)) throw new Error(`The project folder is not in the checkout: ${folder}`);
  return { folder, root, repo, workspaceRel: root === null ? "" : slashPath(root, repo), projectRel };
}

/** The handlers of the requests of the start screen, the checkouts and the surfaces. */
function addHandlers(host: Host, parts: HostParts, setups: CheckoutSetups): void {
  const { router, surfaces, repo, git } = host;
  const { opened, workspaceRel: rel } = parts;
  router
    .on("host.hello", async (params, client) => {
      const origin = (params as { origin?: unknown }).origin;
      if (origin !== undefined) {
        if (!isPageOrigin(origin)) throw new Error(`The page origin is not valid: ${JSON.stringify(origin)}`);
        client.origin = origin;
        surfaces.setPageOrigin(origin);
      }
      const checkout = await findCheckout(repo, host.current(), opened, git, rel);
      return {
        protocol: PROTOCOL_VERSION,
        checkout,
        surfaces: surfaces.states(),
        // The project, the Git state, the role of the page and the auth provider.
        project: projectInfo(parts.project),
        git,
        role: client.role,
        auth: parts.provider.kind,
        remote: parts.remote,
      };
    })
    .on("checkouts.list", async () =>
      (await listCheckouts(repo, opened, git, rel)).map((item) => setups.decorate(item)),
    )
    .on("checkouts.create", async (params) => {
      const made = await createCheckout(
        repo,
        { branch: needString(params, "branch"), base: optString(params, "base"), parent: optString(params, "path") },
        git,
        rel,
      );
      // `bun install` and `bun run generate` as a run. The checkout is `preparing` until the run ends.
      return { ...made, setup: setups.start(made.path).setup };
    })
    .on("checkouts.open", (params) => host.open(needString(params, "path")))
    .on("surface.report", (params, client) => {
      surfaces.report(client, needString(params, "surface"), params.where, params.event);
      return null;
    })
    .on("surface.call", (params, client) => {
      if (typeof params.request !== "number") throw new Error('The parameter "request" must be a number.');
      surfaces.answer(client, params);
      return null;
    });
}
