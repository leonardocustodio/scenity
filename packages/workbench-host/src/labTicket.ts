// SPDX-License-Identifier: Apache-2.0
/**
 * The lab token of the remote mode. The lab server is behind the token of the host:
 *
 * 1. The host puts a lab ticket into each frame URL (`labTicket=<expiry>.<signature>`). Only a page with a token of
 *    the host gets a frame URL. The ticket is an HMAC of its expiry with a key that the host and the gateway derive
 *    from the host token, so the gateway checks it with no call to the host.
 * 2. The gateway checks the ticket of a lab request: the URL parameter (the first load of the frame), else the cookie
 *    `scenity_lab` of the lab base path. A valid parameter gives the cookie (HttpOnly, Secure, SameSite=None,
 *    Partitioned), so the modules, the assets and the HMR socket of the frame carry it. A partitioned cookie works in
 *    a frame of another site (CHIPS); a browser that blocks it gets 401 on the modules, so serve the workbench page
 *    from the same site as the gateway there.
 * 3. The gateway adds the gate header (`x-scenity-lab-gate`) to each lab request that it sends. The lab server of
 *    the remote mode refuses each request without the gate key (apps/editor `scripts/labsGate.ts`), so a process
 *    that reaches its port directly gets nothing either.
 */
import { createHmac } from "node:crypto";
import { sameToken } from "./token";

/** The cookie of a lab ticket (path: the lab base path). */
export const LAB_COOKIE = "scenity_lab";
/** A ticket is valid for 12 to 13 hours: its expiry is the end of the hour of its start plus 12 hours. */
export const LAB_TICKET_HOURS = 12;
const HOUR_MS = 3_600_000;

function hmac(key: string, text: string): string {
  return createHmac("sha256", key).update(text, "utf8").digest("base64url");
}

/** The gate key of the lab server: the header value of the gateway. */
export function labGateKey(hostToken: string): string {
  return createHmac("sha256", hostToken).update("scenity-lab-gate/1", "utf8").digest("hex");
}

function ticketKey(hostToken: string): string {
  return hmac(hostToken, "scenity-lab-ticket/1");
}

/**
 * A lab ticket for the time `now`. The tickets of one hour are the same text, so the frame URL of a surface does not
 * change at each state event.
 */
export function makeLabTicket(hostToken: string, now: number = Date.now()): string {
  const expiry = Math.floor(now / HOUR_MS) * HOUR_MS + (LAB_TICKET_HOURS + 1) * HOUR_MS;
  const seconds = String(Math.floor(expiry / 1000));
  return `${seconds}.${hmac(ticketKey(hostToken), `lab:${seconds}`)}`;
}

/** The expiry of a valid ticket (ms since the epoch), or null for a bad or old ticket. */
export function checkLabTicket(hostToken: string, ticket: string | null, now: number = Date.now()): number | null {
  if (ticket === null) return null;
  const match = /^(\d{9,12})\.([A-Za-z0-9_-]{43})$/.exec(ticket);
  if (match?.[1] === undefined || match[2] === undefined) return null;
  const expiry = Number(match[1]) * 1000;
  if (expiry <= now || expiry > now + (LAB_TICKET_HOURS + 1) * HOUR_MS) return null;
  return sameToken(match[2], hmac(ticketKey(hostToken), `lab:${match[1]}`)) ? expiry : null;
}

/** The value of a cookie of a Cookie header, or null. */
export function cookieValue(header: string | null, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

/** The Set-Cookie header of a valid ticket on the lab base path. */
export function labCookie(ticket: string, expiry: number, base: string, now: number = Date.now()): string {
  const maxAge = String(Math.max(0, Math.floor((expiry - now) / 1000)));
  return `${LAB_COOKIE}=${ticket}; Path=${base}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=None; Partitioned`;
}
