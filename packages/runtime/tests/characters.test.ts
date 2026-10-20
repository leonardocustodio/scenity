// SPDX-License-Identifier: Apache-2.0
// The `character` component in the time line (src/scene/characters.ts, src/scene/animate.ts): the clips of a clip
// source through the retarget, the variants of the look, and the IK goals of a model with no animator.
// The scenes use the Rigify mannequin of the characters sample. Three.js runs in Bun with no renderer.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Color, Vector3, type Mesh, type MeshStandardMaterial, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { boneNode, characterBones } from "@scenity/character/characterRig";
import { builtinRegistry, readValue, type SceneDocument, type SequenceDocument } from "@scenity/scene";
import { entityModel, SceneBuilder, SceneTimeline, type AssetKind, type AssetSource, type AssetValue } from "../src";

const SAMPLE = join(import.meta.dir, "../../../samples/characters/assets/sources");
const MANNEQUIN = "asset:01M518N6P8VF0Z4WYHJHSRFZHB";
const registry = builtinRegistry();

class MannequinAssets implements AssetSource {
  async load(_ref: string, kind: AssetKind): Promise<AssetValue> {
    if (kind !== "model") throw new Error("the test has only models");
    const data = readFileSync(join(SAMPLE, "RigifyMannequin/RigifyMannequin.glb"));
    const gltf = await new GLTFLoader().parseAsync(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      "",
    );
    gltf.scene.animations = gltf.animations;
    return gltf.scene;
  }
}

const IDLE = {
  controller: {
    layers: [{ name: "base", start: "idle", states: { idle: { motion: { kind: "clip", clip: "Idle" } } } }],
  },
};

function scene(entities: Record<string, unknown>): SceneDocument {
  const result = readValue({ format: "scenity.scene/1", id: "test", entities }, "scene", { registry });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.doc as SceneDocument;
}

function sequence(tracks: unknown[] = []): SequenceDocument {
  const value = { format: "scenity.sequence/1", id: "test", scene: "test", duration: 4000, tracks };
  const result = readValue(value, "sequence", { registry });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.doc as SequenceDocument;
}

async function player(doc: SceneDocument, seq: SequenceDocument = sequence()) {
  const builder = new SceneBuilder({ assets: new MannequinAssets() });
  builder.build(doc);
  await builder.ready();
  const timeline = new SceneTimeline(builder, doc, seq);
  const model = (id: string): Object3D => {
    const object = builder.entityObject(id);
    const found = object === undefined ? undefined : entityModel(object);
    if (found === undefined) throw new Error(`no model of ${id}`);
    return found;
  };
  const bone = (id: string, name: string): Vector3 => {
    const root = model(id);
    const node = boneNode(root, characterBones(root, { rig: "rigify" }), name);
    if (node === undefined) throw new Error(`no ${name}`);
    node.updateWorldMatrix(true, false);
    return node.getWorldPosition(new Vector3());
  };
  return { builder, timeline, model, bone };
}

describe("the character component in the time line", () => {
  test("an animator plays the clips of its clip source through the retarget", async () => {
    // Two mannequins at the same place. One plays its own idle, and one plays the idle of its clip source (the same
    // asset).
    const doc = scene({
      own: { parent: null, index: 0, components: { model: { asset: MANNEQUIN }, animator: IDLE } },
      borrowed: {
        parent: null,
        index: 1,
        components: {
          model: { asset: MANNEQUIN },
          animator: { ...IDLE, clipSource: { asset: MANNEQUIN, rig: "rigify" } },
          character: { rig: "rigify" },
        },
      },
    });
    const { timeline, bone } = await player(doc);
    let moved = 0;
    timeline.at(0);
    const start = bone("own", "leftHand");
    for (const t of [0, 700, 1400, 2100, 2800]) {
      timeline.at(t);
      for (const name of ["head", "leftHand", "rightHand", "leftFoot", "rightLowerArm"])
        expect(bone("borrowed", name).distanceTo(bone("own", name))).toBeLessThan(0.01);
      moved = Math.max(moved, bone("own", "leftHand").distanceTo(start));
    }
    expect(moved).toBeGreaterThan(0.005);
  });

  test("a variant merges its material overrides over the model", async () => {
    const variants = {
      night: { mannequin_wood: { colour: "#204060" } },
      day: { mannequin_wood: { colour: "#e0c080" } },
    };
    const doc = scene({
      mannequin: {
        parent: null,
        index: 0,
        components: { model: { asset: MANNEQUIN }, character: { rig: "rigify", variants, variant: "night" } },
      },
    });
    const seq = sequence([
      {
        entity: "mannequin",
        kind: "property",
        path: "character/variant",
        keys: [
          { t: 0, value: "night" },
          { t: 2000, value: "day", ease: "step" },
        ],
      },
    ]);
    const { timeline, builder, model } = await player(doc, seq);
    const colour = (): string => {
      let found: string | undefined;
      model("mannequin").traverse((node) => {
        const material = (node as Partial<Mesh>).material as MeshStandardMaterial | undefined;
        if (found === undefined && material?.name === "mannequin_wood") found = material.color.getHexString();
      });
      return found ?? "";
    };
    timeline.at(1000);
    await builder.ready();
    timeline.at(1000);
    expect(colour()).toBe(new Color("#204060").getHexString());
    timeline.at(3000);
    await builder.ready();
    timeline.at(3000);
    expect(colour()).toBe(new Color("#e0c080").getHexString());
  });

  test("an IK goal moves the hand of a model with no animator, and a zero weight gives the rest pose back", async () => {
    const doc = scene({
      mannequin: {
        parent: null,
        index: 0,
        components: {
          model: { asset: MANNEQUIN },
          character: { rig: "rigify", ik: { leftHand: { target: "entity:ball", weight: 1 } } },
        },
      },
      ball: { parent: null, index: 1, components: { transform: { position: [0.35, 1.2, 0.3] } } },
    });
    const seq = sequence([
      {
        entity: "mannequin",
        kind: "property",
        path: "character/ik/leftHand/weight",
        keys: [
          { t: 0, value: 0 },
          { t: 1000, value: 1, ease: "linear" },
          { t: 2000, value: 0, ease: "step" },
        ],
      },
    ]);
    const { timeline, bone } = await player(doc, seq);
    timeline.at(0);
    const rest = bone("mannequin", "leftHand");
    timeline.at(1000);
    const reached = bone("mannequin", "leftHand");
    const target = new Vector3(0.35, 1.2, 0.3);
    expect(reached.distanceTo(target)).toBeLessThan(rest.distanceTo(target));
    expect(reached.distanceTo(target)).toBeLessThan(0.05);
    timeline.at(2500);
    expect(bone("mannequin", "leftHand").distanceTo(rest)).toBeLessThan(1e-9);
  });
});
