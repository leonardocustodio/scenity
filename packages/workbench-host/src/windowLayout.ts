// SPDX-License-Identifier: Apache-2.0
/**
 * The link between the windows and the window layout of the host (the messages are in windowProtocol.ts).
 *
 * - The link: `link.post` sends a message of a page to every other page of the host (`link.message`). The host keeps
 *   the last message with `keep` of each channel, so a window that opens later reads the clock at once (`link.kept`).
 * - The layout: one JSON file in the state folder (`layout.json`, a layout per checkout, an atomic write per change).
 *   A page that asks `layout.get` with `main: true` is a main window. A detached window tells its key with
 *   `layout.join`. When a detached window closes and a main window is still connected after DROP_MS, the owner closed
 *   it: the host removes it from the layout. When all pages close (the app quits, the host stops), the layout keeps
 *   every window, so the next start opens them again. A reload of a detached window joins again within DROP_MS.
 */
import { join } from "node:path";
import {
  detachedPanel,
  EMPTY_LAYOUT,
  isLinkChannel,
  isPanelKey,
  LINK_MAX_CHARS,
  MAX_DETACHED,
  patchLayout,
  readLayout,
  windowRect,
  type DetachedPanel,
  type HostEvent,
  type LayoutView,
  type WindowLayout,
} from "./protocol";
import { needString, type Router } from "./router";
import type { HostServer, PageClient } from "./server";
import { readJsonObject, writeJsonAtomic, type HostState } from "./state";

/** The file of the layouts in the state folder. */
export const LAYOUT_FILE = "layout.json";
/** The wait after a detached window closed before the host removes it from the layout (ms). */
export const DROP_MS = 3_000;

export interface WindowLayoutOptions {
  readonly stateDir: string;
  /** The open checkout of the host. */
  readonly checkout: () => string;
  /** The pages with an open WebSocket. */
  readonly clients: () => readonly PageClient[];
  readonly broadcast: (event: HostEvent) => void;
  readonly dropMs?: number;
}

/** What the host knows of a page: a main window, or a detached window with its key. */
type Role = { readonly main: true } | { readonly main: false; readonly key: string };

export class WindowLayouts {
  readonly #options: WindowLayoutOptions;
  readonly #roles = new Map<number, Role>();
  readonly #kept = new Map<string, unknown>();
  readonly #drops = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: WindowLayoutOptions) {
    this.#options = options;
  }

  get #file(): string {
    return join(this.#options.stateDir, LAYOUT_FILE);
  }

  /** The saved layout of the open checkout. */
  layout(): WindowLayout {
    return readLayout(readJsonObject(this.#file)[this.#options.checkout()] ?? EMPTY_LAYOUT);
  }

  #save(layout: WindowLayout): void {
    const all = readJsonObject(this.#file);
    writeJsonAtomic(this.#file, { ...all, [this.#options.checkout()]: layout });
  }

  /** The keys of the detached windows that are connected now. */
  open(): string[] {
    const ids = new Set(this.#options.clients().map((client) => client.id));
    const keys = new Set<string>();
    for (const [id, role] of this.#roles) if (!role.main && ids.has(id)) keys.add(role.key);
    return [...keys].sort();
  }

  view(): LayoutView {
    return { layout: this.layout(), open: this.open() };
  }

  #tell(extra: Partial<LayoutView> = {}): LayoutView {
    const view = { ...this.view(), ...extra };
    this.#options.broadcast({ type: "layout.state", ...view });
    return { layout: view.layout, open: view.open };
  }

  /** Add or replace a detached window. */
  detach(panel: DetachedPanel): LayoutView {
    const layout = this.layout();
    const others = layout.detached.filter((item) => item.key !== panel.key);
    if (others.length >= MAX_DETACHED) throw new Error(`A layout has at most ${String(MAX_DETACHED)} windows.`);
    this.#save({ ...layout, detached: [...others, panel] });
    return this.#tell();
  }

  /** Remove a detached window. `docked` tells the main page to put it back in its place. */
  remove(key: string, docked: boolean): LayoutView {
    const layout = this.layout();
    const panel = layout.detached.find((item) => item.key === key);
    if (panel === undefined) return this.view();
    this.#save({ ...layout, detached: layout.detached.filter((item) => item.key !== key) });
    return this.#tell(docked ? { docked: panel } : {});
  }

  /** The new place of a window (`main` for the main window). No event: only a restart reads it. */
  place(key: string, rect: unknown): void {
    const value = windowRect(rect);
    if (value === null) throw new Error('The parameter "rect" must be a window place.');
    const layout = this.layout();
    if (key === "main") {
      this.#save({ ...layout, main: value });
      return;
    }
    if (!layout.detached.some((item) => item.key === key)) return;
    this.#save({
      ...layout,
      detached: layout.detached.map((item) => (item.key === key ? { ...item, rect: value } : item)),
    });
  }

  /** A detached window connected: it is open again, and a planned removal stops. */
  joined(client: PageClient, key: string): LayoutView {
    this.#roles.set(client.id, { main: false, key });
    const timer = this.#drops.get(key);
    if (timer !== undefined) clearTimeout(timer);
    this.#drops.delete(key);
    return this.#tell();
  }

  /** Send a message of a page to every other page. */
  post(client: PageClient, channel: string, message: unknown, keep: boolean): void {
    const event: HostEvent = { type: "link.message", channel, from: client.id, message };
    for (const other of this.#options.clients()) if (other.id !== client.id) other.send(event);
    if (keep) this.#kept.set(channel, message);
  }

  kept(channel: string): { message: unknown } | null {
    return this.#kept.has(channel) ? { message: this.#kept.get(channel) } : null;
  }

  /** A page closed. A detached window that does not connect again while a main window stays leaves the layout. */
  dropClient(client: PageClient): void {
    const role = this.#roles.get(client.id);
    this.#roles.delete(client.id);
    if (role === undefined) return;
    if (role.main) return;
    const { key } = role;
    this.#options.broadcast({ type: "layout.state", ...this.view() });
    const old = this.#drops.get(key);
    if (old !== undefined) clearTimeout(old);
    const timer = setTimeout(() => {
      this.#drops.delete(key);
      if (this.open().includes(key) || !this.#mainConnected()) return;
      this.remove(key, false);
    }, this.#options.dropMs ?? DROP_MS);
    timer.unref();
    this.#drops.set(key, timer);
  }

  #mainConnected(): boolean {
    return this.#options.clients().some((client) => this.#roles.get(client.id)?.main === true);
  }

  /** Stop the planned removals (the stop of the host). */
  stop(): void {
    for (const timer of this.#drops.values()) clearTimeout(timer);
    this.#drops.clear();
  }

  /** The handlers of the requests of windowProtocol.ts. */
  register(router: Router): void {
    router
      .on("link.post", (params, client) => {
        const channel = needString(params, "channel");
        if (!isLinkChannel(channel)) throw new Error('The parameter "channel" is not a channel name.');
        const message: unknown = params.message;
        if (typeof message !== "object" || message === null)
          throw new Error('The parameter "message" must be an object.');
        if (JSON.stringify(message).length > LINK_MAX_CHARS) throw new Error("The link message is too large.");
        this.post(client, channel, message, params.keep === true);
        return null;
      })
      .on("link.kept", (params) => {
        const channel = needString(params, "channel");
        return this.kept(channel);
      })
      .on("layout.get", (params, client) => {
        if (params.main === true) this.#roles.set(client.id, { main: true });
        return this.view();
      })
      .on("layout.set", (params) => {
        this.#save(patchLayout(this.layout(), params));
        return this.#tell();
      })
      .on("layout.detach", (params) => {
        const panel = detachedPanel(params.panel);
        if (panel === null) throw new Error('The parameter "panel" is not a detached window.');
        return this.detach(panel);
      })
      .on("layout.dock", (params) => {
        const key = needString(params, "key");
        return this.remove(key, true);
      })
      .on("layout.join", (params, client) => {
        const key = needString(params, "key");
        if (!isPanelKey(key)) throw new Error('The parameter "key" is not a window key.');
        return this.joined(client, key);
      })
      .on("layout.rect", (params) => {
        this.place(needString(params, "key"), params.rect);
        return null;
      });
  }
}

/**
 * The window layouts of a host, with their request handlers. The open checkout is the one that the state folder
 * names (`HostState.currentCheckout`, written at each open), else the checkout of the start.
 */
export function windowLayouts(state: HostState, server: HostServer, router: Router, start: string): WindowLayouts {
  const layouts = new WindowLayouts({
    stateDir: state.dir,
    checkout: () => state.currentCheckout() ?? start,
    clients: () => server.clients(),
    broadcast: (event) => server.broadcast(event),
  });
  layouts.register(router);
  return layouts;
}
