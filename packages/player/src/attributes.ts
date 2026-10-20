// SPDX-License-Identifier: Apache-2.0
/**
 * The attributes of the web component `<scenity-player>`: the player options of the attributes of an element, and
 * the names of the events that the element and the Vue component send again. The module has no DOM code, so a test
 * can import it.
 */
import type { PlayerEventName, PlayerOptions } from "./types";

/** The events of a player, in the order of the documentation. */
export const PLAYER_EVENTS: readonly PlayerEventName[] = [
  "ready",
  "play",
  "pause",
  "seek",
  "timeupdate",
  "ended",
  "marker",
  "event",
  "camera",
  "error",
  // A renderer fallback, and a step of the adaptive quality ladder.
  "fallback",
  "quality",
  // A press on the canvas, the projected points of the watched references, and the clock time.
  "pick",
  "points",
  "time",
];

const TIERS: readonly string[] = ["ultra", "high", "medium", "low"];
const BACKENDS: readonly string[] = ["auto", "webgl", "webgpu"];

/** The player options of the attributes of an element. */
export function optionsOf(element: Pick<Element, "getAttribute" | "hasAttribute">): PlayerOptions {
  const text = (name: string): string | undefined => element.getAttribute(name) ?? undefined;
  const flag = (name: string): boolean | undefined =>
    element.hasAttribute(name) ? element.getAttribute(name) !== "false" : undefined;
  const sequence = text("sequence");
  const tier = text("tier");
  const backend = text("backend");
  const start = Number(text("start") ?? 0);
  const options: Record<string, unknown> = {
    project: text("src"),
    manifestUrl: text("manifest"),
    scene: text("scene"),
    sequence: sequence === "none" ? null : sequence,
    camera: text("camera"),
    backend: backend !== undefined && BACKENDS.includes(backend) ? backend : undefined,
    worker: flag("worker"),
    tier: tier !== undefined && TIERS.includes(tier) ? tier : undefined,
    autoplay: flag("autoplay"),
    loop: flag("loop"),
    audio: flag("muted") === true ? false : undefined,
    start: Number.isFinite(start) ? start : 0,
    plugins: text("plugins"),
    // `poster="none"` removes the poster of the scene. `adaptive="false"` disables the quality ladder.
    poster: text("poster") === "none" ? null : text("poster"),
    adaptive: flag("adaptive"),
    // `input` enables the input of the play mode (the keys on the canvas and the pointer).
    input: flag("input"),
  };
  // An absent attribute gives no option (exactOptionalPropertyTypes: no undefined values).
  const checked: PlayerOptions = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
  return checked;
}
