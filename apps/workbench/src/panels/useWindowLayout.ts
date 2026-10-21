// SPDX-License-Identifier: Apache-2.0
/**
 * The window layout of the main window.
 *
 * - At the first connection, the page reads the layout of the checkout (`layout.get` with `main: true`). It shows or
 *   hides the Claude column, opens the saved dock tab and puts the app window at its saved place. It also opens again
 *   each detached window that is not connected (after a restart of the app or of the browser). A browser that blocks
 *   a window gives a notice with a button that opens the windows.
 * - Each change of the Claude column and of the dock tab goes to the host (`layout.set`). The place of the window goes
 *   to the host when it changes (`layout.rect`).
 * - "Open in a window" (`detach`): the panel goes into the layout first, then its window opens. A pane asks once for
 *   the memory cost, then the lab releases the pane (`dropPane`). The content browser hides in the lab
 *   (`dock("hidden")`). "Dock back" in a window (`layout.dock`) puts the part again in this window.
 */
import type {
  BridgeDetachEvent,
  DetachedPanel,
  PanelKind,
  SurfaceWhere,
  WindowLayout,
  WindowRect,
} from "@scenity/workbench-host/protocol";
import { EMPTY_LAYOUT } from "@scenity/workbench-host/protocol";
import { getCurrentScope, onScopeDispose, ref, shallowRef, watch, type Ref, type ShallowRef } from "vue";
import type { HostApi } from "../host/useHost";
import type { SurfaceRelay } from "../surfaces/relay";
import { openPanel, placeWindow, trackRect, windowName, type OpenWay, type PanelWindowHost } from "./openPanel";
import { DOCK_TABS, kindOfTab, newPanelKey, panelPageUrl } from "./panelUrl";

/** The storage key of the PTY of a Claude tab (Terminal.vue): a detached Claude column opens the same terminals. */
export function terminalKey(checkout: string, kind: "claude" | "shell"): string {
  return `scenity.workbench.terminal.${checkout}.${kind}`;
}

export interface WindowLayoutParts {
  readonly host: Pick<HostApi, "request" | "client" | "greeted" | "state" | "checkout" | "endpoint">;
  /** The relay of the page: the frame of the scene surface gives up a pane or its dock. */
  readonly relay: Pick<SurfaceRelay, "call" | "idWith">;
  readonly claudeOpen: Ref<boolean>;
  /** The open dock tab of the bottom bar. */
  readonly dockTab: Ref<string | null>;
  /** The window (a test gives a fake without events: no place reports). */
  readonly win?: PanelWindowHost;
  /** The session storage (the PTY IDs of the Claude tabs); a test gives a fake. */
  readonly storage?: Pick<Storage, "getItem"> | null;
}

export interface WindowLayoutApi {
  readonly layout: ShallowRef<WindowLayout>;
  /** The keys of the detached windows that are connected now. */
  readonly open: Ref<readonly string[]>;
  /** The detached windows that the browser did not open (it blocks a window without a click). */
  readonly blocked: Ref<readonly DetachedPanel[]>;
  /** The question of the memory cost of a pane, or null (DetachCost.vue answers it). */
  readonly costAsk: Ref<((ok: boolean) => void) | null>;
  /** True when a part of this kind is in its own window. */
  detached(kind: PanelKind): boolean;
  /** "Open in a window" of a part. */
  detach(kind: PanelKind, query?: Readonly<Record<string, string>>): Promise<OpenWay | null>;
  /** The window of a detached part in front (or opened again). */
  show(kind: PanelKind): Promise<void>;
  /** Put a detached part again into this window. */
  dockBack(kind: PanelKind): Promise<void>;
  /** Open the windows that the browser blocked (from a click of the notice). */
  reopen(): Promise<void>;
  /** The handler of the `detach` events of the lab frame (relay). */
  onFrameDetach(surface: string, where: SurfaceWhere, event: BridgeDetachEvent): void;
}

function storageOf(parts: WindowLayoutParts): Pick<Storage, "getItem"> | null {
  if (parts.storage !== undefined) return parts.storage;
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}

/** The state of the layout of a page and the parts that its functions share. */
interface LayoutCtx {
  readonly parts: WindowLayoutParts;
  readonly win: PanelWindowHost;
  readonly layout: ShallowRef<WindowLayout>;
  readonly open: Ref<readonly string[]>;
  readonly blocked: Ref<readonly DetachedPanel[]>;
  readonly costAsk: Ref<((ok: boolean) => void) | null>;
  /** True after the first restore. */
  restored: boolean;
  /** True while the page applies the saved layout: the watchers then send nothing. */
  applying: boolean;
}

function take(ctx: LayoutCtx, view: { layout: WindowLayout; open: readonly string[] }): void {
  ctx.layout.value = view.layout;
  ctx.open.value = view.open;
}

async function openAll(ctx: LayoutCtx, panels: readonly DetachedPanel[]): Promise<void> {
  const failed: DetachedPanel[] = [];
  for (const panel of panels) {
    const way = await openPanel(panel, ctx.parts.host.endpoint.value, ctx.win).catch(() => "blocked" as const);
    if (way === "blocked") failed.push(panel);
  }
  ctx.blocked.value = failed;
}

/** A call into the visible frame of the scene surface; it fails when the project has no scene surface. */
function sceneCall(relay: WindowLayoutParts["relay"], call: string, args: readonly unknown[]): Promise<unknown> {
  const scene = relay.idWith();
  if (scene === null) return Promise.reject(new Error("The project has no scene surface."));
  return relay.call(scene, "visible", call, args);
}

/** Read the layout; the first time also apply it and open the detached windows that are not connected. */
async function restore(ctx: LayoutCtx): Promise<void> {
  const { host, claudeOpen, dockTab } = ctx.parts;
  const view = await host.request("layout.get", { main: true });
  take(ctx, view);
  if (ctx.restored) return;
  ctx.restored = true;
  ctx.applying = true;
  try {
    if (view.layout.claude !== null) claudeOpen.value = view.layout.claude;
    dockTab.value = view.layout.dockTab;
  } finally {
    ctx.applying = false;
  }
  if (view.layout.main !== null) await placeWindow(view.layout.main, ctx.win).catch(() => false);
  await openAll(
    ctx,
    view.layout.detached.filter((panel) => !view.open.includes(panel.key)),
  );
}

/** A part that came back from its window: the lab shows its dock or its pane again; a dock tab opens. */
async function putBack(ctx: LayoutCtx, panel: DetachedPanel): Promise<void> {
  const { relay, claudeOpen, dockTab } = ctx.parts;
  if (panel.kind === "dock") await sceneCall(relay, "dock", ["half"]).catch(() => undefined);
  else if (panel.kind === "pane" && panel.query.cam !== undefined) {
    await sceneCall(relay, "addPane", [panel.query.cam]).catch(() => undefined);
  } else if (panel.kind === "claude") claudeOpen.value = true;
  else if (DOCK_TABS[panel.kind] !== undefined) dockTab.value = DOCK_TABS[panel.kind] ?? null;
}

/** The watchers of a main page: the restore, the column and the tab, the layout events, the place of the window. */
function watchLayout(ctx: LayoutCtx): (() => void)[] {
  const { host, claudeOpen, dockTab } = ctx.parts;
  const stops: (() => void)[] = [];
  // The first connection restores; a new connection (a restart of the host) marks this page as a main window again.
  stops.push(
    watch(
      () => [host.state.value, host.greeted.value, host.checkout.value?.path ?? null] as const,
      ([state, greeted, checkout]) => {
        if (state === "connected" && greeted && checkout !== null) void restore(ctx).catch(() => undefined);
      },
      { immediate: true },
    ),
  );
  const send = (patch: { claude?: boolean; dockTab?: string | null }): void => {
    if (!ctx.applying && ctx.restored) void host.request("layout.set", patch).catch(() => undefined);
  };
  stops.push(watch(claudeOpen, (value) => send({ claude: value })));
  stops.push(watch(dockTab, (value) => send({ dockTab: value })));
  stops.push(
    watch(
      host.client,
      (client, _old, onCleanup) => {
        if (client === null) return;
        onCleanup(
          client.on("layout.state", (event) => {
            take(ctx, event);
            if (event.docked !== undefined) void putBack(ctx, event.docked);
          }),
        );
      },
      { immediate: true },
    ),
  );
  if ("addEventListener" in ctx.win) {
    const report = (rect: WindowRect): boolean => {
      if (!ctx.restored) return false;
      void host.request("layout.rect", { key: "main", rect }).catch(() => undefined);
      return true;
    };
    stops.push(trackRect(report, 2_000, ctx.win as Window));
  }
  return stops;
}

function askCost(ctx: LayoutCtx): Promise<boolean> {
  return new Promise((resolve) => {
    ctx.costAsk.value = (ok) => {
      ctx.costAsk.value = null;
      resolve(ok);
    };
  });
}

/** The values of the window URL of a part: a pane gives up its camera; Claude takes the IDs of its terminals. */
async function queryOf(
  ctx: LayoutCtx,
  kind: PanelKind,
  query: Readonly<Record<string, string>>,
): Promise<Record<string, string> | null> {
  const { host, relay } = ctx.parts;
  if (kind === "pane") {
    if (!ctx.layout.value.paneCost) {
      if (!(await askCost(ctx))) return null;
      await host.request("layout.set", { paneCost: true });
    }
    const dropped = await sceneCall(relay, "dropPane", [Number(query.pane ?? 1)]).catch(() => null);
    return { cam: typeof dropped === "string" ? dropped : (query.cam ?? "overview") };
  }
  if (kind === "claude") {
    const checkout = host.checkout.value?.path;
    const ids: Record<string, string> = {};
    for (const tab of ["claude", "shell"] as const) {
      const storage = storageOf(ctx.parts);
      const id = checkout === undefined || storage === null ? null : storage.getItem(terminalKey(checkout, tab));
      if (id !== null) ids[tab] = id;
    }
    return ids;
  }
  return { ...query };
}

async function detach(
  ctx: LayoutCtx,
  kind: PanelKind,
  query: Readonly<Record<string, string>> = {},
): Promise<OpenWay | null> {
  const { host, relay, dockTab } = ctx.parts;
  const values = await queryOf(ctx, kind, query);
  if (values === null) return null;
  const key = newPanelKey(
    kind,
    ctx.layout.value.detached.map((panel) => panel.key),
  );
  const old = ctx.layout.value.detached.find((panel) => panel.key === key);
  const panel: DetachedPanel = { key, kind, query: values, rect: old?.rect ?? null };
  take(ctx, await host.request("layout.detach", { panel }));
  const way = await openPanel(panel, host.endpoint.value, ctx.win).catch(() => "blocked" as const);
  if (way === "blocked") ctx.blocked.value = [...ctx.blocked.value.filter((item) => item.key !== key), panel];
  if (kind === "dock") await sceneCall(relay, "dock", ["hidden"]).catch(() => undefined);
  if (kindOfTab(dockTab.value ?? "") === kind) dockTab.value = null;
  return way;
}

async function show(ctx: LayoutCtx, kind: PanelKind): Promise<void> {
  const { host } = ctx.parts;
  const panel = ctx.layout.value.detached.find((item) => item.kind === kind);
  if (panel === undefined) return;
  if (ctx.win.__TAURI_INTERNALS__ !== undefined || !ctx.open.value.includes(panel.key)) {
    await openPanel(panel, host.endpoint.value, ctx.win).catch(() => undefined);
    return;
  }
  // A browser window: find it by its name, without a new load.
  const found = ctx.win.open("", windowName(panel.key), "") as Window | null;
  const endpoint = host.endpoint.value;
  if (found !== null && found.location.href === "about:blank" && endpoint !== null) {
    found.location.href = panelPageUrl(ctx.win.location.href, panel, endpoint);
  }
  found?.focus();
}

/** The window layout of the main window; it stops with the scope of the caller. */
export function useWindowLayout(parts: WindowLayoutParts): WindowLayoutApi {
  const ctx: LayoutCtx = {
    parts,
    win: parts.win ?? globalThis,
    layout: shallowRef<WindowLayout>(EMPTY_LAYOUT),
    open: ref<readonly string[]>([]),
    blocked: ref<readonly DetachedPanel[]>([]),
    costAsk: ref<((ok: boolean) => void) | null>(null),
    restored: false,
    applying: false,
  };
  const stops = watchLayout(ctx);
  if (getCurrentScope() !== undefined) onScopeDispose(() => stops.forEach((stop) => stop()));
  return {
    layout: ctx.layout,
    open: ctx.open,
    blocked: ctx.blocked,
    costAsk: ctx.costAsk,
    detached: (kind) => ctx.layout.value.detached.some((panel) => panel.kind === kind),
    detach: (kind, query) => detach(ctx, kind, query),
    show: (kind) => show(ctx, kind),
    dockBack: async (kind) => {
      const panel = ctx.layout.value.detached.find((item) => item.kind === kind);
      if (panel !== undefined) take(ctx, await parts.host.request("layout.dock", { key: panel.key }));
    },
    reopen: () => openAll(ctx, ctx.blocked.value),
    onFrameDetach: (surface, where, event) => {
      if (surface !== parts.relay.idWith() || where !== "visible") return;
      void detach(ctx, event.panel, event.query);
    },
  };
}
