#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * The gateway of the studio in remote mode: the one public port of a studio on another machine (a container or a
 * server). The studio host stays on 127.0.0.1 and starts with
 * `--public-origin`. The gateway runs as another user on the public port and sends each request to the host:
 *
 * - The `Host` header must name the public origin, so a DNS-rebinding page fails here (and again in the host).
 * - The gateway refuses a request with the host secret (`x-studio-token`): the secret works only on the host machine.
 * - An HTTP or WebSocket request keeps its path, its `Host`, its cookies and its `Origin`. Thus the host checks the
 *   session, the CSRF value and the role of each request (access.ts) and serves the studio pages.
 * - `GET /health` gives the health of the host (the editor window reads `studio: true` there), else 503. It needs no
 *   public `Host`, so a probe of the container works.
 *
 *   SCENITY_STUDIO_PUBLIC_ORIGIN=https://studio.example.com bun packages/studio-host/src/gateway.ts
 *
 * The environment: `SCENITY_STUDIO_PUBLIC_ORIGIN` (required, the same value as `--public-origin` of the host),
 * `SCENITY_PORT` (8080, the public port), `SCENITY_HOSTNAME` (0.0.0.0, the address of the public port) and
 * `SCENITY_STUDIO_PORT` (5170, the port of the host). A TLS proxy in front of the gateway must keep the `Host` header
 * of the public origin.
 */
import type { Server, ServerWebSocket } from "bun";
import { TOKEN_HEADER } from "./access";

export interface StudioGatewaySetup {
  /** The public origin of the studio (`https://studio.example.com`). */
  readonly publicOrigin: string;
  /** The origin of the studio host on 127.0.0.1. */
  readonly hostOrigin: string;
}

/** The data of a WebSocket that the gateway relays. */
export interface GatewaySocket {
  readonly target: string;
  readonly protocols: readonly string[];
  readonly headers: Readonly<Record<string, string>>;
  upstream: WebSocket | null;
  readonly queue: (string | ArrayBuffer)[];
}

/** The headers that stay with one connection (RFC 9110 §7.6.1). */
const HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
/** The headers of a WebSocket upgrade that the host reads: the session cookies, the origin and the host name. */
const SOCKET_HEADERS = ["cookie", "origin", "host", "user-agent"];

/** The WebSocket of Bun with its options form: the headers of the upgrade request. */
const BunSocket = WebSocket as unknown as new (
  url: string,
  options: { readonly protocols: string[]; readonly headers: Readonly<Record<string, string>> },
) => WebSocket;

/** Send an HTTP request to the host as it is and give the answer as it is (no decompression, no redirect). */
async function relayHttp(request: Request, target: string): Promise<Response> {
  const headers = new Headers();
  for (const [name, value] of request.headers) if (!HOP_HEADERS.has(name.toLowerCase())) headers.set(name, value);
  const body = request.method === "GET" || request.method === "HEAD" ? null : await request.arrayBuffer();
  try {
    const answer = await fetch(target, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      decompress: false,
    });
    const out = new Headers();
    for (const [name, value] of answer.headers) if (!HOP_HEADERS.has(name.toLowerCase())) out.append(name, value);
    return new Response(answer.body, { status: answer.status, statusText: answer.statusText, headers: out });
  } catch {
    return new Response("The studio host does not answer.", { status: 502 });
  }
}

/** A close code that a peer can send (1005 and 1006 are only for reports). */
function sendableCode(code: number): number {
  return code === 1000 ||
    (code >= 3000 && code <= 4999) ||
    (code >= 1001 && code <= 1014 && code !== 1005 && code !== 1006)
    ? code
    : 1011;
}

/** The `fetch` handler of the gateway for `Bun.serve`. */
export function studioGatewayFetch(setup: StudioGatewaySetup) {
  const publicHost = new URL(setup.publicOrigin).host;
  return async (request: Request, server: Server<GatewaySocket>): Promise<Response | undefined> => {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      const answer = await fetch(`${setup.hostOrigin}/health`).catch(() => null);
      return answer === null
        ? new Response("The studio host does not answer.", { status: 503 })
        : new Response(answer.body, { status: answer.status, headers: { "content-type": "application/json" } });
    }
    if (request.headers.get("host") !== publicHost)
      return new Response("The Host header is not the public origin of the studio.", { status: 421 });
    if (request.headers.has(TOKEN_HEADER))
      return new Response("The host secret works only on the machine of the host.", { status: 403 });
    const target = `${setup.hostOrigin}${url.pathname}${url.search}`;
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return relayHttp(request, target);
    const protocols = (request.headers.get("sec-websocket-protocol") ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "");
    const headers: Record<string, string> = {};
    for (const name of SOCKET_HEADERS) {
      const value = request.headers.get(name);
      if (value !== null) headers[name] = value;
    }
    const data: GatewaySocket = {
      target: target.replace(/^http/, "ws"),
      protocols,
      headers,
      upstream: null,
      queue: [],
    };
    const first = protocols[0];
    const answer = first === undefined ? {} : { headers: { "sec-websocket-protocol": first } };
    return server.upgrade(request, { data, ...answer })
      ? undefined
      : new Response("The WebSocket upgrade failed.", { status: 400 });
  };
}

/** The handlers of the relayed WebSockets for `Bun.serve`. */
export const gatewaySockets = {
  open(ws: ServerWebSocket<GatewaySocket>): void {
    const upstream = new BunSocket(ws.data.target, { protocols: [...ws.data.protocols], headers: ws.data.headers });
    upstream.binaryType = "arraybuffer";
    ws.data.upstream = upstream;
    upstream.addEventListener("open", () => {
      for (const message of ws.data.queue.splice(0)) upstream.send(message);
    });
    upstream.addEventListener("message", (event: MessageEvent<string | ArrayBuffer>) => {
      ws.send(event.data);
    });
    upstream.addEventListener("close", (event: CloseEvent) => {
      ws.close(sendableCode(event.code), event.reason);
    });
    upstream.addEventListener("error", () => {
      ws.close(1011, "The studio host closed the connection.");
    });
  },
  message(ws: ServerWebSocket<GatewaySocket>, message: string | Buffer): void {
    const upstream = ws.data.upstream;
    // A copy of the bytes in an ArrayBuffer of its own (a Buffer can share a larger buffer).
    const data = typeof message === "string" ? message : new Uint8Array(message).buffer;
    if (upstream?.readyState === WebSocket.OPEN) upstream.send(data);
    else ws.data.queue.push(data);
  },
  close(ws: ServerWebSocket<GatewaySocket>, code: number, reason: string): void {
    const upstream = ws.data.upstream;
    if (upstream !== null && upstream.readyState <= WebSocket.OPEN) upstream.close(sendableCode(code), reason);
  },
};

type Env = Readonly<Record<string, string | undefined>>;

function portOf(env: Env, name: string, fallback: number): number {
  const value = Number(env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${name} must be a port.`);
  return value;
}

/** The settings of the gateway from the environment. Throw an error for a missing or bad value. */
export function studioGatewayEnv(env: Env): {
  readonly port: number;
  readonly hostname: string;
  readonly setup: StudioGatewaySetup;
} {
  const publicOrigin = publicOriginOf(env.SCENITY_STUDIO_PUBLIC_ORIGIN ?? "");
  if (publicOrigin === null) throw new Error("SCENITY_STUDIO_PUBLIC_ORIGIN must be an http or https origin.");
  return {
    port: portOf(env, "SCENITY_PORT", 8080),
    hostname: env.SCENITY_HOSTNAME ?? "0.0.0.0",
    setup: { publicOrigin, hostOrigin: `http://127.0.0.1:${String(portOf(env, "SCENITY_STUDIO_PORT", 5170))}` },
  };
}

/** The origin of a public URL (`http:` or `https:`, no path), or null for another value. */
export function publicOriginOf(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.pathname === "/" && url.search === "" && url.hash === "" ? url.origin : null;
}

/** Start the gateway on a port (0: a free port). */
export function startStudioGateway(setup: StudioGatewaySetup, port: number, hostname = "0.0.0.0") {
  return Bun.serve<GatewaySocket>({
    hostname,
    port,
    idleTimeout: 120,
    fetch: studioGatewayFetch(setup),
    websocket: { ...gatewaySockets, idleTimeout: 960 },
  });
}

if (import.meta.main) {
  try {
    const { port, hostname, setup } = studioGatewayEnv(process.env);
    const server = startStudioGateway(setup, port, hostname);
    process.stderr.write(
      `scenity: the studio gateway listens on port ${String(server.port)} for ${setup.publicOrigin}.\n`,
    );
  } catch (error: unknown) {
    process.stderr.write(`scenity: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
