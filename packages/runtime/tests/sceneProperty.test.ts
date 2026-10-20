// SPDX-License-Identifier: Apache-2.0
// A property test of the scene builder: random ops applied one by one give the same graph as a fresh build
// of the final document. The ops come from a seeded generator, so each run is the same.
import { describe, expect, it } from "bun:test";
import type { Light, Mesh, Object3D, PerspectiveCamera } from "three";
import { childCount, isInSubtree, type SceneDocument, type SceneOp } from "@scenity/scene";
import { modelInstance, SceneBuilder } from "../src";
import { FakeAssets, seeded, showroom } from "./sceneHelpers";

type Random = () => number;

const ASSETS = ["asset:01M4ZPXYG50NAV41FPDE38QB7E", "asset:01M4ZPXYG26FPR940EDPJM9FCD", "asset:extra-model"];
const LIGHTS = ["directional", "point", "spot", "ambient", "hemisphere"] as const;
const SHAPES = ["box", "plane", "cylinder", "sphere"] as const;

function pick<T>(random: Random, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!;
}

const num = (random: Random) => Math.round((random() * 8 - 4) * 1000) / 1000;
const int = (random: Random, max: number) => Math.floor(random() * (max + 1));

/** A random value of a component that has a presenter. */
function randomComponent(random: Random): [string, unknown] {
  switch (int(random, 4)) {
    case 0:
      return ["shape", { kind: pick(random, SHAPES), size: [1 + int(random, 3), 1, 1], colour: "#336699" }];
    case 1:
      return ["light", { type: pick(random, LIGHTS), intensity: int(random, 5), shadow: random() < 0.5 }];
    case 2:
      return ["model", { asset: pick(random, ASSETS), castShadow: random() < 0.5 }];
    case 3:
      return ["camera", { fov: 30 + int(random, 40), target: [num(random), 0, num(random)] }];
    default:
      return ["visibility", { visible: random() < 0.5 }];
  }
}

function randomAdd(doc: SceneDocument, random: Random, counter: { next: number }, id?: string): SceneOp {
  const parent = random() < 0.4 || id === undefined ? null : id;
  const [component, value] = randomComponent(random);
  const components = { transform: { position: [num(random), num(random), num(random)] }, [component]: value };
  const index = int(random, childCount(doc.entities, parent));
  return { op: "add", id: `n${String((counter.next += 1))}`, entity: { parent, index, components } };
}

/** One random op for the document. Some ops are not valid. The builder must refuse them and change nothing. */
function randomOp(doc: SceneDocument, random: Random, counter: { next: number }): SceneOp {
  const ids = Object.keys(doc.entities).sort();
  const id = ids.length === 0 ? undefined : pick(random, ids);
  const kind = int(random, 9);
  if (id === undefined || kind === 0) return randomAdd(doc, random, counter, id);
  const base = `/entities/${id}/components`;
  switch (kind) {
    case 1:
      return { op: "remove", id };
    case 2: {
      const parents = [null, ...ids.filter((other) => !isInSubtree(doc.entities, other, id))];
      const parent = pick(random, parents);
      return { op: "move", id, parent, index: int(random, childCount(doc.entities, parent, id)) };
    }
    case 3:
      return { op: "set", path: `${base}/transform/position/${String(int(random, 2))}`, value: num(random) };
    case 4: {
      const angle = num(random);
      return { op: "set", path: `${base}/transform/rotation`, value: [0, Math.sin(angle), 0, Math.cos(angle)] };
    }
    case 5: {
      const [component, value] = randomComponent(random);
      return { op: "addComponent", id, component, value: value as never };
    }
    case 6: {
      const component = pick(random, Object.keys(doc.entities[id]!.components).sort());
      return { op: "removeComponent", id, component };
    }
    case 7: {
      const [component, value] = randomComponent(random);
      return { op: "set", path: `${base}/${component}`, value: value as never };
    }
    case 8:
      return { op: "set", path: `${base}/light/intensity`, value: int(random, 4) };
    default:
      return { op: "set", path: "/environment/exposure", value: 0.5 + int(random, 10) / 10 };
  }
}

const round = (values: number[]) => values.map((value) => Math.round(value * 1e9) / 1e9 + 0);

/** The part of an object that the test compares. */
function describeObject(object: Object3D | null): unknown {
  if (object === null) return null;
  const light = object as Partial<Light>;
  if (light.isLight === true) return { light: light.type, intensity: light.intensity, shadow: light.castShadow };
  if ((object as Partial<PerspectiveCamera>).isPerspectiveCamera === true) {
    const camera = object as PerspectiveCamera;
    return { camera: camera.fov, rotation: round(camera.quaternion.toArray()) };
  }
  if ((object as Partial<Mesh>).isMesh === true) {
    const mesh = object as Mesh;
    return { mesh: mesh.geometry.type, shadow: mesh.castShadow };
  }
  const instance = modelInstance(object);
  return { model: object.name, loaded: instance !== undefined, children: object.children.length };
}

/** A snapshot of the graph: the tree, the transforms, the components and the objects of the presenters. */
function snapshot(builder: SceneBuilder): unknown {
  const entities = builder.entityIds().map((id) => {
    const group = builder.entityObject(id)!;
    const parent: unknown = group.parent?.userData.entity ?? (group.parent === builder.root ? null : "detached");
    const siblings = group.parent?.children.filter((child) => typeof child.userData.entity === "string") ?? [];
    return {
      id,
      parent,
      index: siblings.indexOf(group),
      children: group.children.map((child) => child.name),
      transform: round([...group.position.toArray(), ...group.quaternion.toArray(), ...group.scale.toArray()]),
      visible: group.visible,
      components: builder.componentIds(id),
      objects: builder.componentIds(id).map((component) => describeObject(builder.componentObject(id, component))),
    };
  });
  const roots = builder.root.children.map((child) => child.name);
  return { roots, entities, cameras: [...builder.cameras().keys()], exposure: builder.environment().exposure };
}

describe("SceneBuilder: incremental apply equals a fresh build", () => {
  for (const seed of [1, 2, 3, 5, 8, 13, 21, 34]) {
    it(`gives the same graph for the seed ${String(seed)}`, async () => {
      const random = seeded(seed);
      const counter = { next: 0 };
      const assets = new FakeAssets();
      const builder = new SceneBuilder({ assets });
      builder.build(showroom());
      let accepted = 0;
      for (let step = 0; step < 60; step += 1) {
        const before = builder.document();
        const result = builder.apply([randomOp(before, random, counter)]);
        if (result.ok) accepted += 1;
        else expect(builder.document()).toBe(before);
      }
      expect(accepted).toBeGreaterThan(20);
      await builder.ready();
      const fresh = new SceneBuilder({ assets: new FakeAssets() });
      fresh.build(structuredClone(builder.document()));
      await fresh.ready();
      expect(snapshot(builder)).toEqual(snapshot(fresh));
      // Each asset in use has one cache entry, with one user for each model component.
      const users = ASSETS.map((ref) => builder.assetUsers(ref));
      expect(users).toEqual(ASSETS.map((ref) => fresh.assetUsers(ref)));
      builder.dispose();
      expect(ASSETS.map((ref) => builder.assetUsers(ref))).toEqual([0, 0, 0]);
      const live = [...assets.models.values()].flat().filter((model) => !model.disposed.geometry);
      expect(live).toHaveLength(0);
    });
  }
});
