// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { documentJsonSchemas, FORMAT_CHAINS, readDocument, writeDocument, type SequenceDocument } from "../src/index";
import { fixture, fixtureText } from "./helpers";
import { validate } from "./jsonSchemaSubset";

/** The text of the tour fixture after a change. */
function changed(edit: (doc: SequenceDocument) => void): string {
  const doc = JSON.parse(fixtureText("tour.sequence.json")) as SequenceDocument;
  edit(doc);
  return JSON.stringify(doc);
}

function errorsOf(text: string): { path: string; message: string }[] {
  const result = readDocument(text, "sequence");
  return result.ok ? [] : [...result.errors];
}

describe("the sequence document", () => {
  test("the tour fixture reads as a sequence", () => {
    const doc = fixture("tour.sequence.json", "sequence");
    expect(doc.duration).toBe(20000);
    expect(doc.markers).toEqual({ "door-open": 5650 });
    expect(doc.tracks.map((track) => track.kind)).toEqual(["property", "action", "attach"]);
  });

  test("the longer fixture holds each track kind and reads back to the same bytes", () => {
    const text = fixtureText("walkthrough.sequence.json");
    const doc = fixture("walkthrough.sequence.json", "sequence");
    expect(new Set(doc.tracks.map((track) => track.kind))).toEqual(
      new Set(["camera", "transform", "property", "visibility", "event", "action", "animation", "attach"]),
    );
    expect(writeDocument(doc)).toBe(text);
  });

  test("the format chain has an entry for the sequence", () => {
    expect(FORMAT_CHAINS.sequence.current).toBe(1);
    const result = readDocument(changed((doc) => Object.assign(doc, { format: "scenity.sequence/2" })));
    expect(result).toEqual({
      ok: false,
      errors: [{ path: "/format", message: "this file has format scenity.sequence/2; this Scenity reads up to /1" }],
    });
  });
});

describe("the checks of the sequence document", () => {
  test("a key after the duration and a marker after the duration are errors at their paths", () => {
    const text = changed((doc) => {
      doc.duration = 6000;
    });
    const paths = errorsOf(text).map((error) => error.path);
    expect(paths).toContain("/tracks/0/keys/1/t");
    expect(paths).toContain("/tracks/2/keys/1/t");
    expect(paths).not.toContain("/markers/door-open");
    const late = changed((doc) => {
      doc.markers = { late: 30000 };
    });
    expect(errorsOf(late).map((error) => error.path)).toEqual(["/markers/late"]);
  });

  test("keys out of time order are an error", () => {
    const text = changed((doc) => {
      doc.tracks[0]?.keys.reverse();
    });
    expect(errorsOf(text)).toEqual([{ path: "/tracks/0/keys/1/t", message: "the keys of a track are in time order" }]);
  });

  test("a time is an integer count of ms", () => {
    const text = changed((doc) => {
      const key = doc.tracks[0]?.keys[1];
      if (key !== undefined) key.t = 10.5;
    });
    expect(errorsOf(text).map((error) => error.path)).toEqual(["/tracks/0/keys/1/t"]);
  });

  test("an action name has a plugin ID and a dot; an attach parent is an entity reference", () => {
    const action = changed((doc) => {
      const track = doc.tracks[1];
      if (track?.kind === "action" && track.keys[0] !== undefined) track.keys[0].action = "open";
    });
    expect(errorsOf(action).map((error) => error.path)).toEqual(["/tracks/1/keys/0/action"]);
    const attach = changed((doc) => {
      const track = doc.tracks[2];
      if (track?.kind === "attach" && track.keys[0] !== undefined) track.keys[0].to = "robot#hand_r";
    });
    expect(errorsOf(attach).map((error) => error.path)).toEqual(["/tracks/2/keys/0/to"]);
  });

  test("a Bézier ease has x1 and x2 in 0..1", () => {
    const ok = changed((doc) => {
      const key = doc.tracks[0]?.keys[1];
      if (key !== undefined && "ease" in key) key.ease = { bezier: [0.2, -0.5, 0.8, 1.5] };
    });
    expect(errorsOf(ok)).toEqual([]);
    const bad = changed((doc) => {
      const key = doc.tracks[0]?.keys[1];
      if (key !== undefined && "ease" in key) key.ease = { bezier: [1.2, 0, 0.8, 1] };
    });
    expect(errorsOf(bad).map((error) => error.path)).toEqual(["/tracks/0/keys/1/ease/bezier/0"]);
  });

  test("an unknown track kind is refused by the reader and by the JSON Schema", () => {
    const text = changed((doc) => Object.assign(doc.tracks[0] ?? {}, { kind: "sound" }));
    expect(errorsOf(text).length).toBeGreaterThan(0);
    expect(validate(documentJsonSchemas().sequence, JSON.parse(text)).length).toBeGreaterThan(0);
  });
});
