// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import type { ExtensionMessage } from "@scenity/runtime/protocol";
import { Box3, PerspectiveCamera, Scene, Vector3, type Mesh } from "three";
import type { DevCoreApi } from "../src/client";
import { pickScene } from "../src/pick";
import { parseSelect, selectText } from "../src/pickMath";
import { SCRATCH_ROOT, ScratchLayer, type ScratchModel, type ScratchUpdate } from "../src/scratch";
import { targetCorners } from "../src/selection";
import { handleDevMessage } from "../src/worker/extension";

// The scratch props of the lab: the models of imports at their places, a frame input of the labs core (no WebGL here:
// the layer, the pick and the outline read the scene graph).

/** A 0.4 m cube with its base on y = 0 around the origin of the model. */
function cube(id: string): ScratchModel {
  const p = [-0.2, 0.2];
  const positions: number[] = [];
  for (const x of p) for (const y of [0, 0.4]) for (const z of p) positions.push(x, y, z);
  const faces = [
    0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3,
  ];
  return {
    id,
    meshes: [
      {
        positions: new Float32Array(positions),
        normals: null,
        uvs: null,
        indices: new Uint32Array(faces),
        color: [0.2, 0.6, 0.9],
        opacity: 1,
        texture: null,
      },
    ],
  };
}

const MODEL = "lx0abc-0011aabb";

describe("ScratchLayer", () => {
  it("puts each place of a model at its point and turn, and shares the geometry of the model", () => {
    const layer = new ScratchLayer();
    expect(layer.root.name).toBe(SCRATCH_ROOT);
    expect(layer.root.visible).toBe(false);
    layer.set({
      models: [cube(MODEL)],
      places: [
        { id: "scratch-1", model: MODEL, at: [1, 0, -0.5], yaw: 0 },
        { id: "scratch-2", model: MODEL, at: [0, 0.9, 1], yaw: Math.PI / 2 },
      ],
    });
    expect(layer.size).toBe(2);
    expect(layer.root.visible).toBe(true);
    expect(layer.root.children.map((group) => group.name)).toEqual(["scratch:scratch-1", "scratch:scratch-2"]);
    layer.root.updateMatrixWorld(true);
    const box = new Box3().setFromObject(layer.root.children[0] ?? layer.root);
    expect(box.min.y).toBeCloseTo(0, 6);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(1, 6);
    const [a, b] = layer.root.children.map((group) => group.children[0] as Mesh);
    expect(a?.geometry).toBe(b?.geometry as never);
    expect(layer.root.children[1]?.rotation.y).toBeCloseTo(Math.PI / 2, 9);
  });

  it("moves the places without new models, keeps a known model, and drops a model out of the list", () => {
    const layer = new ScratchLayer();
    const first: ScratchUpdate = {
      models: [cube(MODEL)],
      places: [{ id: "scratch-1", model: MODEL, at: [0, 0, 0], yaw: 0 }],
    };
    layer.set(first);
    const geometry = (layer.root.children[0]?.children[0] as Mesh).geometry;
    layer.set({ places: [{ id: "scratch-1", model: MODEL, at: [0.5, 0, 0], yaw: 0 }] });
    expect(layer.root.children[0]?.position.x).toBe(0.5);
    expect((layer.root.children[0]?.children[0] as Mesh).geometry).toBe(geometry);
    layer.set({ models: [cube(MODEL)], places: first.places });
    expect((layer.root.children[0]?.children[0] as Mesh).geometry).toBe(geometry);
    // A place of a model that the layer does not have does not show.
    layer.set({ models: [], places: first.places });
    expect(layer.modelIds).toEqual([]);
    expect(layer.size).toBe(0);
    expect(layer.root.visible).toBe(false);
  });
});

describe("the pick and the outline of a scratch prop", () => {
  function scene(): { scene: Scene; camera: PerspectiveCamera; at: [number, number] } {
    const root = new Scene();
    const layer = ScratchLayer.addTo(root);
    layer.set({ models: [cube(MODEL)], places: [{ id: "scratch-1", model: MODEL, at: [0.4, 0, 0.2], yaw: 0.5 }] });
    const camera = new PerspectiveCamera(50, 800 / 600, 0.05, 30);
    camera.position.set(0, 1.6, 3);
    camera.lookAt(0, 0.4, 0);
    camera.updateMatrixWorld();
    root.updateMatrixWorld(true);
    const ndc = new Vector3(0.4, 0.2, 0.2).project(camera);
    return { scene: root, camera, at: [((ndc.x + 1) / 2) * 800, ((1 - ndc.y) / 2) * 600] };
  }

  it("names the scratch prop with its box in the frame of its place", () => {
    const { scene: root, camera, at } = scene();
    const input = { scene: root, camera, width: 800, height: 600, members: [], points: {}, places: {} };
    const picked = pickScene(input, at[0], at[1]);
    expect(picked).toMatchObject({ kind: "scratch", id: "scratch-1" });
    expect(picked?.local?.min[1]).toBeCloseTo(0, 5);
    expect(picked?.local?.max[0]).toBeCloseTo(0.2, 5);
    expect(parseSelect(selectText({ kind: "scratch", id: "scratch-1" }))).toEqual({ kind: "scratch", id: "scratch-1" });
  });

  it("outlines the scratch prop at its place, turned with it", () => {
    const { scene: root } = scene();
    const corners = targetCorners(
      { kind: "scratch", id: "scratch-1" },
      { scene: root, places: {}, members: new Map() },
    );
    const expected = new Vector3(-0.2, 0, -0.2).applyAxisAngle(new Vector3(0, 1, 0), 0.5).add(new Vector3(0.4, 0, 0.2));
    expect(corners?.[0]?.distanceTo(expected)).toBeLessThan(1e-6);
    expect(
      targetCorners({ kind: "scratch", id: "scratch-9" }, { scene: root, places: {}, members: new Map() }),
    ).toBeNull();
  });

  it("gives the scratch message of the labs worker to the core", () => {
    const seen: ScratchUpdate[] = [];
    const core = { setScratch: (update: ScratchUpdate) => seen.push(update) } as unknown as DevCoreApi;
    const posted: ExtensionMessage[] = [];
    const update: ScratchUpdate = { places: [] };
    handleDevMessage({ type: "scratch", update }, core, (message) => posted.push(message));
    expect(seen).toEqual([update]);
    expect(posted).toEqual([]);
  });
});
