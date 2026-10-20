// SPDX-License-Identifier: Apache-2.0
/**
 * The types of the player: the options of `createPlayer`, the player handle and its events. The options include the
 * poster, the renderer fallbacks and the adaptive quality ladder. The embed API includes the plugin input, the events
 * for the plugin systems, the simulation source, the plugin core, and the `pick`, `points` and `time` events.
 */
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type {
  InputEvent,
  InputRecording,
  SequenceDocument,
  SimulationPlugin,
  SimulationSource,
} from "@scenity/scene/sequence";
import type { InputSchema, PickHit, ProjectedFrame, SceneDecoders, SceneStats, Tier } from "@scenity/runtime/protocol";
import type { StartedSound } from "@scenity/runtime/audio";
import type { DocumentClient, DocumentClientOptions } from "@scenity/runtime/documentClient";

/**
 * The backend of the player: "auto" asks the backend chooser of the runtime and uses the generic scene worker (WebGL)
 * when it can. "webgl" is the kill switch: the player makes no WebGPU call.
 */
export type PlayerBackend = "auto" | "webgl" | "webgpu";

/** A renderer path: the thread and the backend. */
export interface PlayerPath {
  readonly renderer: "worker" | "main";
  readonly backend: "webgl" | "webgpu";
}

/** One fallback step of the renderer. `to` is null when no backend is left: the player fails. */
export interface PlayerFallback {
  readonly from: PlayerPath;
  readonly to: PlayerPath | null;
  readonly reason: string;
}

/** The adaptive quality ladder: on or off, the tier of a live play, and the tiers from the best to the lowest. */
export interface PlayerQuality {
  readonly on: boolean;
  readonly tier: Tier;
  readonly tiers: readonly Tier[];
}

/**
 * The core of a project plugin that draws its own scene and takes no documents. The player uses its client in place
 * of the document client. The core gets the input of its plugin as it is, not the input map of the document core.
 */
export interface PlayerPluginCore {
  /** The plugin ID. `setInput(plugin, input)` and a source of this ID give the input of the core. */
  readonly plugin: string;
  /** The input schema of the plugin: `setInput` checks the input with it. */
  readonly input?: InputSchema<unknown>;
  /** The URL of the render worker of the core, or null for the main thread only. */
  readonly workerUrl: string | null;
  /** Make the client of the core on a canvas. The options are the options of a document client. */
  createClient(canvas: HTMLCanvasElement, options: DocumentClientOptions): Promise<DocumentClient>;
  /**
   * The reference of a projected point of the core (the ID of the point in its "anchors" frames). Default:
   * `entity:<id>`. A null result drops the point.
   */
  refOf?(id: string): string | null;
  /**
   * Give the core the input events of `send` (input events of the play mode at their clock times). `replace` removes
   * the events before them. Absent: the core takes no events, and `send` refuses them.
   */
  sendEvents?(client: DocumentClient, events: readonly InputEvent[], replace: boolean): void;
}

/**
 * An event for the plugin systems (`player.send`): an input event of the play mode (`InputEvent` of
 * `@scenity/scene/sequence`) with no time. The player gives it the clock time, and the document core gives it to the
 * systems at the first system step at or after that time (`ctx.inputs`), so a replay gets the same frames.
 */
export type PlayerInputEvent = Omit<InputEvent, "t">;

/** An event of `send` with its clock time. */
export type TimedInputEvent = InputEvent;

/** One problem of a plugin input or an event: the plugin ID, the JSON Pointer and the message. */
export interface PlayerInputProblem {
  readonly plugin: string;
  readonly path: string;
  readonly message: string;
}

/** The result of `setInput` and `send`. A refused value changes nothing. */
export type PlayerInputResult =
  { readonly ok: true } | { readonly ok: false; readonly problems: readonly PlayerInputProblem[] };

/** The detail of the `pick` event. */
export interface PlayerPick {
  /** The point of the press on the canvas in CSS pixels. */
  readonly x: number;
  readonly y: number;
  /** The ID of the entity under the press, or null. */
  readonly entity: string | null;
  /** The sub-target of the entity (`entity:<id>#<sub>` without the entity part), or null. */
  readonly sub: string | null;
  /** The world point of the hit in metres, or null when the core does not give one (a plugin core). */
  readonly point: readonly [number, number, number] | null;
}

export interface PlayerOptions {
  /**
   * The URL of `scenity.project.json`. The paths of `scene` and `sequence` are relative to its folder, and the
   * player reads the asset manifest of the project build (`build.assets.output`, default "build").
   */
  readonly project?: string;
  /**
   * The URL of a built asset manifest (Manifest 2). It replaces the manifest of the project. Without `project`, the
   * paths of `scene` and `sequence` are relative to the page.
   */
  readonly manifestUrl?: string;
  /** The scene: a path, or a document. Default: the first scene of the project. */
  readonly scene?: string | SceneDocument;
  /**
   * The sequence over the scene: a path, or a document. Null: no sequence. Default: the first sequence of the project
   * for the scene (its `scene` field is the ID of the scene document).
   */
  readonly sequence?: string | SequenceDocument | null;
  /**
   * A simulation plugin (`defineSimulation` of `@scenity/scene/sequence`). The player replays its action keys with
   * the evaluator and sends its `project` output to the core as the plugin input. It needs a sequence.
   */
  readonly simulation?: SimulationPlugin;
  /** Default "auto". */
  readonly backend?: PlayerBackend;
  /** Use the render worker when the browser can run it. Default true. */
  readonly worker?: boolean;
  /** The quality tier. Default "high". */
  readonly tier?: Tier;
  /** Play the sequence when the first frame is ready. Default false. */
  readonly autoplay?: boolean;
  /** Play the sequence again from 0 at its end. Default: the `loop` field of the sequence. */
  readonly loop?: boolean;
  /** The document camera (entity ID or name). Default: the first camera of the scene. */
  readonly camera?: string;
  /** Play the sounds of the audio tracks. Default true. */
  readonly audio?: boolean;
  /** The time of the first frame in ms. Default 0. */
  readonly start?: number;
  /**
   * The name of the plugin set in the plugin module of the build. `scenity build` has the plugins of one
   * project and ignores it. The scene server of the editor serves many projects: the name of the project picks its
   * plugins there. Default: none.
   */
  readonly plugins?: string;
  /** The URLs of the WASM decoders. Default: the decoders of the player build. */
  readonly decoders?: SceneDecoders;
  /**
   * The poster image until the first frame (a URL relative to the scene file), or null for no poster.
   * Default: the `poster` field of the scene document.
   */
  readonly poster?: string | null;
  /** The adaptive quality ladder in a live play. Default true. */
  readonly adaptive?: boolean;
  /** The core of a project plugin that draws its own scene, in place of the document core. */
  readonly core?: PlayerPluginCore;
  /** The input schemas of the plugins, by plugin ID. `setInput` checks the input of these plugins. */
  readonly schemas?: Readonly<Record<string, InputSchema<unknown>>>;
  /** The first simulation source (`setSource`). */
  readonly source?: SimulationSource;
  /**
   * The input of the play mode (input.ts). True: the keys on the canvas and the pointer give the input events
   * of the input maps of the project plugins. A recording (`scenity.input/1`): the player replays its events, with no
   * live input. Default: no input. A plugin core (`core`) gets no input events.
   */
  readonly input?: boolean | InputRecording;
}

/** The state of a player. */
export type PlayerState = "loading" | "ready" | "failed" | "disposed";

/** The events of a player and their details. */
export interface PlayerEvents {
  /** The first frame with every asset is drawn. */
  readonly ready: {
    readonly renderer: "worker" | "main";
    readonly backend: string;
    readonly warnings: readonly string[];
  };
  readonly play: { readonly t: number };
  readonly pause: { readonly t: number };
  /** A seek is done: the frame of the new time is drawn. */
  readonly seek: { readonly t: number };
  /** The clock time changed during a play (once per animation frame at most). */
  readonly timeupdate: { readonly t: number };
  /** The clock came to the end of a sequence with no loop. */
  readonly ended: { readonly t: number };
  /** The clock went past a marker of the sequence during a play. */
  readonly marker: { readonly name: string; readonly t: number };
  /** The clock went past an event key of the sequence during a play. */
  readonly event: {
    readonly name: string;
    readonly t: number;
    readonly entity: string | undefined;
    readonly args: Readonly<Record<string, unknown>> | undefined;
  };
  readonly camera: { readonly name: string | null };
  /** The load or the renderer failed. */
  readonly error: { readonly reason: string };
  /** The renderer failed and the player goes to the next path (or to the error state: `to` is null). */
  readonly fallback: PlayerFallback;
  /** The adaptive quality ladder stepped the tier in a live play. */
  readonly quality: { readonly tier: Tier; readonly from: Tier; readonly workP95: number };
  /** A press on the canvas, with the entity under it. */
  readonly pick: PlayerPick;
  /**
   * The screen points of the references of `watchPoints` (the ID of each point is its reference), after a
   * frame that moved one of them. The points are in CSS pixels of the canvas.
   */
  readonly points: ProjectedFrame;
  /** The clock time that the player gives the core: each play step, seek, play, pause and source push. */
  readonly time: { readonly t: number; readonly playing: boolean };
}

export type PlayerEventName = keyof PlayerEvents;

/** The sounds of a player: the state of the audio context and the starts of the voices, oldest first. */
export interface PlayerAudioState {
  /** "none" before the first sound, "suspended" until a user gesture, then "running"; "closed" after `dispose`. */
  readonly state: string;
  readonly started: readonly StartedSound[];
}

/** The handle of a player. */
export interface Player {
  /** Resolves after the first frame with every asset; rejects when the load fails. */
  readonly ready: Promise<void>;
  readonly state: PlayerState;
  /** The time of the clock in ms (0 with no sequence). */
  readonly time: number;
  /** The duration of the sequence in ms (0 with no sequence). */
  readonly duration: number;
  readonly playing: boolean;
  /** The sounds, or null with no audio. */
  readonly audio: PlayerAudioState | null;
  /** The path that draws ("worker" or "main"), or null before the client starts. */
  readonly renderer: "worker" | "main" | null;
  /** The fallback steps of the renderer, oldest first. */
  readonly fallbacks: readonly PlayerFallback[];
  /** The adaptive quality ladder, or null before the content loads. */
  readonly quality: PlayerQuality | null;
  /**
   * A test hook of the e2e tests: `ms` replaces each frame work p95 that the quality ladder measures. Null measures
   * again. It changes no frame of a stopped clock.
   */
  simulateFrameWork(ms: number | null): void;
  /** With the `input` option, the current input recording of the session (null before the first frame). */
  inputRecording?(): InputRecording | null;
  /** Play from the clock time (from 0 at the end of a sequence with no loop). */
  play(): void;
  pause(): void;
  /** Stand at a time (ms) and wait for its frame. */
  seek(ms: number): Promise<void>;
  /** Listen to an event; the result removes the listener. */
  on<E extends PlayerEventName>(event: E, listener: (detail: PlayerEvents[E]) => void): () => void;
  /** Draw with a document camera (entity ID or name; null: the first one). False when the scene has no such camera. */
  setCamera(name: string | null): Promise<boolean>;
  /** The IDs of the camera entities of the scene, sorted. */
  cameras(): string[];
  /** The entity under a point of the canvas (CSS pixels), or null. */
  pick(x: number, y: number): Promise<PickHit | null>;
  /** The frame statistics of the renderer. */
  stats(): Promise<SceneStats>;
  /**
   * Set the input of a plugin (null or undefined: no input). The schema of the plugin checks it (the
   * `schemas` option, or the schema of the plugin core). A refused input keeps the input before it.
   */
  setInput(plugin: string, input: unknown): PlayerInputResult;
  /** Send an event to the plugin systems at the clock time. */
  send(event: PlayerInputEvent): PlayerInputResult;
  /** The events of `send`, oldest first. */
  readonly events: readonly TimedInputEvent[];
  /**
   * The source of the state of a simulation plugin: a recorded stream or a live engine; null removes it. The
   * core gets `inputAt(t)` of the source as the input of its plugin. With no sequence, a recorded source gives the time
   * line (its duration), and a live source moves the clock to the time of each push.
   */
  setSource(source: SimulationSource | null): void;
  readonly source: SimulationSource | null;
  /** The references of the projected points of the `points` event (`entity:<id>`, `entity:<id>#<sub>`). */
  watchPoints(refs: readonly string[]): void;
  /** Stop the renderer, the clock and the sounds; a canvas that the player made goes out of the container. */
  dispose(): void;
}
