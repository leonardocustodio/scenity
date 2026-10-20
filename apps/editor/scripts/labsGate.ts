// SPDX-License-Identifier: Apache-2.0
/**
 * The token gate of the lab dev server in the remote mode of the workbench host. The Scenity gateway checks the lab
 * ticket of the frame (packages/workbench-host `labTicket.ts`). Then it adds the header `x-scenity-lab-gate` with the
 * gate key of this server to each request that it sends to the server. The host gives the key to
 * the server in `SCENITY_WORKBENCH_LAB_GATE`.
 *
 * In the remote mode the server refuses each HTTP request and each WebSocket upgrade without the key (401). A remote
 * server without a key refuses everything, so a bad setup does not open the lab. The local mode has no gate: the
 * server is on the loopback, and the page key of the tools stays as it is.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { Plugin } from "vite";
import { LAB_GATE_ENV, LAB_GATE_HEADER, sameText } from "@scenity/labs-platform/labKey";
import { envValue } from "@scenity/labs-platform/envNames";
import { isRemote } from "./labsFs.ts";

type Env = Readonly<Record<string, string | undefined>>;

/** The gate key of the remote mode, or null in the local mode. A remote server without a key gets "". */
export function gateKey(env: Env): string | null {
  if (!isRemote(env)) return null;
  return envValue(LAB_GATE_ENV, env)?.trim() ?? "";
}

/** True when the request has the gate key (always true in the local mode). */
export function hasGateKey(request: Pick<IncomingMessage, "headers">, key: string | null): boolean {
  if (key === null) return true;
  const given = request.headers[LAB_GATE_HEADER];
  return key !== "" && typeof given === "string" && sameText(given, key);
}

/** The middleware of the HTTP requests. */
export function gateMiddleware(env: Env) {
  const key = gateKey(env);
  return (request: IncomingMessage, response: ServerResponse, next: () => void): void => {
    if (hasGateKey(request, key)) {
      next();
      return;
    }
    response.writeHead(401, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    response.end("This lab server opens only through the Scenity gateway with a token of the workbench.");
  };
}

/** The check of a WebSocket upgrade (the HMR socket): a refused socket gets 401 and closes. */
export function gateUpgrade(env: Env) {
  const key = gateKey(env);
  return (request: IncomingMessage, socket: Duplex): void => {
    if (hasGateKey(request, key)) return;
    socket.end("HTTP/1.1 401 Unauthorized\r\nconnection: close\r\ncontent-length: 0\r\n\r\n");
    socket.destroy();
  };
}

/** The Vite plugin of the gate: the first middleware, and the first listener of the upgrades. */
export function labsGate(env: Env = process.env): Plugin {
  return {
    name: "scenity-labs-gate",
    apply: "serve",
    configureServer(server) {
      if (gateKey(env) === null) return;
      server.middlewares.use(gateMiddleware(env));
      server.httpServer?.prependListener("upgrade", gateUpgrade(env));
    },
  };
}
