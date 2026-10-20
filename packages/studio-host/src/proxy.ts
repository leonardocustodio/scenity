// SPDX-License-Identifier: Apache-2.0
/**
 * The proxy of the studio host to its scene server: each page path and the Vite HMR
 * WebSocket go to the scene server, so every page of the studio has the origin of the host. The proxy keeps the
 * method, the body, the headers and the WebSocket protocol (`vite-hmr`) and token of the request.
 */
import type { ServerWebSocket } from "bun";

/** The headers that do not pass a proxy (RFC 9110 §7.6.1). The proxy also removes the cookies of the studio. */
const HOP_HEADERS = ["connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-connection", "te", "trailer"];

/** Forward an HTTP request to `upstream` (an origin). */
export async function forwardHttp(request: Request, url: URL, upstream: string): Promise<Response> {
  const headers = new Headers(request.headers);
  for (const name of HOP_HEADERS) headers.delete(name);
  headers.delete("cookie");
  headers.set("host", new URL(upstream).host);
  // The access check of the host accepts only a write with the origin of the host. The scene server gets its own
  // origin, because its save check wants the origin of its pages.
  if (headers.has("origin")) headers.set("origin", new URL(upstream).origin);
  const body = request.method === "GET" || request.method === "HEAD" ? null : await request.arrayBuffer();
  const answer = await fetch(`${upstream}${url.pathname}${url.search}`, {
    method: request.method,
    headers,
    body,
    redirect: "manual",
  });
  const out = new Headers(answer.headers);
  out.delete("content-encoding");
  out.delete("content-length");
  return new Response(answer.body, { status: answer.status, statusText: answer.statusText, headers: out });
}

/** The data of a proxied WebSocket. */
export interface ProxySocket {
  readonly kind: "proxy";
  readonly path: string;
  readonly protocol: string | null;
  upstream: WebSocket | null;
  queue: (string | Uint8Array<ArrayBuffer>)[];
}

/** The data of a WebSocket that the proxy takes, from an upgrade request. */
export function proxySocketData(request: Request, url: URL): ProxySocket {
  return {
    kind: "proxy",
    path: `${url.pathname}${url.search}`,
    protocol: request.headers.get("sec-websocket-protocol"),
    upstream: null,
    queue: [],
  };
}

/** Open the upstream WebSocket of a proxied socket and join the two. */
export function openProxySocket(ws: ServerWebSocket<ProxySocket>, upstream: string): void {
  const target = `${upstream.replace(/^http/, "ws")}${ws.data.path}`;
  const up = new WebSocket(
    target,
    ws.data.protocol === null ? undefined : ws.data.protocol.split(",").map((p) => p.trim()),
  );
  up.binaryType = "arraybuffer";
  ws.data.upstream = up;
  up.onopen = () => {
    for (const message of ws.data.queue) up.send(message);
    ws.data.queue = [];
  };
  up.onmessage = (event) => {
    ws.send(typeof event.data === "string" ? event.data : new Uint8Array(event.data as ArrayBuffer));
  };
  up.onclose = () => ws.close();
  up.onerror = () => ws.close();
}

/** Pass a message of the page to the upstream socket (or queue it until the upstream opens). */
export function proxyMessage(ws: ServerWebSocket<ProxySocket>, message: string | Uint8Array<ArrayBuffer>): void {
  const up = ws.data.upstream;
  if (up !== null && up.readyState === WebSocket.OPEN) up.send(message);
  else ws.data.queue.push(message);
}

export function closeProxySocket(ws: ServerWebSocket<ProxySocket>): void {
  ws.data.upstream?.close();
}
