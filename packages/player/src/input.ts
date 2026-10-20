// SPDX-License-Identifier: Apache-2.0
/**
 * The input of the play mode in a player. With the `input` option, the keys on the canvas and the pointer give the
 * input events of the input maps of the project plugins (`PageInput` of `@scenity/runtime/pageInput`). The document
 * core applies them at the system steps. A recording in the option replays its events in place of the live input, so
 * the frames are the frames of the recorded session. `inputRecording()` of the player handle gives the events of the
 * session.
 *
 * This module wraps the deps of the player. The client of each renderer path gives its link and its canvas (a
 * fallback gets all the events again). The content gives the scene for the components of a hit. The session itself is
 * a lazy chunk (inputSession.ts) that loads after the first frame, so the player entry stays small.
 */
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { InputRecording } from "@scenity/scene/sequence";
import type { SceneLink } from "@scenity/runtime/client";
import type { DocumentCore } from "@scenity/runtime/documentCore";
import type { PlayerDeps } from "./deps";
import type { InputSession } from "./inputSession";
import type { Player, PlayerOptions } from "./types";

/**
 * Make a player with the input of the play mode when the options ask for it (`input: true`, or a recording), else the
 * player of `create` as it is. A plugin core (`core`) gets no input.
 */
export function withPlayerInput(
  options: PlayerOptions,
  deps: PlayerDeps,
  create: (deps: PlayerDeps) => Player,
): Player {
  const setting = options.input;
  if (setting === undefined || setting === false || options.core !== undefined) return create(deps);
  let link: SceneLink<DocumentCore> | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let scene: SceneDocument | null = null;
  let session: InputSession | null = null;
  const wrapped: PlayerDeps = {
    ...deps,
    content: async (...args) => {
      const content = await deps.content(...args);
      scene = content.scene;
      return content;
    },
    createClient: (target, client) => {
      canvas = target;
      session?.canvas(target);
      return deps.createClient(target, {
        ...client,
        link: (next) => {
          client.link?.(next);
          link = next;
          session?.link(next);
        },
      });
    },
  };
  const player = create(wrapped);
  player.on("ready", () => {
    const shown = scene;
    if (shown === null) return;
    void import("./inputSession")
      .then(({ startSession }) => startSession({ player, options, deps, scene: shown, link, canvas }))
      .then((started) => {
        session = started;
      });
  });
  const recording = (): InputRecording | null => session?.recording() ?? null;
  return Object.assign(player, { inputRecording: recording });
}
