// SPDX-License-Identifier: Apache-2.0
/**
 * The file state of an open scene document: the dirty state, the local draft and the base of a save. No Vue import, no
 * DOM: the storage of the drafts is a port.
 *
 * - The base is the canonical text of the document at the load (or at the last save) and the hash of the file on the
 *   disk at that time. The document is dirty when its canonical text differs from the base text.
 * - A save sends the canonical text and the base hash. The writer refuses it when the file on the disk has another
 *   hash (the file changed on the disk after the load). The owner then reloads or overwrites.
 * - The draft is a copy of a dirty document in the browser storage. After a crash, the next load offers it again. A
 *   draft with another base hash than the current file is stale: the file changed on the disk after the draft.
 */
import { sha256Hex } from "@scenity/labs-platform/sha256";
import { writeDocument } from "@scenity/scene/canonical";

/** The format of a draft in the browser storage. */
export const SCENE_DRAFT_FORMAT = "scenity.sceneDraft/1";

/** The SHA-256 of a scene text (hex), as the writer of the host computes it. */
export function sceneTextHash(text: string): string {
  return sha256Hex(text);
}

/** The fields of a save: the path, the canonical text and the base hash. */
export interface SceneSaveRequest {
  readonly path: string;
  readonly text: string;
  readonly baseHash: string | null;
  readonly force?: boolean;
}

/** The state of a scene file: its path, the base text and the base hash (null for a new file). */
export interface SceneFileState {
  readonly path: string;
  readonly text: string;
  readonly hash: string | null;
}

/** The file state of a scene document. */
export class SceneFile {
  #path: string;
  #text: string;
  #hash: string | null;

  /**
   * @param path the path of the file in the project, with "/"
   * @param doc the document at the load
   * @param diskText the text of the file at the load, or null for a new file
   */
  constructor(path: string, doc: { readonly format: string }, diskText: string | null) {
    this.#path = path;
    this.#text = writeDocument(doc);
    this.#hash = diskText === null ? null : sceneTextHash(diskText);
  }

  /** The path of the file in the project, with "/". */
  get path(): string {
    return this.#path;
  }

  /** The hash of the file on the disk at the load or at the last save. Null for a new file. */
  get baseHash(): string | null {
    return this.#hash;
  }

  /** The canonical text of the document at the load or at the last save. */
  get baseText(): string {
    return this.#text;
  }

  /** True when the document differs from the document at the load or at the last save. */
  dirty(doc: { readonly format: string }): boolean {
    return writeDocument(doc) !== this.#text;
  }

  /** The fields of a save of the document. */
  saveRequest(doc: { readonly format: string }, force = false): SceneSaveRequest {
    return { path: this.#path, text: writeDocument(doc), baseHash: this.#hash, ...(force ? { force } : {}) };
  }

  /** A save wrote `text` with the hash `hash`: it is the new base. */
  saved(text: string, hash: string): void {
    this.#text = text;
    this.#hash = hash;
  }

  /** True when the disk text has another hash than the base (the file changed on the disk after the load). */
  changedOnDisk(diskText: string | null): boolean {
    return (diskText === null ? null : sceneTextHash(diskText)) !== this.#hash;
  }

  /** The current state (the path, the base text and the base hash). */
  state(): SceneFileState {
    return { path: this.#path, text: this.#text, hash: this.#hash };
  }

  /** Restore a state: the file of another open scene, or the new path of a save as. */
  restore(state: SceneFileState): void {
    this.#path = state.path;
    this.#text = state.text;
    this.#hash = state.hash;
  }
}

/** The state of a file at its open: the canonical text of the document and the hash of the disk text. */
export function sceneFileState(
  path: string,
  doc: { readonly format: string },
  diskText: string | null,
): SceneFileState {
  return new SceneFile(path, doc, diskText).state();
}

/** A draft of a dirty document in the browser storage. */
export interface SceneDraft {
  readonly format: typeof SCENE_DRAFT_FORMAT;
  readonly path: string;
  /** The base hash of the document when the draft was written. */
  readonly baseHash: string | null;
  /** The canonical text of the dirty document. */
  readonly text: string;
  /** The time of the write (ms since 1970, from the page). */
  readonly savedMs: number;
}

/** The parts of `localStorage` that the drafts use. */
export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The storage key of the draft of a scene file of a project. */
export function sceneDraftKey(project: string, path: string): string {
  return `scenity.sceneDraft.${project}:${path}`;
}

function isDraft(value: unknown, path: string): value is SceneDraft {
  if (typeof value !== "object" || value === null) return false;
  const draft = value as Record<string, unknown>;
  return (
    draft.format === SCENE_DRAFT_FORMAT &&
    draft.path === path &&
    (draft.baseHash === null || typeof draft.baseHash === "string") &&
    typeof draft.text === "string" &&
    typeof draft.savedMs === "number"
  );
}

/**
 * The draft of one scene file. Each storage call is in a try block. A private window, a full storage or a blocked
 * storage gives no draft, and the page continues to work.
 */
export class SceneDrafts {
  constructor(
    private readonly storage: DraftStorage | null,
    private key: string,
    private path: string,
  ) {}

  /** Use the drafts of another scene file from this time (a switch of the open scene, or a save as). */
  moveTo(key: string, path: string): void {
    this.key = key;
    this.path = path;
  }

  /** The draft of the file, or null (no draft, a bad value, or no storage). */
  read(): SceneDraft | null {
    try {
      const text = this.storage?.getItem(this.key) ?? null;
      const value: unknown = text === null ? null : JSON.parse(text);
      return isDraft(value, this.path) ? value : null;
    } catch {
      return null;
    }
  }

  /** Keep the dirty document of a file as its draft. */
  write(file: SceneFile, doc: { readonly format: string }, savedMs: number): void {
    const draft: SceneDraft = {
      format: SCENE_DRAFT_FORMAT,
      path: this.path,
      baseHash: file.baseHash,
      text: writeDocument(doc),
      savedMs,
    };
    try {
      this.storage?.setItem(this.key, JSON.stringify(draft));
    } catch {
      // A full or blocked storage keeps no draft.
    }
  }

  clear(): void {
    try {
      this.storage?.removeItem(this.key);
    } catch {
      // A blocked storage has no draft to remove.
    }
  }
}

/** The draft that a load offers to restore: a draft that differs from the base text. */
export interface DraftOffer {
  readonly draft: SceneDraft;
  /** True when the file changed on the disk after the draft (another base hash). */
  readonly stale: boolean;
}

/** The offer of a draft at the load, or null when the draft is absent or equals the base text. */
export function draftOffer(draft: SceneDraft | null, file: SceneFile): DraftOffer | null {
  if (draft === null || draft.text === file.baseText) return null;
  return { draft, stale: draft.baseHash !== file.baseHash };
}
