// SPDX-License-Identifier: Apache-2.0
/**
 * The start of the Game view: the panel `game.view` over the play mode of the page (its
 * handoff of the documents now). A start of the play mode brings the view to the front and gives it the documents of
 * the play mode.
 */
import type { StudioShell } from "../../studio/shell/shell";
import type { PagePlay } from "../play/pagePlay";
import type { ScenePageEditor } from "../sceneEditor";
import GameView from "./GameView.vue";
import { gameParams, type GameOptions } from "./gameView";

/** Give the Game view its panel. */
export function startGameView(
  shell: Pick<StudioShell, "setPanel" | "showPanel">,
  editor: ScenePageEditor,
  play: PagePlay,
): void {
  const listeners = new Set<() => void>();
  play.listen((active) => {
    if (!active) return;
    if (play.view === "game") shell.showPanel("game.view");
    for (const listener of listeners) listener();
  });
  shell.setPanel("game.view", {
    component: GameView,
    props: {
      url: (options: GameOptions) => play.handoffUrl(gameParams(options), options.camera),
      cameras: () =>
        Object.entries(editor.doc.entities)
          .filter(([, entity]) => entity.components.camera !== undefined)
          .map(([id, entity]) => ({ id, label: entity.name ?? id })),
      listen: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  });
}
