// SPDX-License-Identifier: Apache-2.0
/**
 * The page key of a lab server. A server that the lab tools or the workbench host start for their own pages gets a
 * random secret in its environment. The tools send it as a header (Playwright `extraHTTPHeaders`). The host puts it
 * into the URL of its frames, because a frame of another origin keeps no cookie in WebKit. The host removes it from
 * every URL that it keeps or shows.
 *
 * In the remote mode, the frame URL also has the lab ticket of the gateway (`labTicket`). The host removes it from
 * every URL that it keeps or shows, as it does for the page key.
 *
 * The module runs in Bun and Node (Web Crypto API). The gate takes structural request types, so it has no `node:`
 * import.
 */

/** The environment variable of the secret of a lab server. */
export const LAB_KEY_ENV = "SCENITY_LABS_PAGE_SECRET";
/** The URL parameter of the secret (the frames of the workbench). */
export const LAB_KEY_PARAM = "labsKey";
/** The request header of the secret (the Playwright pages of the lab tools). */
export const LAB_KEY_HEADER = "x-scenity-labs-key";
/** The URL parameter of the lab ticket of the gateway (the frames of the remote mode). */
export const LAB_TICKET_PARAM = "labTicket";

/** A new secret: 32 random bytes as hex. */
export function newLabKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The URL with the secret as its parameter. */
export function withLabKey(url: string, key: string): string {
  const next = new URL(url);
  next.searchParams.set(LAB_KEY_PARAM, key);
  return next.toString();
}

/** The URL without the secret and without the lab ticket. A text that is not a URL stays as it is. */
export function withoutLabKey(url: string): string {
  if (!url.includes(`${LAB_KEY_PARAM}=`) && !url.includes(`${LAB_TICKET_PARAM}=`)) return url;
  try {
    const next = new URL(url);
    next.searchParams.delete(LAB_KEY_PARAM);
    next.searchParams.delete(LAB_TICKET_PARAM);
    return next.toString();
  } catch {
    return url;
  }
}

/** True when two texts are the same. The time does not depend on the place of the first difference. */
export function sameText(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let index = 0; index < left.length; index += 1) diff |= (left[index] ?? 0) ^ (right[index % right.length] ?? 0);
  return diff === 0;
}

/** The parts of a Node HTTP request that the gate reads. */
export interface GateRequest {
  readonly method?: string | undefined;
  readonly url?: string | undefined;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

/** The parts of a Node HTTP response that the gate writes. */
export interface GateResponse {
  writeHead(status: number, headers: Record<string, string>): unknown;
  end(text?: string): unknown;
}

/** True for a request of a page: a document or a frame (a module, an asset or a fetch is not one). */
export function isPageRequest(request: GateRequest): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const dest = request.headers["sec-fetch-dest"];
  if (typeof dest === "string") return dest === "document" || dest === "iframe" || dest === "frame";
  const accept = request.headers.accept;
  return typeof accept === "string" && accept.includes("text/html");
}

/** True when the request has the secret: the header, or the URL parameter. */
export function hasLabKey(request: GateRequest, key: string | null): boolean {
  if (key === null || key === "") return false;
  const header = request.headers[LAB_KEY_HEADER];
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const given = (typeof header === "string" ? header : null) ?? url.searchParams.get(LAB_KEY_PARAM);
  return given !== null && sameText(given, key);
}

/**
 * The page key gate of a lab server that the tools or the host start (the built lab of the render pool). A page
 * request needs the secret. The modules, the assets and the HMR socket stay open on the loopback. A server without a
 * secret (a person started it) has no gate.
 */
export function pageKeyGate(key: string | null) {
  return (request: GateRequest, response: GateResponse, next: () => void): void => {
    if (key === null || key === "" || !isPageRequest(request) || hasLabKey(request, key)) {
      next();
      return;
    }
    response.writeHead(401, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    response.end("This lab server opens only with its page key.");
  };
}

/**
 * The header that the gateway of the remote mode adds to each request that it sends to the lab server. The value is
 * the gate key of the lab server (`LAB_GATE_ENV`). The host derives it from its token, and the gateway does too. In
 * the remote mode, the lab server refuses a request without it (apps/editor `scripts/labsGate.ts`).
 */
export const LAB_GATE_HEADER = "x-scenity-lab-gate";
/** The environment variable of the gate key of a lab server in the remote mode. */
export const LAB_GATE_ENV = "SCENITY_WORKBENCH_LAB_GATE";
