// SPDX-License-Identifier: Apache-2.0
/**
 * The Content-Security-Policy of the lab dev server. The workbench shows the lab page in a sandboxed frame
 * (apps/workbench `surfaces/frameSandbox.ts`). This header is the CSP of that frame and of the lab page alone.
 *
 * The policy of the learner app (scripts/static/web-security-headers.conf, read by nginxHeaders.ts) does not fit a
 * dev server: it has `frame-ancestors 'none'` (the workbench frames the lab), Trusted Types (the Vite error overlay
 * writes HTML) and no inline styles (Vite and Vue add `<style>` elements in the dev server). This policy keeps the
 * other limits of the learner app:
 *
 * - Scripts, workers, fonts and frames come only from the lab server. No inline script and no `eval`. WebAssembly
 *   (the Basis transcoder) needs `'wasm-unsafe-eval'`. Workers and pictures also take `blob:` URLs.
 * - The page connects only to its own server: HTTP, the HMR WebSocket and the `/v1` proxy of the mock engine.
 *   `'self'` covers `ws:` and `wss:` in current browsers; the policy also names the WebSocket origins of the request
 *   host and, in the remote mode, of the public origin of the gateway.
 * - No plugin objects, no `<base>` of another origin, no form submission to another origin.
 * - In the remote mode with `SCENITY_WORKBENCH_PAGE_ORIGIN` (the public origin of the workbench page), the
 *   policy has `frame-ancestors <that origin>`: no other page can frame the lab. Without the origin, and in the local
 *   mode (the loopback page, the app), the policy has no `frame-ancestors`.
 *
 * Only the dev server sends the header (`apply: "serve"`). The built lab of the render pool has its own server.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { isRemote, REMOTE_ORIGIN_ENV } from "./labsFs.ts";
import { envValue } from "@scenity/labs-platform/envNames";

export const CSP_HEADER = "Content-Security-Policy";

/** A host and port of a Host header: letters, digits, dots, dashes, an IPv6 address in brackets and a port. */
const HOST = /^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;
const ORIGIN = /^https?:\/\/((?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?)\/?$/;

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The WebSocket origins of a request: `ws:` and `wss:` of its Host header, and `wss:` of the public origin of the
 * remote mode. A Host header with other characters gives nothing.
 */
export function socketOrigins(host: string | undefined, env: Env): string[] {
  const origins: string[] = [];
  if (host !== undefined && HOST.test(host)) origins.push(`ws://${host}`, `wss://${host}`);
  const remote = ORIGIN.exec(envValue(REMOTE_ORIGIN_ENV, env)?.trim() ?? "");
  if (remote?.[1] !== undefined) origins.push(`wss://${remote[1]}`);
  return [...new Set(origins)];
}

/** The variable of the public origin of the workbench page (packages/workbench-host `remote.ts`). */
export const PAGE_ORIGIN_ENV = "SCENITY_WORKBENCH_PAGE_ORIGIN";

/** The origin that may frame the lab: the public workbench page of the remote mode, or null. */
export function frameAncestor(env: Env): string | null {
  if (!isRemote(env)) return null;
  const page = ORIGIN.exec(envValue(PAGE_ORIGIN_ENV, env)?.trim() ?? "");
  return page === null ? null : page[0].replace(/\/$/, "");
}

/** The policy text with the WebSocket origins of `socketOrigins` and the frame ancestor of `frameAncestor`. */
export function labCsp(sockets: readonly string[] = [], ancestor: string | null = null): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    ["connect-src 'self'", ...sockets].join(" "),
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(ancestor === null ? [] : [`frame-ancestors ${ancestor}`]),
  ].join("; ");
}

/** The middleware: the header on each answer of the dev server. */
export function cspMiddleware(env: Env) {
  return (request: IncomingMessage, response: ServerResponse, next: () => void): void => {
    response.setHeader(CSP_HEADER, labCsp(socketOrigins(request.headers.host, env), frameAncestor(env)));
    next();
  };
}

/** The Vite plugin of the CSP of the lab dev server. */
export function labsCsp(env: Env = process.env): Plugin {
  return {
    name: "scenity-labs-csp",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(cspMiddleware(env));
    },
  };
}
