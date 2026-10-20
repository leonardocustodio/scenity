// SPDX-License-Identifier: Apache-2.0
/**
 * The remote mode of the host: the host runs in a container behind the
 * Scenity gateway (gateway/), which gives the workbench page one public HTTPS origin. The gateway sets these variables:
 *
 * - `SCENITY_WORKBENCH_PUBLIC_ORIGIN`: the public origin of the gateway, for example `https://scenity.dotspark.app`.
 * - `SCENITY_WORKBENCH_LAB_PORT`: the fixed port of the lab dev server. The gateway sends the lab requests to it.
 * - `SCENITY_WORKBENCH_LAB_BASE`: the base path of the lab dev server, for example `/s/<secret>/`. Only a person
 *   with a token of the host gets the frame URL.
 * - `SCENITY_WORKBENCH_PAGE_ORIGIN` (optional): the public origin of the workbench page. The lab server then
 *   sends `frame-ancestors <origin>` (apps/editor `scripts/labsCsp.ts`), so only that page can frame the lab.
 *
 * In the remote mode the lab frames load from `<public origin><base path>`, and the render pool does not start: the
 * server has no GPU, and the frames draw in the browser of the person.
 *
 * In the remote mode each holder of the host token is a remote person, so the host refuses two requests that
 * the page hides: `terminal.open` of the kind `shell` (terminal.ts) and a chat session in the mode "all"
 * (`bypassPermissions`, agent/manager.ts). The lab dev server gets a narrow `fs.allow` (apps/editor/scripts).
 *
 * The lab server is behind the token (labTicket.ts). The frame URL has a lab ticket, and the gateway changes it into
 * a cookie and adds the gate header. The lab server refuses a request without the gate key. The roles of the
 * tokens (roleProtocol.ts) limit each page.
 */

import { envValue } from "@scenity/labs-platform/envNames";

export const PUBLIC_ORIGIN_ENV = "SCENITY_WORKBENCH_PUBLIC_ORIGIN";
export const LAB_PORT_ENV = "SCENITY_WORKBENCH_LAB_PORT";
export const LAB_BASE_ENV = "SCENITY_WORKBENCH_LAB_BASE";
export const PAGE_ORIGIN_ENV = "SCENITY_WORKBENCH_PAGE_ORIGIN";

/** The error of `terminal.open` of the kind `shell` in the remote mode. */
export const REMOTE_SHELL_REFUSED = "The remote mode has no shell terminal. Use the Claude terminal or the chat.";
/** The error of a chat session in the mode "all" (`bypassPermissions`) in the remote mode. */
export const REMOTE_BYPASS_REFUSED = 'The remote mode refuses the mode "all" (bypassPermissions). Use another mode.';

/** The settings of the remote mode. */
export interface RemoteSetup {
  /** The public origin of the gateway, without a last slash. */
  readonly publicOrigin: string;
  /** The port of the lab dev server on 127.0.0.1. */
  readonly labPort: number;
  /** The base path of the lab dev server, with a slash at each end. */
  readonly labBase: string;
  /** The public origin of the workbench page, or null when the host does not know it. */
  readonly pageOrigin?: string | null;
}

const ORIGIN_PATTERN = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/;
const BASE_PATTERN = /^\/[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*\/$/;

/**
 * The remote mode from the environment, or null when `SCENITY_WORKBENCH_PUBLIC_ORIGIN` is not set. A set origin
 * with a missing or bad port or base path is an error: the host does not start half remote.
 */
export function remoteSetup(env: Readonly<Record<string, string | undefined>>): RemoteSetup | null {
  const origin = envValue(PUBLIC_ORIGIN_ENV, env)?.trim().replace(/\/$/, "") ?? "";
  if (origin === "") return null;
  if (!ORIGIN_PATTERN.test(origin)) throw new Error(`${PUBLIC_ORIGIN_ENV} must be an origin such as https://host.`);
  const port = Number(envValue(LAB_PORT_ENV, env));
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(`${LAB_PORT_ENV} must be a port from 1 to 65535.`);
  const base = envValue(LAB_BASE_ENV, env)?.trim() ?? "";
  if (!BASE_PATTERN.test(base)) throw new Error(`${LAB_BASE_ENV} must be a path with a slash at each end.`);
  const page = envValue(PAGE_ORIGIN_ENV, env)?.trim().replace(/\/$/, "") ?? "";
  if (page !== "" && !ORIGIN_PATTERN.test(page))
    throw new Error(`${PAGE_ORIGIN_ENV} must be an origin such as https://host.`);
  return { publicOrigin: origin, labPort: port, labBase: base, pageOrigin: page === "" ? null : page };
}
