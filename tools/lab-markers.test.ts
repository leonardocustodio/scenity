// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gateFails, markerGate, type Marker } from "./lab-markers";

const MARKERS: Marker[] = [
  { id: "__room3dLab", kind: "lab", what: "the lab script API", pattern: /__room3dLab/ },
  { id: "pose.maskHand", kind: "info", what: "a tune key", pattern: /"pose\.maskHand"/ },
];

const folders: string[] = [];

/** A build folder with one script of this text. */
function build(text: string): string {
  const dist = mkdtempSync(join(tmpdir(), "lab-markers-"));
  folders.push(dist);
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "assets", "index.js"), text);
  return dist;
}

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe("the lab marker gate", () => {
  it("passes a runtime build with tune keys only, and gives the keys as information", () => {
    const gate = markerGate(build('tunable("pose.maskHand",{a:1})'), build('__room3dLab;"pose.maskHand"'), MARKERS);
    expect(gate.found).toEqual([]);
    expect(gate.info.map((item) => item.marker.id)).toEqual(["pose.maskHand"]);
    expect(gate.stale).toEqual([]);
    expect(gateFails(gate)).toBe(false);
  });

  it("fails on a lab marker in the runtime build", () => {
    const gate = markerGate(build("globalThis.__room3dLab={}"), null, MARKERS);
    expect(gate.found.map((item) => item.marker.id)).toEqual(["__room3dLab"]);
    expect(gateFails(gate)).toBe(true);
  });

  it("fails when the labs build does not have a lab marker (a stale list)", () => {
    const gate = markerGate(build("x"), build("y"), MARKERS);
    expect(gate.stale?.map((marker) => marker.id)).toEqual(["__room3dLab"]);
    expect(gateFails(gate)).toBe(true);
  });

  it("fails on a dev marker of the learner app in the runtime build, but does not need it in the labs build", () => {
    const dev: Marker = { id: "__workbenchWeb", kind: "dev", what: "the bridge", pattern: /__workbenchWeb\b/ };
    const clean = markerGate(build("x"), build("__room3dLab"), [...MARKERS, dev]);
    expect(clean.stale).toEqual([]);
    expect(gateFails(clean)).toBe(false);
    const found = markerGate(build("globalThis.__workbenchWeb={}"), build("__room3dLab"), [...MARKERS, dev]);
    expect(found.found.map((item) => item.marker.id)).toEqual(["__workbenchWeb"]);
    expect(gateFails(found)).toBe(true);
  });

  it("does not check the labs build when there is none", () => {
    expect(markerGate(build("x"), null, MARKERS).stale).toBeNull();
  });
});
