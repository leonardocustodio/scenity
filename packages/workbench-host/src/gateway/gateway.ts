// SPDX-License-Identifier: Apache-2.0
/**
 * The Scenity gateway: the one public port of Scenity. It runs in a container of
 * its own, as another user than the workbench host and Claude Code, and shares only the network of the workbench
 * container. The workbench page is on another origin. It opens with `?host=<public origin>/host#token=<host token>`
 * (host/endpoint.ts of the page) and talks to the host through the gateway with the host token.
 *
 * - `/host/…`: the host on 127.0.0.1 (HTTP and the WebSocket `/host/ws`). A request needs a token of the host (the
 *   header `x-workbench-token`, or the `token` parameter of the WebSocket): the host token, or a role token
 *   of `SCENITY_WORKBENCH_ROLES`. The gateway refuses a request without one. The host checks the token again and
 *   limits the request to its role. A CORS preflight goes to the host as it is. The paths that only the processes in the
 *   workbench container use (`/hooks/`, `/loops/<id>/hooks/`, `/context`, `/tools/`, `/auth/`) are not public.
 * - `<lab base>…`: the lab dev server (HTTP and the HMR WebSocket). A request needs the lab ticket (labTicket.ts) of
 *   the frame URL or its cookie. The gateway sets the cookie and adds the gate header for the lab server.
 * - `GET /health`: 200 when the host answers, else 503.
 */
import type { Server } from "bun";
import { LAB_GATE_HEADER, LAB_TICKET_PARAM } from "@scenity/labs-platform/labKey";
import { checkLabTicket, cookieValue, LAB_COOKIE, labCookie, labGateKey } from "../labTicket";
import { sameToken } from "../token";
import { askedProtocols, relayHttp, type SocketData } from "./proxy";

export interface GatewaySetup {
  /** The token of the host. The gateway sends a host request to the host only with this token or a role token. */
  readonly hostToken: string;
  /** The role tokens of `SCENITY_WORKBENCH_ROLES` (the host gives each its role). */
  readonly roleTokens?: readonly string[];
  /** The origin of the host on 127.0.0.1. */
  readonly hostOrigin: string;
  /** The origin of the lab dev server on 127.0.0.1 and its base path (a slash at each end). */
  readonly labOrigin: string;
  readonly labBase: string;
}

/**
 * The host paths that only the processes in the workbench container use. The hooks of the background runs
 * (`/loops/<id>/hooks/<event>`, loopGuard.ts) are private too.
 */
export const PRIVATE_HOST_PATHS: readonly RegExp[] = [
  /^\/hooks(\/|$)/,
  /^\/loops\/[^/]+\/hooks(\/|$)/,
  /^\/context(\/|$)/,
  /^\/tools(\/|$)/,
  /^\/auth(\/|$)/,
];

const TOKEN_HEADER = "x-workbench-token";

/** Upgrade a WebSocket request and relay it to the target, with more headers for the target. */
function upgrade(
  request: Request,
  server: Server<SocketData>,
  target: string,
  headers: Readonly<Record<string, string>> = {},
): Response | undefined {
  const protocols = askedProtocols(request);
  const data: SocketData = { target, protocols, upstream: null, queue: [], headers };
  const first = protocols[0];
  const answer = first === undefined ? undefined : { "sec-websocket-protocol": first };
  if (server.upgrade(request, { data, ...(answer === undefined ? {} : { headers: answer }) })) return undefined;
  return new Response("The WebSocket upgrade failed.", { status: 400 });
}

const isUpgrade = (request: Request): boolean => request.headers.get("upgrade")?.toLowerCase() === "websocket";

/** The answer to a host request without a token of the host. */
const noToken = (): Response => new Response("The host token is missing or wrong.", { status: 401 });

/** The answer to a lab request without a valid lab ticket. */
const noTicket = (): Response =>
  new Response("The lab needs the lab ticket of the workbench: open the lab from the workbench page.", { status: 401 });

/** The target URL of a lab request without the lab ticket parameter. */
function labTarget(origin: string, url: URL): string {
  const search = new URLSearchParams(url.search);
  search.delete(LAB_TICKET_PARAM);
  const text = search.toString();
  return `${origin}${url.pathname}${text === "" ? "" : `?${text}`}`;
}

/** The `fetch` handler of the gateway for `Bun.serve`. */
export function gatewayFetch(setup: GatewaySetup) {
  const tokens = [setup.hostToken, ...(setup.roleTokens ?? [])];
  /** True for a token of the host: each token gets a compare, so the time does not show which one matched. */
  const known = (given: string | null): boolean => tokens.map((token) => sameToken(given, token)).includes(true);
  const gate = { [LAB_GATE_HEADER]: labGateKey(setup.hostToken) };

  /**
   * A lab request. It needs the ticket of the URL parameter (the first load of a frame) or of the cookie. A valid
   * parameter gives the cookie. The request goes to the lab server with the gate header and without the ticket.
   */
  async function lab(request: Request, url: URL, server: Server<SocketData>): Promise<Response | undefined> {
    const fromUrl = url.searchParams.get(LAB_TICKET_PARAM);
    const fromCookie = cookieValue(request.headers.get("cookie"), LAB_COOKIE);
    const urlExpiry = checkLabTicket(setup.hostToken, fromUrl);
    if (urlExpiry === null && checkLabTicket(setup.hostToken, fromCookie) === null) return noTicket();
    const target = labTarget(setup.labOrigin, url);
    if (isUpgrade(request)) return upgrade(request, server, target.replace(/^http/, "ws"), gate);
    const answer = await relayHttp(request, target, gate, [LAB_GATE_HEADER, "cookie"]);
    if (urlExpiry === null || fromUrl === null) return answer;
    const headers = new Headers(answer.headers);
    headers.append("set-cookie", labCookie(fromUrl, urlExpiry, setup.labBase));
    return new Response(answer.body, { status: answer.status, statusText: answer.statusText, headers });
  }

  /** A request of the host: the gateway checks the host token, then sends the request to the host as it is. */
  function host(request: Request, url: URL, server: Server<SocketData>): Promise<Response> | Response | undefined {
    const rest = url.pathname.slice("/host".length) || "/";
    if (PRIVATE_HOST_PATHS.some((pattern) => pattern.test(rest))) return new Response("Not found.", { status: 404 });
    const target = `${setup.hostOrigin}${rest}${url.search}`;
    if (isUpgrade(request)) {
      if (!known(url.searchParams.get("token"))) return noToken();
      return upgrade(request, server, target.replace(/^http/, "ws"));
    }
    // A CORS preflight has no token: the host answers it, and the request after it needs the token.
    if (request.method === "OPTIONS") return relayHttp(request, target);
    if (!known(request.headers.get(TOKEN_HEADER))) return noToken();
    return relayHttp(request, target);
  }

  return async (request: Request, server: Server<SocketData>): Promise<Response | undefined> => {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/health") {
      const up = await fetch(`${setup.hostOrigin}/health`)
        .then((answer) => answer.ok)
        .catch(() => false);
      return new Response(up ? "ok" : "the host does not answer", { status: up ? 200 : 503 });
    }
    if (path === "/host" || path.startsWith("/host/")) return host(request, url, server);
    if (path.startsWith(setup.labBase)) return lab(request, url, server);
    if (path === "/") return new Response("Scenity server. Open the workbench page to use it.\n", { status: 200 });
    return new Response("Not found.", { status: 404 });
  };
}
