// SPDX-License-Identifier: Apache-2.0
// The scratch props of the lab: the URL text, the places for the core,
// the edits, the frame key with and without scratch props, and the readers of the import facts and of a promote.
import { frameKey } from "@scenity/labs-platform/frameKey";
import { describe, expect, it } from "vitest";
import { dragPlace, snapTurn } from "../../src/core/edit/placeDrag";
import { labFrameInput, rendererOptions, type LabKeyState } from "../../src/core/index/frameInput";
import { stripKey } from "../../src/core/index/stripKey";
import { promoteAnswer, promoteBlock, readInfo, rightsGap } from "../../src/core/scratch/scratchInfo";
import {
  indexOf,
  modelsOf,
  parseScratch,
  placeOfEntry,
  scratchPlaces,
  scratchText,
  withAdded,
  withDuplicate,
  withPlace,
  without,
} from "../../src/core/scratch/scratchList";

const A = "lx0abc-0011aabb";
const B = "lx0abd-22334455";
const HASH = "0".repeat(32);

describe("the scratch list", () => {
  it("reads and writes the URL text, and the text of a list reads back as the same list", () => {
    const list = parseScratch(`${A}@0.5,0,1.25,15;${B}@-1.2,0.9,-0.4,-90.5`);
    expect(list).toEqual([
      { model: A, at: [0.5, 0, 1.25], turnDeg: 15 },
      { model: B, at: [-1.2, 0.9, -0.4], turnDeg: -90.5 },
    ]);
    expect(parseScratch(scratchText(list))).toEqual(list);
    expect(scratchText([])).toBe("");
  });

  it("leaves out a part that is not an entry", () => {
    expect(parseScratch(`not-an-id@1,2,3,4;${A}@1,2,3;${A}@1,x,3,4;${A}@99,0,0,0;${A}@1,0,1,370`)).toEqual([
      { model: A, at: [1, 0, 1], turnDeg: 10 },
    ]);
    expect(parseScratch(null)).toEqual([]);
  });

  it("gives the core the places in radians, with IDs in the order of the list", () => {
    const places = scratchPlaces(parseScratch(`${A}@0.5,0,1,90;${A}@0,0,0,0`));
    expect(places.map((place) => [place.id, place.model])).toEqual([
      ["scratch-1", A],
      ["scratch-2", A],
    ]);
    expect(places[0]?.yaw).toBeCloseTo(Math.PI / 2, 12);
  });

  it("adds, duplicates beside, moves on the grid and deletes", () => {
    let list = withAdded([], A, [0.4, 0, 1.2]);
    list = withDuplicate(list, "scratch-1");
    expect(list[1]).toEqual({ model: A, at: [0.7, 0, 1.2], turnDeg: 0 });
    list = withPlace(list, "scratch-2", { at: [0.70049, 0.1, 1.2], yaw: snapTurn(0.3, 15) });
    expect(list[1]).toEqual({ model: A, at: [0.7, 0.1, 1.2], turnDeg: 15 });
    expect(withPlace(list, "scratch-9", { at: [0, 0, 0], yaw: 0 })).toEqual(list);
    list = without(list, "scratch-1");
    expect(list).toEqual([{ model: A, at: [0.7, 0.1, 1.2], turnDeg: 15 }]);
    expect(indexOf(list, "scratch-1")).toBe(0);
    expect(modelsOf([...list, ...withAdded([], B, [0, 0, 0]), ...list])).toEqual([A, B]);
  });

  it("a drag of a scratch prop writes a place that the URL text gives back exactly", () => {
    const start = parseScratch(`${A}@0.4,0,1.2,30`)[0];
    if (start === undefined) throw new Error("no entry");
    const camera = {
      world: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1.6, 3, 1],
      projectionInverse: [0.8, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0, -9.9, 0, 0, -1, 10],
      width: 800,
      height: 600,
    };
    const drag = {
      slot: "scratch-1",
      mode: "turn" as const,
      place: placeOfEntry(start),
      grab: start.at,
      camera,
      x: 400,
      y: 300,
    };
    const next = withPlace([start], "scratch-1", dragPlace(drag, 300, 300, { shift: false, alt: false }));
    // 100 px of the 300 px of a quarter turn: 30° in steps of 15°.
    expect(next[0]?.turnDeg).toBe(60);
    expect(parseScratch(scratchText(next))).toEqual(next);
  });
});

describe("the frame key with scratch props", () => {
  const state: LabKeyState = {
    take: "greet",
    track: null,
    events: [],
    tunes: {},
    debug: [],
    assets: true,
    reduced: false,
    tier: "high",
  };

  it("keeps the key of a frame without scratch props, and separates the frames with them", () => {
    expect(rendererOptions({ ...state, scratch: "" })).toEqual(rendererOptions(state));
    const plain = frameKey(labFrameInput(state, 9000, "chest", HASH));
    const empty = frameKey(labFrameInput({ ...state, scratch: "" }, 9000, "chest", HASH));
    const one = frameKey(labFrameInput({ ...state, scratch: `${A}@0.5,0,1,0` }, 9000, "chest", HASH));
    const moved = frameKey(labFrameInput({ ...state, scratch: `${A}@0.6,0,1,0` }, 9000, "chest", HASH));
    expect(empty).toBe(plain);
    expect(new Set([plain, one, moved]).size).toBe(3);
  });

  it("separates the strips with and without scratch props", () => {
    const strip = {
      take: "greet",
      events: [],
      range: { from: 0, to: 1000 },
      count: 8,
      view: "chest",
      tunes: {},
      debug: [],
      assets: true,
      tier: "high",
      contentHash: HASH,
    };
    expect(stripKey({ ...strip, scratch: "" })).toBe(stripKey(strip));
    expect(stripKey({ ...strip, scratch: `${A}@0.5,0,1,0` })).not.toBe(stripKey(strip));
  });
});

describe("the import facts and the promote of a scratch prop", () => {
  const facts = {
    import: A,
    name: "chair.glb",
    source: "Generated by code in this repository (a test)",
    licence: "Own work of Snowpine; no third-party content",
    rights: { allowed: true, reason: null },
    pass: true,
    triangles: 188,
    kb: 7,
    warnings: [],
  };

  it("reads the facts and finds the gaps of the rights", () => {
    const info = readInfo({ ...facts, rights: { allowed: true, entry: "scenity-own-work" }, point: [0, 0, 0] });
    expect(info).toEqual(facts);
    expect(readInfo({ import: A, error: "no model" })).toBeNull();
    expect(readInfo({ import: "x" })).toBeNull();
    expect(rightsGap(info)).toBeNull();
    expect(rightsGap({ ...facts, licence: "" })).toBe("no licence");
    expect(rightsGap({ ...facts, source: "", licence: "" })).toBe("no source and no licence");
    expect(promoteBlock(info)).toBeNull();
    // A gap of the rights does not stop the promote; the release gate stops the asset.
    expect(promoteBlock({ ...facts, source: "" })).toBeNull();
    // The answer of the licence register: the card shows why the source or the licence is not allowed.
    const refused = readInfo({ ...facts, rights: { allowed: false, reason: 'the source "x" is not in the register' } });
    expect(rightsGap(refused)).toBe('the source "x" is not in the register');
    expect(promoteBlock(refused)).toBeNull();
    expect(rightsGap({ ...facts, rights: null })).toBe(
      "not checked against the licence register: import the file again",
    );
    expect(readInfo({ ...facts, rights: { reason: "no allowed field" } })?.rights).toBeNull();
    expect(promoteBlock({ ...facts, pass: false })).toBe("the model is not in the budget");
    expect(promoteBlock(null)).toBe("no import record");
  });

  it("reads the answer of the host (the asset and the entity, no prompt)", () => {
    const answer = promoteAnswer("scratch-1", {
      dry: false,
      refused: null,
      changes: ["a", 3, "b"],
      asset: { id: "01ASSET", source: "s", record: "r" },
      entity: { id: "chair", scene: "main.scene.json" },
      rights: { record: "rights/imports.yaml", blocked: true, note: "The release gate stops it." },
      followUp: ["a code change"],
    });
    expect(answer).toEqual({
      id: "scratch-1",
      dry: false,
      status: "done",
      refused: null,
      changes: ["a", "b"],
      asset: "01ASSET",
      entity: "chair",
      rights: "The release gate stops it.",
      followUp: ["a code change"],
    });
    expect(promoteAnswer("scratch-1", { dry: true, refused: null })).toMatchObject({ asset: null, followUp: [] });
    expect(promoteAnswer("scratch-1", { dry: false, refused: "The import failed" })?.status).toBe("refused");
    expect(promoteAnswer("scratch-1", null)).toBeNull();
  });
});
