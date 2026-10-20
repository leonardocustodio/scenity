// SPDX-License-Identifier: Apache-2.0
/**
 * The parts of the host: the dev servers, the file watchers, the router, the runs, the turns, the server, the
 * surfaces, the agent loop, the chat sessions, the infrastructure (infra.ts) and the terminals. The parts call each
 * other through late references, because the server needs the agent loop and the agent loop needs the server.
 */
import { AgentManager } from "./agent/index";
import { startAgentLoop, type AgentLoop, type AgentLoopOptions } from "./agentLoop";
import { makeProvider, type AuthProvider } from "./authProvider";
import { CheckoutSetups, setupRunsOf } from "./checkoutSetup";
import { clipsHttp } from "./desktopClips";
import { EditWatcher, watchRoots } from "./edits";
import type { HostOptions } from "./host";
import { HostIndex } from "./index/hostIndex";
import { ImportJobs } from "./imports";
import { startInfra, type Infra } from "./infra";
import { HOST_PATHS, INDEX_CAPABILITY, NO_GIT, requestRefusal } from "./protocol";
import type { BridgeVariantsEvent, RequestType } from "./protocol";
import { LAB_GATE_ENV } from "@scenity/labs-platform/labKey";
import { labGateKey, makeLabTicket } from "./labTicket";
import { credentialPath, type HostProject } from "./project";
import type { FrameIndexSource } from "@scenity/labs-platform/indexSource";

/** The requests that need Git: the Changes tab, the turns and a new worktree. */
const GIT_REQUESTS: ReadonlySet<RequestType> = new Set([
  "git.status",
  "git.diff",
  "git.turns",
  "git.keepTurn",
  "git.undoTurn",
  "git.commit",
  "checkouts.create",
]);
import { Router } from "./router";
import { PictureStore } from "./pictures";
import { RunManager, runFilesHttp } from "./runs";
import { startServer, type HostServer } from "./server";
import { DevServer, DevServers, EDITOR_SERVER, labCommand, type CommandFactory, type ServerCommand } from "./servers";
import { SCENE_PAGE, SCENE_SERVER, scenePageCommand } from "./scenePage";
import { join } from "node:path";
import type { CheckoutSettingsStore } from "./blender";
import { LabPool, LabPools, POOL_DIR_ENV } from "./labPool";
import { defaultStateDir, type HostState } from "./state";
import { addPromoteHandler } from "./promoteRun";
import { sceneEditEvents, type SceneEditDeps } from "./sceneEdit";
import { SurfaceRegistry } from "./surfaces";
import { TerminalManager } from "./terminal";
import { TerminalSessions } from "./terminalSessions";
import { TurnStore } from "./turns";
import type { SurfacePort } from "./tools/context";
import { windowLayouts, type WindowLayouts } from "./windowLayout";
import { gitTopOf } from "./workspace";

/** The file watchers of the open checkouts, one per checkout. */
export class WatcherPool {
  readonly #enabled: boolean;
  readonly #watchers = new Map<string, EditWatcher>();

  constructor(enabled: boolean) {
    this.#enabled = enabled;
  }

  /** The watcher of a checkout. The first call starts it. Null when the pool is off. */
  of(checkout: string): EditWatcher | null {
    if (!this.#enabled) return null;
    let watcher = this.#watchers.get(checkout);
    if (watcher === undefined) {
      watcher = new EditWatcher(watchRoots(checkout));
      watcher.start();
      this.#watchers.set(checkout, watcher);
    }
    return watcher;
  }

  stop(): void {
    for (const watcher of this.#watchers.values()) watcher.stop();
  }
}

/**
 * The dev servers of the host: the editor server of each checkout and the scene server of each project.
 * `token` is the launch token (the source of the gate key).
 */
export function makeServers(options: HostOptions, token: string): DevServers {
  const lab = options.serverCommand ?? labCommand;
  const timeout = options.readyTimeoutMs === undefined ? {} : { readyTimeoutMs: options.readyTimeoutMs };
  const remote = options.remote ?? null;
  return new DevServers((checkout, kind) => {
    if (kind === EDITOR_SERVER && remote !== null) {
      // The remote mode (remote.ts): the fixed port and base path that the gateway knows, and the public frame URL.
      // The gate key of the lab server (labTicket.ts): the gateway adds it to each lab request.
      const command: CommandFactory = (path, port) => {
        const made = withBase(lab(path, port), remote.labBase);
        return { ...made, env: { ...made.env, [LAB_GATE_ENV]: labGateKey(token) } };
      };
      return new DevServer({
        checkout,
        kind,
        command,
        fixedPort: remote.labPort,
        frameOrigin: `${remote.publicOrigin}${remote.labBase}`,
        readyPath: remote.labBase,
        ...timeout,
        ...options.devServer,
      });
    }
    // The scene server of a project runs the scene page (a test gives its fake command for each kind). The
    // remote mode has no scene server path yet: the gateway knows only the lab server.
    if (kind === SCENE_SERVER) {
      const command = options.serverCommand ?? scenePageCommand;
      return new DevServer({ checkout, kind, command, readyPath: SCENE_PAGE, ...timeout, ...options.devServer });
    }
    return new DevServer({ checkout, kind, command: lab, ...timeout, ...options.devServer });
  });
}

/** The command of a Vite server with a base path (`--base`). */
function withBase(command: ServerCommand, base: string): ServerCommand {
  return { ...command, cmd: [...command.cmd, "--base", base] };
}

/**
 * The render pools of the host (labPool.ts), one per checkout, when `options.pool` asks for them. The
 * pool of the host checkout keeps its files in the state folder of the host; the tools of the checkout find it there
 * (a state folder that is not the default goes to them in `SCENITY_LABS_POOL_DIR`).
 */
export function makePools(
  options: HostOptions,
  repo: string,
  state: HostState,
  settings: CheckoutSettingsStore,
  refresh: () => void,
): LabPools {
  const pool = options.pool ?? null;
  if (pool === null) return new LabPools(null);
  const builtLab = (checkout: string): boolean => settings.get(checkout).builtLab;
  // The setting `builtLab` moves the visible lab frame between the dev server and the built lab.
  settings.onChange(refresh);
  const stateDir = (checkout: string): string => (checkout === repo ? state.dir : defaultStateDir(checkout));
  if (state.dir !== defaultStateDir(repo)) process.env[POOL_DIR_ENV] = join(state.dir, "pool");
  return new LabPools(
    (checkout) =>
      new LabPool(checkout, {
        stateDir,
        visible: () => builtLab(checkout),
        ...(pool.pages === undefined ? {} : { pages: pool.pages }),
        ...(pool.command === undefined ? {} : { command: pool.command }),
        ...(options.devServer === undefined ? {} : { devServer: options.devServer }),
      }),
  );
}

/** The parts of a running host. */
export interface HostParts {
  readonly repo: string;
  readonly state: HostState;
  readonly token: string;
  readonly servers: DevServers;
  /** The render pool and the built lab of the open checkout (none in a host without them). */
  readonly pools: LabPools;
  readonly watchers: WatcherPool;
  /** The checkouts that the host opened. */
  readonly opened: Set<string>;
  readonly router: Router;
  readonly runs: RunManager;
  /** The setups of the worktrees that the start screen made. */
  readonly setups: CheckoutSetups;
  readonly turns: TurnStore;
  /** The pictures that the pages show, by ID. */
  readonly pictures: PictureStore;
  /** The frame index (the store, the job queue, the routes). */
  readonly index: HostIndex;
  readonly server: HostServer;
  readonly surfaces: SurfaceRegistry;
  readonly agent: AgentLoop;
  readonly chat: AgentManager;
  readonly infra: Infra;
  /** The auth provider: the role of each token. */
  readonly provider: AuthProvider;
  /** False for a project folder with no Git. */
  readonly git: boolean;
  /** True behind the Scenity gateway (remote.ts). */
  readonly remote: boolean;
  /** The folder of the project relative to each checkout ("" for the checkout itself). */
  readonly projectRel: string;
  /** The workspace folder (the checkout) relative to the Git top folder of each worktree (workspace.ts). */
  readonly workspaceRel: string;
  /** The project of the open checkout (host.ts `open` reads it again). */
  project: HostProject;
  readonly terminals: TerminalManager;
  /** The session IDs of the Claude terminals (resume, transcript). */
  readonly sessions: TerminalSessions;
  /** The current open checkout (host.ts `open` sets it). */
  current: string;
}

/** The parts that the parts of `buildParts` call later (they exist when a call comes). */
interface Late {
  agent: AgentLoop;
  infra: Infra;
  surfaces: SurfaceRegistry;
  index: HostIndex;
  /** The scene edit events of the lab frame (sceneEdit.ts). */
  edit?: ReturnType<typeof sceneEditEvents>;
  /** The import by drop (`POST /imports`, imports.ts). */
  imports?: ImportJobs;
  /** The link between the windows and the window layout (windowLayout.ts). */
  layout?: WindowLayouts;
  /** The project of the open checkout and the Git state. */
  project: () => HostProject;
  git: boolean;
  /** The folder of the project relative to each checkout. */
  projectRel: string;
  /** The workspace folder relative to the Git top folder. */
  workspaceRel: string;
}

/** The base parts: the servers, the router, the runs, the turns, the HTTP and WebSocket server and the surfaces. */
function baseParts(options: HostOptions, state: HostState, token: string, late: Late) {
  const router = new Router();
  const runs = new RunManager({
    emit: (event) => {
      server.broadcast(event);
      late.infra.onRunEvent(event);
    },
    ...(options.runSpawn ? { spawn: options.runSpawn } : {}),
    // The runs of the open project, in its project folder.
    catalog: () => late.project().runCatalog,
    projectRel: () => late.projectRel,
  });
  const runFiles = runFilesHttp(runs);
  // The pictures that the pages show, by ID (`GET /pictures/<id>`).
  // In the labs app the shell re-encodes each new JPEG as WebP (shellWebp.ts).
  const pictures = new PictureStore(state.dir, options.onJpeg === undefined ? {} : { onJpeg: options.onJpeg });
  const clips = clipsHttp({ surfaces: () => late.surfaces, pictures });
  // The provider gives the role of each token; the router refuses a request above the role of its page.
  const provider = makeProvider(options.auth, token);
  router.guard((type, params, client) => requestRefusal(client.role, type, params));
  router.guard((type) => (late.git || !GIT_REQUESTS.has(type) ? null : NO_GIT));
  const server = startServer({
    port: options.port ?? 0,
    token,
    provider,
    onMessage: (client, text) => router.dispatch(text, client),
    // The picture bytes of a surface call come as a binary frame before its `surface.call`.
    // An index frame of a renderer goes to the index; the other frames are pictures.
    onBinary: (client, data) => {
      if (!late.index.bytes(client, data)) late.surfaces.bytes(client, data);
    },
    onClose: (client) => {
      late.surfaces.dropClient(client);
      late.index.dropClient(client);
      late.layout?.dropClient(client);
    },
    http: async (request, url, role) =>
      (await updateToken(provider, request, url)) ??
      runFiles(request, url) ??
      pictures.http(request, url) ??
      // The MP4 of a clip in the labs app (`POST /clips/mp4`).
      (await clips(request, url)) ??
      // The import of a dropped file (`POST /imports`, `GET /imports/<id>/<file>`).
      (await late.imports?.http(request, url)) ??
      (await late.index.http(request, url)) ??
      (await options.http?.(request, url)) ??
      (await late.infra.http(request, url)) ??
      (await late.agent.http(request, url, role)),
  });
  const remote = options.remote ?? null;
  const surfaces = new SurfaceRegistry({
    broadcast: (event) => server.broadcast(event),
    // The lab ticket of the remote mode in each frame URL (labTicket.ts).
    ...(remote === null ? {} : { ticket: () => makeLabTicket(token) }),
    persistUrl: (checkout, id, url) => state.setSurfaceUrl(checkout, id, url),
    onEvent: (surface, where, event) => {
      late.agent.onSurfaceEvent(surface, where, event);
      late.index.onSurfaceEvent(surface, where, event);
      late.edit?.(surface, where, event);
    },
  });
  late.surfaces = surfaces;
  // The link between the windows and the window layout of the open checkout.
  late.layout = windowLayouts(state, server, router, options.checkout);
  // A folder with no Git keeps no turns. The turns keep the paths of the Git top folder.
  const turns = new TurnStore({
    stateDir: state.dir,
    git: () => late.git,
    top: (checkout) => gitTopOf(checkout, late.workspaceRel),
  });
  return { router, runs, server, surfaces, turns, provider, pictures };
}

/**
 * The frame index under the state folder, with the content hash of the open checkout. The
 * content roots come from the project manifest. The source of the project gives its plans too.
 */
function makeIndex(
  stateDir: string,
  server: HostServer,
  current: () => string,
  router: Router,
  source: () => FrameIndexSource,
  surfaces: SurfaceRegistry,
): HostIndex {
  const index = new HostIndex({
    stateDir,
    broadcast: (event) => server.broadcast(event),
    checkout: current,
    source,
    // The visible frame of the index surface moves the focus of the queue.
    surface: () => surfaces.idWith(INDEX_CAPABILITY),
  });
  index.register(router);
  return index;
}

/**
 * The scene edit events of the lab frame (sceneEdit.ts). The variants of a layout search of the lab go to the picker
 * as candidates. The reason of a layout override goes into the commit message proposal (the notes of the turns,
 * commitNotes.ts).
 */
function editEvents(
  deps: Omit<SceneEditDeps, "offer" | "noteOverride">,
  infra: Infra,
  turns: TurnStore,
): ReturnType<typeof sceneEditEvents> {
  const offer = (event: BridgeVariantsEvent): void => {
    infra.picker.offer(event.seed, event.variants);
  };
  const noteOverride = (reason: string): void => {
    turns.notes.add(deps.current(), reason);
  };
  return sceneEditEvents({ ...deps, offer, noteOverride });
}

/** The terminals of the host. */
function makeTerminals(
  options: HostOptions,
  server: HostServer,
  current: () => string,
  infra: Infra,
  sessions: TerminalSessions,
): TerminalManager {
  return new TerminalManager({
    emit: (event) => server.broadcast(event),
    checkout: current,
    // The generated files of settings.ts, with the Blender server of the owner when the checkout setting is on.
    claudeLaunch: () => infra.claudeLaunch(),
    // The session ID of each new Claude terminal.
    onSession: (entry) => sessions.record({ ...entry, source: "launch" }),
    // The remote mode refuses a shell terminal (remote.ts). `options.terminal` cannot change it.
    refuseShell: (options.remote ?? null) !== null,
    ...options.terminal,
  });
}

/** The chat sessions of the host: the tool context and the hooks of the agent loop. */
function makeChat(options: HostOptions, parts: HostParts, agent: AgentLoop): AgentManager {
  return new AgentManager({
    checkout: () => parts.current,
    state: parts.state,
    emit: (event) => parts.server.broadcast(event),
    hooks: () => agent.hooks,
    toolContext: () => agent.toolContext(),
    origin: parts.server.origin,
    pictures: parts.pictures,
    // The remote mode refuses the mode "all" (remote.ts). `options.chat` cannot change it.
    refuseBypass: parts.remote,
    // The credential file of the project manifest.
    credentialFile: () => credentialPath(parts.project),
    ...options.chat,
  });
}

/** The project parts of `buildParts` (host.ts reads them before the start). */
export interface ProjectStart {
  readonly git: boolean;
  readonly project: HostProject;
  readonly projectRel: string;
  readonly workspaceRel: string;
}

/** The options of the agent loop of a host from its parts. */
function agentOptions(
  parts: HostParts,
  own: Pick<AgentLoopOptions, "sessions" | "endpoint" | "index">,
): AgentLoopOptions {
  const { server, state } = parts;
  return {
    ...own,
    surfaces: parts.surfaces,
    turns: parts.turns,
    runs: parts.runs,
    current: () => parts.current,
    broadcast: (event) => server.broadcast(event),
    stateDir: state.dir,
    forbidden: () => forbiddenFolders(parts),
    store: parts.pictures,
    // The tools answer from the frame index on a hit (`own.index`). The project of `scene_check`.
    projectDir: () => parts.project.dir,
  };
}

/** The folders that must not hold the Claude Code files: each checkout and its Git top folder. */
function forbiddenFolders({ repo, opened, workspaceRel }: HostParts): string[] {
  return [...new Set([repo, ...opened].flatMap((folder) => [folder, gitTopOf(folder, workspaceRel)]))];
}

/** Build every part of a host. The lab server of the checkout does not start here (host.ts `open`). */
export function buildParts(
  options: HostOptions,
  repo: string,
  state: HostState,
  token: string,
  start: ProjectStart,
): HostParts {
  const late = { git: start.git, projectRel: start.projectRel, workspaceRel: start.workspaceRel } as Late;
  const base = baseParts(options, state, token, late);
  const { server, surfaces, runs, turns, pictures } = base;
  const opened = new Set<string>();
  const remote = (options.remote ?? null) !== null;
  const parts = { repo, state, token, opened, current: repo, remote, ...base, ...start } as HostParts;
  late.project = () => parts.project;
  const current = (): string => parts.current;
  const endpoint = { origin: server.origin, token };
  const index = (late.index = makeIndex(state.dir, server, current, base.router, () => parts.project.index, surfaces));
  late.imports = new ImportJobs({ stateDir: state.dir, runs, checkout: current, picture: options.importPicture });
  const home = options.infra?.home;
  const sessions = new TerminalSessions({ stateDir: state.dir, ...(home === undefined ? {} : { home }) });
  // The tools, the packet, the hooks, the shadow, the before and after, the Stop gate.
  const agent = startAgentLoop(agentOptions(parts, { sessions, endpoint, index }));
  index.useShadow(() => agent.toolContext().surface("shadow")); // `index.shadow` keeps the shadow frame.
  // The chat sessions use the tool context and the hooks of the agent loop.
  const chat = makeChat(options, parts, agent);
  // The background runs, the picker, the experiment log, the settings and the window hosts.
  const infra = startInfra({
    repo,
    workspaceRel: start.workspaceRel,
    state,
    runs,
    endpoint,
    current,
    broadcast: (event) => server.broadcast(event),
    forbidden: () => forbiddenFolders(parts),
    shadow: () => agent.toolContext().surface("shadow"),
    labUrl: () => {
      // The URL of the visible frame of the scene surface.
      const scene = surfaces.idWith();
      return scene === null ? null : surfaces.state(scene).url;
    },
    pictures,
    index, // The picker takes its tune sheets from the frame index on a hit.
    ...options.infra,
  });
  const terminals = makeTerminals(options, server, current, infra, sessions);
  late.agent = agent;
  late.infra = infra;
  // The promote reads the import records (`importsDir`) and writes into the project. The picker
  // gets the variants. The request `asset.promote` runs the same promote as the bridge event of the lab.
  const lab = (): SurfacePort => agent.toolContext().surface("visible");
  const scene = (): string | null => surfaces.idWith();
  const promote = {
    importsDir: late.imports.folder,
    project: () => parts.project,
    broadcast: server.broadcast.bind(server),
  };
  late.edit = editEvents({ terminals, chat, runs, current, lab, scene, ...promote }, infra, turns);
  addPromoteHandler(base.router, { ...promote, current, noteOverride: (reason) => turns.notes.add(current(), reason) });
  return Object.assign(parts, {
    index,
    servers: makeServers(options, token),
    pools: makePools(options, repo, state, infra.settings, () => {
      const scene = surfaces.idWith();
      if (scene !== null) surfaces.refresh(scene);
    }),
    watchers: new WatcherPool(options.watch !== false),
    agent,
    chat,
    infra,
    terminals,
    sessions,
    // The setup command of the project manifest.
    setups: new CheckoutSetups(setupRunsOf(runs, () => parts.project.setup)),
  });
}

/**
 * `GET /desktop/update-token` gives the shell an access token for the update server of Scenity (`updater.rs`
 * sends it as a bearer token). The server already checked the token. Only an auth provider with an access
 * token (an `oidc` provider of an embedder) gives one. The others answer 404.
 */
export async function updateToken(provider: AuthProvider, request: Request, url: URL): Promise<Response | null> {
  if (url.pathname !== HOST_PATHS.updateToken || request.method !== "GET") return null;
  if (provider.accessToken === undefined) return new Response("This host has no sign-in.", { status: 404 });
  const token = await provider.accessToken();
  if (token === null) return new Response("No access token: sign in again.", { status: 409 });
  return Response.json({ token }, { headers: { "Cache-Control": "no-store" } });
}
