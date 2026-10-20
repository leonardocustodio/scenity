// SPDX-License-Identifier: Apache-2.0
// The levels of detail of the models (src/scene/lod.ts): the level of a screen
// size with hysteresis, the cap of the quality tier and the chain of a Manifest 2 record, the switch of a model and
// of its instance batch, and the cache of the entity boxes.
import { describe, expect, it } from "bun:test";
import { PerspectiveCamera, Vector3, type InstancedMesh } from "three";
import type { SceneDocument, SceneOp } from "@scenity/scene";
import type { SequenceDocument } from "@scenity/scene/sequence";
import { modelInstance, modelTemplate, SceneBuilder, SceneTimeline } from "../src";
import { pickLevel, screenSize } from "../src/scene/lod";
import { ManifestAssets, recordChain, recordFile, recordLevel } from "../src/scene/manifestAssets";
import { FakeAssets, firstMesh, manifestOf, modelRecord } from "./sceneHelpers";

const CRATE = "asset:crate";

/** A fake source with one coarser level for each model (`<ref>@low`). */
class LodAssets extends FakeAssets {
  lods(ref: string): readonly string[] {
    return [`${ref}@low`];
  }
}

function scene(count: number, lod: Record<string, unknown> | null = { screen: [0.2] }): SceneDocument {
  const entities: SceneDocument["entities"] = {};
  for (let i = 0; i < count; i += 1) {
    entities[`crate-${String(i)}`] = {
      parent: null,
      index: i,
      components: {
        transform: { position: [i, 0, 0] },
        model: lod === null ? { asset: CRATE } : { asset: CRATE, lod },
      },
    };
  }
  return { format: "scenity.scene/1", id: "lods", entities };
}

/** A camera on the Z axis at a distance from the row, looking at it. */
function cameraAt(distance: number): PerspectiveCamera {
  const view = new PerspectiveCamera(50, 1.6, 0.1, 500);
  view.position.set(0, 0.25, distance);
  view.lookAt(0, 0.25, 0);
  view.updateMatrixWorld(true);
  return view;
}

async function built(doc: SceneDocument, assets = new LodAssets()) {
  const builder = new SceneBuilder({ assets });
  builder.build(doc);
  await builder.ready();
  return { builder, assets };
}

function applied(builder: SceneBuilder, ops: SceneOp[]): void {
  const result = builder.apply(ops);
  if (!result.ok) throw new Error(result.reason);
}

describe("pickLevel", () => {
  const screen = [0.3, 0.1];

  it("gives the level of a size with no history", () => {
    expect(pickLevel(0.5, screen, 0, 0, 2)).toBe(0);
    expect(pickLevel(0.2, screen, 0, 0, 2)).toBe(1);
    expect(pickLevel(0.05, screen, 0, 0, 2)).toBe(2);
    expect(pickLevel(0.05, screen, 0, 0, 1)).toBe(1);
  });

  it("changes a level only past the threshold and its hysteresis", () => {
    // At 0.28 the raw level is 1, but a model on level 0 stays until the size is under 0.3 × 0.9 = 0.27.
    expect(pickLevel(0.28, screen, 0, 0.1, 2)).toBe(0);
    expect(pickLevel(0.26, screen, 0, 0.1, 2)).toBe(1);
    // The model returns to level 0 only over 0.3 × 1.1 = 0.33.
    expect(pickLevel(0.32, screen, 1, 0.1, 2)).toBe(1);
    expect(pickLevel(0.34, screen, 1, 0.1, 2)).toBe(0);
  });

  it("gives the screen size of a sphere: its diameter over the height of the view", () => {
    const view = cameraAt(10);
    const size = screenSize(new Vector3(0, 0.25, 0), 1, view);
    expect(size).toBeCloseTo(1 / (10 * Math.tan((25 * Math.PI) / 180)), 6);
    expect(screenSize(new Vector3(0, 0.25, 9.5), 1, view)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("the LOD chain of a Manifest 2 record", () => {
  const lods = [
    { tier: "high", file: "a.high.glb", triangles: 1000, meshes: 1, maxTextureSize: 1024 },
    { tier: "low", file: "a.low.glb", triangles: 500, meshes: 1, maxTextureSize: 512 },
  ];
  const record = modelRecord("a1", ["a.high.glb", "a.low.glb"], lods);

  it("caps the best level with the quality tier", () => {
    expect(recordLevel(record, "high")).toBe(0);
    expect(recordLevel(record, "ultra")).toBe(0);
    // A tier with no level of its own takes the best level of a lower tier.
    expect(recordLevel(record, "medium")).toBe(1);
    expect(recordFile(record, "medium")).toBe("a.low.glb");
    expect(recordLevel(record, "other")).toBe(0);
  });

  it("gives the coarser levels after the level of the tier", () => {
    expect(recordChain(record, "high").map((lod) => lod.file)).toEqual(["a.low.glb"]);
    expect(recordChain(record, "low")).toEqual([]);
    const source = new ManifestAssets({
      manifest: manifestOf([record]),
      files: { "a.high.glb": "/b/a.high.glb", "a.low.glb": "/b/a.low.glb" },
      tier: "high",
    });
    expect(source.lods("asset:a1")).toEqual(["asset:a1@low"]);
    expect(source.url("asset:a1@low")).toBe("/b/a.low.glb");
    expect(source.url("asset:a1")).toBe("/b/a.high.glb");
    const capped = new ManifestAssets({
      manifest: manifestOf([record]),
      files: { "a.low.glb": "/b/a.low.glb" },
      tier: "medium",
    });
    expect(capped.lods("asset:a1")).toEqual([]);
    expect(capped.url("asset:a1")).toBe("/b/a.low.glb");
  });
});

describe("SceneBuilder: levels of detail", () => {
  it("loads the levels with the model, so ready() waits for them", async () => {
    const { assets } = await built(scene(1));
    expect(assets.loads.get(CRATE)).toBe(1);
    expect(assets.loads.get(`${CRATE}@low`)).toBe(1);
  });

  it("switches a model to the coarser level by its screen size; a user camera adds hysteresis", async () => {
    const { builder, assets } = await built(scene(1));
    const holder = builder.componentObject("crate-0", "model")!;
    builder.frame(cameraAt(2));
    expect(builder.lodLevels()).toEqual({ "crate-0": 0 });
    expect(modelTemplate(holder)).toBe(assets.model(CRATE).root);
    builder.frame(cameraAt(40));
    expect(builder.lodLevels()).toEqual({ "crate-0": 1 });
    expect(modelTemplate(holder)).toBe(assets.model(`${CRATE}@low`).root);
    expect(firstMesh(modelInstance(holder))?.geometry).toBe(assets.model(`${CRATE}@low`).geometry);
    // The sphere of the crate has a radius of about 0.43 m: the threshold 0.2 is at about 4.6 m.
    const radius = Math.sqrt(3) * 0.25;
    const at = (size: number) => radius / (size * Math.tan((25 * Math.PI) / 180));
    // A user camera: the level holds inside the band of the hysteresis.
    builder.frame(cameraAt(at(0.21)), true);
    expect(builder.lodLevels()["crate-0"]).toBe(1);
    builder.frame(cameraAt(at(0.23)), true);
    expect(builder.lodLevels()["crate-0"]).toBe(0);
    builder.frame(cameraAt(at(0.19)), true);
    expect(builder.lodLevels()["crate-0"]).toBe(0);
    // A fixed camera: the level comes only from the size.
    builder.frame(cameraAt(at(0.19)));
    expect(builder.lodLevels()["crate-0"]).toBe(1);
    builder.frame(cameraAt(at(0.21)));
    expect(builder.lodLevels()["crate-0"]).toBe(0);
  });

  it("gives the levels of a play to t after a seek to t (a frame is a function of the time)", async () => {
    // The crate moves far at 1000 ms, then has a size of 0.21 at 2000 ms: inside the band of the hysteresis.
    const radius = Math.sqrt(3) * 0.25;
    const near = 10 - radius / (0.21 * Math.tan((25 * Math.PI) / 180));
    const sequence: SequenceDocument = {
      format: "scenity.sequence/1",
      id: "lods",
      scene: "lods",
      duration: 3000,
      tracks: [
        {
          entity: "crate-0",
          kind: "property",
          path: "transform/position",
          keys: [
            { t: 0, value: [0, 0, 8], ease: "step" },
            { t: 1000, value: [0, 0, -60], ease: "step" },
            { t: 2000, value: [0, 0, near], ease: "step" },
          ],
        },
      ],
    };
    const camera = cameraAt(10);
    const levelsAt = async (times: readonly number[], userCamera: boolean) => {
      const { builder } = await built(scene(1));
      const timeline = new SceneTimeline(builder, builder.document(), sequence);
      for (const t of times) {
        timeline.at(t);
        builder.frame(camera, userCamera);
      }
      return builder.lodLevels();
    };
    const play = Array.from({ length: 26 }, (_, index) => index * 100);
    const seek = [2500];
    expect(await levelsAt(play, false)).toEqual(await levelsAt(seek, false));
    expect(await levelsAt(seek, false)).toEqual({ "crate-0": 0 });
    // The check sees the fault: a user camera keeps the far level of the play.
    expect(await levelsAt(play, true)).toEqual({ "crate-0": 1 });
  });

  it("puts the models of one level into one batch", async () => {
    const { builder, assets } = await built(scene(4));
    builder.frame(cameraAt(60));
    const holder = builder.root.children.find((child) => child.name === "instances");
    const [batch] = (holder?.children ?? []) as InstancedMesh[];
    expect(batch?.count).toBe(4);
    expect(batch?.geometry).toBe(assets.model(`${CRATE}@low`).geometry);
  });

  it("shows the model again and releases its levels when the lod value goes", async () => {
    const { builder, assets } = await built(scene(1));
    builder.frame(cameraAt(40));
    applied(builder, [{ op: "set", path: "/entities/crate-0/components/model", value: { asset: CRATE } }]);
    builder.frame(cameraAt(40));
    const holder = builder.componentObject("crate-0", "model")!;
    expect(modelTemplate(holder)).toBe(assets.model(CRATE).root);
    expect(assets.released).toContain(`${CRATE}@low`);
    expect(builder.assetUsers(`${CRATE}@low`)).toBe(0);
  });

  it("releases the levels with the entity", async () => {
    const { builder, assets } = await built(scene(2));
    builder.frame(cameraAt(40));
    applied(builder, [{ op: "remove", id: "crate-0" }]);
    builder.frame(cameraAt(40));
    expect(builder.assetUsers(`${CRATE}@low`)).toBe(1);
    applied(builder, [{ op: "remove", id: "crate-1" }]);
    builder.frame(cameraAt(40));
    expect(assets.released).toContain(`${CRATE}@low`);
  });

  it("keeps a model with no lod value on the level of the quality tier", async () => {
    const { builder, assets } = await built(scene(1, null));
    builder.frame(cameraAt(80));
    expect(assets.loads.has(`${CRATE}@low`)).toBe(false);
    expect(modelTemplate(builder.componentObject("crate-0", "model")!)).toBe(assets.model(CRATE).root);
  });
});

describe("SceneBuilder: the cache of the entity boxes", () => {
  it("gives the same box until the graph changes", async () => {
    const { builder } = await built(scene(2, null));
    const first = builder.bounds("crate-1");
    expect(first.min.x).toBeCloseTo(0.75, 6);
    first.min.x = 99;
    expect(builder.bounds("crate-1").min.x).toBeCloseTo(0.75, 6);
    applied(builder, [{ op: "set", path: "/entities/crate-1/components/transform/position/0", value: 3 }]);
    expect(builder.bounds("crate-1").min.x).toBeCloseTo(2.75, 6);
    // An object that moves in place needs invalidateBounds.
    builder.entityObject("crate-1")!.position.x = 5;
    expect(builder.bounds("crate-1").min.x).toBeCloseTo(2.75, 6);
    builder.invalidateBounds();
    expect(builder.bounds("crate-1").min.x).toBeCloseTo(4.75, 6);
  });
});
