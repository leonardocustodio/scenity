// SPDX-License-Identifier: Apache-2.0
/**
 * The documents of a user in the browser storage: the editor settings of the user (`scenity.editor/1`), the key map of
 * the user (`scenity.keymap/1`) and the page layout of each project (the dock and the side panels). The settings and
 * the key map of a user are the same for each project, but each project has its own layout. Each storage call is in a
 * try block. A private window, a full storage or a blocked storage gives the defaults, and the page continues to
 * work. No DOM, no Vue.
 */
import { readEditorDocument, type EditorSettingsDocument, type KeymapDocument } from "@scenity/scene/schema/editor";
import type { DraftStorage } from "../sceneFile";

/** The storage keys of the documents of a user. */
export const USER_SETTINGS_KEY = "scenity.editor.user";
export const USER_KEYMAP_KEY = "scenity.keymap.user";

/** The storage key of the page layout of a project. */
export function pageLayoutKey(project: string): string {
  return `scenity.scene.layout.${project}`;
}

type Storage = Pick<DraftStorage, "getItem" | "setItem"> | null;

/** The text of a key, or null (no storage, no value, or a blocked storage). */
function readText(storage: Storage, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Write a text. False when the storage refuses it. */
function writeText(storage: Storage, key: string, text: string): boolean {
  try {
    if (storage === null) return false;
    storage.setItem(key, text);
    return true;
  } catch {
    return false;
  }
}

/** The editor settings of the user, or null (none, or a value that does not read). */
export function readUserSettings(storage: Storage): EditorSettingsDocument | null {
  const text = readText(storage, USER_SETTINGS_KEY);
  if (text === null) return null;
  const read = readEditorDocument(text, "editor");
  return read.ok ? read.doc : null;
}

/** The key map of the user, or null (none, or a value that does not read). */
export function readUserKeymap(storage: Storage): KeymapDocument | null {
  const text = readText(storage, USER_KEYMAP_KEY);
  if (text === null) return null;
  const read = readEditorDocument(text, "keymap");
  return read.ok ? read.doc : null;
}

export function writeUserSettings(storage: Storage, doc: EditorSettingsDocument): boolean {
  return writeText(storage, USER_SETTINGS_KEY, JSON.stringify(doc));
}

export function writeUserKeymap(storage: Storage, doc: KeymapDocument): boolean {
  return writeText(storage, USER_KEYMAP_KEY, JSON.stringify(doc));
}

/** The layout of the page of a project: the dock and the side panels. A missing value takes the default of the page. */
export interface PageLayout {
  /** The open tab of the bottom dock, its height (rem) and whether it is open. */
  readonly dockTab?: string;
  readonly dockHeight?: number;
  readonly dockOpen?: boolean;
  /** The widths of the side panels (CSS pixels) and whether they are open. */
  readonly leftWidth?: number;
  readonly rightWidth?: number;
  readonly leftOpen?: boolean;
  readonly rightOpen?: boolean;
}

const LAYOUT_TYPES: Readonly<Record<keyof PageLayout, "string" | "number" | "boolean">> = {
  dockTab: "string",
  dockHeight: "number",
  dockOpen: "boolean",
  leftWidth: "number",
  rightWidth: "number",
  leftOpen: "boolean",
  rightOpen: "boolean",
};

/** The fields of a stored value that have the correct type. A bad value gives an empty layout. */
export function readPageLayout(storage: Storage, project: string): PageLayout {
  const text = readText(storage, pageLayoutKey(project));
  let value: unknown;
  try {
    value = text === null ? {} : JSON.parse(text);
  } catch {
    return {};
  }
  if (typeof value !== "object" || value === null) return {};
  const out: Record<string, unknown> = {};
  for (const [key, type] of Object.entries(LAYOUT_TYPES)) {
    const item = (value as Record<string, unknown>)[key];
    if (typeof item === type && (type !== "number" || Number.isFinite(item))) out[key] = item;
  }
  return out;
}

export function writePageLayout(storage: Storage, project: string, layout: PageLayout): boolean {
  return writeText(storage, pageLayoutKey(project), JSON.stringify(layout));
}
