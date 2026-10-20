// SPDX-License-Identifier: Apache-2.0
/**
 * The agent loop of the host: the parts that connect Claude Code to the surfaces. One object per host:
 *
 * - the tool context of each MCP tool call: a port to the visible lab frame and to the shadow frame (shadow.ts), the
 *   console log of the checkout, the state of the dev server, the after capture and the runs;
 * - the context packet: a cache that the surface events refresh, with a `context.packet` event to the pages;
 * - the hooks: the turn start (turns.ts `beginTurn`, the before picture), the edits (`recordEdits`, the after
 *   picture), the Git refusal, the notices and the `Stop` gate;
 * - the HTTP routes `/tools/`, `/hooks/` and `/context` (agentHttp.ts), and the generated Claude Code files.
 */
import { createAgentHttp } from "./agentHttp";
import { buildPacket, createPacketCache, playTick, type PacketCache } from "./context";
import { createFrontPackets, type FrontPackets } from "./frontPacket";
import { createTurnLog, handleHook, type HookDeps, type HookOutput } from "./hooks";
import { isSurfaceId, type BridgeEvent, type HookEvent, type HostEndpoint, type HostEvent } from "./protocol";
import type { SurfaceWhere } from "./protocol";
import type { Router } from "./router";
import type { RunManager } from "./runs";
import { selectionMoved } from "./sceneEdit";
import type { HttpHandler } from "./server";
import { writeClaudeSettings, type ClaudeFiles } from "./settings";
import { ShadowFrames } from "./shadow";
import { hostPlugins } from "./plugins";
import { activeRunCatalog } from "./runCatalog";
import { sessionGateCheck, StopGate } from "./stopGate";
import type { SurfaceRegistry } from "./surfaces";
import type { TerminalSessions } from "./terminalSessions";
import { createConsoleLog, makeToolContext, type ConsoleLog, type SurfacePort, type ToolFrame } from "./tools/context";
import type { ToolContext, ToolIndex } from "./tools/context";
import type { JobPort } from "./tools/jobs";
import { shownUrl } from "./tools/kit";
import { TurnCapture } from "./turnCapture";
import { PictureStore } from "./pictures";
import { TurnPictureStore } from "./turnPictures";
import type { TurnStore } from "./turns";

/** A file of a command can have a modification time a little before the hook (the clock of the file system). */
const COMMAND_SLACK_MS = 1_000;

export interface AgentLoopOptions {
  readonly surfaces: SurfaceRegistry;
  readonly turns: TurnStore;
  /** The runs of the host, or null. */
  readonly runs: RunManager | null;
  current(): string;
  broadcast(event: HostEvent): void;
  /** The state folder and the endpoint: the generated Claude Code files (settings.ts). */
  readonly stateDir: string;
  readonly endpoint: HostEndpoint;
  /** Folders that must not get the Claude Code files (the checkouts). */
  forbidden(): readonly string[];
  /** The quiet time of the packet refresh (ms; default 600). */
  readonly packetDebounceMs?: number;
  /** The idle time of the shadow frame (ms; default 90 s). */
  readonly shadowIdleMs?: number;
  /** The quiet time after an edit before the after capture (ms; default 250). */
  readonly settleMs?: number;
  /** The session records of the Claude terminals (the `SessionStart` hook adds to them), or none. */
  readonly sessions?: TerminalSessions;
  /** The picture store of the host (default: a store in the state folder). */
  readonly store?: PictureStore;
  /** The frame index of the host for the tools, or none. */
  readonly index?: ToolIndex;
  /** The project folder of the open checkout (`scene_check`), or none (the checkout). */
  projectDir?(): string;
}

export interface AgentLoop {
  /** The handler of `/tools/`, `/hooks/` and `/context`. */
  readonly http: HttpHandler;
  readonly packets: PacketCache;
  /** The surface in front and its packet (the prompt hook, `GET /context`). */
  readonly front: FrontPackets;
  readonly shadow: ShadowFrames;
  readonly capture: TurnCapture;
  /** The saved turns and their pictures. */
  readonly pictures: TurnPictureStore;
  readonly gate: StopGate;
  readonly hooks: HookDeps;
  /** The Claude Code files that the loop wrote at the start (the terminal writes them again at each launch). */
  readonly files: ClaudeFiles;
  /** The tool context of the current open checkout. */
  toolContext(): ToolContext;
  /** Answer one hook (the chat mode calls it from its SDK callbacks). */
  hook(event: HookEvent, payload: unknown): Promise<HookOutput>;
  /** A bridge event of a frame (the registry calls it). */
  onSurfaceEvent(surface: string, where: SurfaceWhere, event: BridgeEvent): void;
  /** Add the requests of the loop (`agent.setStopGate`). */
  addHandlers(router: Router): void;
  stop(): void;
}

/** The URL events during the packet build do not refresh it, because its `check` moves the clock and returns it. */
const PACKET_QUIET_MS = 1_500;

/**
 * Make the ports of the frames of the scene surface (the first surface with the capability `scene`): the visible
 * frame through the registry, the shadow through the shadow frames.
 */
function framePorts(surfaces: SurfaceRegistry, shadow: ShadowFrames): (frame: ToolFrame) => SurfacePort {
  return (frame) => ({
    call: async (call, args = [], options = {}) =>
      frame === "shadow"
        ? shadow.call(surfaces.scene(), call, args, options)
        : surfaces.call(surfaces.scene(), call, args, { ...options, where: "visible" }),
  });
}

/** The hook callbacks of the loop. */
function makeHooks(options: AgentLoopOptions, parts: LoopParts): HookDeps {
  const { capture, gate, front } = parts;
  return {
    // The packet of the surface in front, not always the lab packet.
    packet: async () => (await front.packet())?.text ?? null,
    turns: createTurnLog(),
    onPrompt: ({ session, turn, prompt }) => {
      const key = session ?? "";
      // The saved turn waits for the number of the turn store.
      const numbered = options.turns
        .beginTurn(options.current(), key, { turn, prompt })
        .then((summary) => capture.renumber(key, summary.turn));
      capture.begin(key, turn, { prompt, numbered });
    },
    onEdit: ({ session, turn, file }) => {
      const key = session ?? "";
      void options.turns.recordEdits(options.current(), key, [file]).catch(() => undefined);
      capture.edit(key, turn, file);
    },
    // A command of Claude (a script, `sed -i`) can change files. The turn and the after picture also get them.
    onCommand: ({ session, turn, startedMs }) => {
      if (startedMs === null) return;
      const key = session ?? "";
      void options.turns
        .recordCommandChanges(options.current(), key, startedMs - COMMAND_SLACK_MS)
        .then((found) => {
          for (const file of found?.added ?? []) capture.edit(key, turn, file);
        })
        .catch(() => undefined);
    },
    onNotification: ({ session, message, kind }) => {
      const title = kind === "permission_prompt" ? "Claude waits for an approval" : "Claude waits for you";
      options.broadcast({ type: "agent.notify", session, kind, title, message });
    },
    onStop: ({ session }) => gate.onStop(session),
    // The interactive CLI gives its session ID. The header names the workbench terminal.
    onSessionStart: ({ session, terminal }) => {
      if (session === null || terminal === null) return;
      options.sessions?.record({ session, terminal, checkout: options.current(), source: "hook" });
    },
  };
}

interface LoopParts {
  readonly capture: TurnCapture;
  readonly gate: StopGate;
  readonly front: FrontPackets;
}

/** The build state of the packet: the guard against a refresh by the clock moves of its own `check`. */
export interface PacketState {
  building: boolean;
  quietUntil: number;
  /** The URL of the last packet. */
  url: string | null;
  /** The URL of the last `url` event of the visible lab. */
  seen: string | null;
}

/** The packet cache and its build state. */
function makePackets(
  toolContext: () => ToolContext,
  options: AgentLoopOptions,
): { packets: PacketCache; packetState: PacketState } {
  const packetState: PacketState = { building: false, quietUntil: 0, url: null, seen: null };
  const packets = createPacketCache(
    async () => {
      packetState.building = true;
      try {
        return await buildPacket(toolContext());
      } finally {
        packetState.building = false;
        packetState.quietUntil = Date.now() + PACKET_QUIET_MS;
      }
    },
    {
      debounceMs: options.packetDebounceMs ?? 600,
      onPacket: (packet) => {
        packetState.url = packet.url === null ? null : shownUrl(packet.url);
        options.broadcast({ type: "context.packet", packet });
      },
    },
  );
  return { packets, packetState };
}

/** The tool context factory of the open checkout: one console log per checkout. */
function makeContexts(
  options: AgentLoopOptions,
  port: (frame: ToolFrame) => SurfacePort,
  capture: TurnCapture,
): () => ToolContext {
  const logs = new Map<string, ConsoleLog>();
  const { surfaces } = options;
  return () => {
    const current = options.current();
    let log = logs.get(current);
    if (log === undefined) logs.set(current, (log = createConsoleLog()));
    const scene = surfaces.idWith();
    return makeToolContext({
      surface: port,
      ...(scene === null ? {} : { scene }),
      ...(options.index === undefined ? {} : { index: options.index }),
      // `lab_marks` keeps its picture in the picture store of the host.
      ...(options.store === undefined ? {} : { pictures: options.store }),
      checkout: current,
      ...(options.projectDir === undefined ? {} : { projectDir: options.projectDir() }),
      consoleLog: log,
      server: () => {
        try {
          const state = surfaces.state(surfaces.scene());
          return { server: state.server, lastEdit: state.lastEdit };
        } catch {
          return null;
        }
      },
      after: (width) => capture.after(undefined, width),
      ...(options.runs === null ? {} : { run: runPort(options.runs, () => options.current()) }),
      ...(options.runs === null ? {} : { jobs: jobPort(options.runs, () => options.current()) }),
    });
  };
}

/** The `Stop` gate of the sessions: the fast check of a host plugin, else the stop gate run of the project. */
function sessionStopGate(options: AgentLoopOptions, port: (frame: ToolFrame) => SurfacePort): StopGate {
  const { surfaces } = options;
  return new StopGate({
    check: () =>
      sessionGateCheck({
        plugins: hostPlugins(),
        gate: activeRunCatalog().gate,
        runs: options.runs,
        checkout: options.current(),
        port: port("shadow"),
        url: surfaces.state(surfaces.scene()).url,
      }),
    emit: (event) => options.broadcast(event),
  });
}

/** Start the agent loop of a host. */
export function startAgentLoop(options: AgentLoopOptions): AgentLoop {
  const { surfaces } = options;
  const shadow = new ShadowFrames({
    registry: {
      visibleUrl: (id) => surfaces.state(id).url,
      setShadow: (id, url) => surfaces.setShadow(id, url),
      call: (id, call, args, callOptions) => surfaces.call(id, call, args, callOptions),
      // The build of the built lab that the shadow loads.
      build: (id) => surfaces.shadowBuild(id),
    },
    ...(options.shadowIdleMs === undefined ? {} : { idleMs: options.shadowIdleMs }),
  });
  const port = framePorts(surfaces, shadow);
  const store = options.store ?? new PictureStore(options.stateDir);
  const pictures = new TurnPictureStore(options.stateDir, store);
  const capture = new TurnCapture({
    surface: () => surfaces.surface(surfaces.scene()),
    checkout: () => options.current(),
    emit: (event) => options.broadcast(event),
    pictures,
    store,
    shadow: () => port("shadow"),
    ...(options.settleMs === undefined ? {} : { settleMs: options.settleMs }),
  });
  let checkout = options.current();
  const follow = (): void => {
    if (options.current() === checkout) return;
    checkout = options.current();
    capture.clear();
    shadow.closeAll();
  };
  const contexts = makeContexts(options, port, capture);
  const toolContext = (): ToolContext => {
    follow();
    return contexts();
  };
  const gate = sessionStopGate(options, port);
  const { packets, packetState } = makePackets(toolContext, options);
  const front = createFrontPackets({ packets });
  const hooks = makeHooks(options, { capture, gate, front });
  const files = writeClaudeSettings({
    stateDir: options.stateDir,
    endpoint: options.endpoint,
    forbidden: options.forbidden(),
  });
  const onSurfaceEvent = surfaceEvents(shadow, packets, packetState, () => surfaces.idWith());
  return {
    http: createAgentHttp({ context: toolContext, hooks, front }),
    packets,
    front,
    shadow,
    capture,
    pictures,
    gate,
    hooks,
    files,
    toolContext,
    hook: (event, payload) => handleHook(event, payload, hooks),
    onSurfaceEvent,
    addHandlers: (router) => {
      addLoopHandlers(router, front, gate);
      addTurnHandlers(router, pictures, () => options.current());
    },
    stop: () => {
      packets.stop();
      shadow.closeAll();
      capture.clear();
    },
  };
}

/**
 * The handler of the bridge events of the frames: the `ready` of the shadow and the refresh of the packet. `scene`
 * gives the ID of the scene surface. Only its visible frame refreshes the packet.
 */
export function surfaceEvents(
  shadow: Pick<ShadowFrames, "onEvent">,
  packets: Pick<PacketCache, "refresh">,
  packetState: PacketState,
  scene: () => string | null,
): (surface: string, where: SurfaceWhere, event: BridgeEvent) => void {
  return (surface, where, event) => {
    // The chords of a lab frame (`key`) go to the page only; they change nothing of the surface.
    if (event.event === "key") return;
    shadow.onEvent(surface, where, event);
    if (surface !== scene() || where !== "visible") return;
    if (event.event === "url") {
      const url = shownUrl(event.url);
      // A clock in play moves `t` of the URL. The packet builds only on a pause, a seek or another change.
      const tick = playTick(packetState.seen, url);
      packetState.seen = url;
      const quiet = packetState.building || Date.now() < packetState.quietUntil;
      if (tick || (quiet && !selectionMoved(packetState.url, url)) || url === packetState.url) return;
    }
    if (event.event === "console" && event.level !== "error") return;
    packets.refresh();
  };
}

/** The requests of the loop: the surface in front and the `Stop` gate. */
function addLoopHandlers(router: Router, front: FrontPackets, gate: StopGate): void {
  router.on("surface.front", (params) => {
    const id = (params as { surface?: unknown }).surface;
    if (!isSurfaceId(id)) throw new Error('The parameter "surface" must be the ID of a surface.');
    front.setFront(id);
    return null;
  });
  router.on("agent.setStopGate", (params) => {
    const on = (params as { on?: unknown }).on;
    if (on === undefined) return gate.state();
    if (typeof on !== "boolean") throw new Error('The parameter "on" must be true or false.');
    return gate.set(on);
  });
}

/** The requests of the saved turns: the list of the open checkout and the pictures of one turn. */
function addTurnHandlers(router: Router, pictures: TurnPictureStore, current: () => string): void {
  router.on("agent.turnList", () => ({ turns: pictures.list(current()) }));
  router.on("agent.turnPictures", (params) => {
    const { session, turn } = params as { session?: unknown; turn?: unknown };
    if (typeof session !== "string" || typeof turn !== "number" || !Number.isInteger(turn)) {
      throw new Error('The parameters "session" and "turn" must be a text and a whole number.');
    }
    return pictures.pictures(current(), session, turn);
  });
}

/** The run port of the tools: `startRun` of the run manager in the open checkout. */
function runPort(runs: RunManager, current: () => string): NonNullable<ToolContext["run"]> {
  return (command, args) => runs.startRun(current(), command, args);
}

/** The jobs of the tools over the run manager of the open checkout. */
function jobPort(runs: RunManager, current: () => string): JobPort {
  return {
    start: (command, args) => {
      const started = runs.start(current(), command, args);
      // The tools read the end with job_status; the run manager keeps the result.
      started.done.catch(() => undefined);
      return started.run;
    },
    info: (job) => runs.info(job),
    output: (job, lines) => {
      const output = runs.list(lines).find((item) => item.run === job)?.output;
      return output === undefined ? null : output.split("\n");
    },
  };
}
