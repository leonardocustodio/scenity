// SPDX-License-Identifier: Apache-2.0
/**
 * Shared parts of the sequence tests: two test simulation plugins, a test scene and a generator of seeded
 * random sequences.
 */
import type { Ease, JsonValue, SceneDocument, SequenceDocument, SimulationPlugin, Track } from "../src/index";

/** The doors plugin: it counts the door opens. A door closes `closeAfter` ms after its last open. */
export interface DoorsState {
  readonly opens: number;
  readonly lastOpen: Readonly<Record<string, number>>;
  readonly open: readonly string[];
  readonly closeAfter: number;
}

export const doorsPlugin: SimulationPlugin<DoorsState> = {
  id: "doors",
  initial(params) {
    const closeAfter = (params as { closeAfter?: number } | undefined)?.closeAfter ?? 3000;
    return { opens: 0, lastOpen: {}, open: [], closeAfter };
  },
  reduce(state, key, t) {
    if (key.action !== "doors.open") return state;
    const door = typeof key.args?.door === "string" ? key.args.door : "door";
    return { ...state, opens: state.opens + 1, lastOpen: { ...state.lastOpen, [door]: t } };
  },
  settle(state, t) {
    const open = Object.keys(state.lastOpen)
      .filter((door) => t - (state.lastOpen[door] ?? 0) < state.closeAfter)
      .sort();
    return { ...state, open };
  },
  project(state, t) {
    return { open: state.open.length, since: state.open.map((door) => t - (state.lastOpen[door] ?? 0)) };
  },
};

/**
 * The shop plugin: a machine that is on or off, and a timer of the time on. `settle` adds the time since the last
 * call.
 */
export interface ShopState {
  readonly on: boolean;
  readonly time: number;
  readonly work: number;
  readonly toggles: number;
}

export const shopPlugin: SimulationPlugin<ShopState> = {
  id: "shop",
  initial: () => ({ on: false, time: 0, work: 0, toggles: 0 }),
  reduce(state, key) {
    if (key.action === "shop.on") return { ...state, on: true, toggles: state.toggles + 1 };
    if (key.action === "shop.off") return { ...state, on: false, toggles: state.toggles + 1 };
    return state;
  },
  settle(state, t) {
    return { ...state, work: state.work + (state.on ? t - state.time : 0), time: t };
  },
};

/** A scene with `count` boxes, a camera and a light. */
export function testScene(count: number): SceneDocument {
  const entities: SceneDocument["entities"] = {
    cam: { parent: null, index: 0, components: { camera: { fov: 50 }, transform: { position: [0, 2, 5] } } },
    cam2: { parent: null, index: 1, components: { camera: { fov: 30 }, transform: { position: [5, 2, 0] } } },
    sun: { parent: null, index: 2, components: { light: { type: "directional", intensity: 1 } } },
  };
  for (let index = 0; index < count; index += 1) {
    entities[`box${String(index)}`] = {
      parent: null,
      index: index + 3,
      components: { shape: { kind: "box" }, transform: { position: [index, 0, 0] } },
    };
  }
  return { format: "scenity.scene/1", id: "test", entities };
}

const EASES: readonly Ease[] = ["step", "linear", "in", "out", "inOut", { bezier: [0.3, 0.2, 0.7, 1] }];

/** `count` sorted integer times in 0..duration. */
function times(random: () => number, count: number, duration: number): number[] {
  return Array.from({ length: count }, () => Math.floor(random() * (duration + 1))).sort((a, b) => a - b);
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T;
}

/** A unit quaternion about the Y axis. */
function yaw(angle: number): [number, number, number, number] {
  return [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
}

/** The tracks of each kind for `boxes` boxes. `scale` multiplies the key counts. */
function randomTracks(random: () => number, duration: number, boxes: number, scale: number): Track[] {
  const n = (count: number) => Math.max(1, Math.round(count * scale));
  const box = () => `box${String(Math.floor(random() * boxes))}`;
  const ease = () => pick(random, EASES);
  const tracks: Track[] = [];
  for (let index = 0; index < boxes; index += 1) {
    const keys = times(random, n(20), duration).map((t) => ({
      t,
      position: [random() * 4, random(), random() * 4] as [number, number, number],
      rotation: yaw(random() * 6),
      ease: ease(),
    }));
    tracks.push({ kind: "transform", entity: `box${String(index)}`, keys });
  }
  const fov = times(random, n(20), duration).map((t) => ({ t, value: 20 + random() * 60, ease: ease() }));
  tracks.push({ kind: "property", entity: "cam", path: "camera/fov", keys: fov });
  const colour = times(random, n(10), duration).map((t) => ({ t, value: [random() * 255, 100, 50] as JsonValue }));
  tracks.push({ kind: "property", entity: "sun", path: "light/colour", keys: colour });
  const visible = times(random, n(10), duration).map((t) => ({ t, visible: random() < 0.5 }));
  tracks.push({ kind: "visibility", entity: box(), keys: visible });
  const doors = ["a", "b", "c"];
  const actions = (count: number) =>
    times(random, n(count), duration).map((t) =>
      random() < 0.5
        ? { t, action: "doors.open", args: { door: pick(random, doors) } }
        : { t, action: pick(random, ["shop.on", "shop.off"]) },
    );
  tracks.push({ kind: "action", entity: box(), keys: actions(40) }, { kind: "action", keys: actions(30) });
  tracks.push({ kind: "event", keys: times(random, n(20), duration).map((t) => ({ t, name: "beat" })) });
  const clips = times(random, n(8), duration).map((t) => ({
    t,
    clip: random() < 0.2 ? null : `asset:clip${String(Math.floor(random() * 3))}`,
    speed: 0.5 + random(),
    blend: Math.floor(random() * 800),
  }));
  tracks.push({ kind: "animation", entity: box(), keys: clips });
  const cuts = times(random, n(6), duration).map((t) => ({ t, camera: pick(random, ["entity:cam", "entity:cam2"]) }));
  tracks.push({ kind: "camera", keys: cuts });
  const attach = times(random, n(6), duration).map((t) => ({ t, to: random() < 0.3 ? null : `entity:${box()}#top` }));
  tracks.push({ kind: "attach", entity: box(), keys: attach });
  return tracks;
}

/** A random sequence for the scene of `testScene(boxes)`. */
export function randomSequence(random: () => number, duration: number, boxes: number, scale = 1): SequenceDocument {
  return {
    format: "scenity.sequence/1",
    id: "random",
    scene: "test",
    duration,
    initial: { doors: { closeAfter: 2500 } },
    tracks: randomTracks(random, duration, boxes, scale),
  };
}
