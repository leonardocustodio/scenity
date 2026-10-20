// SPDX-License-Identifier: Apache-2.0
/**
 * The entry point of @scenity/player: the runtime with the documents of a project, with no editor and no dev code.
 *
 *     import { createPlayer } from "@scenity/player";
 *     const player = createPlayer(container, { project: "/projects/showroom/scenity.project.json", autoplay: true });
 *     player.on("ready", () => player.setCamera("front"));
 *
 * `@scenity/player/element` defines the web component `<scenity-player>`, and `@scenity/player/vue` has the Vue
 * component `ScenityPlayer`. `@scenity/player/light` has `createLightPlayer`, the player of a plugin core
 * with no document reader.
 */
import { browserDeps } from "./browser";
import { withPlayerInput } from "./input";
import { createPlayerWith } from "./player";
import type { Player, PlayerOptions } from "./types";

export type {
  Player,
  PlayerAudioState,
  PlayerBackend,
  PlayerEventName,
  PlayerEvents,
  PlayerInputEvent,
  PlayerInputProblem,
  PlayerInputResult,
  PlayerOptions,
  PlayerPick,
  PlayerPluginCore,
  PlayerState,
  TimedInputEvent,
} from "./types";

/** Make a player on a canvas, or on a container element where the player makes a canvas that fills it. */
export function createPlayer(target: HTMLCanvasElement | HTMLElement, options: PlayerOptions): Player {
  // The `input` option adds the input of the play mode (input.ts).
  return withPlayerInput(options, browserDeps(), (deps) => createPlayerWith(target, options, deps));
}
