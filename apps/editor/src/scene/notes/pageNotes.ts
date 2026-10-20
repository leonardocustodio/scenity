// SPDX-License-Identifier: Apache-2.0
/**
 * The notes of the open scene: the notes of the side file `<scene>.notes.json` (`scenity.notes/1`) and the note
 * entities of the scene (the `annotation` component), as one list with their world places. The side file changes with
 * no step of the history. Each add, status change and removal writes it immediately through the scene file port (the
 * player never reads it). The filter of the notes (all, open, done, none) is a convenience of the person in the
 * browser storage. The pins and the Notes panel use it.
 */
import { worldTransform } from "@scenity/scene/world";
import { parseRef } from "@scenity/scene/refs";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import {
  NOTES_FORMAT,
  notesPathOf,
  readNotesDocument,
  type Note,
  type NoteReply,
  type NotesDocument,
} from "@scenity/scene/schema/notes";
import { writeDocument } from "@scenity/scene/canonical";
import { shallowRef, type ShallowRef } from "vue";
import type { SceneFilePort } from "../sceneFiles";

export type Vec3 = readonly [number, number, number];

/** One note of the list: a note of the side file or a note entity. */
export interface NoteItem {
  /** `file:<id>` or `entity:<id>`. */
  readonly key: string;
  readonly kind: "file" | "entity";
  readonly id: string;
  readonly text: string;
  readonly status: "open" | "done";
  /** The entity of the note: the target of a file note, the parent of a note entity (null: a point). */
  readonly entity: string | null;
  /** The world place of the pin, or null when the target has no place. */
  readonly at: Vec3 | null;
  /** The author of a file note, and the replies of its thread (none for a note entity). */
  readonly author?: string;
  readonly replies: readonly NoteReply[];
}

export const NOTE_FILTERS = ["all", "open", "done", "none"] as const;
export type NoteFilter = (typeof NOTE_FILTERS)[number];

/** The storage key of the filter of the notes. */
export const NOTE_FILTER_KEY = "scenity.notes.filter";

/** True when a note shows under a filter. */
export function shownBy(filter: NoteFilter, item: NoteItem): boolean {
  return filter === "all" || (filter !== "none" && item.status === filter);
}

/** The world place of an entity of a document, or null. */
function placeOf(doc: SceneDocument, id: string): Vec3 | null {
  return worldTransform(doc, id)?.position ?? null;
}

/** The notes of a document and of its side file, the file notes first. */
export function noteItems(doc: SceneDocument, file: NotesDocument | null): NoteItem[] {
  const fileItems = (file?.notes ?? []).map((note): NoteItem => {
    const ref = typeof note.at === "string" ? parseRef(note.at) : undefined;
    const entity = ref?.kind === "entity" ? ref.id : null;
    const at = typeof note.at === "string" ? (entity === null ? null : placeOf(doc, entity)) : note.at;
    return {
      ...{ key: `file:${note.id}`, kind: "file", id: note.id, text: note.text, status: note.status, entity, at },
      ...(note.author === undefined ? {} : { author: note.author }),
      replies: note.replies ?? [],
    } satisfies NoteItem;
  });
  const entityItems = Object.entries(doc.entities).flatMap(([id, entity]): NoteItem[] => {
    const value = entity.components.annotation as { text?: unknown; status?: unknown } | undefined;
    if (value === undefined || typeof value.text !== "string") return [];
    const status = value.status === "done" ? "done" : "open";
    return [
      {
        key: `entity:${id}`,
        kind: "entity",
        id,
        text: value.text,
        status,
        entity: entity.parent,
        at: placeOf(doc, id),
        replies: [],
      },
    ];
  });
  return [...fileItems, ...entityItems];
}

/** The number of the notes of each entity (the hierarchy shows it). */
export function noteCounts(items: readonly NoteItem[]): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (const item of items)
    if (item.kind === "file" && item.entity !== null) out.set(item.entity, (out.get(item.entity) ?? 0) + 1);
  return out;
}

/** The note file of the open scene and its writes. */
export class PageNotes {
  readonly file: ShallowRef<NotesDocument | null> = shallowRef(null);
  readonly filter: ShallowRef<NoteFilter> = shallowRef("all");
  readonly error: ShallowRef<string | null> = shallowRef(null);
  readonly #files: SceneFilePort;
  readonly #path: string;
  readonly #scene: string;
  #hash: string | null = null;

  constructor(files: SceneFilePort, scenePath: string, sceneId: string) {
    this.#files = files;
    this.#path = notesPathOf(scenePath);
    this.#scene = sceneId;
    try {
      const stored = localStorage.getItem(NOTE_FILTER_KEY);
      if ((NOTE_FILTERS as readonly (string | null)[]).includes(stored)) this.filter.value = stored as NoteFilter;
    } catch {
      // No storage: the filter starts at "all".
    }
  }

  get path(): string {
    return this.#path;
  }

  /** Read the side file; a scene with no note file has no file notes. */
  async load(): Promise<void> {
    const read = await this.#files.read(this.#path).catch(() => null);
    if (read === null) return;
    const doc = readNotesDocument(read.text);
    if (!doc.ok) {
      this.error.value = doc.errors[0]?.message ?? null;
      return;
    }
    this.file.value = doc.doc;
    this.#hash = read.hash;
  }

  setFilter(filter: NoteFilter): void {
    this.filter.value = filter;
    try {
      localStorage.setItem(NOTE_FILTER_KEY, filter);
    } catch {
      // No storage: the filter stays for this page only.
    }
  }

  /** Add a note on an entity or at a point; the result is its ID. */
  async add(text: string, at: string | Vec3, author?: string): Promise<string> {
    const notes = this.file.value?.notes ?? [];
    const used = new Set(notes.map((note) => note.id));
    let id = `note-${String(notes.length + 1)}`;
    for (let n = notes.length + 2; used.has(id); n += 1) id = `note-${String(n)}`;
    const note: Note = {
      id,
      text,
      at: typeof at === "string" ? at : [...at],
      status: "open",
      ...(author === undefined ? {} : { author }),
    };
    await this.#write([...notes, note]);
    return id;
  }

  /**
   * Add a reply to the thread of a note of the file. The file is read first, so the replies of the other
   * people of the team stay. False when the note is not there or the write fails.
   */
  async reply(id: string, text: string, author?: string): Promise<boolean> {
    await this.load();
    const notes = this.file.value?.notes ?? [];
    if (!notes.some((note) => note.id === id)) return false;
    const reply: NoteReply = { text, at: new Date().toISOString(), ...(author === undefined ? {} : { author }) };
    await this.#write(
      notes.map((note) => (note.id === id ? { ...note, replies: [...(note.replies ?? []), reply] } : note)),
    );
    return this.error.value === null;
  }

  /** Change the status of a note of the file. */
  setStatus(id: string, status: "open" | "done"): Promise<void> {
    return this.#write((this.file.value?.notes ?? []).map((note) => (note.id === id ? { ...note, status } : note)));
  }

  /** Remove a note of the file. */
  remove(id: string): Promise<void> {
    return this.#write((this.file.value?.notes ?? []).filter((note) => note.id !== id));
  }

  async #write(notes: Note[]): Promise<void> {
    const doc: NotesDocument = { format: NOTES_FORMAT, scene: this.#scene, notes };
    const result = await this.#files.save({
      path: this.#path,
      text: writeDocument(doc),
      baseHash: this.#hash,
      force: true,
    });
    if (!result.ok) {
      this.error.value = "reason" in result ? result.reason : null;
      return;
    }
    this.error.value = null;
    this.#hash = result.hash;
    this.file.value = doc;
  }
}

/** The notes of the page (none before the edit mode starts them). */
const current = shallowRef<PageNotes | null>(null);

export function pageNotes(): PageNotes | null {
  return current.value;
}

export function setPageNotes(notes: PageNotes | null): void {
  current.value = notes;
}
