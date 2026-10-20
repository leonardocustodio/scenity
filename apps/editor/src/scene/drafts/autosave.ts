// SPDX-License-Identifier: Apache-2.0
/**
 * The autosave of a project. When the project setting `autosave.enabled` is true, the editor saves the open scene after
 * `autosave.seconds` with no edit. A save that waits for the owner (a conflict, a block rule) shows its notice as a
 * press of Save does. The play mode never saves.
 */
import type { EditorSettings } from "@scenity/editor-core";

/** The parts of the editor that the autosave uses. */
export interface AutosaveParts {
  /** Call `listener` after each change of the document; the result stops it. */
  listen(listener: () => void): () => void;
  readonly dirty: boolean;
  /** True while the play mode runs. */
  playing(): boolean;
  save(): Promise<unknown>;
  /** The settings now, and a listener of their changes. */
  settings(): EditorSettings;
  listenSettings(listener: () => void): () => void;
}

/** Start the autosave; the result stops it. */
export function startAutosave(parts: AutosaveParts): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (): void => {
    clearTimeout(timer);
    const { enabled, seconds } = parts.settings().autosave;
    if (!enabled || !parts.dirty) return;
    timer = setTimeout(() => {
      if (parts.dirty && !parts.playing()) void parts.save();
    }, seconds * 1000);
  };
  const stops = [parts.listen(arm), parts.listenSettings(arm)];
  arm();
  return () => {
    clearTimeout(timer);
    for (const stop of stops) stop();
  };
}
