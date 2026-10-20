// SPDX-License-Identifier: Apache-2.0
/**
 * The parts of the embed API that only the full player has: the check of an input event of `send` (`InputEvent` of
 * `@scenity/scene/sequence`) and the pick of a document core with its sub-target. The light player of a plugin core
 * lets the core check an event (`sendEvents`) and gets its picks from the hits of the core. Thus its page does not
 * include this module.
 */
import type { InputEvent } from "@scenity/scene/sequence";
import type { DocumentClient } from "@scenity/runtime/documentClient";
import type { PlayerInputEvent, PlayerInputResult, PlayerPick } from "./types";

/** An action of an input map: a plugin ID, a dot and a name (`ACTION_PATTERN` of `@scenity/scene`, `demo.toggle`). */
const ACTION = /^[a-z][A-Za-z0-9-]{0,63}\.[A-Za-z0-9_.:-]{1,64}$/;

function refused(plugin: string, path: string, message: string): PlayerInputResult {
  return { ok: false, problems: [{ plugin, path, message }] };
}

/** True for a world point: three finite numbers. */
function isPoint(value: unknown): value is readonly [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((item) => Number.isFinite(item));
}

/** The event at the time `t` (whole ms), or the problems. A page with no types can give any value. */
export function checkEvent(event: PlayerInputEvent, t: number): InputEvent | PlayerInputResult {
  const value: unknown = event;
  const raw = typeof value === "object" && value !== null ? (value as Readonly<Record<string, unknown>>) : {};
  const action = raw.action;
  if (typeof action !== "string" || !ACTION.test(action)) {
    return refused("", "/action", "the action is <plugin>.<name> (doors.open)");
  }
  const plugin = action.slice(0, action.indexOf("."));
  const kind = raw.kind;
  if (kind !== "press" && kind !== "release") return refused(plugin, "/kind", "the kind is press or release");
  const entity = raw.entity;
  if (entity !== undefined && (typeof entity !== "string" || entity.length === 0)) {
    return refused(plugin, "/entity", "the entity is an entity ID");
  }
  const point = raw.point;
  if (point !== undefined && !isPoint(point)) return refused(plugin, "/point", "the point is [x, y, z]");
  return {
    t: Math.max(0, Math.round(t)),
    kind,
    action,
    ...(entity === undefined ? {} : { entity }),
    ...(point === undefined ? {} : { point: [point[0], point[1], point[2]] }),
  };
}

/** The pick of a document core at a point of the canvas (CSS pixels), with the nearest sub-target. */
export async function pickDocument(client: DocumentClient, x: number, y: number): Promise<PlayerPick> {
  const hit = await client.pickEntity(x, y, { sub: true });
  if (hit === null) return { x, y, entity: null, sub: null, point: null };
  // The sub-target of a hit is a reference `entity:<entity>#<sub>`.
  const sub = hit.sub === undefined ? null : hit.sub.slice(hit.sub.indexOf("#") + 1);
  return { x, y, entity: hit.entity, sub, point: hit.point };
}
