// SPDX-License-Identifier: Apache-2.0
/**
 * The endpoint of the host for the workbench page. In the labs app, the
 * Tauri command `host_endpoint` gives it. In a browser, the URL gives it: `?host=<origin>#token=<token>`. The page
 * reads the token once, removes the fragment from the address bar and keeps the endpoint in the session storage, so
 * a reload of the page finds the host again.
 */
import { isHostOrigin, isToken, type HostEndpoint } from "@scenity/workbench-host/protocol";
import { storageItem } from "@scenity/labs-platform/storageKeys";

/** The key of the endpoint in the session storage. */
export const ENDPOINT_STORAGE_KEY = "scenity.workbench.endpoint";

/** The Tauri internals that the labs app puts on the window (frontend/labs-desktop). */
export interface TauriInternals {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
}

/** The window parts that the endpoint search uses (a test gives a fake). */
export interface EndpointWindow {
  readonly location: { readonly href: string };
  readonly history: { readonly state: unknown; replaceState(state: unknown, unused: string, url: string): void };
  /** The session storage. The getter can throw (blocked storage), so the code reads it in a try block. */
  readonly sessionStorage?: Pick<Storage, "getItem" | "setItem"> | null;
  readonly __TAURI_INTERNALS__?: TauriInternals;
}

/** Where the endpoint came from. */
export type EndpointSource = "tauri" | "url" | "storage";

export interface FoundEndpoint {
  readonly endpoint: HostEndpoint;
  readonly source: EndpointSource;
}

/** The session storage of the window, or null when the browser blocks it. */
function storageOf(win: EndpointWindow): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return win.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** Keep the endpoint for a reload. A blocked storage keeps nothing; the page then needs the token again. */
function keep(win: EndpointWindow, endpoint: HostEndpoint): void {
  try {
    storageOf(win)?.setItem(ENDPOINT_STORAGE_KEY, JSON.stringify(endpoint));
  } catch {
    // The storage is full or blocked: a reload asks for the token again.
  }
}

/** The endpoint that the session storage keeps for the given host origin, or null. */
function kept(win: EndpointWindow, origin: string): HostEndpoint | null {
  try {
    const storage = storageOf(win);
    const value = JSON.parse(
      (storage === null ? null : storageItem(storage, ENDPOINT_STORAGE_KEY)) ?? "null",
    ) as unknown;
    if (typeof value !== "object" || value === null) return null;
    const { origin: keptOrigin, token } = value as Record<string, unknown>;
    return keptOrigin === origin && isToken(token) ? { origin, token } : null;
  } catch {
    return null;
  }
}

/**
 * True for the endpoint of a host behind the Scenity gateway (packages/workbench-host/src/gateway): `<server>/host`,
 * for example `https://scenity.dotspark.app/host`. The page opens with `?host=<server>/host#token=<host token>`, as
 * for a local host. The host itself stays on the loopback (`isHostOrigin`).
 */
export function isGatewayHost(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?\/host$/.test(value);
}

/** A host origin without a last slash: `http://127.0.0.1:4100/` is `http://127.0.0.1:4100`. */
function cleanOrigin(value: string | null): string {
  return (value ?? "").trim().replace(/\/$/, "");
}

/**
 * Read the endpoint from the page URL (browser mode). The page removes the `token` of the fragment from the address
 * bar at once, also when it is not valid. Without a token in the fragment, the session storage gives the endpoint of
 * the same host origin. Returns null when the URL names no valid host or no token is known.
 */
export function readUrlEndpoint(win: EndpointWindow): FoundEndpoint | null {
  const url = new URL(win.location.href);
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  const token = fragment.get("token");
  if (token !== null) {
    fragment.delete("token");
    const rest = fragment.toString();
    url.hash = rest === "" ? "" : `#${rest}`;
    win.history.replaceState(win.history.state, "", url.href);
  }
  const origin = cleanOrigin(url.searchParams.get("host"));
  // if (!isHostOrigin(origin)) return null;
  if (!isHostOrigin(origin) && !isGatewayHost(origin)) return null;
  if (isToken(token)) {
    const endpoint = { origin, token };
    keep(win, endpoint);
    return { endpoint, source: "url" };
  }
  const stored = kept(win, origin);
  return stored === null ? null : { endpoint: stored, source: "storage" };
}

/** Ask the labs app for the endpoint. Returns null outside the app or for an answer that is not valid. */
export async function readTauriEndpoint(win: EndpointWindow): Promise<FoundEndpoint | null> {
  const internals = win.__TAURI_INTERNALS__;
  if (internals === undefined || typeof internals.invoke !== "function") return null;
  const value = await internals.invoke("host_endpoint");
  if (typeof value !== "object" || value === null) return null;
  const { origin, token } = value as Record<string, unknown>;
  return isHostOrigin(origin) && isToken(token) ? { endpoint: { origin, token }, source: "tauri" } : null;
}

/** Find the endpoint: the labs app first, then the page URL. Returns null when neither gives one. */
export async function findEndpoint(win: EndpointWindow): Promise<FoundEndpoint | null> {
  try {
    const fromApp = await readTauriEndpoint(win);
    if (fromApp !== null) return fromApp;
  } catch {
    // The command failed (no host yet): the URL can still name a host.
  }
  return readUrlEndpoint(win);
}
