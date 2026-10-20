// SPDX-License-Identifier: Apache-2.0
// The generic pick and the projected points of the document core on the showroom sample with its built models. The
// pick hits the triangles of the models from the document cameras. The layers of a `pickable` component filter the
// hits, and a hit names the socket of the table. The "anchors" event gives the screen point of each
// `entity:<id>#<sub>` reference from the camera of the frame. The "pick" options and the "points" message go through
// the worker handler. Three.js runs with no renderer.
import { describe, expect, it } from "bun:test";
import type { PerspectiveCamera } from "three";
import type { DocumentCore } from "../src/core/documentCore";
import type { FromWorker, PickOptions, ProjectedFrame, SceneCoreLike, ToWorker } from "../src/protocol";
import { PROTOCOL_VERSION } from "../src/protocol";
import { attachSceneWorker } from "../src/worker/handler";
import { fakeBackend, screenOf, ShowroomAssets, SURFACE, testCore } from "./pickHelpers";
import { showroom } from "./sceneHelpers";

/** A point on the top of the dining table, away from the lantern on it. */
const TABLE_TOP: [number, number, number] = [1.45, 0.549, -1.1];

async function loaded(frames: ProjectedFrame[] = []): Promise<{ core: DocumentCore; camera: () => PerspectiveCamera }> {
  const core = testCore(new ShowroomAssets(), frames);
  core.start();
  const result = await core.load({ documents: { scene: showroom() } });
  expect(result).toMatchObject({ ok: true, warnings: [] });
  const camera = (): PerspectiveCamera => {
    const found = core.builder.camera("top");
    if (found === undefined) throw new Error("the showroom has no top camera");
    return found;
  };
  expect(core.useCamera("top")).toBe(true);
  // A patch with no ops gives a frame of the top camera, with its safe frame.
  await core.patch([]);
  return { core, camera };
}

/** The next projected frame after `count` frames. */
async function frameAfter(frames: ProjectedFrame[], count: number): Promise<ProjectedFrame> {
  for (let tries = 0; frames.length <= count && tries < 200; tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  const frame = frames[count];
  if (frame === undefined) throw new Error("no projected frame");
  return frame;
}

describe("the pick on the showroom", () => {
  it("hits the triangles of each model from the top camera", async () => {
    const { core, camera } = await loaded();
    const hits = new Set<string>();
    for (let x = 10; x < SURFACE.width; x += 20) {
      for (let y = 10; y < SURFACE.height; y += 20) {
        const hit = core.pickEntity(x, y);
        if (hit !== null) hits.add(hit.entity);
      }
    }
    expect([...hits].sort()).toEqual([
      "armchair",
      "coffee-table",
      "floor",
      "ottoman",
      "shelf",
      "table",
      "wall-back",
      "wall-left",
    ]);
    // The lantern is small: a pick at its place on the table hits it, not the table under it.
    const [x, y] = screenOf(camera(), [1.95, 0.6, -0.85]);
    expect(core.pickEntity(x, y)).toMatchObject({ entity: "lantern", component: "model" });
    core.dispose();
  });

  it("hits the top of the table, filters by layer and names the socket of the table", async () => {
    const { core, camera } = await loaded();
    const [x, y] = screenOf(camera(), TABLE_TOP);
    const hit = core.pickEntity(x, y);
    expect(hit).toMatchObject({ entity: "table", component: "model", target: { kind: "node" } });
    expect(Math.abs((hit?.point[1] ?? 0) - TABLE_TOP[1])).toBeLessThan(0.03);
    expect(core.pickEntity(x, y, { sub: true })).toMatchObject({ sub: "top", target: { kind: "socket", id: "top" } });
    // The showroom has no `pickable` component: each entity is on the layer "default".
    expect(core.pickEntity(x, y, { layers: ["default"] })?.entity).toBe("table");
    expect(core.pickEntity(x, y, { layers: ["furniture"] })).toBeNull();
    await core.patch([{ op: "addComponent", id: "table", component: "pickable", value: { layers: ["furniture"] } }]);
    expect(core.pickEntity(x, y, { layers: ["furniture"] })?.entity).toBe("table");
    const [floorX, floorY] = screenOf(camera(), [0.5, 0, 1.5]);
    expect(core.pickEntity(floorX, floorY)?.entity).toBe("floor");
    expect(core.pickEntity(floorX, floorY, { layers: ["furniture"] })).toBeNull();
    // The hit test "bounds" hits the box of the table: the top of the box is the top of the model.
    await core.patch([{ op: "set", path: "/entities/table/components/pickable/mode", value: "bounds" }]);
    const box = core.pickEntity(x, y);
    expect(box).toMatchObject({ entity: "table", component: null, target: null });
    expect(Math.abs((box?.point[1] ?? 0) - TABLE_TOP[1])).toBeLessThan(0.03);
    core.dispose();
  });
});

describe("the projected points of the document core", () => {
  it("sends the screen point of each reference from the camera of the frame when a point moves", async () => {
    const frames: ProjectedFrame[] = [];
    const { core, camera } = await loaded(frames);
    const count = frames.length;
    core.setPoints(["entity:table#top", "entity:lantern", "entity:nothing"]);
    const frame = await frameAfter(frames, count);
    expect(frame.points.map((point) => [point.id, point.visible])).toEqual([
      ["entity:table#top", true],
      ["entity:lantern", true],
      ["entity:nothing", false],
    ]);
    const [x, y] = screenOf(camera(), [1.6, 0.549, -0.9]);
    expect(frame.points[0]?.at[0]).toBeCloseTo(x, 3);
    expect(frame.points[0]?.at[1]).toBeCloseTo(y, 3);
    // A move of the table moves the points of the table and of the lantern on it.
    await core.patch([{ op: "set", path: "/entities/table/components/transform/position/0", value: 1.2 }]);
    const moved = frames.at(-1);
    const [movedX] = screenOf(camera(), [1.2, 0.549, -0.9]);
    expect(moved?.points[0]?.at[0]).toBeCloseTo(movedX, 3);
    expect(moved?.points[1]?.at[0]).toBeLessThan(frame.points[1]?.at[0] ?? 0);
    // The front camera gives other points.
    core.useCamera("front");
    await core.patch([]);
    const front = core.builder.camera("front");
    if (front === undefined) throw new Error("the showroom has no front camera");
    const [frontX, frontY] = screenOf(front, [1.2, 0.549, -0.9]);
    expect(frames.at(-1)?.points[0]?.at[0]).toBeCloseTo(frontX, 3);
    expect(frames.at(-1)?.points[0]?.at[1]).toBeCloseTo(frontY, 3);
    core.dispose();
  });
});

describe("the pick options and the points in the worker handler", () => {
  it("gives the options of 'pick' and the references of 'points' to the core", () => {
    const calls: unknown[] = [];
    let deliver: ((event: MessageEvent<ToWorker>) => void) | null = null;
    const answers: FromWorker[] = [];
    const core = {
      setInput: () => undefined,
      setSurface: () => undefined,
      setFlags: () => undefined,
      setTier: () => undefined,
      setGpuTimer: () => undefined,
      setRenderScale: () => undefined,
      setAssets: () => undefined,
      pointerAt: () => undefined,
      stats: () => ({}) as never,
      start: () => undefined,
      dispose: () => undefined,
      pickEntity: (x: number, y: number, options?: PickOptions) => {
        calls.push(["pickEntity", x, y, options]);
        return null;
      },
      setPoints: (refs: readonly string[]) => calls.push(["setPoints", refs]),
    } satisfies SceneCoreLike<unknown>;
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
      { input: { safeParse: (value) => ({ success: true, data: value }) }, createCore: () => core },
    );
    const send = (message: ToWorker) => deliver?.({ data: message } as MessageEvent<ToWorker>);
    send({
      type: "init",
      protocol: PROTOCOL_VERSION,
      canvas: {} as OffscreenCanvas,
      surface: SURFACE,
      tier: "high",
      flags: { reducedMotion: false, paused: false, visible: true },
      assets: null,
    });
    send({ type: "pick", id: 1, x: 3, y: 4, options: { layers: ["props"], sub: ["socket"] } });
    send({ type: "points", refs: ["entity:table#top"] });
    expect(calls).toEqual([
      ["pickEntity", 3, 4, { layers: ["props"], sub: ["socket"] }],
      ["setPoints", ["entity:table#top"]],
    ]);
    expect(answers).toContainEqual({ type: "picked", id: 1, hit: null });
  });
});
