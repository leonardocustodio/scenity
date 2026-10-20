// SPDX-License-Identifier: Apache-2.0
/**
 * The clipboard of the scene page. `entity.copy` writes the copy here and `entity.paste` reads it. The browser storage
 * keeps one copy for all projects of the origin. Thus a copy in one scene pastes into another scene of the same or of
 * another project (also after a page load). The copy also goes to the system clipboard as JSON. A browser that blocks
 * the storage keeps the copy in the memory of the page. A stored value that does not read as a copy counts as an empty
 * clipboard.
 */
import type { ClipboardData } from "@scenity/editor-core";

/** The clipboard of the page. */
export interface PageClipboard {
  read(): ClipboardData | null;
  write(data: ClipboardData): void;
}

/** The storage key of the clipboard (one for every project of the origin). */
export function clipboardKey(): string {
  return "scenity.scene.clipboard";
}

/** The copy of a stored text, or null when the text is not a copy. */
export function parseClipboard(text: string | null): ClipboardData | null {
  if (text === null) return null;
  try {
    const value = JSON.parse(text) as Readonly<Record<string, unknown>> | null;
    if (value?.format !== "scenity.clipboard/1" || !Array.isArray(value.roots)) return null;
    if (typeof value.entities !== "object" || value.entities === null) return null;
    return value as unknown as ClipboardData;
  } catch {
    return null;
  }
}

/** The storage of the page, or null when the browser blocks it. */
function pageStorage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/** The clipboard of a project over the browser storage (default: the local storage of the page). */
export function pageClipboard(storage: Storage | null = pageStorage()): PageClipboard {
  const key = clipboardKey();
  let memory: ClipboardData | null = null;
  return {
    read() {
      try {
        return storage === null ? memory : (parseClipboard(storage.getItem(key)) ?? memory);
      } catch {
        return memory;
      }
    },
    write(data) {
      memory = data;
      // The system clipboard is a copy for other windows and apps; a browser that refuses it changes nothing.
      if (typeof navigator !== "undefined" && "clipboard" in navigator) {
        navigator.clipboard.writeText(JSON.stringify(data)).catch(() => undefined);
      }
      try {
        storage?.setItem(key, JSON.stringify(data));
      } catch {
        // The browser blocks the storage or it is full: the copy stays in the memory of the page.
      }
    },
  };
}
