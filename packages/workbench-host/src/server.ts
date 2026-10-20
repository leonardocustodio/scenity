// SPDX-License-Identifier: Apache-2.0
/**
 * The loopback server of the host. It binds 127.0.0.1. `GET /health` needs no token. `GET /ws?token=<token>` opens
 * the WebSocket of a workbench page. Every other path needs the header `x-workbench-token`. A request without the
 * correct token gets 401. A page of another origin (the labs app, a page of a `host.hello`) gets the CORS headers and
 * an answer to its preflight. Other origins get none. The auth provider (authProvider.ts) gives the role of a token.
 * A page keeps the role of its WebSocket token. An HTTP request above its role gets 403 (`httpRefusal`).
 */
import type { ServerWebSocket } from "bun";
import { noneProvider, type AuthProvider, type Caller } from "./authProvider";
import {
  HOST_PATHS,
  HOST_BODY_MAX_BYTES,
  TOKEN_HEADER,
  type Answer,
  type HostEvent,
  type HostMessage,
} from "./protocol";
import type { Role } from "./roleProtocol";

/** A workbench page with an open WebSocket. */
export interface PageClient {
  /** A number that is unique while the host runs. */
  readonly id: number;
  /** The origin of the page, from `host.hello`, or null before the hello. */
  origin: string | null;
  /** The role of the token of the WebSocket. */
  readonly role: Role;
  /** Send a message to the page. A closed page ignores it. */
  send(message: HostMessage): void;
}

/** A handler of the HTTP paths that need the token. `role` is the role of the token of the caller. Null gives 404. */
export type HttpHandler = (request: Request, url: URL, role?: Role) => Response | null | Promise<Response | null>;

export interface ServerOptions {
  /** The port; 0 gives a free port. */
  readonly port: number;
  /** The launch token: an admin token. */
  readonly token: string;
  /** The provider that gives the caller of a token. The default is `noneProvider` of the launch token. */
  readonly provider?: AuthProvider;
  /** Handle the text of a WebSocket message. The answer, if one, goes to the same page. */
  onMessage(client: PageClient, text: string): Promise<Answer | null>;
  /**
   * Handle a binary WebSocket message (a picture frame of the page). The data is a view of the message, not a
   * copy. Without a handler the host drops binary messages.
   */
  onBinary?(client: PageClient, data: Uint8Array): void;
  onOpen?(client: PageClient): void;
  onClose?(client: PageClient): void;
  http?: HttpHandler;
}

export interface HostServer {
  /** `http://127.0.0.1:<port>`. */
  readonly origin: string;
  readonly port: number;
  /** The pages with an open WebSocket. */
  clients(): readonly PageClient[];
  /** Send an event to every page. */
  broadcast(event: HostEvent): void;
  stop(): Promise<void>;
}

interface SocketData {
  client: PageClient | null;
  role: Role;
}

/** The text of a message to a page: one `JSON.stringify` per message, also for a broadcast to many pages. */
export function messageText(message: HostMessage): string {
  return JSON.stringify(message);
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

/**
 * The fixed options of the server: the loopback address only, and a body limit above the largest import upload
 * (200 MB, importProtocol.ts). The import route checks its own limit. The gateway has the same body limit.
 */
export const SERVE_OPTIONS = { hostname: "127.0.0.1", maxRequestBodySize: HOST_BODY_MAX_BYTES } as const;

function unauthorized(): Response {
  return new Response(JSON.stringify({ ok: false, error: "The token is missing or wrong." }), {
    status: 401,
    headers: JSON_HEADERS,
  });
}

function forbidden(error: string): Response {
  return new Response(JSON.stringify({ ok: false, error }), { status: 403, headers: JSON_HEADERS });
}

/** The paths that only the processes of the host use (the gateway also keeps them private). */
const PROCESS_PATHS = [/^\/hooks(\/|$)/, /^\/loops\/[^/]+\/hooks(\/|$)/, /^\/context(\/|$)/, /^\/tools(\/|$)/];

/**
 * The reason to refuse an HTTP request of a caller, or null. The paths of the host processes need the role
 * admin (the launch token). A viewer can only read (GET and HEAD): an import, a clip or another POST needs an editor.
 */
export function httpRefusal(caller: Caller, request: Request, url: URL): string | null {
  if (caller.role !== "admin" && PROCESS_PATHS.some((pattern) => pattern.test(url.pathname))) {
    return "Only the processes of the host use this path.";
  }
  if (caller.role === "viewer" && request.method !== "GET" && request.method !== "HEAD") {
    return "The role viewer can only read.";
  }
  return null;
}

/** The origin of the workbench page in the labs app (Tauri). */
export const APP_PAGE_ORIGIN = "tauri://localhost";

/**
 * The origin of a request that can read the HTTP paths from another origin (CORS): the page of the labs
 * app, or a page that sent its origin in `host.hello`. Null for other origins and for a request without an origin.
 */
export function corsOrigin(request: Request, clients: Iterable<PageClient>): string | null {
  const origin = request.headers.get("origin");
  if (origin === null) return null;
  if (origin === APP_PAGE_ORIGIN) return origin;
  for (const client of clients) if (client.origin === origin) return origin;
  return null;
}

/** The CORS headers for an allowed origin. The token header is the one header that a page adds. */
function corsHeaders(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": `${TOKEN_HEADER}, content-type`,
    "access-control-allow-methods": "GET, POST",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

/** A response with the CORS headers of an allowed origin (no headers without one). */
function withCors(response: Response, origin: string | null): Response {
  if (origin === null) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders(origin))) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * A binary message of a page (a picture frame). A bad frame gets no answer: the `surface.call` of its request
 * then fails and names the missing bytes.
 */
function takeBinary(options: ServerOptions, client: PageClient, data: Uint8Array): void {
  try {
    options.onBinary?.(client, data);
  } catch {
    // The answer of the request names the missing bytes.
  }
}

/** An HTTP request of a path with a token: the CORS preflight, the caller, the role check, then the handler. */
async function answerHttp(
  request: Request,
  url: URL,
  parts: { readonly options: ServerOptions; readonly provider: AuthProvider; readonly allowed: string | null },
): Promise<Response> {
  const { options, provider, allowed } = parts;
  if (request.method === "OPTIONS") {
    if (allowed === null) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: corsHeaders(allowed) });
  }
  const caller = await provider.caller(request.headers.get(TOKEN_HEADER), request);
  if (caller === null) return withCors(unauthorized(), allowed);
  const refusal = httpRefusal(caller, request, url);
  if (refusal !== null) return withCors(forbidden(refusal), allowed);
  const response = options.http === undefined ? null : await options.http(request, url, caller.role);
  return withCors(response ?? new Response("Not found.", { status: 404 }), allowed);
}

/** Start the server. */
export function startServer(options: ServerOptions): HostServer {
  const clients = new Map<number, PageClient>();
  /** The socket of each page, so a broadcast sends one text to every page. */
  const sockets = new Map<number, ServerWebSocket<SocketData>>();
  const provider = options.provider ?? noneProvider(options.token);
  let next = 1;

  const server = Bun.serve({
    ...SERVE_OPTIONS,
    port: options.port,
    websocket: {
      data: {} as SocketData,
      open(ws: ServerWebSocket<SocketData>) {
        const client: PageClient = {
          id: next++,
          origin: null,
          role: ws.data.role,
          send: (message) => {
            if (ws.readyState === 1) ws.send(messageText(message));
          },
        };
        ws.data.client = client;
        clients.set(client.id, client);
        sockets.set(client.id, ws);
        options.onOpen?.(client);
      },
      async message(ws: ServerWebSocket<SocketData>, message: string | Buffer) {
        const client = ws.data.client;
        if (client === null) return;
        if (typeof message !== "string") {
          takeBinary(options, client, message);
          return;
        }
        const answer = await options.onMessage(client, message);
        if (answer !== null) client.send(answer);
      },
      close(ws: ServerWebSocket<SocketData>) {
        const client = ws.data.client;
        if (client === null) return;
        clients.delete(client.id);
        sockets.delete(client.id);
        options.onClose?.(client);
      },
    },
    async fetch(request, bunServer) {
      const url = new URL(request.url);
      if (url.pathname === HOST_PATHS.health) return Response.json({ ok: true });
      if (url.pathname === HOST_PATHS.ws) {
        const caller = await provider.caller(url.searchParams.get("token"), request);
        if (caller === null) return unauthorized();
        if (bunServer.upgrade(request, { data: { client: null, role: caller.role } })) return undefined;
        return new Response("A WebSocket upgrade is necessary.", { status: 400 });
      }
      return answerHttp(request, url, { options, provider, allowed: corsOrigin(request, clients.values()) });
    },
  });

  const port = server.port ?? options.port;
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    port,
    clients: () => [...clients.values()],
    broadcast: (event) => {
      if (sockets.size === 0) return;
      // One JSON text for every page.
      const text = messageText(event);
      for (const ws of sockets.values()) if (ws.readyState === 1) ws.send(text);
    },
    stop: () => server.stop(true),
  };
}
