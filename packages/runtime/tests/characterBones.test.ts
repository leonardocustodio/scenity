// SPDX-License-Identifier: Apache-2.0
// The bone names of the `character` component on a model of the generic loader. The glTF loader
// removes the dots of a node name (`UpperArm.L` loads as `UpperArmL`), so the bone map of the robot of the pickup scene
// must give the node names of the loaded model. The IK goal, the attach key and the sub-targets of the pick and of the
// projected points then resolve `entity:robot#rightHand` to the palm bone, with no quiet fallback.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Vector3, type Object3D } from "three";
import { boneNode, characterBones } from "@scenity/character/characterRig";
import { GenericAssetLoader } from "@scenity/render/genericAssets";
import { builtinRegistry, readDocument, type CharacterValue, type SceneDocument } from "@scenity/scene";
import { entityModel, SceneBuilder, SceneTimeline, type AssetKind, type AssetSource, type AssetValue } from "../src";
import { refPoint, subPoints } from "../src/scene/subTargets";

const SAMPLE = join(import.meta.dir, "../../../samples/characters");
const registry = builtinRegistry();

function read<K extends "scene" | "sequence">(path: string, kind: K) {
  const result = readDocument(readFileSync(join(SAMPLE, path), "utf8"), kind, { registry });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.doc;
}

/** The robot through the generic loader of the scene page (`GenericAssetLoader` of `@scenity/render`). */
class GenericRobot implements AssetSource {
  readonly #loader = new GenericAssetLoader();
  async load(_ref: string, kind: AssetKind): Promise<AssetValue> {
    if (kind !== "model") throw new Error("the sample has only a model");
    const data = readFileSync(join(SAMPLE, "assets/sources/RobotExpressive/RobotExpressive.glb"));
    const gltf = await this.#loader.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), "");
    gltf.scene.animations = gltf.animations;
    return gltf.scene;
  }
}

async function pickup() {
  const scene: SceneDocument = read("scenes/pickup.scene.json", "scene");
  const builder = new SceneBuilder({ assets: new GenericRobot() });
  builder.build(scene);
  await builder.ready();
  const timeline = new SceneTimeline(builder, scene, read("sequences/pickup.sequence.json", "sequence"));
  const group = builder.entityObject("robot");
  const model = group === undefined ? undefined : entityModel(group);
  if (model === undefined) throw new Error("the robot did not load");
  const character = scene.entities.robot?.components.character as CharacterValue;
  return { builder, timeline, model, character };
}

const isBone = (node: Object3D | undefined) => (node as Partial<{ isBone: boolean }>).isBone === true;

describe("the bone names of a character on a loaded model", () => {
  test("each bone name of the component maps to a bone of the loaded model", async () => {
    const { model, character } = await pickup();
    const map = characterBones(model, character);
    expect(Object.keys(character.bones ?? {}).length).toBe(11);
    for (const [bone, written] of Object.entries(character.bones ?? {})) {
      const name = map.get(bone as never);
      // The loader removes the dots, and it adds "_1" to the bone "Torso" after the mesh "Torso".
      expect(name).toBe(written === "Torso" ? "Torso_1" : written.replace(/\./g, ""));
      // The bone and not a mesh of the same name (the robot has a mesh "Head" and a mesh "Torso").
      const node = boneNode(model, map, bone);
      expect(isBone(node)).toBe(true);
      expect(node?.name).toBe(name);
    }
    expect(boneNode(model, map, "rightHand")?.name).toBe("Palm2R");
    expect(boneNode(model, map, "leftUpperArm")?.name).toBe("UpperArmL");
  });

  test("the sub-targets and the projected points name the hands by their canonical names", async () => {
    const { builder, timeline, model } = await pickup();
    timeline.at(4900);
    const bones = subPoints(builder, "robot", new Set(["bone"])).map((point) => point.id);
    for (const name of ["rightHand", "leftHand", "rightUpperArm", "leftLowerArm", "head", "hips"])
      expect(bones).toContain(name);
    expect(bones).not.toContain("Palm2R");
    const palm = model.getObjectByName("Palm2R");
    const point = refPoint(builder, "entity:robot#rightHand");
    expect(point?.at.distanceTo(palm?.getWorldPosition(new Vector3()) ?? new Vector3())).toBeLessThan(1e-9);
  });

  test("the IK goal and the attach key resolve the palm, not a fallback", async () => {
    const { builder, timeline, model } = await pickup();
    timeline.at(4900);
    const palm = model.getObjectByName("Palm2R");
    // The hand goal: the grip socket of the cup, 5 cm behind its centre.
    expect(palm?.getWorldPosition(new Vector3()).distanceTo(new Vector3(-0.2, 0.55, -0.25))).toBeLessThan(1e-4);
    timeline.at(6000);
    const cup = builder.entityObject("cup")?.getWorldPosition(new Vector3());
    expect(cup?.distanceTo(palm?.getWorldPosition(new Vector3()) ?? new Vector3())).toBeLessThan(0.08);
    expect(cup?.distanceTo(new Vector3(-0.2, 0.55, -0.2))).toBeGreaterThan(0.1);
  });
});
