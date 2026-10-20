// SPDX-License-Identifier: Apache-2.0
// The attach keys and the IK goals in the time line (src/scene/attach.ts, src/scene/characters.ts): in the
// pickup scene of the characters sample, the robot walks to the table, reaches for the cup with an IK goal, and the
// cup attaches to its right hand (`entity:robot#rightHand`, a canonical bone through the bone names of its
// `character` component) from the pickup time. Three.js runs in Bun with no renderer.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Matrix4, Quaternion, Vector3, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { builtinRegistry, readDocument, type SceneDocument, type SequenceDocument } from "@scenity/scene";
import { SceneBuilder, SceneTimeline, type AssetKind, type AssetSource, type AssetValue } from "../src";

const SAMPLE = join(import.meta.dir, "../../../samples/characters");
const registry = builtinRegistry();
/** The pickup time: the attach key of the cup. */
const PICKUP = 5000;
/** The place of the cup on the table in the scene document. */
const ON_TABLE = [-0.2, 0.55, -0.2] as const;

function read<K extends "scene" | "sequence">(path: string, kind: K) {
  const result = readDocument(readFileSync(join(SAMPLE, path), "utf8"), kind, { registry });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.doc;
}

class RobotAssets implements AssetSource {
  async load(_ref: string, kind: AssetKind): Promise<AssetValue> {
    if (kind !== "model") throw new Error("the sample has only a model");
    const data = readFileSync(join(SAMPLE, "assets/sources/RobotExpressive/RobotExpressive.glb"));
    const gltf = await new GLTFLoader().parseAsync(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      "",
    );
    gltf.scene.animations = gltf.animations;
    return gltf.scene;
  }
}

/** A player of the pickup scene, with an optional change of its sequence. */
async function player(change: (sequence: SequenceDocument) => SequenceDocument = (sequence) => sequence) {
  const scene: SceneDocument = read("scenes/pickup.scene.json", "scene");
  const sequence = change(read("sequences/pickup.sequence.json", "sequence"));
  const builder = new SceneBuilder({ assets: new RobotAssets() });
  builder.build(scene);
  await builder.ready();
  const timeline = new SceneTimeline(builder, scene, sequence);
  const cup = (): Object3D => builder.entityObject("cup") ?? builder.root;
  const palm = (): Object3D => {
    let found: Object3D | undefined;
    builder.root.getObjectByName("robot")?.traverse((node) => {
      if (found === undefined && node.name === "Palm2R" && (node as Partial<{ isBone: boolean }>).isBone === true)
        found = node;
    });
    if (found === undefined) throw new Error("the robot has no right palm");
    return found;
  };
  return { builder, timeline, cup, palm };
}

function worldPlace(object: Object3D): Vector3 {
  object.updateWorldMatrix(true, false);
  return object.getWorldPosition(new Vector3());
}

/** The world matrix of the cup in the frame of the palm (no scale): constant while the cup follows the hand. */
function inHand(cup: Object3D, palm: Object3D): number[] {
  const position = new Vector3();
  const rotation = new Quaternion();
  palm.matrixWorld.decompose(position, rotation, new Vector3());
  const frame = new Matrix4().compose(position, rotation, new Vector3(1, 1, 1));
  return frame
    .invert()
    .multiply(cup.matrixWorld)
    .toArray()
    .map((value) => Math.round(value * 1e6));
}

/** The world matrices of the cup and of the palm, rounded to 1e-9. */
function snapshot(cup: Object3D, palm: Object3D): number[] {
  return [...cup.matrixWorld.toArray(), ...palm.matrixWorld.toArray()].map((value) => Math.round(value * 1e9));
}

describe("the attach keys and the IK goals in the time line", () => {
  test("the cup stays on the table before the pickup time", async () => {
    const { timeline, cup } = await player();
    for (const t of [0, 2000, 4000, 4900, PICKUP - 1]) {
      timeline.at(t);
      const place = worldPlace(cup());
      ON_TABLE.forEach((value, i) => expect(place.getComponent(i)).toBeCloseTo(value, 9));
    }
  });

  test("the IK goal brings the right hand to the grip of the cup", async () => {
    const { timeline, palm } = await player();
    timeline.at(4900);
    const hand = worldPlace(palm());
    // The socket `grip` of the cup: 5 cm behind its centre.
    expect(hand.distanceTo(new Vector3(-0.2, 0.55, -0.25))).toBeLessThan(1e-4);
    timeline.at(4000);
    expect(worldPlace(palm()).distanceTo(hand)).toBeGreaterThan(0.2);
  });

  test("from the pickup time the cup follows the hand, with no jump at the pickup", async () => {
    const { timeline, cup, palm } = await player();
    timeline.at(PICKUP);
    expect(worldPlace(cup()).distanceTo(new Vector3(...ON_TABLE))).toBeLessThan(1e-9);
    const held = inHand(cup(), palm());
    for (const t of [5300, 5600, 6000, 7000, 8000]) {
      timeline.at(t);
      expect(inHand(cup(), palm())).toEqual(held);
    }
    // The hand goal moves to the chest (the carry point): the cup goes up with the hand.
    timeline.at(6000);
    const lifted = worldPlace(cup());
    expect(lifted.y - ON_TABLE[1]).toBeGreaterThan(0.1);
    expect(lifted.distanceTo(new Vector3(...ON_TABLE))).toBeGreaterThan(0.15);
    // A seek back before the pickup puts the cup on the table again.
    timeline.at(3000);
    expect(worldPlace(cup()).distanceTo(new Vector3(...ON_TABLE))).toBeLessThan(1e-9);
  });

  test("a seek gives the frame of a play", async () => {
    const played = await player();
    const frames = new Map<number, number[]>();
    let since: number | undefined;
    for (let t = 0; t <= 8000; t += 40) {
      played.timeline.at(t, since);
      since = t;
      if (t % 200 === 0) frames.set(t, snapshot(played.cup(), played.palm()));
    }
    const sought = await player();
    // A fixed order of seeks back and forth (no random numbers).
    const times = [...frames.keys()].sort((a, b) => ((a * 7919) % 4001) - ((b * 7919) % 4001));
    for (const t of times) {
      sought.timeline.at(t);
      expect(snapshot(sought.cup(), sought.palm())).toEqual(frames.get(t) ?? []);
    }
  });

  test("a key with a local place snaps the cup into the hand frame; a null key drops it", async () => {
    const { timeline, cup, palm } = await player((sequence) => ({
      ...sequence,
      tracks: sequence.tracks.map((track) =>
        track.kind === "attach"
          ? {
              ...track,
              keys: [
                { t: PICKUP, to: "entity:robot#rightHand", position: [0, 0.05, 0] },
                { t: 7000, to: null },
              ],
            }
          : track,
      ),
    }));
    timeline.at(6000);
    const position = new Vector3();
    const rotation = new Quaternion();
    palm().matrixWorld.decompose(position, rotation, new Vector3());
    const expected = new Vector3(0, 0.05, 0).applyQuaternion(rotation).add(position);
    expect(worldPlace(cup()).distanceTo(expected)).toBeLessThan(1e-9);
    timeline.at(7000);
    const dropped = worldPlace(cup());
    timeline.at(8000);
    expect(worldPlace(cup()).distanceTo(dropped)).toBeLessThan(1e-9);
  });
});
