// SPDX-License-Identifier: Apache-2.0
/**
 * The events of the workbench bridge: a change of the page URL, and the updates and the full reloads of the Vite dev
 * server. The lab keeps its state in the URL with `history.replaceState`. The events and the chord keys are in
 * `@scenity/bridge`, the one contract of the bridge.
 */
import { workbenchKeyOf, type BridgeEventBody, type WorkbenchKey } from "@scenity/bridge";

/** The key parts of a `KeyboardEvent`. */
export type ChordEvent = Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

/** The workbench key of a ⌘ or Ctrl chord, or null. The lab keys have no ⌘ or Ctrl, so they never match. */
export function chordKey(event: ChordEvent): WorkbenchKey | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return null;
  return workbenchKeyOf(event.code);
}

/** The window parts that the key forward uses (a test gives a fake). */
export interface KeyHost {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

/** Send each workbench chord of the frame to the page with the `key` event. Returns the stop function. */
export function forwardChords(host: KeyHost, emit: (body: BridgeEventBody) => void): () => void {
  const onKey = (raw: Event): void => {
    const event = raw as KeyboardEvent;
    const key = chordKey(event);
    if (key === null) return;
    event.preventDefault();
    emit({ event: "key", key });
  };
  host.addEventListener("keydown", onKey);
  return () => {
    host.removeEventListener("keydown", onKey);
  };
}

/** The shortest time between two events of one kind (ms). A clock that runs changes the URL many times each second. */
export const EVENT_GAP_MS = 250;

/** Call `fire` at most one time in each `gapMs`. A call in the gap fires one time at the end of the gap. */
export function throttle(fire: () => void, gapMs = EVENT_GAP_MS): { call(): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = Number.NEGATIVE_INFINITY;
  return {
    call() {
      if (timer !== null) return;
      const wait = Math.max(0, last + gapMs - performance.now());
      timer = setTimeout(() => {
        timer = null;
        last = performance.now();
        fire();
      }, wait);
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

/** The window parts that the URL watch uses (a test gives a fake). */
export interface UrlHost {
  readonly location: { readonly href: string };
  readonly history: Pick<History, "replaceState" | "pushState">;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

/**
 * Watch the URL of the page: `replaceState`, `pushState`, `popstate` and `hashchange`. `onUrl` gets each new URL, at
 * most one time in each EVENT_GAP_MS. Returns the stop function, which restores the history methods.
 */
export function watchUrl(host: UrlHost, onUrl: (url: string) => void, gapMs = EVENT_GAP_MS): () => void {
  let sent = host.location.href;
  const changed = throttle(() => {
    const url = host.location.href;
    if (url === sent) return;
    sent = url;
    onUrl(url);
  }, gapMs);
  const history = host.history;
  const original = { replaceState: history.replaceState, pushState: history.pushState };
  const replaceState: History["replaceState"] = (...args) => {
    original.replaceState.apply(history, args);
    changed.call();
  };
  const pushState: History["pushState"] = (...args) => {
    original.pushState.apply(history, args);
    changed.call();
  };
  const onChange = (): void => {
    changed.call();
  };
  history.replaceState = replaceState;
  history.pushState = pushState;
  host.addEventListener("popstate", onChange);
  host.addEventListener("hashchange", onChange);
  return () => {
    changed.cancel();
    if (history.replaceState === replaceState) history.replaceState = original.replaceState;
    if (history.pushState === pushState) history.pushState = original.pushState;
    host.removeEventListener("popstate", onChange);
    host.removeEventListener("hashchange", onChange);
  };
}

/** The HMR context of Vite in the dev server (undefined in a build). */
export type HotContext = ImportMeta["hot"];

/** The files of a Vite update: the path and the accepted path of each module (the host matches on either). */
export function updateFiles(updates: readonly { readonly path: string; readonly acceptedPath?: string }[]): string[] {
  return [...new Set(updates.flatMap((update) => [update.path, update.acceptedPath ?? update.path]))];
}

/**
 * Send the `hmr` event (the files of an update) and the `reload` event (a full reload, with the URL of the page) of
 * the Vite dev server, and give each Vite error to `onError`. Returns the stop function.
 */
export function watchHmr(
  hot: HotContext,
  emit: (body: BridgeEventBody) => void,
  url: () => string,
  onError: (text: string) => void,
): () => void {
  if (hot === undefined) return () => undefined;
  const afterUpdate = (payload: {
    readonly updates: readonly { readonly path: string; readonly acceptedPath: string }[];
  }) => {
    emit({ event: "hmr", files: updateFiles(payload.updates) });
  };
  const beforeReload = () => {
    emit({ event: "reload", url: url() });
  };
  const viteError = (payload: { readonly err: { readonly message: string; readonly id?: string } }) => {
    onError(`vite error: ${payload.err.message}${payload.err.id === undefined ? "" : ` (${payload.err.id})`}`);
  };
  hot.on("vite:afterUpdate", afterUpdate);
  hot.on("vite:beforeFullReload", beforeReload);
  hot.on("vite:error", viteError);
  return () => {
    hot.off("vite:afterUpdate", afterUpdate);
    hot.off("vite:beforeFullReload", beforeReload);
    hot.off("vite:error", viteError);
  };
}
