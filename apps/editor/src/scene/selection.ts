// SPDX-License-Identifier: Apache-2.0
/**
 * The selection of the scene page. `sel=<entity>[,<entity>…]` in the URL or `__scenity.select(ids)` selects entities,
 * and the core draws their outline with the outline value of the `environment` component (or its defaults). The
 * selection is a view value of the page, not a document value: it makes no op and no history step.
 */
import type { SceneLink } from "@scenity/runtime/client";
import type { DocumentCore } from "@scenity/runtime/documentCore";
import { selectionOf } from "@scenity/runtime/documentClient";

/** The selection part of the script API. */
export interface SelectionApi {
  /** Select entities by ID (null or an empty list: no selection) and wait for the frame that shows the outline. */
  select(ids: string | readonly string[] | null): Promise<void>;
  /** The selected entity IDs. */
  selection(): readonly string[];
}

/** The entity IDs of the `sel` parameter: a list with commas. */
export function selectionParam(value: string | null): string[] {
  if (value === null) return [];
  return value
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

/** The selection of the page over the link of its client. `link` goes to the `link` option of the client. */
export class PageSelection {
  #send: ((ids: readonly string[]) => void) | null = null;
  #ids: readonly string[] = [];
  readonly #listeners = new Set<(ids: readonly string[]) => void>();

  readonly link = (link: SceneLink<DocumentCore>): void => {
    this.#send = selectionOf(link);
  };

  /** The script API. `frame` waits for the next frame of the core. */
  api(frame: () => Promise<void>): SelectionApi {
    return {
      select: async (ids) => {
        this.set(ids === null ? [] : typeof ids === "string" ? [ids] : ids);
        await frame();
      },
      selection: () => this.#ids,
    };
  }

  /** The selected entity IDs. */
  get ids(): readonly string[] {
    return this.#ids;
  }

  /** Call `listener` after each new selection (the inspector follows it); the result stops it. */
  listen(listener: (ids: readonly string[]) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Send a new selection to the core. */
  set(ids: readonly string[]): void {
    if (this.#send === null) throw new Error("the client of the page has no link");
    this.#ids = [...ids];
    this.#send(this.#ids);
    for (const listener of this.#listeners) listener(this.#ids);
  }
}
