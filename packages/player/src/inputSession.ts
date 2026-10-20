// SPDX-License-Identifier: Apache-2.0
/**
 * The input session of a player (input.ts): a lazy chunk that the player loads after its first frame, only with
 * the `input` option. It has the input maps of the plugins, the `PageInput` of `@scenity/runtime/pageInput` with its
 * DOM listeners on the canvas, the link of the events to the core and the recording.
 */
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { inputRecording, type InputRecording } from "@scenity/scene/sequence";
import type { SceneLink } from "@scenity/runtime/client";
import type { DocumentCore } from "@scenity/runtime/documentCore";
import { inputsOf } from "@scenity/runtime/documentClient";
import { PageInput } from "@scenity/runtime/pageInput";
import type { PlayerDeps } from "./deps";
import type { Player, PlayerOptions } from "./types";

/** The input session: a new link or canvas after a fallback, and the current recording. */
export interface InputSession {
  link(link: SceneLink<DocumentCore>): void;
  canvas(canvas: HTMLCanvasElement): void;
  recording(): InputRecording;
}

/** What the session reads of the player. */
export interface SessionParts {
  readonly player: Player;
  readonly options: PlayerOptions;
  readonly deps: PlayerDeps;
  readonly scene: SceneDocument;
  readonly link: SceneLink<DocumentCore> | null;
  readonly canvas: HTMLCanvasElement | null;
}

/** Listen to the keys and the pointer of a canvas. The canvas takes the focus at a press. */
function listenCanvas(input: PageInput, target: HTMLCanvasElement): () => void {
  if (target.tabIndex < 0) target.tabIndex = 0;
  const focus = (): void => {
    target.focus();
  };
  target.addEventListener("pointerdown", focus);
  const stop = input.listen({ keys: target, pointer: target });
  return () => {
    stop();
    target.removeEventListener("pointerdown", focus);
  };
}

/** Start the input session: a live input with `input: true`, else a replay of the recording of the option. */
export async function startSession(parts: SessionParts): Promise<InputSession> {
  const { player, options, scene } = parts;
  const plugins = await parts.deps.loadPlugins(options.plugins);
  const maps = plugins.flatMap((plugin) => (plugin.inputMap === undefined ? [] : [plugin.inputMap]));
  let send = parts.link === null ? null : inputsOf(parts.link);
  const input = new PageInput({
    maps,
    time: () => (player.duration > 0 ? player.time : null),
    pick: (x, y) => player.pick(x, y),
    components: (entity) => {
      const components = scene.entities[entity]?.components;
      return components === undefined ? null : Object.keys(components);
    },
    send: (events, replace) => send?.(events, replace),
  });
  // The core keeps the events of `send` of the embed API. The session adds its events and removes none.
  const setting = options.input;
  if (typeof setting === "object") input.replay(setting.events, false);
  else input.start(false);
  let unlisten = parts.canvas === null ? null : listenCanvas(input, parts.canvas);
  const sequence = typeof options.sequence === "object" && options.sequence !== null ? options.sequence.id : undefined;
  return {
    link: (link) => {
      send = inputsOf(link);
      // A new core after a fallback gets all the events of the session again (the player sends its own).
      send(input.events, false);
    },
    canvas: (canvas) => {
      unlisten?.();
      unlisten = listenCanvas(input, canvas);
    },
    // The events of the session and of `send`, in time order.
    recording: () =>
      inputRecording({ id: "player", scene: scene.id, sequence, events: [...input.events, ...player.events] }),
  };
}
