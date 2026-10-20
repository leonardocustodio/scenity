// SPDX-License-Identifier: Apache-2.0
/**
 * The URLs of the surface frames: the saved URL state on the origin of the dev server, the defaults of a scene frame, the URL of the indexer window
 * and the page key and lab ticket of a frame URL. The surface registry (surfaces.ts) uses these functions.
 */
import { LAB_TICKET_PARAM, withLabKey } from "@scenity/labs-platform/labKey";
import { BRIDGE_PARAM, hasCapability, SCENE_CAPABILITY } from "./protocol";

/**
 * The URL of a frame: the saved URL state on the origin of the dev server, with the `workbench` parameter (the origin
 * of the workbench page). Null when the server has no origin. An origin with a path (the base path of the remote
 * mode, remote.ts) also sets the path: a saved URL of an older base path gets the new one. Without a saved
 * URL the frame starts at the page of the surface (a path such as `/scene.html`, on the base path of the server).
 */
export function surfaceUrl(
  origin: string | null,
  saved: string | null,
  pageOrigin: string | null,
  page: string | null = null,
): string | null {
  if (origin === null) return null;
  const server = new URL(origin.endsWith("/") ? origin : `${origin}/`);
  const start = new URL((page ?? "/").slice(1), server.href);
  let url: URL;
  try {
    url = new URL(saved ?? start.href);
  } catch {
    url = new URL(start.href);
  }
  url.protocol = server.protocol;
  url.host = server.host;
  // A host without a port keeps the old port of the URL, so also set the port (the default port of HTTPS is empty).
  url.port = server.port;
  if (server.pathname !== "/") url.pathname = start.pathname;
  if (pageOrigin !== null) url.searchParams.set(BRIDGE_PARAM, pageOrigin);
  return url.toString();
}

/**
 * The defaults of a scene frame URL: the render worker (`worker=1`) unless the URL sets it. In a frame of another
 * origin, WebKit draws the main-thread core only every 50 ms. Only a surface with the capability
 * `scene` gets them.
 */
export function labDefaults(surface: { readonly capabilities?: readonly string[] }, url: string | null): string | null {
  if (url === null || !hasCapability(surface, SCENE_CAPABILITY)) return url;
  const next = new URL(url);
  if (next.searchParams.has("worker")) return url;
  next.searchParams.set("worker", "1");
  return next.toString();
}

/**
 * The URL of the frame of the indexer window: the built lab without the panel and the dock, with a fixed
 * quality, the render worker and a stopped clock at 0. The indexer page adds the take, the tier and the backend of
 * its jobs.
 */
export function indexerDefaults(url: string | null): string | null {
  if (url === null) return null;
  const next = new URL(url);
  for (const [name, value] of Object.entries({ worker: "1", panel: "0", dock: "0", adaptive: "0", paused: "1" }))
    next.searchParams.set(name, value);
  next.searchParams.set("t", "0");
  return next.toString();
}

/**
 * The frame URL with the per-process secret of its lab server, so the frame skips the sign-in of the lab page.
 * The registry keeps and saves the URL without it (`withoutLabKey`).
 */
export function keyed(key: string | null, url: string | null, ticket: string | null = null): string | null {
  const next = key === null || url === null ? url : withLabKey(url, key);
  if (ticket === null || next === null) return next;
  // The lab ticket of the remote mode (labTicket.ts). The registry also keeps the URL without it.
  const withTicket = new URL(next);
  withTicket.searchParams.set(LAB_TICKET_PARAM, ticket);
  return withTicket.toString();
}
