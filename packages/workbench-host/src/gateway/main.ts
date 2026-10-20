// SPDX-License-Identifier: Apache-2.0
/**
 * The program of the gateway container of Scenity: the gateway (gateway.ts)
 * on the public port. The workbench host runs in the workbench container; both containers share one network, so the
 * gateway reaches the host and the lab dev server on 127.0.0.1.
 *
 *   bun src/gateway/main.ts
 *
 * The environment:
 * - `SCENITY_HOST_TOKEN` (required): the token of the host (64 hex characters), the same as the
 *   `SCENITY_WORKBENCH_TOKEN` of the workbench container.
 * - `SCENITY_LAB_BASE` (required): the base path of the lab dev server, the same as `SCENITY_WORKBENCH_LAB_BASE`.
 * - `SCENITY_PORT` (8080), `SCENITY_HOST_PORT` (4300), `SCENITY_LAB_PORT` (4310): the ports.
 * - `SCENITY_WORKBENCH_ROLES` (optional): the role tokens, the same value as in the workbench container.
 */
import { parseRoleTokens, ROLES_ENV } from "../authProvider";
import { HOST_BODY_MAX_BYTES } from "../importProtocol";
import { gatewayFetch, type GatewaySetup } from "./gateway";
import { socketRelay, type SocketData } from "./proxy";

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The largest request body. The same limit as the host server (importProtocol.ts), so the gateway refuses
 * the bodies that the host refuses, and no more.
 */
export const GATEWAY_MAX_BODY_BYTES = HOST_BODY_MAX_BYTES;

function required(env: Env, name: string): string {
  const value = env[name]?.trim() ?? "";
  if (value === "") throw new Error(`${name} is not set.`);
  return value;
}

function port(env: Env, name: string, fallback: number): number {
  const value = Number(env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${name} must be a port.`);
  return value;
}

/** The settings of the gateway from the environment. Throw an error for a missing or bad value. */
export function gatewayEnv(env: Env): { readonly port: number; readonly setup: GatewaySetup } {
  const hostToken = required(env, "SCENITY_HOST_TOKEN");
  if (!/^[0-9a-f]{64}$/.test(hostToken)) throw new Error("SCENITY_HOST_TOKEN must be 64 lowercase hex characters.");
  const labBase = required(env, "SCENITY_LAB_BASE");
  if (!/^\/[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*\/$/.test(labBase))
    throw new Error("SCENITY_LAB_BASE must be a path with a slash at each end.");
  return {
    port: port(env, "SCENITY_PORT", 8080),
    setup: {
      hostToken,
      roleTokens: parseRoleTokens(env[ROLES_ENV] ?? "").map((entry) => entry.token),
      hostOrigin: `http://127.0.0.1:${String(port(env, "SCENITY_HOST_PORT", 4300))}`,
      labOrigin: `http://127.0.0.1:${String(port(env, "SCENITY_LAB_PORT", 4310))}`,
      labBase,
    },
  };
}

/** The options of `Bun.serve` for the gateway on a port. */
export function gatewayServeOptions(setup: GatewaySetup, listenPort: number, hostname = "0.0.0.0") {
  return {
    hostname,
    port: listenPort,
    maxRequestBodySize: GATEWAY_MAX_BODY_BYTES,
    idleTimeout: 255,
    fetch: gatewayFetch(setup),
    websocket: { ...socketRelay, idleTimeout: 960 },
  };
}

function main(): void {
  const { port: listenPort, setup } = gatewayEnv(process.env);
  const server = Bun.serve<SocketData>(gatewayServeOptions(setup, listenPort));
  process.stderr.write(`scenity: the gateway listens on port ${String(server.port)}.\n`);
}

if (import.meta.main) {
  try {
    main();
  } catch (error: unknown) {
    process.stderr.write(`scenity: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
