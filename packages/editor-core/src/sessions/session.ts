// SPDX-License-Identifier: Apache-2.0
/**
 * The document session of one open scene. Each open scene of a project has its own session. The session has the file
 * state and the draft key of its path, and the one history of its edits. The history covers the scene document, the
 * sequence, the view state of the hierarchy panel and each other channel. The session also has the selection and the
 * editor view of the page. Thus each scene keeps its own undo history over a switch.
 *
 * The editor has one scene channel (sceneChannel.ts) and one file state (sceneFile.ts). The page binds its panels, its
 * file bar and the runtime to them. The active session lives in them. A session that is not active is parked. It keeps
 * a mark of the history of the channel (`EditHistory.mark`) and the state of its file. The switch (sessions.ts)
 * restores them (`rewind`, `SceneFile.restore`). No Vue import, no DOM.
 */
import { writeDocument } from "@scenity/scene/canonical";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { HistoryMark } from "../history";
import { SCENE_CHANNEL } from "../sceneChannel";
import type { SceneFile, SceneFileState, SceneSaveRequest } from "../sceneFile";

/** The parts of an editor that its sessions share: the document and the file state of the active session. */
export interface SessionLive<D extends SceneDocument = SceneDocument> {
  doc(): D;
  readonly file: SceneFile;
}

/** The parked state of a session: the history of its channels and its file state. */
export interface ParkedSession {
  readonly mark: HistoryMark;
  readonly file: SceneFileState;
}

let sessionCount = 0;

/** The editor state of one open scene. */
export class DocumentSession<D extends SceneDocument = SceneDocument> {
  /** A key of the session that stays the same after a save as (the path can change). */
  readonly key: string;
  /** The selection of the page while the session is parked (entity IDs). */
  selection: readonly string[] = [];
  /** The editor view of the page while the session is parked (for example the camera). The page gives the keys. */
  state: Readonly<Record<string, unknown>> = {};
  readonly #live: SessionLive<D>;
  readonly #draftKey: (path: string) => string;
  /** The parked state, or null while the session is active (the channel and the file state of the editor have it). */
  #parked: ParkedSession | null;

  /**
   * @param live the document and the file state of the editor (the session reads them while it is active)
   * @param parked the parked state, or null for the session that is currently active
   * @param draftKey the draft key of a scene path (for example `sceneDraftKey` of the project)
   */
  constructor(live: SessionLive<D>, parked: ParkedSession | null, draftKey: (path: string) => string) {
    sessionCount += 1;
    this.key = `session-${String(sessionCount)}`;
    this.#live = live;
    this.#parked = parked;
    this.#draftKey = draftKey;
  }

  /** The current file state: the state of the editor while the session is active. */
  get fileState(): SceneFileState {
    return this.#parked?.file ?? this.#live.file.state();
  }

  get path(): string {
    return this.fileState.path;
  }

  /** The hash of the file on the disk at the open or at the last save. Null for a new file. */
  get baseHash(): string | null {
    return this.fileState.hash;
  }

  /** The current scene document. */
  get doc(): D {
    return this.#parked === null ? this.#live.doc() : (this.#parked.mark.values[SCENE_CHANNEL] as D);
  }

  /** The storage key of the local draft of the current file. */
  get draftKey(): string {
    return this.#draftKey(this.path);
  }

  /** True when the scene document differs from the file at the open or at the last save. */
  get dirty(): boolean {
    return writeDocument(this.doc) !== this.fileState.text;
  }

  /** True while the session lives in the channel and the file state of the editor. */
  get active(): boolean {
    return this.#parked === null;
  }

  /** The parked state (null while the session is active). */
  get parked(): ParkedSession | null {
    return this.#parked;
  }

  /** The session set parks the session, or makes it active (null). */
  setParked(parked: ParkedSession | null): void {
    this.#parked = parked;
  }

  /** The fields of a save as: the new path, the canonical text and no base hash (a new file). */
  saveAsRequest(path: string): SceneSaveRequest {
    return { path, text: writeDocument(this.doc), baseHash: null };
  }

  /**
   * After a save as: the session moves to `path`. The saved `text` and its `hash` are the new base. Thus the session
   * is clean. The history stays.
   */
  moveTo(path: string, text: string, hash: string): void {
    const file = { path, text, hash };
    if (this.#parked === null) this.#live.file.restore(file);
    else this.#parked = { ...this.#parked, file };
  }
}
