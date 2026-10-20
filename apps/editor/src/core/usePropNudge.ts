// SPDX-License-Identifier: Apache-2.0
/**
 * The prop nudge of the 3D room lab: select a prop in the Tune tab, then move it and turn it with keys. A key press
 * changes the tune values of the prop place (`room.props.<prop>.at.<axis>` and `.yaw`). Thus the scene shows the new
 * place immediately, the URL keeps it, and "Copy changes" gives the new placement for the code.
 *
 * The keys are Alt with the arrow keys (over the floor), Q and E (down and up) and comma and period (turn). The other
 * keys of the lab ignore Alt, so the nudge keys do not move the camera or the clock.
 */
import { tunables, withTune } from "@scenity/runtime-dev";
import { computed, onBeforeUnmount, onMounted, ref, type ComputedRef, type Ref } from "vue";
import { typingInto } from "./labUi";

/** One key press moves the prop 1 cm or turns it 1 degree; Shift gives 10 times as much. */
const STEP_M = 0.01;
const STEP_RAD = Math.PI / 180;
const SHIFT_TIMES = 10;

type PlacePart = "at.0" | "at.1" | "at.2" | "yaw";

/** The part of the place that a key changes and the direction (x east, y up, z south, yaw counterclockwise). */
const NUDGE_KEYS: Readonly<Record<string, readonly [PlacePart, 1 | -1]>> = {
  ArrowLeft: ["at.0", -1],
  ArrowRight: ["at.0", 1],
  ArrowUp: ["at.2", -1],
  ArrowDown: ["at.2", 1],
  KeyE: ["at.1", 1],
  KeyQ: ["at.1", -1],
  Comma: ["yaw", 1],
  Period: ["yaw", -1],
};

export interface PropNudge {
  /** The props that have a tuned place, in the order of the registry. */
  readonly props: readonly string[];
  /** The selected prop, or null: with no prop the keys do nothing. */
  readonly prop: Ref<string | null>;
  /** The current place of the selected prop: x, y, z in metres and the turn in degrees. */
  readonly place: ComputedRef<{ x: number; y: number; z: number; yawDeg: number } | null>;
  /** Move or turn the selected prop by `steps` steps of a part of its place. */
  nudge(part: PlacePart, steps: number): void;
}

export function usePropNudge(tunes: Ref<Record<string, number>>): PropNudge {
  const defaults = new Map(tunables().map((item) => [item.path, item.default]));
  const props = [...defaults.keys()].flatMap((path) => /^room\.props\.([^.]+)\.yaw$/.exec(path)?.[1] ?? []);
  const prop = ref<string | null>(null);

  function valueOf(path: string): number {
    return tunes.value[path] ?? defaults.get(path) ?? 0;
  }

  const place = computed(() => {
    const name = prop.value;
    if (name === null) return null;
    const at = (axis: number) => valueOf(`room.props.${name}.at.${String(axis)}`);
    return { x: at(0), y: at(1), z: at(2), yawDeg: (valueOf(`room.props.${name}.yaw`) * 180) / Math.PI };
  });

  function nudge(part: PlacePart, steps: number): void {
    const name = prop.value;
    if (name === null) return;
    const path = `room.props.${name}.${part}`;
    if (!defaults.has(path)) return;
    const step = part === "yaw" ? STEP_RAD : STEP_M;
    // Round to 0.1 mm (and 1e-5 rad), thus many presses do not add float noise to the copied numbers.
    const grain = part === "yaw" ? 1e5 : 1e4;
    const value = Math.round((valueOf(path) + steps * step) * grain) / grain;
    tunes.value = withTune(tunes.value, path, value, defaults.get(path));
  }

  function onKey(event: KeyboardEvent): void {
    const key = NUDGE_KEYS[event.code];
    if (key === undefined || prop.value === null) return;
    if (!event.altKey || event.ctrlKey || event.metaKey || typingInto(event.target)) return;
    event.preventDefault();
    nudge(key[0], key[1] * (event.shiftKey ? SHIFT_TIMES : 1));
  }

  onMounted(() => {
    globalThis.addEventListener("keydown", onKey);
  });
  onBeforeUnmount(() => {
    globalThis.removeEventListener("keydown", onKey);
  });

  return { props, prop, place, nudge };
}
