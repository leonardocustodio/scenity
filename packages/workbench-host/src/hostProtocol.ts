// SPDX-License-Identifier: Apache-2.0
/**
 * The messages of the host lifecycle and of the surface in front.
 * `protocol.ts` exports them. This module is pure (no `node:` or `bun:` import), so the page gets them through
 * `@scenity/workbench-host/protocol`.
 *
 * - `surface.front`: the page tells the host which tab is in front. The prompt hook sends the packet of that surface.
 * - `host.restart`: the host writes its state, stops every child process and ends with `RESTART_EXIT_CODE`. Its
 *   supervisor (main.ts) starts a new host on the same port with the same token, so the page connects again by itself.
 * - `host.restarting`: the event to the pages before the stop.
 */
import type { SurfaceId } from "./protocol";
// The roles of the tokens and the rules of each request.
export * from "./roleProtocol";
// The project of the host in `host.hello`.
export * from "./projectProtocol";

/** The exit code of a host that asks its supervisor for a restart (EX_TEMPFAIL of sysexits.h). */
export const RESTART_EXIT_CODE = 75;

/** The requests of the host lifecycle (page to host). `RequestMap` of protocol.ts extends this map. */
export interface HostRequests {
  /** The tab in front. The `UserPromptSubmit` hook and `GET /context` without a surface use it. */
  "surface.front": { params: { surface: SurfaceId }; result: null };
  /**
   * Restart the host process. The answer comes before the stop. A host without a supervisor (a test, an old
   * shell) refuses; the shell then restarts it from its menu.
   */
  "host.restart": { params: object; result: { restarting: true } };
}

export const HOST_REQUEST_NAMES: Readonly<Record<keyof HostRequests, true>> = {
  "surface.front": true,
  "host.restart": true,
};

/** The events of the host lifecycle (host to page). `EventMap` of protocol.ts extends this map. */
export interface HostEvents {
  /** The host stops and a new host starts. The terminals and the runs of this host end. */
  "host.restarting": { at: string };
}

export const HOST_EVENT_NAMES: Readonly<Record<keyof HostEvents, true>> = {
  "host.restarting": true,
};

/**
 * The aspect of a capture that a tool asks for: 16:10, the aspect of `labs sheet` (1280 × 800). The lab draws
 * the picture at this aspect whatever the size of its frame, so a narrow window gives no thin strip.
 */
export const CAPTURE_ASPECT = 16 / 10;

/** The arguments of the bridge call `capture` for a width: `[width, quality (default), height at CAPTURE_ASPECT]`. */
export function captureArgs(width: number): [number, null, number] {
  return [width, null, Math.max(1, Math.round(width / CAPTURE_ASPECT))];
}

/** The words of a terminal or a run that ended with a restart of the host. */
export const RESTART_ENDED_TEXT = "The host restarted. This ended with the old host; start a new one.";
