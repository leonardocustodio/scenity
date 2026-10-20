// SPDX-License-Identifier: Apache-2.0
/**
 * The presence of the agents in the editor window. The studio host sends `agent.presence` over the socket of the page
 * bridge at each tool call of a turn. The page keeps the newest presence of each session. The hierarchy and the Scene
 * view mark the entities of a turn that runs in the colour of its session. The view shows the camera of its last frame
 * for 3 s. The status bar shows its activity, and "Follow the agent" shows its last picture. These marks do not move
 * the camera, the selection or the focus of the person.
 */
import { shallowRef } from "vue";

/** The presence of one session. */
export interface AgentPresence {
  readonly session: { readonly id: string; readonly name: string; readonly colour: string };
  readonly running: boolean;
  readonly activity: string | null;
  readonly entities: readonly string[];
  readonly camera: string | null;
  readonly picture: string | null;
  /** The time of the message (ms), and the time when its camera arrived (the frustum shows for 3 s). */
  readonly at: number;
  readonly cameraAt: number | null;
}

/** The time that the camera of a frame of the agent shows in the view (ms). */
export const CAMERA_SHOW_MS = 3000;

const presences = shallowRef<ReadonlyMap<string, AgentPresence>>(new Map());

const texts = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** Take a presence message of the studio host. Ignore other values. */
export function receivePresence(raw: unknown, now = Date.now()): void {
  if (typeof raw !== "object" || raw === null) return;
  const message = raw as Record<string, unknown>;
  const session = message.session as Record<string, unknown> | undefined;
  const id = text(session?.id);
  if (id === null) return;
  const old = presences.value.get(id);
  const camera = text(message.camera);
  const next: AgentPresence = {
    session: { id, name: text(session?.name) ?? id, colour: text(session?.colour) ?? "agent-1" },
    running: message.running === true,
    activity: text(message.activity),
    entities: texts(message.entities),
    camera,
    picture: text(message.picture),
    at: now,
    cameraAt: camera === null ? null : camera === old?.camera ? old.cameraAt : now,
  };
  const map = new Map(presences.value);
  map.set(id, next);
  presences.value = map;
}

/** The presences of the sessions (reactive). */
export function pagePresences(): ReadonlyMap<string, AgentPresence> {
  return presences.value;
}

/** The presence of a session that runs and works on an entity, or null. */
export function workingOn(entity: string): AgentPresence | null {
  for (const presence of presences.value.values()) {
    if (presence.running && presence.entities.includes(entity)) return presence;
  }
  return null;
}

/** The newest presence of a session that runs, or null. */
export function newestRunning(): AgentPresence | null {
  let found: AgentPresence | null = null;
  for (const presence of presences.value.values()) {
    if (presence.running && (found === null || presence.at > found.at)) found = presence;
  }
  return found;
}

/** Clear the presences (for a test). */
export function clearPresences(): void {
  presences.value = new Map();
}
