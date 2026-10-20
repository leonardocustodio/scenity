// SPDX-License-Identifier: Apache-2.0
// The plugins of the document core. The components of a plugin go to the registry of the builder, and its presenters
// draw its components. Its simulation gives the input of its systems, and its systems turn an entity in fixed steps.
// A seek gives the frame of a play. The worker loads the plugins of its loader with the set name of the "init"
// message. Three.js runs with no renderer: a fake backend records nothing.
import { describe, expect, it } from "bun:test";
import { Group, Quaternion, Texture } from "three";
import type { RenderBackend, RenderBackendFactory, SceneRenderer } from "@scenity/render/types";
import { defineComponent, vec3Schema, type SceneDocument } from "@scenity/scene";
import { defineSimulation, type SequenceDocument } from "@scenity/scene/sequence";
import { DocumentCore } from "../src/core/documentCore";
import { lastStep, stepTime } from "../src/core/systemSteps";
import { defineRuntimePlugin, type RuntimePlugin } from "../src/plugins";
import { PROTOCOL_VERSION, type FromWorker, type SceneCoreOptions, type ToWorker } from "../src/protocol";
import type { Presenter } from "../src/scene/types";
import { defineSystem } from "../src/systems/index";
import { documentWorkerFactory } from "../src/worker/documentMessages";
import { attachSceneWorker } from "../src/worker/handler";
import { FakeAssets } from "./sceneHelpers";

/** The turn speed about each axis in degrees per second. The system uses the Y part. */
const turnComponent = defineComponent({
  id: "spin.turn",
  schema: vec3Schema,
  defaults: [0, 90, 0],
  editor: { label: "Turn", fields: {} },
});

/** The presenter of `spin.turn`: a child group named "spin-hub". */
const hubPresenter: Presenter<unknown, Group> = {
  id: "spin.turn",
  create: () => Object.assign(new Group(), { name: "spin-hub" }),
  update: () => true,
  dispose: () => undefined,
};

interface Boost {
  readonly factor: number;
}

/** The simulation: the action `spin.boost` sets the factor of the turn speed. */
const boost = defineSimulation<Boost, Boost>({
  id: "spin",
  stateSchema: {
    safeParse: (value) => ({ success: true, data: value as Boost }),
  },
  initial: () => ({ factor: 1 }),
  reduce: (state, key) => (key.action === "spin.boost" ? { factor: Number(key.args?.factor ?? 1) } : state),
  settle: (state) => state,
  project: (state) => state,
});

/** The system: it adds the turn of each step to its memory, and writes the rotation about Y. */
function turnSystem() {
  let angles: Record<string, number> = {};
  return defineSystem<Boost | undefined, Record<string, number>>({
    id: "spin.turn",
    order: 0,
    reads: ["spin.turn"],
    update(ctx) {
      const factor = ctx.input?.factor ?? 1;
      for (const id of Object.keys(ctx.frame.scene.entities).sort()) {
        const value = ctx.frame.scene.entities[id]?.components["spin.turn"] as readonly number[] | undefined;
        if (value === undefined) continue;
        const angle = (angles[id] ?? 0) + ((value[1] ?? 90) * factor * ctx.dt) / 1000;
        angles = { ...angles, [id]: angle };
        const half = (angle * Math.PI) / 360;
        ctx.out.setTransform(id, { rotation: [0, Math.sin(half), 0, Math.cos(half)] });
      }
    },
    save: () => ({ ...angles }),
    restore: (memory) => {
      angles = { ...memory };
    },
  });
}

const spin: RuntimePlugin = defineRuntimePlugin({
  id: "spin",
  components: [turnComponent],
  presenters: { "spin.turn": hubPresenter },
  systems: [turnSystem],
  simulation: boost,
});

const SCENE: SceneDocument = {
  format: "scenity.scene/1",
  id: "spin",
  entities: {
    wheel: { name: "Wheel", parent: null, index: 0, components: { transform: {}, "spin.turn": [0, 90, 0] } },
    post: { name: "Post", parent: null, index: 1, components: { transform: { position: [1, 0, 0] } } },
  },
};

const SEQUENCE: SequenceDocument = {
  format: "scenity.sequence/1",
  id: "turns",
  scene: "spin",
  duration: 4000,
  tracks: [{ kind: "action", entity: "wheel", keys: [{ t: 2000, action: "spin.boost", args: { factor: 2 } }] }],
};

/** A backend with no GPU. */
const fakeBackend: RenderBackendFactory = () => {
  const renderer = {
    domElement: {} as OffscreenCanvas,
    shadowMap: { enabled: false, type: 1 },
    setPixelRatio: () => undefined,
    setSize: () => undefined,
    getSize: (target) => target,
    render: () => undefined,
    getPixelRatio: () => 1,
    setViewport: () => undefined,
    setScissor: () => undefined,
    setScissorTest: () => undefined,
  } as SceneRenderer;
  const backend: RenderBackend = {
    kind: "webgl",
    renderer,
    isReady: () => true,
    ready: Promise.resolve(),
    render: () => undefined,
    info: () => ({ calls: 0, triangles: 0 }),
    memory: () => ({ geometries: 0, textures: 0, programs: 0 }),
    timer: () => null,
    textureSupport: () => ({ gpuFeatures: { has: () => false } }),
    dispose: () => undefined,
  };
  return backend;
};

/** The options of a core with a timer scheduler and the clock of `clock.t`. */
function baseOptions(clock: { t: number | null }): SceneCoreOptions {
  return {
    canvas: {} as OffscreenCanvas,
    surface: { width: 640, height: 400, dpr: 1 },
    tier: "high",
    flags: { reducedMotion: false, paused: true, visible: true },
    clock: () => clock.t,
    now: () => performance.now(),
    scheduler: {
      request: (callback) => setTimeout(callback, 0) as unknown as number,
      cancel: (handle) => {
        clearTimeout(handle);
      },
    },
    mode: "main",
    events: { ready: () => undefined, anchors: () => undefined, hit: () => undefined, context: () => undefined },
    backend: fakeBackend,
  };
}

const FAKE_MAPS = () => ({
  fromEquirectangular: () => new Texture(),
  fromCubemap: () => new Texture(),
  dispose: () => undefined,
});

function core(clock: { t: number | null }, plugins?: readonly RuntimePlugin[] | Promise<readonly RuntimePlugin[]>) {
  const made = new DocumentCore({
    ...baseOptions(clock),
    assetSource: () => new FakeAssets(),
    environmentMaps: FAKE_MAPS,
    ...(plugins === undefined ? {} : { plugins }),
  });
  made.start();
  return made;
}

/** The rotation of an entity after the frame at `t`. */
async function rotationAt(made: DocumentCore, clock: { t: number | null }, t: number): Promise<number[]> {
  clock.t = t;
  await made.patch([]);
  const object = made.builder.entityObject("wheel");
  return object === undefined ? [] : object.quaternion.toArray();
}

/** The angle about Y of a quaternion in degrees, in [0, 360). */
function yaw(rotation: readonly number[]): number {
  const angle = (2 * Math.atan2(rotation[1] ?? 0, rotation[3] ?? 1) * 180) / Math.PI;
  return ((angle % 360) + 360) % 360;
}

describe("the plugins of the document core", () => {
  it("steps at whole ms, 60 times a second", () => {
    expect([0, 1, 2, 3, 60].map(stepTime)).toEqual([0, 17, 33, 50, 1000]);
    expect([0, 16, 17, 32, 33, 999, 1000, 1016].map(lastStep)).toEqual([0, 0, 1, 1, 2, 59, 60, 60]);
  });

  it("registers the components and draws them with the presenters of the plugins", async () => {
    const clock = { t: 0 };
    const made = core(clock, [spin]);
    const loaded = await made.load({ documents: { scene: SCENE, sequence: SEQUENCE } });
    expect(loaded.ok).toBe(true);
    expect(made.builder.registry.fill("spin.turn", undefined)).toEqual([0, 90, 0]);
    const hub = made.builder.entityObject("wheel")?.getObjectByName("spin-hub");
    expect(hub).toBeDefined();
    expect(made.builder.entityObject("post")?.getObjectByName("spin-hub")).toBeUndefined();
    made.dispose();
  });

  it("turns the entity with the system, and the simulation boosts the turn", async () => {
    const clock = { t: 0 };
    const made = core(clock, [spin]);
    await made.load({ documents: { scene: SCENE, sequence: SEQUENCE } });
    expect(yaw(await rotationAt(made, clock, 0))).toBeCloseTo(0, 6);
    expect(yaw(await rotationAt(made, clock, 1000))).toBeCloseTo(90, 6);
    // The key at 2000 ms sets the factor 2. From the step at 2000 ms (17 ms after 1983 ms), the turn is 180 degrees/s.
    expect(yaw(await rotationAt(made, clock, 3000))).toBeCloseTo((90 * 1.983 + 180 * 1.017) % 360, 6);
    // The entity with no `spin.turn` keeps the rotation of its document.
    expect(made.builder.entityObject("post")?.quaternion.equals(new Quaternion())).toBe(true);
    made.dispose();
  });

  it("gives the frame of a play after a seek forward and a seek back", async () => {
    const played = { t: 0 };
    const play = core(played, [spin]);
    await play.load({ documents: { scene: SCENE, sequence: SEQUENCE } });
    const frames = new Map<number, number[]>();
    for (let t = 0; t <= 3500; t += 23) frames.set(t, await rotationAt(play, played, t));
    const sought = { t: 0 };
    const seek = core(sought, [spin]);
    await seek.load({ documents: { scene: SCENE, sequence: SEQUENCE } });
    for (const t of [3450, 1150, 2990, 0, 2392, 2392]) {
      expect(await rotationAt(seek, sought, t)).toEqual(frames.get(t) ?? []);
    }
    play.dispose();
    seek.dispose();
  });

  it("starts the system memory again after a patch", async () => {
    const clock = { t: 0 };
    const made = core(clock, [spin]);
    await made.load({ documents: { scene: SCENE, sequence: SEQUENCE } });
    const before = await rotationAt(made, clock, 1500);
    const result = await made.patch([{ op: "set", path: "/entities/wheel/components/spin.turn/1", value: 45 }]);
    expect(result.ok).toBe(true);
    const after = made.builder.entityObject("wheel")?.quaternion.toArray() ?? [];
    expect(yaw(before)).toBeCloseTo(135, 6);
    expect(yaw(after)).toBeCloseTo(67.5, 6);
    made.dispose();
  });

  it("waits for plugins that come as a promise, and refuses the load of bad plugins", async () => {
    const clock = { t: 0 };
    const late = core(clock, Promise.resolve([spin]));
    expect((await late.load({ documents: { scene: SCENE } })).ok).toBe(true);
    expect(late.builder.presenters.has("spin.turn")).toBe(true);
    late.dispose();
    const bad = core(clock, [defineRuntimePlugin({ id: "other", components: [turnComponent] })]);
    const result = await bad.load({ documents: { scene: SCENE } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('the component ID "spin.turn" does not start with "other."');
    bad.dispose();
    const failed = core(clock, Promise.reject(new Error("no chunk")));
    expect(await failed.load({ documents: { scene: SCENE } })).toEqual({
      ok: false,
      reason: "the plugins did not load: no chunk",
    });
    failed.dispose();
  });

  it("has no plugin parts with no plugins", async () => {
    const clock = { t: 1000 };
    const made = core(clock);
    await made.load({ documents: { scene: SCENE, sequence: SEQUENCE } });
    expect(made.builder.registry.has("spin.turn")).toBe(false);
    expect(made.builder.entityObject("wheel")?.getObjectByName("spin-hub")).toBeUndefined();
    expect(yaw(await rotationAt(made, clock, 1000))).toBe(0);
    made.dispose();
  });

  it("loads the plugins of the worker loader with the set name of the init message", async () => {
    const sets: (string | undefined)[] = [];
    const answers: FromWorker[] = [];
    let deliver: ((event: MessageEvent<ToWorker>) => void) | undefined;
    attachSceneWorker(
      {
        addEventListener: (_type, listener) => {
          deliver = listener;
        },
        postMessage: (message) => answers.push(message),
        requestAnimationFrame: (callback) => setTimeout(callback, 0),
        cancelAnimationFrame: (handle) => {
          clearTimeout(handle);
        },
      },
      fakeBackend,
      documentWorkerFactory(
        (options) => new DocumentCore({ ...options, assetSource: () => new FakeAssets(), environmentMaps: FAKE_MAPS }),
        undefined,
        (set) => {
          sets.push(set);
          return Promise.resolve([spin]);
        },
      ),
    );
    const send = (message: ToWorker) => deliver?.({ data: message } as MessageEvent<ToWorker>);
    const init = {
      type: "init",
      protocol: PROTOCOL_VERSION,
      canvas: {} as OffscreenCanvas,
      surface: { width: 640, height: 400, dpr: 1 },
      tier: "high",
      flags: { reducedMotion: false, paused: true, visible: true },
      assets: null,
      plugins: "spin",
    } as const;
    send(init);
    send({ type: "load", id: 1, documents: { scene: SCENE } });
    while (!answers.some((message) => message.type === "loaded")) await new Promise((done) => setTimeout(done, 5));
    expect(sets).toEqual(["spin"]);
    expect(answers.find((message) => message.type === "loaded")).toMatchObject({ result: { ok: true, entities: 2 } });
    send({ type: "dispose" });
  });
});
