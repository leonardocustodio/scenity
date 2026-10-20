// SPDX-License-Identifier: Apache-2.0
/**
 * The open scenes of an editor: a list of document sessions over the one scene channel of the editor, and the active
 * session.
 *
 * - The first session is the scene of the channel at the start. `open` adds a parked session. Its history has one
 *   step: the document of the new scene with an empty view state. The other channels keep their current values.
 * - `activate` parks the active session (a mark of the history of the channel). Then it restores the history of the
 *   other session (`rewind`): its document, its view state, its sequence and its undo steps. Each channel writes its
 *   value. Thus the runtime gets the change of the document as a patch. The switch waits while a live drag runs or
 *   while `busy` gives a reason (the play mode of the page).
 * - `close` asks about unsaved changes first (save, discard or cancel). When the active session closes, the last
 *   other session becomes active. After the last close, no session is active.
 * - `saveAsProblem` refuses a save as to a path that another open session has.
 *
 * No Vue import, no DOM: the page gives the questions, the saves and the busy check as ports.
 */
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { EMPTY_VIEW, VIEW_CHANNEL } from "../hierarchy/view";
import type { HistoryMark } from "../history";
import { EditError } from "../ops";
import { SCENE_CHANNEL, type SceneChannel } from "../sceneChannel";
import { sceneFileState, type SceneDrafts, type SceneFile } from "../sceneFile";
import { DocumentSession, type SessionLive } from "./session";

/** The answer to the question of a close with unsaved changes. */
export type CloseChoice = "save" | "discard" | "cancel";

/** The ports of a close. */
export interface ClosePort<D extends SceneDocument = SceneDocument> {
  /** True when the session has unsaved changes (default: the dirty state of its scene file). */
  dirty?(session: DocumentSession<D>): boolean;
  /** The question about the unsaved changes of the session. */
  ask(session: DocumentSession<D>): CloseChoice | Promise<CloseChoice>;
  /** Save the session (it is active at that time). True when the save wrote the file. */
  save(session: DocumentSession<D>): Promise<boolean>;
}

/** The result of a close. */
export interface CloseResult<D extends SceneDocument = SceneDocument> {
  readonly closed: boolean;
  /** Why the session stays open: the owner cancelled, the save failed, or the switch waits. */
  readonly reason?: string;
  /** The active session after the close (null: no open session). */
  readonly active: DocumentSession<D> | null;
}

/** A hook of a switch: `from` was active (null: no session), `to` becomes active. */
export type SwitchHook<D extends SceneDocument> = (from: DocumentSession<D> | null, to: DocumentSession<D>) => void;

/** The parts of the editor that the sessions share. */
export interface DocumentSessionsOptions<D extends SceneDocument = SceneDocument> {
  /** The scene channel of the editor: the active session lives in it. */
  readonly channel: SceneChannel<D>;
  /** The file state of the editor: the file state of the active session. */
  readonly file: SceneFile;
  /** The local drafts of the editor: a switch moves them to the draft key of the active session. */
  readonly drafts?: SceneDrafts;
  /** The draft key of a scene path (for example `sceneDraftKey` of the project). */
  readonly draftKey: (path: string) => string;
  /** Why the active session cannot park at this time (for example the play mode of the page), or null. */
  readonly busy?: () => string | null;
}

/** The fields of a scene at its open. */
export interface OpenScene<D extends SceneDocument = SceneDocument> {
  /** The path of the scene file in the project, with "/". */
  readonly path: string;
  readonly doc: D;
  /** The text of the file on the disk at the open, or null for a file that is not on the disk. */
  readonly diskText: string | null;
}

export class DocumentSessions<D extends SceneDocument = SceneDocument> {
  readonly channel: SceneChannel<D>;
  readonly #options: DocumentSessionsOptions<D>;
  readonly #live: SessionLive<D>;
  readonly #list: DocumentSession<D>[] = [];
  readonly #before = new Set<SwitchHook<D>>();
  readonly #after = new Set<SwitchHook<D>>();
  #active: DocumentSession<D> | null;

  /** The first session is the current scene of the editor: the document, the history of the channel, the file state. */
  constructor(options: DocumentSessionsOptions<D>) {
    this.#options = options;
    this.channel = options.channel;
    this.#live = { doc: () => this.channel.doc, file: options.file };
    const session = new DocumentSession<D>(this.#live, null, options.draftKey);
    this.#list.push(session);
    this.#active = session;
  }

  /** The active session, or null after the close of the last session. */
  get active(): DocumentSession<D> | null {
    return this.#active;
  }

  /** The open sessions in the order of their open. */
  list(): readonly DocumentSession<D>[] {
    return [...this.#list];
  }

  /** The open session of a path, or null. */
  find(path: string): DocumentSession<D> | null {
    return this.#list.find((session) => session.path === path) ?? null;
  }

  /** The values of the channels of a session: the current channel for the active session, else its mark. */
  values(session: DocumentSession<D>): Readonly<Record<string, unknown>> {
    return session.parked?.mark.values ?? this.channel.history.read();
  }

  /** True when the undo of a session has a step before the current step. */
  canUndo(session: DocumentSession<D>): boolean {
    const parked = session.parked;
    return parked === null ? this.channel.history.canUndo : parked.mark.steps.index > 0;
  }

  /** Call `hook` before each switch (the old session is still active). The result stops it. */
  beforeSwitch(hook: SwitchHook<D>): () => void {
    this.#before.add(hook);
    return () => this.#before.delete(hook);
  }

  /** Call `hook` after each switch (the new session is active). The result stops it. */
  afterSwitch(hook: SwitchHook<D>): () => void {
    this.#after.add(hook);
    return () => this.#after.delete(hook);
  }

  /**
   * Open a parked session of a scene. Its history has one step: the document `doc`, an empty view state, and the
   * current values of the other channels. It throws an EditError when another session has the same path.
   */
  open(scene: OpenScene<D>): DocumentSession<D> {
    if (this.find(scene.path) !== null) throw new EditError(`The scene ${scene.path} is open already.`);
    const now = this.channel.history.read();
    const values: Record<string, unknown> = { ...now, [SCENE_CHANNEL]: scene.doc };
    if (VIEW_CHANNEL in now) values[VIEW_CHANNEL] = EMPTY_VIEW;
    const mark: HistoryMark = { steps: { states: [{ values, label: null }], index: 0 }, values };
    const file = sceneFileState(scene.path, scene.doc, scene.diskText);
    const session = new DocumentSession<D>(this.#live, { mark, file }, this.#options.draftKey);
    this.#list.push(session);
    return session;
  }

  /** Why the active session cannot park at this time, or null. */
  busy(): string | null {
    if (this.channel.live) return "A live drag runs: end it first.";
    return this.#options.busy?.() ?? null;
  }

  /**
   * Make a session active (an open session, or its path). It throws an EditError for a session that is not open, and
   * while the active session cannot park (`busy`).
   */
  activate(target: DocumentSession<D> | string): DocumentSession<D> {
    const to = typeof target === "string" ? this.find(target) : target;
    if (to === null || !this.#list.includes(to)) throw new EditError("The scene is not open.");
    const from = this.#active;
    if (to === from) return to;
    const busy = this.busy();
    if (busy !== null) throw new EditError(busy);
    const parked = to.parked;
    if (parked === null) throw new EditError("The scene has no history to put back.");
    for (const hook of this.#before) hook(from, to);
    const { file, drafts } = this.#options;
    from?.setParked({ mark: this.channel.history.mark(), file: file.state() });
    // The file state and the drafts move first. Thus the change of the document keeps the draft of the new scene.
    file.restore(parked.file);
    drafts?.moveTo(to.draftKey, parked.file.path);
    this.#active = to;
    to.setParked(null);
    this.channel.history.rewind(parked.mark);
    for (const hook of this.#after) hook(from, to);
    return to;
  }

  /**
   * Close a session. With unsaved changes, the port asks first. "cancel" keeps it open, and "save" saves it (a failed
   * save keeps it open). "discard" closes it with no save. A save makes the session active first.
   */
  async close(target: DocumentSession<D> | string, port: ClosePort<D>): Promise<CloseResult<D>> {
    const session = typeof target === "string" ? this.find(target) : target;
    const stay = (reason: string): CloseResult<D> => ({ closed: false, reason, active: this.#active });
    if (session === null || !this.#list.includes(session)) return stay("The scene is not open.");
    if (session === this.#active && this.busy() !== null) return stay(this.busy() ?? "");
    if (port.dirty?.(session) ?? session.dirty) {
      const choice = await port.ask(session);
      if (choice === "cancel") return stay("The owner cancelled the close.");
      if (choice === "save") {
        if (session !== this.#active) this.activate(session);
        if (!(await port.save(session))) return stay("The save failed: the scene stays open.");
      }
    }
    const others = this.#list.filter((item) => item !== session);
    const next = others.at(-1);
    if (session === this.#active && next !== undefined) this.activate(next);
    this.#list.splice(this.#list.indexOf(session), 1);
    if (session === this.#active) this.#active = null;
    return { closed: true, active: this.#active };
  }

  /** Why a save as of `session` cannot write `path`, or null. */
  saveAsProblem(session: DocumentSession<D>, path: string): string | null {
    if (path === session.path) return "A save as needs another path: use Save.";
    const other = this.find(path);
    return other === null ? null : `The scene ${path} is open: close it first.`;
  }
}
