// SPDX-License-Identifier: Apache-2.0
/**
 * The embed state of a player: what the page gives the core and what the core gives the page. The module has no DOM
 * code and no import of a value, so a test can use it alone.
 *
 * - The plugin input: `setInput(plugin, input)` keeps the input of each plugin; the schema of the plugin checks it.
 *   The source of a simulation (`setSource`) gives the input of its plugin at the clock time, and a simulation plugin
 *   of the options gives its `project` output. A later part replaces an earlier one: page input, source, simulation.
 * - The input message: a document core gets the input map by plugin ID; a plugin core gets the input of its own
 *   plugin as it is.
 * - The events for the plugin systems (`send`): the log of the input events of the play mode at their clock
 *   times. The check of an event and the pick of a document core are parts of the full player (events.ts).
 * - The projected points (`watchPoints`): the references go to a document core (`setPoints`); the frames of a plugin
 *   core have its own point IDs, which `refOf` of the core turns into references.
 */
import type { InputEvent, SimulationSource } from "@scenity/scene/sequence";
import type { InputSchema, ProjectedFrame } from "@scenity/runtime/protocol";
import type { PlayerInputProblem, PlayerInputResult, PlayerPick, PlayerPluginCore } from "./types";

/** No state of the source yet: the next state is a change. */
const NONE: unique symbol = Symbol("none");

/** The input of a simulation plugin of the options at a time. */
export interface SimulationInput {
  readonly id: string;
  readonly value: unknown;
}

/** The input message of a time, and whether it differs from the last message. */
export interface InputMessage {
  readonly value: unknown;
  readonly changed: boolean;
}

function ok(): PlayerInputResult {
  return { ok: true };
}

function refused(plugin: string, path: string, message: string): PlayerInputResult {
  return { ok: false, problems: [{ plugin, path, message }] };
}

/** The JSON Pointer of a path of a schema issue. */
function pointer(path: readonly PropertyKey[]): string {
  return path.map((part) => `/${String(part).replace(/~/g, "~0").replace(/\//g, "~1")}`).join("");
}

export class PlayerEmbed {
  readonly #core: PlayerPluginCore | null;
  readonly #schemas: Readonly<Record<string, InputSchema<unknown>>>;
  readonly #inputs = new Map<string, unknown>();
  readonly #events: InputEvent[] = [];
  #source: SimulationSource | null = null;
  /** The state of the source at the last message, and its input: a new state object is a change. */
  #state: unknown = NONE;
  #sourceInput: unknown = undefined;
  #refs: readonly string[] = [];
  /** The last press on the canvas: the hit of a plugin core comes later and has no point. */
  #pressAt: readonly [number, number] | null = null;
  /** The last frame of projected points of the core: a new list of references reads it again. */
  #frame: ProjectedFrame | null = null;
  #dirty = true;

  constructor(core: PlayerPluginCore | null, schemas: Readonly<Record<string, InputSchema<unknown>>> = {}) {
    this.#core = core;
    const own = core?.input === undefined ? {} : { [core.plugin]: core.input };
    this.#schemas = { ...schemas, ...own };
  }

  get core(): PlayerPluginCore | null {
    return this.#core;
  }

  get source(): SimulationSource | null {
    return this.#source;
  }

  get events(): readonly InputEvent[] {
    return this.#events;
  }

  get refs(): readonly string[] {
    return this.#refs;
  }

  /** Keep the input of a plugin when its schema passes it; null or undefined removes it. */
  setInput(plugin: string, input: unknown): PlayerInputResult {
    // A page with no types (the web component) can give any value: the checks read it as unknown.
    const id: unknown = plugin;
    if (typeof id !== "string" || id.length === 0) return refused("", "", "no plugin ID");
    if (input === null || input === undefined) {
      this.#dirty ||= this.#inputs.delete(plugin);
      return ok();
    }
    const schema = this.#schemas[plugin];
    if (schema !== undefined) {
      const parsed = schema.safeParse(input);
      if (!parsed.success) {
        const problems: PlayerInputProblem[] = parsed.error.issues.map((issue) => ({
          plugin,
          path: pointer(issue.path),
          message: issue.message,
        }));
        return { ok: false, problems };
      }
      this.#inputs.set(plugin, parsed.data);
    } else {
      this.#inputs.set(plugin, input);
    }
    this.#dirty = true;
    return ok();
  }

  /** Add a checked event to the log. */
  log(event: InputEvent): void {
    this.#events.push(event);
  }

  setSource(source: SimulationSource | null): void {
    this.#source = source;
    this.#state = NONE;
    this.#sourceInput = undefined;
    this.#dirty = true;
  }

  /** Set the watched references; true when they changed. */
  watch(refs: readonly string[]): boolean {
    const next = [...new Set(refs.filter((ref) => typeof ref === "string" && ref.length > 0))];
    const same = next.length === this.#refs.length && next.every((ref, index) => ref === this.#refs[index]);
    this.#refs = next;
    return !same;
  }

  /** The input message at the time `t`. `simulation` is the input of the simulation plugin of the options. */
  message(t: number, simulation: SimulationInput | null): InputMessage {
    const sourceChanged = this.#readSource(t);
    const changed = this.#dirty || sourceChanged || simulation !== null;
    this.#dirty = false;
    const parts = new Map(this.#inputs);
    const source = this.#source;
    if (source !== null && this.#sourceInput !== undefined) parts.set(source.id, this.#sourceInput);
    if (simulation?.value !== undefined) parts.set(simulation.id, simulation.value);
    const core = this.#core;
    if (core !== null) return { value: parts.get(core.plugin), changed };
    if (parts.size === 0) return { value: null, changed };
    return { value: Object.fromEntries([...parts].sort(([a], [b]) => a.localeCompare(b))), changed };
  }

  /**
   * The points of the watched references in a frame of the core (default: the last frame), or null when the page
   * watches none or the core sent no frame yet.
   */
  points(next: ProjectedFrame | null = this.#frame): ProjectedFrame | null {
    this.#frame = next;
    const frame = next;
    if (frame === null || this.#refs.length === 0) return null;
    const watched = new Set(this.#refs);
    const core = this.#core;
    const refOf = (id: string): string | null => (core === null ? id : (core.refOf?.(id) ?? `entity:${id}`));
    const points = frame.points.flatMap((point) => {
      const ref = refOf(point.id);
      return ref !== null && watched.has(ref) ? [{ ...point, id: ref }] : [];
    });
    return { ...frame, points };
  }

  /** A press on the canvas (CSS pixels): the hit of a plugin core comes later and has no point. */
  pressed(x: number, y: number): void {
    this.#pressAt = [x, y];
  }

  /** The pick of the hit of a plugin core at the last press, or null with no press: the ID goes through `refOf`. */
  pickOfCore(id: string | null): PlayerPick | null {
    const at = this.#pressAt;
    if (at === null) return null;
    const core = this.#core;
    const ref = id === null || core === null ? null : (core.refOf?.(id) ?? `entity:${id}`);
    const body = ref?.startsWith("entity:") === true ? ref.slice("entity:".length) : null;
    const cut = body === null ? -1 : body.indexOf("#");
    const entity = body === null ? null : cut < 0 ? body : body.slice(0, cut);
    const sub = body === null || cut < 0 ? null : body.slice(cut + 1);
    return { x: at[0], y: at[1], entity, sub, point: null };
  }

  /** Read the source at `t`; true when its state is a new object (a recorded sample or a live push). */
  #readSource(t: number): boolean {
    const source = this.#source;
    if (source === null) return false;
    const state = source.stateAt(t);
    if (state === this.#state) return false;
    this.#state = state;
    this.#sourceInput = state === undefined ? undefined : source.inputAt(t);
    return true;
  }
}
