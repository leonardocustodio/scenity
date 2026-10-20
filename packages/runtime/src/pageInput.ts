// SPDX-License-Identifier: Apache-2.0
/**
 * The input of the play mode on a page. It changes the DOM events into the input events of the input maps of the
 * plugins (plugins/inputMap.ts). It sends them to the document core (`inputsOf` of documentClient.ts) and records
 * them. The scene page and the player use it.
 *
 * - The time of an event is the simulation time of the page clock at the DOM event, in whole ms. The core applies the
 *   event at the first system step at or after that time, so the wall time of the message does not change a frame.
 * - A key gives `press` at its first keydown (no key repeat) and `release` at its keyup. A key with Meta, Control or
 *   Alt, and a key in a text field, go to the page: the editor keys stay available. A key of the input map gets
 *   `preventDefault` in a capture listener. Thus the editor keys that skip a prevented event (the camera keys, the
 *   key map) do not act on it.
 * - A pointer press picks the entity under the pointer (the pick of the core). Each pointer action that matches the
 *   hit gives `press` with the entity and the world point. The pointerup gives `release`.
 * - The record keeps the events in the order of the core (`InputTrack`), so a replay of `recording()` gives the same
 *   steps. `replay` sends a recording and stops the live input.
 */
import { InputTrack, inputEvent, type InputEvent, type InputKind } from "@scenity/scene/input";
import { keyActions, pointerActions, type InputMap } from "./plugins/inputMap";
import type { PickHit } from "./protocol";

/** What the page input reads of its page. */
export interface PageInputOptions {
  /** The input maps of the plugins of the project. */
  readonly maps: readonly InputMap[];
  /** The simulation time of the page clock in ms, or null with no clock (then the input sends no event). */
  time(): number | null;
  /** The pick at a point of the canvas in CSS pixels. */
  pick(x: number, y: number): Promise<PickHit | null>;
  /** The component IDs of an entity of the current scene, or null for an unknown entity. */
  components(entity: string): readonly string[] | null;
  /** Send events to the core. `replace` removes the events that came before them. */
  send(events: readonly InputEvent[], replace: boolean): void;
}

/** The DOM targets of the input: the keys and the pointer. */
export interface PageInputTargets {
  readonly keys: EventTarget;
  readonly pointer: HTMLElement;
}

/** True for a text input, a text area or an element that the user can edit. */
function textTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)
    return true;
  return target instanceof HTMLInputElement && !["checkbox", "radio", "button", "range"].includes(target.type);
}

/** The listener options of the keys. */
const CAPTURE = { capture: true } as const;

/** The pointer actions of one press: the actions and the entity, when the pick is done. */
type PointerPress = Promise<{ readonly actions: readonly string[]; readonly entity: string | undefined }>;

export class PageInput {
  readonly #options: PageInputOptions;
  readonly #record = new InputTrack();
  readonly #keys = new Set<string>();
  readonly #presses = new Map<number, PointerPress>();
  #live = false;

  constructor(options: PageInputOptions) {
    this.#options = options;
  }

  /** The events of the session in the order of the core. */
  get events(): readonly InputEvent[] {
    return this.#record.events;
  }

  /** True while the DOM events give input events. */
  get live(): boolean {
    return this.#live;
  }

  /**
   * Start a live session: the record is empty, and the DOM events give events from this point. With `replace` (the
   * default), the core removes its events. Else it keeps the events of other sources (the embedding API of a player).
   */
  start(replace = true): void {
    this.#reset([], replace);
    this.#live = true;
  }

  /** Start a replay: the events of a recording go to the core and to the record. The DOM events give no event. */
  replay(events: readonly InputEvent[], replace = true): void {
    this.#reset(events, replace);
    this.#live = false;
  }

  /** Stop the session: the core removes the events. The record stays for `events`. */
  stop(): void {
    this.#live = false;
    this.#keys.clear();
    this.#presses.clear();
    this.#options.send([], true);
  }

  /** Listen to the DOM events of the targets. The result removes the listeners. */
  listen(targets: PageInputTargets): () => void {
    const down = (event: Event): void => {
      this.#keyDown(event as KeyboardEvent);
    };
    const up = (event: Event): void => {
      this.#keyUp((event as KeyboardEvent).code);
    };
    const press = (event: PointerEvent): void => {
      this.#pointerDown(event, targets.pointer);
    };
    const release = (event: PointerEvent): void => {
      this.#pointerUp(event.pointerId);
    };
    const blur = (): void => {
      for (const code of [...this.#keys]) this.#keyUp(code);
    };
    // The capture listeners run first: the editor keys see the prevented event of a key of the input map and skip it.
    targets.keys.addEventListener("keydown", down, CAPTURE);
    targets.keys.addEventListener("keyup", up, CAPTURE);
    targets.keys.addEventListener("blur", blur);
    targets.pointer.addEventListener("pointerdown", press);
    targets.pointer.addEventListener("pointerup", release);
    return () => {
      targets.keys.removeEventListener("keydown", down, CAPTURE);
      targets.keys.removeEventListener("keyup", up, CAPTURE);
      targets.keys.removeEventListener("blur", blur);
      targets.pointer.removeEventListener("pointerdown", press);
      targets.pointer.removeEventListener("pointerup", release);
    };
  }

  #reset(events: readonly InputEvent[], replace: boolean): void {
    this.#keys.clear();
    this.#presses.clear();
    this.#record.replace(events);
    if (replace || events.length > 0) this.#options.send(this.#record.events, replace);
  }

  /** Record events and send them to the core in the same order. */
  #emit(t: number, kind: InputKind, actions: readonly string[], at: Pick<InputEvent, "entity" | "point"> = {}): void {
    if (actions.length === 0) return;
    const events = actions.map((action) => inputEvent({ t, kind, action, ...at }));
    this.#record.add(events);
    this.#options.send(events, false);
  }

  #keyDown(event: KeyboardEvent): void {
    if (!this.#live || event.metaKey || event.ctrlKey || event.altKey || textTarget(event.target)) return;
    const actions = keyActions(this.#options.maps, event.code);
    if (actions.length === 0) return;
    // An arrow key or the space bar must not scroll the page in the play mode.
    event.preventDefault();
    const t = this.#options.time();
    if (event.repeat || this.#keys.has(event.code) || t === null) return;
    this.#keys.add(event.code);
    this.#emit(t, "press", actions);
  }

  #keyUp(code: string): void {
    if (!this.#keys.delete(code)) return;
    const t = this.#options.time();
    if (t !== null && this.#live) this.#emit(t, "release", keyActions(this.#options.maps, code));
  }

  #pointerDown(event: PointerEvent, element: HTMLElement): void {
    const t = this.#options.time();
    if (!this.#live || t === null) return;
    const box = element.getBoundingClientRect();
    const { button } = event;
    const press: PointerPress = this.#options.pick(event.clientX - box.left, event.clientY - box.top).then((hit) => {
      const components = hit === null ? null : this.#options.components(hit.entity);
      const actions = pointerActions(this.#options.maps, button, components);
      const at = hit === null ? {} : { entity: hit.entity, point: [...hit.point] as [number, number, number] };
      if (this.#live) this.#emit(t, "press", actions, at);
      return { actions, entity: hit?.entity };
    });
    this.#presses.set(event.pointerId, press);
  }

  #pointerUp(pointer: number): void {
    const press = this.#presses.get(pointer);
    const t = this.#options.time();
    this.#presses.delete(pointer);
    if (press === undefined || t === null) return;
    void press.then(({ actions, entity }) => {
      if (this.#live) this.#emit(t, "release", actions, entity === undefined ? {} : { entity });
    });
  }
}
