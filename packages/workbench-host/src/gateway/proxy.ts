// SPDX-License-Identifier: Apache-2.0
/**
 * The HTTP and WebSocket relay of the Scenity gateway: a request goes to a server on 127.0.0.1 in the container
 * (the host or the lab dev server) and its answer comes back as it is (no decompression, no redirect).
 */
import type { ServerWebSocket } from "bun";

/** The headers that stay with one connection. The relay does not send them to the next server. */
const HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
]);

/**
 * Send the request to the target URL and give its answer. A target that does not answer gives 502. `extra`
 * headers go to the target, and the `drop` headers of the request do not.
 */
export async function relayHttp(
  request: Request,
  target: string,
  extra: Readonly<Record<string, string>> = {},
  drop: readonly string[] = [],
): Promise<Response> {
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    const lower = name.toLowerCase();
    if (!HOP_HEADERS.has(lower) && !drop.includes(lower)) headers.set(name, value);
  }
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  try {
    const answer = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? request.body : null,
      redirect: "manual",
      decompress: false,
    });
    const out = new Headers();
    for (const [name, value] of answer.headers) if (!HOP_HEADERS.has(name.toLowerCase())) out.set(name, value);
    return new Response(answer.body, { status: answer.status, statusText: answer.statusText, headers: out });
  } catch {
    return new Response("The server in the container does not answer.", { status: 502 });
  }
}

/** The data of a relayed WebSocket. */
export interface SocketData {
  readonly target: string;
  readonly protocols: readonly string[];
  upstream: WebSocket | null;
  readonly queue: (string | ArrayBuffer)[];
  /** More headers for the target (the gate header of the lab server). */
  readonly headers?: Readonly<Record<string, string>>;
}

/** The subprotocols that the client asks for (`Sec-WebSocket-Protocol`). */
export function askedProtocols(request: Request): string[] {
  return (request.headers.get("sec-websocket-protocol") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/** A close code that a peer can send (1005 and 1006 are only for reports). */
function sendableCode(code: number): number {
  return code === 1000 ||
    (code >= 3000 && code <= 4999) ||
    (code >= 1001 && code <= 1014 && code !== 1005 && code !== 1006)
    ? code
    : 1011;
}

/** The WebSocket of Bun with its options form: the headers of the upgrade request (the DOM type has no such form). */
const BunSocket = WebSocket as unknown as new (
  url: string,
  options: { readonly protocols: string[]; readonly headers: Readonly<Record<string, string>> },
) => WebSocket;

/** The handlers of the relayed WebSockets for `Bun.serve`. */
export const socketRelay = {
  open(ws: ServerWebSocket<SocketData>): void {
    const headers = ws.data.headers ?? {};
    const upstream =
      Object.keys(headers).length === 0
        ? new WebSocket(ws.data.target, [...ws.data.protocols])
        : new BunSocket(ws.data.target, { protocols: [...ws.data.protocols], headers });
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
      ws.close(1011, "The server in the container closed the connection.");
    });
  },
  message(ws: ServerWebSocket<SocketData>, message: string | Buffer): void {
    const upstream = ws.data.upstream;
    // A copy of the bytes in an ArrayBuffer of its own (a Buffer can share a larger buffer).
    const data = typeof message === "string" ? message : new Uint8Array(message).buffer;
    if (upstream?.readyState === WebSocket.OPEN) upstream.send(data);
    else ws.data.queue.push(data);
  },
  close(ws: ServerWebSocket<SocketData>, code: number, reason: string): void {
    const upstream = ws.data.upstream;
    if (upstream !== null && upstream.readyState <= WebSocket.OPEN) upstream.close(sendableCode(code), reason);
  },
};
