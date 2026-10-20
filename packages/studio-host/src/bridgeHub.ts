// SPDX-License-Identifier: Apache-2.0
/**
 * The page bridge of the studio: the editor windows of the studio connect to the host over the socket `/bridge`, with
 * no workbench frame. A window tells the host its project and its scene (`hello`). The host sends a bridge call to a
 * window (the envelope of `@scenity/bridge`: `{ workbench: 1, id, call, args }`). It gets the answer of the window
 * (`{ workbench: 1, id, result | error }`). The bytes of a picture go as `{ $bytes: <base64> }`. The tools of an
 * agent go to the windows through `POST /api/bridge/<call>` (server.ts). The frame relay of the workbench stays for
 * embeds and the remote mode.
 *
 * The changes of a scene (`doc.ops`) go through the log of the documents (documentLog.ts). Each change gets the next
 * version of its scene, and the window that made it gets that version (`doc.version` with `ack`). A window gets the
 * messages of the host in their order. Thus a change of another window comes after each `ack` of the changes that the
 * host had before it. The window then applies its changes with no `ack` again after that change (documentSync.ts).
 */
import { DocumentLog } from "./documentLog";

/** The part of a socket that the hub uses. */
export interface BridgeSocket {
  send(text: string): void;
}

/** A window of the studio: its project, its scene and the time of its `hello`. */
export interface BridgePage {
  readonly project: string | null;
  readonly scene: string | null;
  readonly since: number;
}

interface Wait {
  readonly socket: BridgeSocket;
  resolve(value: unknown): void;
  reject(error: Error): void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/** The messages of a window that go to the other windows of its scene. */
const RELAYED = new Set(["doc.ops", "window.saved", "window.selection"]);

/** The wait for the answer of a window (ms). */
export const BRIDGE_TIMEOUT_MS = 60_000;
/** The time (ms) in which a window of a project that closed can come back (a reload of the page). */
export const RELOAD_GRACE_MS = 10_000;
/** The wait of a call for the window that comes back (ms). */
export const RELOAD_WAIT_MS = 15_000;

function readObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** The windows of the studio and the calls that wait for their answers. */
export class BridgeHub {
  /** The order and the last steps of the changes of each open scene. */
  readonly log = new DocumentLog();
  readonly #pages = new Map<BridgeSocket, BridgePage>();
  readonly #waits = new Map<number, Wait>();
  /** The time when the last window of each project closed. */
  readonly #left = new Map<string, number>();
  /** The calls that wait for a window of a project. */
  readonly #arrivals = new Map<string, (() => void)[]>();
  #next = 1;
  /**
   * The answer of a call of a project with no window, or null when the call needs a window (the host gives
   * the pictures of the scene pool, poolFrames.ts).
   */
  noWindow: ((project: string, call: string, args: readonly unknown[]) => Promise<unknown> | null) | null = null;

  attach(socket: BridgeSocket): void {
    this.#pages.set(socket, { project: null, scene: null, since: Date.now() });
  }

  /** A window closes: its calls fail immediately. */
  detach(socket: BridgeSocket): void {
    const project = this.#pages.get(socket)?.project ?? null;
    if (project !== null) this.#left.set(project, Date.now());
    this.#pages.delete(socket);
    for (const [id, wait] of this.#waits) {
      if (wait.socket !== socket) continue;
      clearTimeout(wait.timer);
      this.#waits.delete(id);
      wait.reject(new Error("the editor window closed"));
    }
  }

  /** A message of a window: its `hello`, a relayed change, or the answer of a call. The hub ignores other messages. */
  message(socket: BridgeSocket, text: string): void {
    const value = readObject(text);
    if (value === null) return;
    if (value.type === "hello") {
      const project = typeof value.project === "string" ? value.project : null;
      const scene = typeof value.scene === "string" ? value.scene : null;
      this.#pages.set(socket, { project, scene, since: Date.now() });
      if (project !== null) {
        for (const arrive of this.#arrivals.get(project) ?? []) arrive();
        this.#arrivals.delete(project);
      }
      // The window starts from the version of its scene.
      if (project !== null && scene !== null)
        socket.send(
          JSON.stringify({ type: "doc.version", project, path: scene, version: this.log.version(project, scene) }),
        );
      return;
    }
    // The ops of a change of a window go to the other windows of the same scene.
    if (RELAYED.has(String(value.type)) && typeof value.project === "string" && typeof value.path === "string") {
      this.relay(socket, value);
      return;
    }
    if (value.workbench !== 1 || typeof value.id !== "number") return;
    const wait = this.#waits.get(value.id);
    if (wait?.socket !== socket) return;
    clearTimeout(wait.timer);
    this.#waits.delete(value.id);
    if (typeof value.error === "string") wait.reject(new Error(value.error));
    else wait.resolve(value.result ?? null);
  }

  /**
   * Send a change of a scene (`{ type: "doc.ops", project, path, ops, title?, actor? }`) to each window of the
   * project with that scene, except the window that made it (null: the host made it).
   */
  relay(from: BridgeSocket | null, message: Record<string, unknown>): void {
    const sent = message.type === "doc.ops" ? this.#ordered(from, message) : message;
    const text = JSON.stringify(sent);
    for (const [socket, page] of this.#pages) {
      if (socket !== from && page.project === sent.project && page.scene === sent.path) socket.send(text);
    }
  }

  /** Give a change the next version of its scene. The window that made it gets the version (`ack`). */
  #ordered(from: BridgeSocket | null, message: Record<string, unknown>): Record<string, unknown> {
    const project = String(message.project);
    const path = String(message.path);
    const version = this.log.record(project, path, {
      title: typeof message.title === "string" ? message.title : null,
      actor: typeof message.actor === "string" ? message.actor : from === null ? "host" : "window",
      ops: Array.isArray(message.ops) ? (message.ops as unknown[]) : [],
    });
    from?.send(JSON.stringify({ type: "doc.version", project, path, version, ack: true }));
    return { ...message, version };
  }

  /** Send a message to each window of a project (the presence of an agent). */
  tell(project: string, message: Record<string, unknown>): void {
    const text = JSON.stringify(message);
    for (const [socket, page] of this.#pages) if (page.project === project) socket.send(text);
  }

  /** The current windows, the newest first. */
  pages(): BridgePage[] {
    return [...this.#pages.values()].sort((a, b) => b.since - a.since);
  }

  /**
   * Send a call to the newest window (of the project, when one is given) and wait for its answer. No window, a window
   * that closes and a window that does not answer in time are errors.
   */
  async call(
    call: string,
    args: readonly unknown[],
    options: { project?: string; timeoutMs?: number } = {},
  ): Promise<unknown> {
    let found = this.#newest(options.project);
    // A window that closed a short time ago can reload (a command that opens a sequence): the call waits for it.
    const left = options.project === undefined ? undefined : this.#left.get(options.project);
    if (
      found === undefined &&
      options.project !== undefined &&
      left !== undefined &&
      Date.now() - left < RELOAD_GRACE_MS
    ) {
      await this.#arrival(options.project);
      found = this.#newest(options.project);
    }
    if (found === undefined) {
      const answer = options.project === undefined ? null : (this.noWindow?.(options.project, call, args) ?? null);
      if (answer !== null) return answer;
      const where = options.project === undefined ? "" : ` of the project ${options.project}`;
      return Promise.reject(new Error(`no editor window${where} is open in the studio`));
    }
    const [socket] = found;
    const id = this.#next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waits.delete(id);
        reject(new Error(`the editor window did not answer ${call} in time`));
      }, options.timeoutMs ?? BRIDGE_TIMEOUT_MS);
      this.#waits.set(id, { socket, resolve, reject, timer });
      socket.send(JSON.stringify({ workbench: 1, id, call, args }));
    });
  }

  /** The newest window (of a project). */
  #newest(project?: string): [BridgeSocket, BridgePage] | undefined {
    return [...this.#pages]
      .filter(([, page]) => project === undefined || page.project === project)
      .sort(([, a], [, b]) => b.since - a.since)[0];
  }

  /** Resolves when a window of the project says hello, or after the wait. */
  #arrival(project: string): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, RELOAD_WAIT_MS);
      const done = (): void => {
        clearTimeout(timer);
        resolve();
      };
      this.#arrivals.set(project, [...(this.#arrivals.get(project) ?? []), done]);
    });
  }
}
