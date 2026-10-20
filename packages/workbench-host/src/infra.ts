// SPDX-License-Identifier: Apache-2.0
/**
 * The agent infrastructure of the host in one object: the background runs (loops.ts), the picker (picker.ts), the
 * experiment log (experiments.ts), the settings of a checkout and
 * the Blender server (blender.ts) and the hosts of other windows (windows.ts). host.ts makes it and
 * gives it the events of the runs, its HTTP route, its requests and the launch of the terminal.
 */
import { CheckoutSettingsStore } from "./blender";
import { findCheckout } from "./checkouts";
import { ExperimentLog, loopEntry, runEntry } from "./experiments";
import { LoopManager, type LoopManagerOptions } from "./loops";
import { Picker } from "./picker";
import { PictureStore } from "./pictures";
import type { ExperimentQuery, HostEndpoint, HostEvent, LoopParams } from "./protocol";
import { needString, type Router } from "./router";
import type { RunManager } from "./runs";
import { claudeArgs, writeClaudeSettings } from "./settings";
import type { HostState } from "./state";
import type { ClaudeLaunch } from "./terminal";
import type { SurfacePort, ToolIndex } from "./tools/context";
import { WindowHosts, type HostStarter } from "./windows";

export interface InfraOptions {
  readonly repo: string;
  /** The workspace folder from the Git top folder of each worktree ("" or absent: the same folder). */
  readonly workspaceRel?: string;
  readonly state: HostState;
  readonly runs: RunManager;
  readonly endpoint: HostEndpoint;
  readonly current: () => string;
  readonly broadcast: (event: HostEvent) => void;
  /** The checkouts that must not get the generated Claude Code files. */
  forbidden(): readonly string[];
  /** The shadow frame of the lab of the open checkout. */
  readonly shadow: () => SurfacePort;
  /** The URL of the visible lab frame, or null. */
  readonly labUrl: () => string | null;
  /** Test parts: the processes of the background runs, the `claude` program and the start of a second host. */
  readonly loops?: Pick<LoopManagerOptions, "spawn" | "claude" | "env" | "minuteMs" | "graceMs">;
  readonly startHost?: HostStarter;
  /** The home folder of the owner (the Blender server). A test gives a temporary folder. */
  readonly home?: string;
  /** The picture store of the host (default: a store in the state folder). */
  readonly pictures?: PictureStore;
  /** The frame index of the host for the sheets of the picker. */
  readonly index?: ToolIndex;
}

export interface Infra {
  readonly loops: LoopManager;
  readonly log: ExperimentLog;
  readonly picker: Picker;
  readonly settings: CheckoutSettingsStore;
  readonly windows: WindowHosts;
  /** The HTTP route of the hooks of the background runs. */
  http(request: Request, url: URL): Promise<Response | null>;
  /** An event of the run manager (the experiment log records each run that ended). */
  onRunEvent(event: HostEvent): void;
  /** The launch of a `claude` terminal: the generated files with the Blender server when the setting is on. */
  claudeLaunch(): Promise<ClaudeLaunch>;
  addHandlers(router: Router): void;
  stop(): Promise<void>;
  killNow(): void;
}

/** Make the infrastructure of a host. */
export function startInfra(options: InfraOptions): Infra {
  const { state, runs, current } = options;
  const settings = new CheckoutSettingsStore(state.dir, options.home);
  const log = new ExperimentLog({ stateDir: state.dir });
  const isCheckout = (path: string): Promise<boolean> =>
    findCheckout(options.repo, path, new Set(), true, options.workspaceRel ?? "").then(
      () => true,
      () => false,
    );
  const loops = new LoopManager({
    stateDir: state.dir,
    endpoint: options.endpoint,
    repo: options.repo,
    ...(options.workspaceRel === undefined ? {} : { workspaceRel: options.workspaceRel }),
    current,
    emit: options.broadcast,
    runs,
    extraServers: (checkout) => settings.extraServers(checkout),
    onEnd: (info) => log.add(loopEntry(info)),
    ...options.loops,
  });
  const picker = new Picker({
    shadow: options.shadow,
    labUrl: options.labUrl,
    runs,
    worktrees: () => loops.worktrees(),
    isCheckout,
    current,
    emit: options.broadcast,
    pictures: options.pictures ?? new PictureStore(state.dir),
    ...(options.index === undefined ? {} : { index: options.index }),
  });
  const windows = new WindowHosts({
    current,
    isCheckout,
    ...(options.startHost === undefined ? {} : { start: options.startHost }),
  });
  const loopHttp = loops.http();
  return {
    loops,
    log,
    picker,
    settings,
    windows,
    http: loopHttp,
    onRunEvent(event) {
      if (event.type !== "runs.done") return;
      const info = runs.info(event.run);
      if (info === null) return;
      // The intent of the checkout of the run; a run in another worktree uses the setting of that checkout.
      log.add(runEntry(info, settings.get(info.checkout).intent));
    },
    claudeLaunch() {
      const files = writeClaudeSettings({
        stateDir: state.dir,
        endpoint: options.endpoint,
        forbidden: options.forbidden(),
        extraServers: settings.extraServers(current()),
      });
      return Promise.resolve({ args: claudeArgs(files), env: files.env });
    },
    addHandlers: (router) => addInfraHandlers(router, { loops, log, picker, settings, windows, current }),
    stop: async () => {
      windows.stopAll();
      await loops.stopAll();
    },
    killNow: () => {
      loops.killNow();
      windows.stopAll();
    },
  };
}

interface HandlerParts {
  readonly loops: LoopManager;
  readonly log: ExperimentLog;
  readonly picker: Picker;
  readonly settings: CheckoutSettingsStore;
  readonly windows: WindowHosts;
  readonly current: () => string;
}

/** The text fields of a search query. */
function query(params: object): ExperimentQuery {
  const read = (name: string): string | undefined => {
    const value = (params as Record<string, unknown>)[name];
    return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
  };
  const limit = (params as { limit?: unknown }).limit;
  const names = ["take", "command", "text", "intent", "from", "to"] as const;
  const fields: Record<string, string> = {};
  for (const name of names) {
    const value = read(name);
    if (value !== undefined) fields[name] = value;
  }
  return { ...(fields as ExperimentQuery), ...(typeof limit === "number" ? { limit } : {}) };
}

/** Add the requests of the infrastructure. */
function addInfraHandlers(router: Router, parts: HandlerParts): void {
  const { loops, log, picker, settings, windows, current } = parts;
  router
    .on("loops.start", (params) => loops.start(params as Partial<LoopParams>))
    .on("loops.stop", async (params) => {
      await loops.stop(needString(params, "loop"));
      return null;
    })
    .on("loops.list", () => loops.list())
    .on("experiments.search", (params) => log.search(query(params)))
    .on("picker.candidates", () => picker.candidates())
    .on("picker.sheets", async (params) => ({ job: await picker.sheets(params.window, params.candidates) }))
    .on("picker.pick", (params) => picker.pick(params))
    .on("checkout.settings", (params) => {
      const patch = params as { blender?: unknown; intent?: unknown; builtLab?: unknown };
      if (patch.blender === undefined && patch.intent === undefined && patch.builtLab === undefined) {
        return settings.get(current());
      }
      return settings.set(current(), patch);
    })
    .on("windows.open", (params) => windows.open(needString(params, "path")));
}
