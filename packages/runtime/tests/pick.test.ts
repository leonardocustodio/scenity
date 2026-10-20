// SPDX-License-Identifier: Apache-2.0
// The generic pick (src/scene/pick.ts, src/scene/subTargets.ts) on a small document: the hit test of the `pickable`
// component (mesh or bounds), the pick layers, `enabled`, `priority`, the sub-targets (sockets, path points, bones)
// and the world points of `entity:<id>#<sub>`. Three.js runs with no renderer.
import { describe, expect, it } from "bun:test";
import { Bone, BoxGeometry, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Texture } from "three";
import type { SceneDocument } from "@scenity/scene";
import { SceneBuilder, type AssetKind, type AssetSource, type AssetValue } from "../src";
import { GraphPicker } from "../src/scene/pick";
import { refPoint } from "../src/scene/subTargets";
import type { PickOptions } from "../src/protocolScene";
import { screenOf, SURFACE } from "./pickHelpers";

/** A model with a body mesh and two bones: `Hips` at the origin and `Hand_R` at (0.3, 0.4, 0). */
class RigAssets implements AssetSource {
  load(_ref: string, kind: AssetKind): Promise<AssetValue> {
    if (kind !== "model") return Promise.resolve(new Texture());
    const root = new Group();
    const body = new Mesh(new BoxGeometry(0.8, 0.8, 0.4).translate(0, 0.4, 0), new MeshStandardMaterial());
    body.name = "body";
    const hips = new Bone();
    hips.name = "Hips";
    const hand = new Bone();
    hand.name = "Hand_R";
    hand.position.set(0.3, 0.4, 0);
    hips.add(hand);
    root.add(body, hips);
    return Promise.resolve(root);
  }
}

function box(size: [number, number, number], position: [number, number, number], more: Record<string, unknown> = {}) {
  return { transform: { position }, shape: { kind: "box", size }, ...more };
}

/** The small document: a wall in front of a crate, a ball, a route with a path and a rigged model. */
function smallScene(): SceneDocument {
  const entity = (index: number, components: Record<string, unknown>) => ({ parent: null, index, components });
  return {
    format: "scenity.scene/1",
    id: "picks",
    entities: {
      wall: entity(0, box([4, 2, 0.1], [0, 1, -1], { pickable: { layers: ["walls"] } })),
      crate: entity(
        1,
        box([1, 1, 1], [0, 0.5, -3], {
          pickable: { layers: ["props"] },
          socket: { points: { top: [0, 0.5, 0], front: [0, 0, 0.5] } },
        }),
      ),
      ball: entity(2, {
        transform: { position: [3, 0.5, -3] },
        shape: { kind: "sphere", size: [1, 1, 1] },
        pickable: { mode: "bounds", layers: ["props"] },
      }),
      route: entity(
        3,
        box([2, 0.1, 0.5], [-3, 0.05, -3], {
          path: {
            points: [
              [-1, 0, 0],
              [0, 0, 0],
              [1, 0, 0],
            ],
          },
        }),
      ),
      rig: entity(4, { transform: { position: [-3.2, 0, -1] }, model: { asset: "asset:rig" } }),
    },
  };
}

async function setup() {
  const builder = new SceneBuilder({ assets: new RigAssets() });
  builder.build(smallScene());
  await builder.ready();
  const camera = new PerspectiveCamera(50, SURFACE.width / SURFACE.height, 0.1, 100);
  camera.position.set(0, 1.5, 5);
  camera.lookAt(0, 0.5, -2);
  camera.updateMatrixWorld(true);
  const picker = new GraphPicker();
  const pickAt = (at: [number, number, number], options?: PickOptions) => {
    const [x, y] = screenOf(camera, at);
    return picker.pick(builder, camera, x, y, SURFACE.width, SURFACE.height, options);
  };
  return { builder, pickAt };
}

describe("the generic pick", () => {
  it("hits the mesh of the nearest entity, with its component and the world point", async () => {
    const { pickAt } = await setup();
    const hit = pickAt([0.2, 1, -0.95]);
    expect(hit).toMatchObject({ entity: "wall", component: "shape", target: null });
    expect(hit?.point[2]).toBeCloseTo(-0.95, 5);
    expect(hit?.sub).toBeUndefined();
  });

  it("hits only the entities of the pick layers", async () => {
    const { pickAt } = await setup();
    // The ray goes through the wall to the crate behind it.
    expect(pickAt([0.2, 1, -0.95], { layers: ["props"] })?.entity).toBe("crate");
    expect(pickAt([0.2, 1, -0.95], { layers: ["walls", "props"] })?.entity).toBe("wall");
    expect(pickAt([0.2, 1, -0.95], { layers: ["nothing"] })).toBeNull();
    // An entity with no `pickable` component is on the layer "default".
    expect(pickAt([-2.5, 0.1, -3], { layers: ["default"] })?.entity).toBe("route");
  });

  it("lets the ray go through a disabled entity, and a higher priority wins over a nearer hit", async () => {
    const { builder, pickAt } = await setup();
    builder.apply([{ op: "set", path: "/entities/wall/components/pickable/enabled", value: false }]);
    expect(pickAt([0.2, 1, -0.95])?.entity).toBe("crate");
    builder.apply([
      { op: "set", path: "/entities/wall/components/pickable/enabled", value: true },
      { op: "set", path: "/entities/crate/components/pickable/priority", value: 1 },
    ]);
    expect(pickAt([0.2, 1, -0.95])?.entity).toBe("crate");
  });

  it("hits the box of an entity with the hit test 'bounds', and only the triangles with 'mesh'", async () => {
    const { builder, pickAt } = await setup();
    // A point on the front face of the box of the ball, out of the sphere.
    const corner: [number, number, number] = [3.45, 0.95, -2.5];
    const hit = pickAt(corner);
    expect(hit).toMatchObject({ entity: "ball", component: null, target: null });
    expect(hit?.point[2]).toBeCloseTo(-2.5, 5);
    expect(pickAt([3, 0.5, -2.5])?.entity).toBe("ball");
    builder.apply([{ op: "set", path: "/entities/ball/components/pickable/mode", value: "mesh" }]);
    expect(pickAt(corner)?.entity).not.toBe("ball");
    expect(pickAt([3, 0.5, -2.5])?.entity).toBe("ball");
  });

  it("names the nearest socket, path point or bone of the hit entity when the caller asks for it", async () => {
    const { builder, pickAt } = await setup();
    const socket = pickAt([0.05, 0.55, -2.5], { layers: ["props"], sub: true });
    expect(socket).toMatchObject({ entity: "crate", sub: "front", target: { kind: "socket", id: "front" } });
    expect(pickAt([0.05, 1, -2.9], { layers: ["props"], sub: ["socket"] })?.sub).toBe("top");
    const path = pickAt([-2.1, 0.1, -3], { layers: ["default"], sub: ["pathPoint"] });
    expect(path).toMatchObject({ entity: "route", sub: "path.2", target: { kind: "pathPoint", id: "path.2" } });
    const bone = pickAt([-2.9, 0.75, -0.8], { sub: ["bone"] });
    expect(bone).toMatchObject({ entity: "rig", component: "model", sub: "Hand_R", target: { kind: "bone" } });
    // The rig of a `character` component gives the canonical name of a bone.
    builder.apply([
      { op: "addComponent", id: "rig", component: "character", value: { bones: { rightHand: "Hand_R" } } },
    ]);
    expect(pickAt([-2.9, 0.75, -0.8], { sub: ["bone"] })?.sub).toBe("rightHand");
    expect(refPoint(builder, "entity:rig#rightHand")?.at.x).toBeCloseTo(-2.9, 6);
    // With no sub option, a model hit names its glTF node.
    expect(pickAt([-2.9, 0.75, -0.8])).toMatchObject({ entity: "rig", target: { kind: "node", id: "body" } });
    // A kind that the entity does not have gives no sub-target.
    expect(pickAt([0.05, 0.55, -2.5], { layers: ["props"], sub: ["bone"] })?.sub).toBeUndefined();
  });

  it("gives the world point of each entity reference, and null for one that does not resolve", async () => {
    const { builder } = await setup();
    const at = (ref: string) =>
      refPoint(builder, ref)
        ?.at.toArray()
        .map((value) => Math.round(value * 1e6) / 1e6);
    expect(at("entity:crate")).toEqual([0, 0.5, -3]);
    expect(at("entity:crate#top")).toEqual([0, 1, -3]);
    expect(at("entity:route#path.0")).toEqual([-4, 0.05, -3]);
    expect(at("entity:rig#Hand_R")).toEqual([-2.9, 0.4, -1]);
    expect(refPoint(builder, "entity:crate#nothing")).toBeNull();
    expect(refPoint(builder, "entity:nothing")).toBeNull();
    expect(refPoint(builder, "asset:crate")).toBeNull();
    builder.apply([{ op: "addComponent", id: "crate", component: "visibility", value: { visible: false } }]);
    expect(refPoint(builder, "entity:crate#top")?.visible).toBe(false);
    expect(refPoint(builder, "entity:wall")?.visible).toBe(true);
  });
});
