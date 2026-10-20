// SPDX-License-Identifier: Apache-2.0
/**
 * The web component `<scenity-player>`: a player in any HTML page, with no
 * framework. The import defines the element once.
 *
 *     <script type="module">import "@scenity/player/element";</script>
 *     <scenity-player src="/projects/showroom/scenity.project.json" scene="scenes/main.scene.json" autoplay loop>
 *     </scenity-player>
 *
 * Attributes: `src` (the URL of `scenity.project.json`), `manifest` (the URL of a built asset manifest), `scene`,
 * `sequence` ("none": no sequence), `camera`, `backend` (auto, webgl, webgpu), `worker` ("false": the main thread),
 * `tier`, `start` (ms), `plugins` (the plugin set of the build), `poster` (an image URL, "none": no poster), and the
 * flags `autoplay`, `loop` (`loop="false"` disables the loop of the sequence), `muted`, `adaptive`
 * (`adaptive="false"` disables the quality ladder) and `input` (the input of the play mode). A change of `camera`
 * changes the camera. A change of another attribute starts the player again.
 *
 * The element sends each event of the player as a `CustomEvent` with the same name and the event detail (`ready`,
 * `play`, `pause`, `seek`, `timeupdate`, `ended`, `marker`, `event`, `camera`, `error`, `fallback`, `quality`,
 * `pick`, `points`, `time`). `data-state` on the element is the state of the player, `data-renderer` the path that
 * draws, `data-backend` the backend of the first frame and `data-fallback` the reason of the last fallback. The
 * `player` property gives the full API.
 *
 * The API for an embed: `setInput(plugin, input)`, `send(event)`, `watchPoints(refs)` and the `source` property (a
 * simulation source) go to the player. The element keeps the inputs, the source and the references, and gives them to
 * each new player after a restart. The `core` property sets a plugin core and starts the player again.
 */
import type { SimulationSource } from "@scenity/scene/sequence";
import { optionsOf, PLAYER_EVENTS } from "./attributes";
import { createPlayer } from "./index";
import type { Player, PlayerInputEvent, PlayerInputResult, PlayerPluginCore } from "./types";

const STYLE = `
:host { display: block; position: relative; aspect-ratio: 16 / 9; overflow: hidden; }
:host([hidden]) { display: none; }
.stage { position: absolute; inset: 0; }
`;

export class ScenityPlayerElement extends HTMLElement {
  static readonly observedAttributes = [
    "src",
    "manifest",
    "scene",
    "sequence",
    "camera",
    "backend",
    "worker",
    "tier",
    "start",
    "autoplay",
    "loop",
    "plugins",
    "muted",
    "poster",
    "adaptive",
    // The input of the play mode.
    "input",
  ];

  readonly #stage: HTMLDivElement;
  #player: Player | null = null;
  readonly #inputs = new Map<string, unknown>();
  #source: SimulationSource | null = null;
  #refs: readonly string[] = [];
  #core: PlayerPluginCore | null = null;
  #pending = false;
  #connected = false;

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(STYLE);
    root.adoptedStyleSheets = [sheet];
    this.#stage = document.createElement("div");
    this.#stage.className = "stage";
    this.#stage.setAttribute("part", "stage");
    root.append(this.#stage);
  }

  /** The player, or null while the element is not in a document. */
  get player(): Player | null {
    return this.#player;
  }

  /** Resolves after the first frame with every asset. */
  get ready(): Promise<void> {
    return this.#player?.ready ?? Promise.reject(new Error("the element is not in a document"));
  }

  get currentTime(): number {
    return this.#player?.time ?? 0;
  }

  get duration(): number {
    return this.#player?.duration ?? 0;
  }

  play(): void {
    this.#player?.play();
  }

  pause(): void {
    this.#player?.pause();
  }

  seek(ms: number): Promise<void> {
    return this.#player?.seek(ms) ?? Promise.resolve();
  }

  /** The input of a plugin. The element keeps it for a restart. */
  setInput(plugin: string, input: unknown): PlayerInputResult {
    const result = this.#player?.setInput(plugin, input) ?? { ok: true };
    if (result.ok) this.#inputs.set(plugin, input);
    return result;
  }

  /** An event for the plugin systems at the clock time. */
  send(event: PlayerInputEvent): PlayerInputResult {
    return this.#player?.send(event) ?? { ok: false, problems: [{ plugin: "", path: "", message: "no player" }] };
  }

  /** The references of the projected points of the `points` event. */
  watchPoints(refs: readonly string[]): void {
    this.#refs = [...refs];
    this.#player?.watchPoints(this.#refs);
  }

  /** The simulation source of the player (a recorded stream or a live engine). */
  get source(): SimulationSource | null {
    return this.#source;
  }

  set source(source: SimulationSource | null) {
    this.#source = source;
    this.#player?.setSource(source);
  }

  /** The plugin core of the player. A change starts the player again. */
  get core(): PlayerPluginCore | null {
    return this.#core;
  }

  set core(core: PlayerPluginCore | null) {
    this.#core = core;
    if (this.#connected) this.#restart();
  }

  connectedCallback(): void {
    this.#connected = true;
    this.#restart();
  }

  disconnectedCallback(): void {
    this.#connected = false;
    this.#stop();
  }

  attributeChangedCallback(name: string, before: string | null, after: string | null): void {
    // An upgrade gives a call for each attribute before connectedCallback, which starts the player once.
    if (before === after || !this.#connected) return;
    if (name === "camera" && this.#player?.state === "ready") {
      void this.#player.setCamera(after);
      return;
    }
    // Many attribute changes in one task start one player.
    if (this.#pending) return;
    this.#pending = true;
    queueMicrotask(() => {
      this.#pending = false;
      if (this.#connected) this.#restart();
    });
  }

  #restart(): void {
    this.#stop();
    if (!this.hasAttribute("src") && !this.hasAttribute("manifest")) return;
    const options = optionsOf(this);
    const player = createPlayer(this.#stage, this.#core === null ? options : { ...options, core: this.#core });
    this.#player = player;
    for (const [plugin, input] of this.#inputs) player.setInput(plugin, input);
    if (this.#source !== null) player.setSource(this.#source);
    if (this.#refs.length > 0) player.watchPoints(this.#refs);
    this.dataset.state = "loading";
    for (const name of PLAYER_EVENTS) {
      player.on(name, (detail) => {
        if (this.#player !== player) return;
        this.dataset.state = player.state;
        if (player.renderer !== null) this.dataset.renderer = player.renderer;
        if (name === "ready") this.dataset.backend = (detail as { backend: string }).backend;
        if (name === "fallback") this.dataset.fallback = (detail as { reason: string }).reason;
        this.dispatchEvent(new CustomEvent(name, { detail }));
      });
    }
  }

  #stop(): void {
    this.#player?.dispose();
    this.#player = null;
    delete this.dataset.state;
    delete this.dataset.renderer;
    delete this.dataset.backend;
    delete this.dataset.fallback;
  }
}

if (customElements.get("scenity-player") === undefined) {
  customElements.define("scenity-player", ScenityPlayerElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "scenity-player": ScenityPlayerElement;
  }
}
