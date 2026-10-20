// SPDX-License-Identifier: Apache-2.0
/**
 * `scenity frames`: the frames of the walkthrough sample by sequence, camera and time, a key that changes with a
 * document, two pictures of each place in the list, the stale marks and the arguments.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFramesArgs } from "../src/frames/command";
import {
  mergeFrames,
  placeOf,
  projectContentHash,
  projectDocuments,
  readFrameIndex,
  wantedFrames,
  withStaleMarks,
  writeFrameIndex,
  type IndexedFrame,
} from "../src/frames/frameIndex";

const WALKTHROUGH = join(import.meta.dir, "../../../samples/walkthrough");
const temp = mkdtempSync(join(tmpdir(), "scenity-frames-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

const docs = projectDocuments(WALKTHROUGH);
const wanted = wantedFrames(docs.project, docs.files, projectContentHash(WALKTHROUGH, docs.project));

describe("scenity frames: the frame index", () => {
  test("gives a frame of each camera at 0 ms and at each moment of the sequence", () => {
    const cameras = [...new Set(wanted.map((frame) => frame.camera))];
    expect(cameras).toEqual(["front", "table-view", "top", "tour"]);
    expect(new Set(wanted.map((frame) => frame.plan))).toEqual(new Set(["sequence:sequences/meet.sequence.json"]));
    expect(wanted.every((frame) => frame.scene === "scenes/plaza.scene.json")).toBe(true);
    const front = wanted.filter((frame) => frame.camera === "front").map((frame) => frame.time);
    expect(front[0]).toBe(0);
    expect(front).toEqual([...front].sort((a, b) => a - b));
    expect(new Set(wanted.map((frame) => frame.key)).size).toBe(wanted.length);
    // A step adds the times of a grid.
    const grid = wantedFrames(docs.project, docs.files, "hash", 1000);
    expect(grid.length).toBeGreaterThanOrEqual(wanted.length);
  });

  test("a change of a document or of the content hash gives new keys", () => {
    const sequence = docs.files["sequences/meet.sequence.json"] as Record<string, unknown>;
    const changed = { ...docs.files, "sequences/meet.sequence.json": { ...sequence, loop: !sequence.loop } };
    const keys = new Set(wanted.map((frame) => frame.key));
    expect(wantedFrames(docs.project, changed, "other").some((frame) => keys.has(frame.key))).toBe(false);
  });

  test("the list keeps the two newest pictures of each place and marks the stale ones", () => {
    const first = wanted[0];
    if (first === undefined) throw new Error("no frame");
    const at = (made: string, key: string): IndexedFrame => ({ ...first, key, made });
    const list = mergeFrames(
      [at("2026-10-01T00:00:00Z", "a"), at("2026-10-02T00:00:00Z", "b")],
      [at("2026-10-03T00:00:00Z", first.key)],
    );
    expect(list.map((frame) => frame.key)).toEqual([first.key, "b"]);
    expect(new Set(list.map(placeOf)).size).toBe(1);
    expect(withStaleMarks(list, wanted).map((frame) => frame.stale)).toEqual([false, true]);
    writeFrameIndex(temp, list);
    expect(readFrameIndex(temp).frames).toEqual(list);
    expect(readFrameIndex(join(temp, "none")).frames).toEqual([]);
  });

  test("takes a project, a step and a size", () => {
    expect(parseFramesArgs(["samples/walkthrough", "--step", "500", "--size", "320x200", "--json"])).toEqual({
      options: { dir: "samples/walkthrough", step: 500, size: { width: 320, height: 200 }, build: false },
      json: true,
    });
    expect(parseFramesArgs(["a", "b"])).toBeNull();
    expect(parseFramesArgs(["--backend", "metal"])).toBeNull();
  });
});
