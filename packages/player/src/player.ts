// SPDX-License-Identifier: Apache-2.0
/**
 * The player: the document core of `@scenity/runtime` with the documents of a
 * project, a sequence or a simulation, the clock and the sounds. It has no editor and no dev code: the core is the
 * release document core (the generic scene worker, or the main-thread core of the backend), never the dev core of
 * `@scenity/runtime-dev`.
 *
 * - The content (project.ts): the scene, the sequence and the asset manifest, read and checked on the page and sent to
 *   the core in one "load" message.
 * - The plugins: the core runs the runtime faces of the project plugins of the build (their components,
 *   presenters, simulations and systems), in the worker and on the main thread.
 * - The renderer (renderer.ts, fallback.ts): the generic scene worker (WebGL) when the browser can run it, else the
 *   main-thread core. "webgpu" draws with the WebGPU core on the main thread: the generic scene worker is WebGL only.
 *   A failure moves from WebGPU to WebGL and from the worker to the main thread. The poster of the scene (poster.ts)
 *   shows until the first frame. The adaptive quality ladder (quality.ts) changes the tier in a live play.
 * - The time: the clock of the player (clock.ts) plays the sequence; the core draws the scene of the evaluator at the
 *   clock time. The page evaluator (timeline.ts) gives the markers, the event keys and the simulation input.
 * - The sounds: the audio frames of the core go to the audio player of `@scenity/runtime/audio`. A browser starts the
 *   audio context only after a user gesture: a pointer press on the canvas, a key press, or a call of `play()`.
 *
 * - The embed (embed.ts): the plugin input of the page (`setInput`), the events for the plugin systems
 *   (`send`), the source of a simulation (`setSource`, source.ts), the projected points (`watchPoints`, the `points`
 *   event), the `pick` event of a press on the canvas and the `time` event. A plugin core (the `core` option) draws a
 *   scene of its own with no documents: the player uses its client and sends it the input of its plugin.
 *
 * `createPlayerWith` takes the browser parts as `PlayerDeps`, so a test can give fakes. `createPlayer` (index.ts)
 * gives the real ones; `createLightPlayer` (light.ts) gives the parts of a plugin core with no document reader.
 */
import type { InputEvent, SimulationSource } from "@scenity/scene/sequence";
import type { DocumentClient } from "@scenity/runtime/documentClient";
import type { PickHit, SceneStats, Tier } from "@scenity/runtime/protocol";
import { PlayerClock } from "./clock";
import { coreDeps, isCanvas, type PlayerAudio, type PlayerDeps } from "./deps";
import { PlayerEmbed } from "./embed";
import { PlayerEmitter } from "./emitter";
import { posterUrl, type PosterView } from "./poster";
import type { PlayerContent } from "./project";
import { ladderTiers, QualityLadder } from "./quality";
import { PlayerRenderer, type BaseClientOptions, type RendererHost } from "./renderer";
import { clockOf, followLive } from "./source";
import type { TimelineLike } from "./timeline";
import type {
  Player,
  PlayerAudioState,
  PlayerEventName,
  PlayerEvents,
  PlayerFallback,
  PlayerInputEvent,
  PlayerInputResult,
  PlayerOptions,
  PlayerQuality,
  PlayerState,
} from "./types";

export type { PlayerAudio, PlayerDeps } from "./deps";

class ScenePlayer implements Player {
  readonly ready: Promise<void>;
  readonly #options: PlayerOptions;
  readonly #deps: PlayerDeps;
  readonly #emitter = new PlayerEmitter();
  readonly #embed: PlayerEmbed;
  /** Stop the listener of a live source. */
  #unfollow: (() => void) | null = null;
  /** Send input events through the channel of the client that draws at this time, or null. */
  #sendEvents: ((events: readonly InputEvent[], replace: boolean) => void) | null = null;
  #canvas: HTMLCanvasElement;
  readonly #ownsCanvas: boolean;
  readonly #renderer: PlayerRenderer;
  readonly #poster: PosterView;
  #quality: QualityLadder | null = null;
  /** The camera of the last `setCamera`: a new client after a fallback uses it. */
  #camera: string | null | undefined = undefined;
  #state: PlayerState = "loading";
  #client: DocumentClient | null = null;
  #content: PlayerContent | null = null;
  #clock: PlayerClock | null = null;
  #timeline: TimelineLike | null = null;
  #audio: PlayerAudio | null = null;
  #frame: number | null = null;
  /** The clock time of the last play step. */
  #since = 0;

  constructor(target: HTMLCanvasElement | HTMLElement, options: PlayerOptions, browser: PlayerDeps) {
    const deps = coreDeps(browser, options);
    this.#options = options;
    this.#deps = deps;
    this.#embed = new PlayerEmbed(options.core ?? null, options.schemas);
    if (options.source !== undefined) this.#embed.setSource(options.source);
    this.#ownsCanvas = !isCanvas(target);
    this.#canvas = isCanvas(target) ? target : deps.makeCanvas(target);
    this.#poster = deps.poster(this.#canvas, this.#ownsCanvas);
    this.#renderer = new PlayerRenderer(this.#canvas, deps, options, this.#rendererHost());
    // The ladder steps act only in a live play. A stopped clock draws at the tier of the options.
    this.#emitter.on("play", () => this.#quality?.play());
    this.#emitter.on("pause", () => this.#quality?.stop());
    this.ready = this.#start();
    // The promise is handled here, so a page that does not wait for it gets no unhandled rejection.
    this.ready.catch(() => undefined);
  }

  get state(): PlayerState {
    return this.#state;
  }

  get time(): number {
    return this.#clock?.now() ?? 0;
  }

  get duration(): number {
    return this.#clock?.duration ?? 0;
  }

  get playing(): boolean {
    return this.#clock?.playing ?? false;
  }

  get renderer(): "worker" | "main" | null {
    return this.#client?.mode ?? null;
  }

  get fallbacks(): readonly PlayerFallback[] {
    return this.#renderer.fallbacks;
  }

  get quality(): PlayerQuality | null {
    return this.#quality?.state ?? null;
  }

  simulateFrameWork(ms: number | null): void {
    this.#quality?.forceWork(ms);
  }

  get audio(): PlayerAudioState | null {
    const audio = this.#audio;
    return audio === null ? null : { state: audio.state, started: audio.started };
  }

  on<E extends PlayerEventName>(event: E, listener: (detail: PlayerEvents[E]) => void): () => void {
    return this.#emitter.on(event, listener);
  }

  play(): void {
    const clock = this.#clock;
    void this.#audio?.resume();
    if (clock === null || clock.playing || this.#state !== "ready") return;
    clock.play();
    this.#since = clock.now();
    this.#sendClock();
    this.#emitter.emit("play", { t: this.#since });
    this.#schedule();
  }

  pause(): void {
    const clock = this.#clock;
    if (!clock?.playing) return;
    clock.pause();
    this.#stopFrames();
    this.#sendClock();
    this.#emitter.emit("pause", { t: clock.now() });
  }

  async seek(ms: number): Promise<void> {
    const clock = this.#clock;
    if (clock === null) return;
    const wasPlaying = clock.playing;
    clock.seek(ms);
    this.#stopFrames();
    this.#sendClock();
    if (wasPlaying) this.#emitter.emit("pause", { t: clock.now() });
    await this.#client?.patch([]);
    this.#emitter.emit("seek", { t: clock.now() });
  }

  async setCamera(name: string | null): Promise<boolean> {
    const found = (await this.#client?.useCamera(name)) ?? false;
    if (found) this.#camera = name;
    if (found) this.#emitter.emit("camera", { name });
    return found;
  }

  cameras(): string[] {
    const entities = this.#content?.scene.entities ?? {};
    return Object.keys(entities)
      .filter((id) => entities[id]?.components.camera !== undefined)
      .sort();
  }

  pick(x: number, y: number): Promise<PickHit | null> {
    return this.#client?.pickEntity(x, y) ?? Promise.resolve(null);
  }

  get events(): readonly InputEvent[] {
    return this.#embed.events;
  }

  get source(): SimulationSource | null {
    return this.#embed.source;
  }

  setInput(plugin: string, input: unknown): PlayerInputResult {
    const result = this.#embed.setInput(plugin, input);
    if (result.ok) this.#sendInput(false);
    return result;
  }

  send(event: PlayerInputEvent): PlayerInputResult {
    const core = this.#options.core;
    if (core !== undefined && core.sendEvents === undefined) {
      return { ok: false, problems: [{ plugin: core.plugin, path: "", message: "the plugin core takes no events" }] };
    }
    const check = this.#deps.checkEvent;
    const timed = check === undefined ? { ...event, t: Math.max(0, Math.round(this.time)) } : check(event, this.time);
    if ("ok" in timed) return timed;
    this.#embed.log(timed);
    this.#sendEvents?.([timed], false);
    return { ok: true };
  }

  setSource(source: SimulationSource | null): void {
    this.#embed.setSource(source);
    if (this.#content !== null) this.#useSource();
    this.#sendInput(false);
  }

  watchPoints(refs: readonly string[]): void {
    if (!this.#embed.watch(refs)) return;
    if (this.#options.core === undefined) this.#client?.setPoints(this.#embed.refs);
    // A plugin core sends a frame only when a point moves: the last frame gives the points of the new references.
    const points = this.#embed.points();
    if (points !== null) this.#emitter.emit("points", points);
  }

  stats(): Promise<SceneStats> {
    const client = this.#client;
    if (client === null) return Promise.reject(new Error("the player has no renderer yet"));
    return client.stats();
  }

  dispose(): void {
    if (this.#state === "disposed") return;
    this.#state = "disposed";
    this.#stopFrames();
    this.#unfollow?.();
    this.#quality?.dispose();
    this.#renderer.dispose();
    this.#client = null;
    this.#poster.dispose();
    this.#audio?.dispose();
    this.#audio = null;
    this.#emitter.clear();
    if (this.#ownsCanvas) this.#canvas.remove();
  }

  /** Load the content, start the client, draw the first frame with every asset. */
  async #start(): Promise<void> {
    try {
      const content = await this.#deps.content(this.#options, this.#deps.fetch, this.#deps.page);
      if (this.#state === "disposed") return;
      this.#content = content;
      this.#useContent(content);
      const warnings = await this.#renderer.start();
      const client = this.#client;
      if (warnings === null || client === null || this.#state !== "loading") return;
      this.#state = "ready";
      this.#poster.hide();
      this.#quality?.start();
      const backend = (await client.stats()).backend ?? "webgl";
      this.#emitter.emit("ready", { renderer: client.mode, backend, warnings });
      if (this.#options.autoplay === true) this.play();
    } catch (error) {
      this.#fail(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /** The clock, the page evaluator and the audio player of the content. */
  #useContent(content: PlayerContent): void {
    const poster = posterUrl(this.#options, content.scene.poster, content.sceneUrl ?? this.#deps.page);
    if (poster !== null) this.#poster.show(poster);
    this.#quality = new QualityLadder({
      tiers: ladderTiers(this.#tier(), content.project?.quality?.tiers),
      on: this.#options.adaptive !== false,
      client: () => this.#client,
      playing: () => this.#clock?.playing === true && this.#state === "ready",
      step: (detail) => {
        this.#emitter.emit("quality", detail);
      },
      every: (callback, ms) => this.#deps.timer(callback, ms, true),
    });
    const { sequence } = content;
    if (sequence !== null) {
      const loop = sequence.loop === true;
      this.#clock = new PlayerClock(sequence.duration, loop, this.#options.start ?? 0, this.#deps.now);
      this.#since = this.#clock.now();
      this.#timeline = this.#deps.timeline(content.scene, sequence, this.#options.simulation ?? null);
    }
    this.#useSource();
    const make = this.#deps.createAudio;
    if (this.#options.audio === false || make === null) return;
    this.#audio = make(() => ({ t: this.#clock?.now() ?? null, playing: this.#clock?.playing ?? true }), content);
  }

  #tier(): Tier {
    return this.#options.tier ?? "high";
  }

  /** The parts of the player that the renderer uses (renderer.ts). */
  #rendererHost(): RendererHost {
    return {
      base: () => this.#clientOptions(),
      load: (client) => this.#load(client, this.#content),
      use: (client) => {
        this.#client = client;
        const refs = this.#embed.refs;
        if (client !== null && refs.length > 0 && this.#options.core === undefined) client.setPoints(refs);
        // A plugin core takes the events through its `sendEvents`. A new core gets each event of `send` (the
        // first core, and a new core after a fallback).
        const core = this.#options.core;
        if (client !== null && core?.sendEvents !== undefined) {
          this.#sendEvents = (events, replace) => core.sendEvents?.(client, events, replace);
        }
        if (client !== null && this.#embed.events.length > 0) this.#sendEvents?.(this.#embed.events, false);
      },
      press: (x, y) => {
        this.#press(x, y);
      },
      canvas: (canvas) => {
        this.#canvas = canvas;
        this.#poster.move(canvas);
      },
      fallback: (step) => {
        this.#emitter.emit("fallback", step);
      },
      fail: (reason) => {
        this.#fail(reason);
      },
      gesture: () => {
        void this.#audio?.resume();
      },
      stopped: () => this.#state === "disposed",
    };
  }

  /** The options of the document client that do not depend on the renderer plan. */
  #clientOptions(): BaseClientOptions {
    return {
      // The input channel of a document core for the events of `send` (none for a plugin core).
      link: (link) => {
        if (this.#options.core === undefined) this.#sendEvents = this.#deps.inputLink?.(link) ?? null;
      },
      getSimMs: () => this.#clock?.now() ?? null,
      getClockEpoch: () => this.#clock?.epoch ?? 0,
      // The core runs the project plugins. The worker loads the set of the `plugins` option.
      init: { plugins: this.#options.plugins ?? null },
      plugins: () => this.#deps.loadPlugins(this.#options.plugins),
      tier: this.#tier(),
      flags: { reducedMotion: false, paused: false, visible: true },
      onAudio: (frame) => this.#audio?.frame(frame),
      // The points of the watched references, and the hit of a press on a plugin core.
      onAnchors: (frame) => {
        const points = this.#embed.points(frame);
        if (points !== null) this.#emitter.emit("points", points);
      },
      onHit: (id, kind) => {
        const pick = kind === "down" ? this.#embed.pickOfCore(id) : null;
        if (pick !== null) this.#emitter.emit("pick", pick);
      },
    };
  }

  /** A press on the canvas (CSS pixels): the pick of the document core, or the pointer of a plugin core. */
  #press(x: number, y: number): void {
    const client = this.#client;
    if (client === null || this.#state !== "ready") return;
    this.#embed.pressed(x, y);
    // A plugin core answers with a hit (`onHit`); a document core with a pick (events.ts).
    if (this.#options.core !== undefined) client.pointer(x, y, "down");
    else
      void this.#deps.pickAt?.(client, x, y).then((pick) => {
        if (this.#client === client) this.#emitter.emit("pick", pick);
      });
  }

  /** The clock and the listener of the source (source.ts): a source with no sequence gives the time line. */
  #useSource(): void {
    this.#unfollow?.();
    this.#unfollow = null;
    const source = this.#embed.source;
    if (source === null || this.#content?.sequence != null) return;
    const clock = clockOf(source, this.#clock, this.#options, this.#deps.now);
    if (clock !== this.#clock) {
      this.#stopFrames();
      this.#clock = clock;
      this.#since = clock.now();
    }
    this.#unfollow = followLive(source, clock, () => {
      this.#since = clock.now();
      this.#sendClock();
      if (clock.playing && this.#frame === null && this.#state === "ready") this.#schedule();
    });
  }

  /** Send the input, then the content (the documents, or nothing for a plugin core); the warnings of the load. */
  #load(client: DocumentClient, content: PlayerContent | null): Promise<string[]> {
    if (content === null) return Promise.reject(new Error("the player has no content"));
    this.#sendInput(true, client);
    return this.#deps.load(client, content, {
      core: this.#options.core !== undefined,
      decoders: this.#options.decoders ?? this.#deps.decoders,
      tier: this.#tier(),
      camera: this.#camera === undefined ? (this.#options.camera ?? null) : this.#camera,
      warnings: this.#timeline?.warnings ?? [],
      timer: this.#deps.timer,
      stopped: () => this.#state === "disposed",
    });
  }

  /**
   * Send the clock to the core: the plugin input message carries the clock anchor of a new seek count. A plugin core
   * gets its input only when it changes: its client sends the clock anchors.
   */
  #sendClock(): void {
    this.#audio?.sync();
    this.#sendInput(this.#options.core === undefined);
    this.#emitter.emit("time", { t: this.time, playing: this.playing });
  }

  /** Send the input message of the clock time when it changed (or always with `force`). */
  #sendInput(force: boolean, client = this.#client): void {
    if (client === null) return;
    const t = this.time;
    const simulation = this.#options.simulation;
    const value = simulation === undefined ? undefined : this.#timeline?.input(t);
    const message = this.#embed.message(t, simulation === undefined ? null : { id: simulation.id, value });
    if ((force || message.changed) && message.value !== undefined) client.setInput(message.value);
  }

  #schedule(): void {
    this.#frame = this.#deps.frame(() => {
      this.#step();
    });
  }

  #stopFrames(): void {
    if (this.#frame !== null) this.#deps.cancelFrame(this.#frame);
    this.#frame = null;
  }

  /** One play step at an animation frame: the time, the markers, the event keys, the simulation input, the end. */
  #step(): void {
    this.#frame = null;
    const clock = this.#clock;
    if (clock === null || !clock.playing || this.#state !== "ready") return;
    const t = clock.now();
    if (t !== this.#since) {
      for (const item of this.#timeline?.crossed(this.#since, t) ?? []) {
        if (item.kind === "marker") this.#emitter.emit("marker", { name: item.name, t: item.t });
        else this.#emitter.emit("event", { name: item.name, t: item.t, entity: item.entity, args: item.args });
      }
      this.#since = t;
      this.#sendInput(false);
      this.#emitter.emit("timeupdate", { t });
      this.#emitter.emit("time", { t, playing: true });
    }
    if (clock.atEnd()) {
      clock.seek(clock.duration);
      this.#sendClock();
      this.#emitter.emit("pause", { t: clock.duration });
      this.#emitter.emit("ended", { t: clock.duration });
      return;
    }
    this.#schedule();
  }

  #fail(reason: string): void {
    if (this.#state === "disposed" || this.#state === "failed") return;
    this.#state = "failed";
    this.#stopFrames();
    this.#poster.fail(reason);
    this.#emitter.emit("error", { reason });
  }
}

/** Make a player on a canvas, or on a container element where the player makes its own canvas. */
export function createPlayerWith(
  target: HTMLCanvasElement | HTMLElement,
  options: PlayerOptions,
  deps: PlayerDeps,
): Player {
  return new ScenePlayer(target, options, deps);
}
