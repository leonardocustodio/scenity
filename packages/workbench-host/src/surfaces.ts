// SPDX-License-Identifier: Apache-2.0
/**
 * The surfaces of the host and the surface RPC (the host half).
 *
 * A surface is a page of the checkout that a workbench page shows in a frame. The host never speaks to a frame: it
 * sends a `surface.request` event to the page that shows the surface, and the page answers with the request
 * `surface.call`. The page also sends the bridge events of the frame to the host (`surface.report`). The host keeps
 * the URL, the last HMR updates and the console errors of each surface. The `Surface` object is the client that the
 * tools use.
 */
import { join, relative } from "node:path";
import { sendBridgeCall, URL_CALL } from "@scenity/bridge";
import { withoutLabKey } from "@scenity/labs-platform/labKey";
import type { EditWatcher } from "./edits";
import { HmrTracker, type HmrRecord, type HmrTarget } from "./hmr";
import {
  captureArgs,
  // The default width of the base call `capture` of `@scenity/bridge`.
  DEFAULT_CAPTURE_WIDTH,
  hasCapability,
  INDEX_CAPABILITY,
  isBridgeEvent,
  NO_SCENE_SURFACE,
  readPictureFrame,
  type BridgeEvent,
  type Capture,
  type HostEvent,
  type SurfaceKind,
  type SurfaceState,
  type SurfaceWhere,
  surfaceWith,
} from "./protocol";
import type { PageClient } from "./server";
import { SurfaceCalls } from "./surfaceCalls";
import type { BuiltLabRef } from "./labPool";
import { LAB_APP, type DevServer } from "./servers";
import { captureOf } from "./tools/kit";
import { indexerDefaults, keyed, labDefaults, surfaceUrl } from "./surfaceUrls";

export { indexerDefaults, labDefaults, surfaceUrl } from "./surfaceUrls";

/** The options of one surface call. */
export interface CallOptions {
  /** The frame: the visible one (default) or the shadow. */
  readonly where?: SurfaceWhere;
  /** The time for the answer of the frame. The default is 10 s (20 s for `capture`). */
  readonly timeoutMs?: number;
}

/** The client of one surface for the tools. It follows the surface when the open checkout changes. */
export interface Surface {
  readonly id: string;
  /** The state of the surface, as the `surface.state` event gives it. */
  readonly state: SurfaceState;
  /** The last update that the visible frame applied (an `hmr` event or a page load), or null. */
  readonly lastHmr: HmrRecord | null;
  /** The console errors of the frames since the last `clearConsole`, the oldest first (at most 50). */
  readonly consoleErrors: readonly string[];
  /** Send a call of the bridge (a method of `Room3DLabApi` or `capture`, `url`, `console`, `check`). */
  call(call: string, args?: readonly unknown[], options?: CallOptions): Promise<unknown>;
  /** The full URL of the frame (the bridge call `url`). */
  url(options?: CallOptions): Promise<string>;
  /** A picture of the frame (the bridge call `capture`), `width` pixels wide at 16:10. */
  capture(width?: number, options?: CallOptions): Promise<Capture>;
  /**
   * Wait until the visible frame applied the edit of a file (an absolute path, or a path relative to the checkout),
   * or any update after a time (`{ since }`, ms since the epoch). Reject after the timeout (default 10 s).
   */
  waitForHmr(target: HmrTarget, timeoutMs?: number): Promise<HmrRecord>;
  clearConsole(): void;
}

/** The definition of a surface of the open checkout. */
export interface SurfaceDefinition {
  readonly id: string;
  readonly kind: SurfaceKind;
  /** The label and the capabilities of the surface, from the project manifest. */
  readonly label: string;
  readonly capabilities: readonly string[];
  /** The start path of the frame without a saved URL (default `/`). */
  readonly page?: string | null;
  readonly checkout: string;
  readonly server: DevServer;
  /** The file watcher of the checkout, or null without one. */
  readonly watcher: EditWatcher | null;
  /** The URL of the frame from the state folder, or null. */
  readonly savedUrl: string | null;
  /** The folder of the Vite root of the surface. The default is apps/editor (the app surfaces give theirs). */
  readonly appRoot?: string;
  /**
   * The built lab of the checkout (labPool.ts), or none. The shadow frame uses it when it is ready. The visible
   * frame uses it only when its setting says so (no HMR there).
   */
  readonly built?: BuiltLabRef | null;
}

export interface RegistryOptions {
  /** Send an event to every page. */
  broadcast(event: HostEvent): void;
  /** Write the URL of a surface into the state folder. The registry calls it at most once per `persistMs`. */
  persistUrl?(checkout: string, surface: string, url: string): void;
  readonly persistMs?: number;
  readonly now?: () => number;
  /** Called after each bridge event of a frame (the refresh of the context packet, the shadow). */
  onEvent?(surface: string, where: SurfaceWhere, event: BridgeEvent): void;
  /** The wait of a call for the `ready` of a frame that reloads (ms; default 20 s). */
  readonly reloadWaitMs?: number;
  /** The lab ticket of the frame URLs in the remote mode (labTicket.ts), or absent. */
  ticket?(): string;
}

interface Entry {
  readonly def: SurfaceDefinition;
  readonly hmr: HmrTracker;
  url: string | null;
  /** The URL of the shadow frame, or null. */
  shadowUrl: string | null;
  lastEdit: SurfaceState["lastEdit"];
  readonly errors: string[];
  readonly warnings: string[];
  readonly unsubscribe: () => void;
  persistTimer: ReturnType<typeof setTimeout> | null;
}

const CONSOLE_MAX = 50;
const CALL_TIMEOUT_MS = 10_000;
const CAPTURE_TIMEOUT_MS = 20_000;

/** The words of a call that timed out. A frame of a window behind others draws nothing in WebKit. */
function timeoutText(id: string, call: string, timeoutMs: number): string {
  const drawn = ["capture", "frame", "sheet", "check", "measure", "measureAt"].includes(call);
  const hint = drawn ? " The frame draws nothing while the window is hidden or behind other windows." : "";
  return `The surface ${id} did not answer "${call}" in ${String(timeoutMs)} ms.${hint}`;
}

function pushLimited(list: string[], text: string): void {
  list.push(text);
  if (list.length > CONSOLE_MAX) list.splice(0, list.length - CONSOLE_MAX);
}

/** The surfaces of the open checkout and the requests to their frames. */
export class SurfaceRegistry {
  readonly #options: RegistryOptions;
  readonly #now: () => number;
  readonly #entries = new Map<string, Entry>();
  readonly #shown = new Map<string, PageClient>();
  readonly #calls: SurfaceCalls;
  #pageOrigin: string | null = null;

  constructor(options: RegistryOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#calls = new SurfaceCalls({
      shown: (id, where) => this.#shown.get(`${id}/${where}`),
      timeoutText,
      now: this.#now,
      ...(options.reloadWaitMs === undefined ? {} : { reloadWaitMs: options.reloadWaitMs }),
    });
  }

  /** Add a surface, or replace the surface with the same ID (another checkout). */
  define(def: SurfaceDefinition): Surface {
    this.remove(def.id);
    const appRoot = def.appRoot ?? join(def.checkout, LAB_APP);
    const lastEdit = (file: string): number | null => def.watcher?.lastEdit(file) ?? null;
    const offServer = def.server.onChange(() => this.#changed(def.id));
    // A change of the built lab (ready, stopped) moves the shadow frame between the two servers.
    const offBuilt = def.built?.server.onChange(() => this.#changed(def.id));
    const unsubscribe = (): void => {
      offServer();
      offBuilt?.();
    };
    const entry: Entry = {
      def,
      hmr: new HmrTracker({ checkout: def.checkout, appRoot, lastEdit, now: this.#now }),
      url: def.savedUrl,
      shadowUrl: null,
      lastEdit: null,
      errors: [],
      warnings: [],
      unsubscribe,
      persistTimer: null,
    };
    this.#entries.set(def.id, entry);
    this.#changed(def.id);
    return this.surface(def.id);
  }

  /** Remove a surface. Its waits for HMR end with an error. */
  remove(id: string): void {
    const entry = this.#entries.get(id);
    if (entry === undefined) return;
    this.#persistNow(entry);
    entry.unsubscribe();
    entry.hmr.cancel(`The surface ${id} closed.`);
    this.#entries.delete(id);
  }

  /** The IDs of the surfaces. */
  ids(): string[] {
    return [...this.#entries.keys()];
  }

  /** The ID of the surface with a capability (default: the scene surface of the tools), or null. */
  idWith(capability?: string): string | null {
    const defs = [...this.#entries.values()].map((entry) => entry.def);
    return surfaceWith(defs, capability)?.id ?? null;
  }

  /** The ID of the scene surface. Throws `NO_SCENE_SURFACE` when the open project has none. */
  scene(): string {
    const id = this.idWith();
    if (id === null) throw new Error(NO_SCENE_SURFACE);
    return id;
  }

  #entry(id: string): Entry {
    const entry = this.#entries.get(id);
    if (entry === undefined) throw new Error(`Unknown surface: ${id}`);
    return entry;
  }

  /** Set the origin of the workbench page (`host.hello`). The surface URLs get it as the `workbench` parameter. */
  setPageOrigin(origin: string): void {
    if (origin === this.#pageOrigin) return;
    this.#pageOrigin = origin;
    for (const id of this.#entries.keys()) this.#changed(id);
  }

  /** The state of a surface. */
  state(id: string): SurfaceState {
    const { def, url, lastEdit, shadowUrl } = this.#entry(id);
    const info = def.server.info;
    // The built lab when it is ready: always for the shadow, for the visible frame only by the setting.
    const built = def.built?.server.info.status === "ready" ? def.built.server : null;
    const shadowServer = built ?? def.server;
    const visibleServer = built !== null && def.built?.visible() === true ? built : def.server;
    const frameUrl = (server: DevServer, saved: string | null): string | null =>
      server.info.status === "ready"
        ? keyed(
            server.pageKey,
            labDefaults(def, surfaceUrl(server.info.frameOrigin, saved, this.#pageOrigin, def.page ?? null)),
            this.#options.ticket?.() ?? null,
          )
        : null;
    const index = built !== null && hasCapability(def, INDEX_CAPABILITY);
    return {
      id,
      kind: def.kind,
      label: def.label,
      capabilities: [...def.capabilities],
      checkout: def.checkout,
      url: frameUrl(visibleServer, url),
      server: { status: info.status, port: info.port, error: info.error },
      lastEdit,
      shadowUrl: info.status === "ready" && shadowUrl !== null ? frameUrl(shadowServer, shadowUrl) : null,
      // The indexer window loads the built lab only (no HMR, 3.5 MB in place of 46 MB).
      indexerUrl: index
        ? keyed(built.pageKey, indexerDefaults(surfaceUrl(built.info.frameOrigin, null, this.#pageOrigin)))
        : null,
      // The worker paths of the pool, for the indexer window that lends its frame to `labs shot --engine webkit`.
      indexerWorker:
        index && def.built?.workerToken !== undefined && built.info.origin !== null
          ? { origin: built.info.origin, token: def.built.workerToken }
          : null,
    };
  }

  /**
   * The ID of the build that the shadow frame of a surface loads (it waits for a build after a change of the
   * sources), or null when the shadow uses the dev server.
   */
  async shadowBuild(id: string): Promise<string | null> {
    const { def } = this.#entry(id);
    if (def.built?.server.info.status !== "ready") return null;
    return def.built.fresh();
  }

  /** Show (a URL) or remove (null) the shadow frame of a surface. The pages get the new state. */
  setShadow(id: string, url: string | null): void {
    const entry = this.#entry(id);
    const next = url === null ? null : withoutLabKey(url);
    if (entry.shadowUrl === next) return;
    entry.shadowUrl = next;
    this.#changed(id);
  }

  /** Send the state of a surface to the pages again (for example after a change of the setting `builtLab`). */
  refresh(id: string): void {
    this.#changed(id);
  }

  /** The states of every surface. */
  states(): SurfaceState[] {
    return this.ids().map((id) => this.state(id));
  }

  #changed(id: string): void {
    if (this.#entries.has(id)) this.#options.broadcast({ type: "surface.state", surface: this.state(id) });
  }

  #schedulePersist(entry: Entry): void {
    if (entry.persistTimer !== null || this.#options.persistUrl === undefined) return;
    entry.persistTimer = setTimeout(() => this.#persistNow(entry), this.#options.persistMs ?? 500);
  }

  #persistNow(entry: Entry): void {
    if (entry.persistTimer !== null) clearTimeout(entry.persistTimer);
    entry.persistTimer = null;
    if (entry.url !== null) this.#options.persistUrl?.(entry.def.checkout, entry.def.id, entry.url);
  }

  /** Write every changed surface URL immediately (the stop of the host). */
  flush(): void {
    for (const entry of this.#entries.values()) if (entry.persistTimer !== null) this.#persistNow(entry);
  }

  /** Handle a `surface.report` of a page: the page shows the surface, and its frame sent the event. */
  report(client: PageClient, surface: string, where: unknown, event: unknown): void {
    const entry = this.#entry(surface);
    if (where !== "visible" && where !== "shadow" && where !== "indexer")
      throw new Error(`Unknown frame: ${String(where)}`);
    if (!isBridgeEvent(event)) throw new Error("The event is not a bridge event.");
    this.#shown.set(`${surface}/${where}`, client);
    // A reload of a frame: the calls that it hit go to the new page.
    if (event.event === "reload") this.#calls.reloading(surface, where);
    if (event.event === "ready") this.#calls.ready(surface, where);
    if (event.event === "console") pushLimited(event.level === "error" ? entry.errors : entry.warnings, event.text);
    else if (where === "visible") this.#visibleEvent(entry, event);
    this.#options.onEvent?.(surface, where, event);
  }

  #visibleEvent(entry: Entry, event: Exclude<BridgeEvent, { event: "console" }>): void {
    switch (event.event) {
      case "hmr":
        this.#applied(entry, entry.hmr.hmr(event.files));
        return;
      case "reload":
        entry.hmr.reload();
        return;
      case "ready":
        entry.url = withoutLabKey(event.url);
        this.#applied(entry, entry.hmr.ready());
        return;
      case "url":
        entry.url = withoutLabKey(event.url);
        this.#schedulePersist(entry);
        this.#changed(entry.def.id);
    }
  }

  /** Record an update of the frame as the last edit of the surface. */
  #applied(entry: Entry, record: HmrRecord): void {
    const latest = entry.def.watcher?.latest() ?? null;
    const file = latest !== null && latest.at <= record.at ? latest.file : (record.files[0] ?? null);
    if (file !== null) {
      const at = new Date(record.at).toISOString();
      entry.lastEdit = { file: relative(entry.def.checkout, file), at, reloaded: record.reloaded };
    }
    this.#schedulePersist(entry);
    this.#changed(entry.def.id);
  }

  /**
   * Send a call into a frame through the page that shows it. Reject when no page shows it or on the timeout. A
   * call that a page reload hits waits for the new page and goes to it once more (surfaceCalls.ts).
   */
  call(id: string, call: string, args: readonly unknown[] = [], options: CallOptions = {}): Promise<unknown> {
    if (!this.#entries.has(id)) return Promise.reject(new Error(`Unknown surface: ${id}`));
    const where = options.where ?? "visible";
    const timeoutMs = options.timeoutMs ?? (call === "capture" ? CAPTURE_TIMEOUT_MS : CALL_TIMEOUT_MS);
    return this.#calls.call(id, where, call, args, timeoutMs);
  }

  /** Handle a `surface.call` of a page: the answer of a frame to a request. */
  answer(client: PageClient, params: { request: number; result?: unknown; error?: unknown }): void {
    this.#calls.answer(client, params);
  }

  /**
   * A binary WebSocket message of a page: the picture bytes of a request, before its `surface.call`. Throw an
   * error for bytes that are not a picture frame or for a request that is not open.
   */
  bytes(client: PageClient, data: Uint8Array): void {
    const frame = readPictureFrame(data);
    if (frame === null) throw new Error("The binary message is not a picture frame.");
    this.#calls.bytes(client, frame);
  }

  /** Forget a page that closed: its frames show nothing, and its open requests end with an error. */
  dropClient(client: PageClient): void {
    for (const [key, shown] of this.#shown) if (shown.id === client.id) this.#shown.delete(key);
    this.#calls.dropClient(client, "The workbench page closed.");
  }

  /** End every request and every wait (the stop of the host). */
  close(): void {
    this.flush();
    this.#calls.close("The host stops.");
    for (const id of this.ids()) this.remove(id);
  }

  /** The client of a surface for the tools. */
  surface(id: string): Surface {
    const entry = (): Entry => this.#entry(id);
    const state = (): SurfaceState => this.state(id);
    return {
      id,
      get state() {
        return state();
      },
      get lastHmr() {
        return entry().hmr.last;
      },
      get consoleErrors() {
        return [...entry().errors];
      },
      call: (call, args = [], options) => this.call(id, call, args, options),
      // The base call `url` of `@scenity/bridge`.
      url: (options) => sendBridgeCall(URL_CALL, (name, args) => this.call(id, name, args, options)),
      capture: async (width, options) => {
        // A picture at 16:10, whatever the size of the frame.
        const value = await this.call(id, "capture", captureArgs(width ?? DEFAULT_CAPTURE_WIDTH), options);
        try {
          // The bytes of the binary frame (or the base64 of a lab page of an older checkout).
          return captureOf(value);
        } catch {
          throw new Error(`The surface ${id} gave no picture.`);
        }
      },
      waitForHmr: (target, timeoutMs = CALL_TIMEOUT_MS) => entry().hmr.wait(target, timeoutMs),
      clearConsole: () => {
        entry().errors.length = 0;
        entry().warnings.length = 0;
      },
    };
  }
}
