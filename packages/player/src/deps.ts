// SPDX-License-Identifier: Apache-2.0
/**
 * The browser parts of a player as an interface, so a test gives fakes: the content reader,
 * the page time line, the fetch, the clocks, the document client, the worker, the plugins, the audio player, the
 * canvas, the poster and the timers. browser.ts gives the parts of the full player, light.ts the parts of a player of
 * a plugin core.
 */
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { InputEvent, SequenceDocument, SimulationPlugin } from "@scenity/scene/sequence";
import type { SceneLink } from "@scenity/runtime/client";
import type { DocumentCore } from "@scenity/runtime/documentCore";
import type { DocumentClient, DocumentClientOptions } from "@scenity/runtime/documentClient";
import type { BackendChoice } from "@scenity/runtime/backend";
import type { RuntimePlugin } from "@scenity/runtime/plugins";
import type { AudioFrame, SceneDecoders, Tier } from "@scenity/runtime/protocol";
import type { AudioClock, StartedSound } from "@scenity/runtime/audio";
import type { PosterView } from "./poster";
import type { PlayerContent, PlayerFetch } from "./project";
import type { TimelineLike } from "./timeline";
import type { PlayerInputEvent, PlayerInputResult, PlayerOptions, PlayerPick } from "./types";

/** The part of the audio player of `@scenity/runtime/audio` that the player uses. */
export interface PlayerAudio {
  readonly state: string;
  readonly started: readonly StartedSound[];
  frame(frame: AudioFrame): void;
  sync(): void;
  resume(): Promise<void>;
  dispose(): void;
}

/** What a loader of the content needs of the player. */
export interface LoadContext {
  /** A plugin core (the `core` option): it takes no documents. */
  readonly core: boolean;
  readonly decoders: SceneDecoders;
  /** The quality tier: the LOD tier of the asset files follows it. */
  readonly tier: Tier;
  /** The document camera to use (entity ID or name), or null for the first one. */
  readonly camera: string | null;
  /** The notes of the page time line. */
  readonly warnings: readonly string[];
  readonly timer: PlayerDeps["timer"];
  /** True when the player is disposed. */
  stopped(): boolean;
}

/** The browser parts of a player. */
export interface PlayerDeps {
  /** Read the content of the options (project.ts). The light player reads only a scene document (light.ts). */
  readonly content: (options: PlayerOptions, fetch: PlayerFetch, page: string) => Promise<PlayerContent>;
  /**
   * Give a new client the content and wait for its first frame with the assets. The result is the warnings of the
   * load. The full player loads documents (documents.ts) or waits for a plugin core (source.ts). The light player only
   * waits.
   */
  readonly load: (client: DocumentClient, content: PlayerContent, context: LoadContext) => Promise<string[]>;
  /** The page time line of a sequence (timeline.ts). */
  readonly timeline: (
    scene: SceneDocument,
    sequence: SequenceDocument,
    simulation: SimulationPlugin | null,
  ) => TimelineLike;
  readonly fetch: PlayerFetch;
  /** The URL that relative option URLs resolve against (the page). */
  readonly page: string;
  /** The wall clock in ms (`performance.now`). */
  readonly now: () => number;
  /** Call a function at the next animation frame; `cancelFrame` stops it. */
  readonly frame: (callback: () => void) => number;
  readonly cancelFrame: (handle: number) => void;
  readonly createClient: (canvas: HTMLCanvasElement, options: DocumentClientOptions) => Promise<DocumentClient>;
  /**
   * The input channel of a document client (`inputsOf` of `@scenity/runtime/documentClient`) for the events of
   * `send`, or absent for no events (the light player of a plugin core).
   */
  readonly inputLink?: (link: SceneLink<DocumentCore>) => (events: readonly InputEvent[], replace: boolean) => void;
  /**
   * Check an event of `send` and give it the time `t` (events.ts). When absent, the event gets its time with no check
   * (the light player: a plugin core checks its own events).
   */
  readonly checkEvent?: (event: PlayerInputEvent, t: number) => InputEvent | PlayerInputResult;
  /** The pick of a document core at a press (events.ts), or absent (a plugin core gives hits). */
  readonly pickAt?: (client: DocumentClient, x: number, y: number) => Promise<PlayerPick>;
  readonly canUseWorker: (canvas: HTMLCanvasElement) => boolean;
  /** The backend chooser of the runtime (the shared rule), for "auto". */
  readonly chooseBackend: () => Promise<BackendChoice>;
  /** The URL of the generic scene worker, or null for no worker. */
  readonly workerUrl: string | null;
  /** Load the project plugins of a set for a main-thread core (the worker loads the plugins of its build). */
  readonly loadPlugins: (set: string | undefined) => Promise<readonly RuntimePlugin[]>;
  readonly decoders: SceneDecoders;
  /** Make the audio player of the sounds of the content, or null for no sounds. */
  readonly createAudio: ((clock: () => AudioClock, content: PlayerContent) => PlayerAudio) | null;
  /** Make a canvas in a container. */
  readonly makeCanvas: (container: HTMLElement) => HTMLCanvasElement;
  /** Put a new canvas with the same attributes in the place of a canvas, after a renderer failure. */
  readonly replaceCanvas: (canvas: HTMLCanvasElement) => HTMLCanvasElement;
  /** The poster view of a canvas. `owned` is true when the player made the canvas in a container. */
  readonly poster: (canvas: HTMLCanvasElement, owned: boolean) => PosterView;
  /** Call a function after `ms`, and again each `ms` with `repeat`. The result stops it. */
  readonly timer: (callback: () => void, ms: number, repeat?: boolean) => () => void;
  readonly devicePixelRatio: () => number;
}

/** True for a canvas element (no `instanceof`: a test has no DOM). */
export function isCanvas(target: HTMLCanvasElement | HTMLElement): target is HTMLCanvasElement {
  return target.tagName === "CANVAS";
}

/** The deps with the client and the worker of a plugin core, or the deps as they are. */
export function coreDeps(deps: PlayerDeps, options: PlayerOptions): PlayerDeps {
  const core = options.core;
  if (core === undefined) return deps;
  return { ...deps, createClient: (canvas, client) => core.createClient(canvas, client), workerUrl: core.workerUrl };
}
