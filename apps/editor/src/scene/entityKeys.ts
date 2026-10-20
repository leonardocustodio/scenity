// SPDX-License-Identifier: Apache-2.0
/**
 * The keys of the scene commands on the scene page in the edit mode. The key map of the page (settings/pageKeys.ts)
 * gives the keys; the default keys come from the command definitions of `@scenity/editor-core`:
 *
 * - ⌘D (Ctrl+D): `entity.duplicate` of the selected entities;
 * - Delete or Backspace: `entity.delete` of the selected entities (the references rule "clear");
 * - ⌘C (Ctrl+C): `entity.copy` of the selected entities; ⌘V (Ctrl+V): `entity.paste` at the scene root.
 *
 * The keys do nothing in a text field, in a drag of an entity or of a gizmo handle, and in the bottom dock (the key
 * context `scene` stops at the dock; the sequencer deletes its keys with Delete). A command that cannot run (⌘C with no
 * selected entity) does not stop the key, so the browser keeps its copy. A refused command writes its reason in
 * `data-entity-error` on the canvas and in the console.
 */
import type { SceneCommands } from "./hierarchy/sceneCommands";
import { pageKeys } from "./settings/pageKeys";

/** What the keys read of the page. */
export interface EntityKeyParts {
  readonly canvas: HTMLCanvasElement;
  readonly commands: SceneCommands;
  /** True while a drag of the scene channel runs. */
  live(): boolean;
}

/** Connect the scene commands to the keys of the page; the result disconnects them. */
export function listenEntityKeys(parts: EntityKeyParts): () => void {
  const { canvas, commands } = parts;
  return pageKeys().connectScene({
    definitions: () => commands.definitions().filter((command) => command.keys !== undefined),
    block: (id) => {
      const listing = commands.listings().find((item) => item.id === id);
      return listing === undefined ? `No command "${id}".` : listing.reason;
    },
    run: (id) => commands.run(id),
    listings: () => commands.listings(),
    execute: (id, args, options) => commands.run(id, args, options),
    mode: () => commands.mode(),
    busy: () => parts.live() || canvas.dataset.drag !== undefined || canvas.dataset.gizmoDrag !== undefined,
    done: (id, error) => {
      if (error === null) {
        delete canvas.dataset.entityError;
        return;
      }
      const reason = error instanceof Error ? error.message : JSON.stringify(error);
      canvas.dataset.entityError = reason;
      console.warn(`${id}: ${reason}`);
    },
  });
}
