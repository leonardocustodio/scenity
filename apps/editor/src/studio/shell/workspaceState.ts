// SPDX-License-Identifier: Apache-2.0
/**
 * The workspace state of a person: the active workspace, the dock layout of each workspace, and the workspaces of the
 * person. A workspace of the person ("Save as…") has a name, the built-in workspace it comes from and a layout. One
 * document holds the state. The layout store keeps the document in the browser and in the user state of the studio
 * host.
 */
import { markRaw } from "vue";
import type { LayoutStore } from "./layoutStore";
import { DEFAULT_WORKSPACE, WORKSPACES, workspaceOf, type WorkspaceSpec } from "./workspaces";

export const WORKSPACES_FORMAT = "scenity.studio-workspaces/1";

/** A workspace of the person. */
export interface CustomWorkspace {
  readonly id: string;
  readonly name: string;
  /** The built-in workspace that gives its panels and its reset. */
  readonly base: string;
}

export interface WorkspacesDoc {
  readonly format: typeof WORKSPACES_FORMAT;
  readonly active: string;
  readonly layouts: Readonly<Record<string, unknown>>;
  readonly custom: readonly CustomWorkspace[];
}

/** A workspace as the tabs show it. */
export interface WorkspaceEntry {
  readonly id: string;
  /** The Fluent ID of a built-in title, or null for a workspace of the person. */
  readonly title: string | null;
  readonly name: string | null;
  readonly custom: boolean;
}

function emptyDoc(active = DEFAULT_WORKSPACE): WorkspacesDoc {
  return { format: WORKSPACES_FORMAT, active, layouts: {}, custom: [] };
}

function isCustomWorkspace(value: unknown): value is CustomWorkspace {
  const item = value as Partial<CustomWorkspace> | null;
  return typeof item?.id === "string" && typeof item.name === "string" && typeof item.base === "string";
}

/** A copy of a record without one key. */
function without<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const copy = { ...record };
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- The key is an ID of the record.
  delete copy[key];
  return copy;
}

/** The document of a stored value: a document, an older bare dock layout (the layout of "layout"), else empty. */
export function workspacesDoc(value: unknown): WorkspacesDoc {
  if (typeof value !== "object" || value === null) return emptyDoc();
  const doc = value as Partial<WorkspacesDoc>;
  if (doc.format !== WORKSPACES_FORMAT) return { ...emptyDoc(), layouts: { [DEFAULT_WORKSPACE]: value } };
  // The stored value is data from outside (the browser, the host): each field is checked.
  const layouts = doc.layouts as unknown;
  const custom = doc.custom as unknown;
  return {
    format: WORKSPACES_FORMAT,
    active: typeof doc.active === "string" ? doc.active : DEFAULT_WORKSPACE,
    layouts: typeof layouts === "object" && layouts !== null ? (layouts as Record<string, unknown>) : {},
    custom: Array.isArray(custom) ? custom.filter(isCustomWorkspace) : [],
  };
}

/** The workspace state over a layout store. */
export class Workspaces {
  #doc: WorkspacesDoc;
  readonly #store: LayoutStore;
  readonly #stored: boolean;
  readonly #listeners = new Set<() => void>();

  constructor(store: LayoutStore) {
    this.#store = store;
    const stored = store.read();
    this.#stored = stored !== null;
    this.#doc = workspacesDoc(stored);
    // A reactive proxy of the state cannot read its private fields: the state stays a plain object.
    markRaw(this);
  }

  get doc(): WorkspacesDoc {
    return this.#doc;
  }

  /** Take a new document (the copy of the studio host); the listeners hear it. */
  replace(value: unknown): void {
    this.#doc = workspacesDoc(value);
    this.#store.write(this.#doc);
    this.#changed();
  }

  /** The active workspace (a known one, else the default one). */
  active(): string {
    return this.has(this.#doc.active) ? this.#doc.active : DEFAULT_WORKSPACE;
  }

  /** True when the store had a document at the start (a person who used the editor before). */
  chosen(): boolean {
    return this.#stored;
  }

  has(id: string): boolean {
    return WORKSPACES.some((item) => item.id === id) || this.#doc.custom.some((item) => item.id === id);
  }

  /** The spec of a workspace: a built-in one, or the base of a workspace of the person. */
  spec(id: string = this.active()): WorkspaceSpec {
    return workspaceOf(this.#doc.custom.find((item) => item.id === id)?.base ?? id);
  }

  list(): WorkspaceEntry[] {
    return [
      ...WORKSPACES.map((item) => ({ id: item.id, title: item.title, name: null, custom: false })),
      ...this.#doc.custom.map((item) => ({ id: item.id, title: null, name: item.name, custom: true })),
    ];
  }

  layout(id: string): unknown {
    return this.#doc.layouts[id] ?? null;
  }

  setLayout(id: string, layout: unknown): void {
    this.#write({ ...this.#doc, layouts: { ...this.#doc.layouts, [id]: layout } });
  }

  setActive(id: string): void {
    if (this.has(id)) this.#write({ ...this.#doc, active: id });
  }

  /** Forget the layout of a workspace (its reset). */
  clearLayout(id: string): void {
    this.#write({ ...this.#doc, layouts: without(this.#doc.layouts, id) });
  }

  /** Add a workspace of the person with a layout; its ID. */
  add(name: string, layout: unknown): string {
    let index = 1;
    while (this.has(`custom-${String(index)}`)) index += 1;
    const id = `custom-${String(index)}`;
    const base = this.spec().id;
    this.#write({
      ...this.#doc,
      active: id,
      custom: [...this.#doc.custom, { id, name, base }],
      layouts: { ...this.#doc.layouts, [id]: layout },
    });
    return id;
  }

  rename(id: string, name: string): void {
    this.#write({
      ...this.#doc,
      custom: this.#doc.custom.map((item) => (item.id === id ? { ...item, name } : item)),
    });
  }

  /** Take out a workspace of the person (a built-in one stays); the active one becomes its base. */
  remove(id: string): void {
    const gone = this.#doc.custom.find((item) => item.id === id);
    if (gone === undefined) return;
    this.#write({
      ...this.#doc,
      active: this.#doc.active === id ? gone.base : this.#doc.active,
      custom: this.#doc.custom.filter((item) => item.id !== id),
      layouts: without(this.#doc.layouts, id),
    });
  }

  listen(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #write(doc: WorkspacesDoc): void {
    this.#doc = doc;
    this.#store.write(doc);
    this.#changed();
  }

  #changed(): void {
    for (const listener of this.#listeners) listener();
  }
}
