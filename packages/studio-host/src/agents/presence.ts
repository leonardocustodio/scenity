// SPDX-License-Identifier: Apache-2.0
/**
 * The presence of an agent session in the editor windows. At each tool call of a turn, the host tells the windows of
 * the project the current work of the session. The presence has its activity ("entity.move · Armchair (4/9)"), the
 * entities of the call, the document camera of a frame and the last picture of a frame. At the end of the turn, the
 * presence goes away. The windows show it, but it does not move the view or the focus of the person.
 */

/** The presence message of a session (`agent.presence` on the socket of the page bridge). */
export interface PresenceMessage {
  readonly type: "agent.presence";
  readonly project: string;
  readonly session: { readonly id: string; readonly name: string; readonly colour: string };
  readonly running: boolean;
  readonly activity: string | null;
  readonly entities: readonly string[];
  /** The document camera of the last frame of the agent, or null. */
  readonly camera: string | null;
  /** The ID of the last picture of the agent (`/api/agent/pictures/<id>`), or null. */
  readonly picture: string | null;
}

/** The argument keys that name entities. */
const TARGET_KEYS = ["entity", "entities", "ids", "id", "parent", "target", "from", "to", "under"];

function strings(value: unknown): string[] {
  if (typeof value === "string")
    return value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "");
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The entities of the input of a tool call (its arguments and the arguments of its steps). */
export function callEntities(input: unknown): string[] {
  const top = record(input);
  const args = [
    top,
    record(top.args),
    ...(Array.isArray(top.steps) ? top.steps.map((step) => record(record(step).args)) : []),
  ];
  return [...new Set(args.flatMap((part) => TARGET_KEYS.flatMap((key) => strings(part[key]))))];
}

/** The activity text of a tool call: the tool, its command and its count in the turn. */
export function callActivity(name: string, input: unknown, count: number): string {
  const command = record(input).command;
  return `${typeof command === "string" ? `${name} · ${command}` : name} (${String(count)})`;
}

/** The document camera of a frame call, or null. */
export function callCamera(name: string, input: unknown): string | null {
  if (name !== "scene_frame" && name !== "scene_sheet") return null;
  const { camera, cameras } = record(input);
  return typeof camera === "string" ? camera : (strings(cameras)[0] ?? null);
}

/** Who the presence names: the session and its project. */
export interface PresenceOwner {
  readonly id: string;
  readonly name: string;
  readonly colour: string;
  readonly project: string;
}

/** The presence of one session: the count of the calls of the turn, the camera and the picture of its last frame. */
export class SessionPresence {
  #calls = 0;
  #camera: string | null = null;
  #picture: string | null = null;

  constructor(
    private readonly owner: () => PresenceOwner,
    private readonly tell: (project: string, message: PresenceMessage) => void,
  ) {}

  /** A new turn. */
  begin(): void {
    this.#calls = 0;
    this.#camera = null;
    this.#picture = null;
  }

  /** A tool call: before the call (no pictures), or after the call with its pictures. */
  call(name: string, input: unknown, pictures?: readonly string[]): void {
    if (pictures === undefined) this.#calls += 1;
    this.#camera = callCamera(name, input) ?? this.#camera;
    this.#picture = pictures?.at(-1) ?? this.#picture;
    this.#send(true, callActivity(name, input, this.#calls), callEntities(input));
  }

  /** The end of the turn: the windows remove the presence. */
  end(): void {
    this.#send(false, null, []);
  }

  #send(running: boolean, activity: string | null, entities: readonly string[]): void {
    const { id, name, colour, project } = this.owner();
    this.tell(project, {
      type: "agent.presence",
      project,
      session: { id, name, colour },
      running,
      activity,
      entities,
      camera: this.#camera,
      picture: this.#picture,
    });
  }
}
